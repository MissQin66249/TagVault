/**
 * 扫描器：递归扫描已索引目录，按扩展名归类九类，分批事务 upsert files，
 * 盘上消失的文件标 missing=1，进度通过 SSE 广播。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDb, withTransaction, normalizePath, FileRow } from '../db';
import { broadcast } from '../events';

/** 每批入库条数（一个事务） */
const BATCH_SIZE = 500;

/** 九类文件扩展名映射（小写、含点） */
const CATEGORY_EXTS: Record<string, string[]> = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tif', '.tiff', '.heic', '.avif'],
  pdf: ['.pdf'],
  word: ['.doc', '.docx', '.docm', '.dot', '.wps', '.wpt', '.rtf', '.odt'],
  sheet: ['.xls', '.xlsx', '.xlsm', '.xlt', '.xltx', '.et', '.ett', '.csv', '.ods'],
  ppt: ['.ppt', '.pptx', '.pps', '.pot', '.dps', '.dpt', '.odp'],
  text: [
    '.txt', '.md', '.markdown', '.log', '.json', '.xml', '.yaml', '.yml', '.ini', '.conf',
    '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java',
    '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.sql', '.sh', '.bat', '.ps1',
  ],
  video: ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.rmvb', '.3gp', '.ts2'],
  audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.ape', '.opus'],
  archive: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso', '.cab', '.tgz'],
};

/** 扩展名 → 九类（image/pdf/word/sheet/ppt/text/video/audio/archive/other） */
export function categorizeByExt(extRaw: string | null | undefined): string {
  const ext = (extRaw ?? '').toLowerCase();
  for (const [cat, exts] of Object.entries(CATEGORY_EXTS)) {
    if (exts.includes(ext)) return cat;
  }
  return 'other';
}

export interface DirRow {
  id: number;
  path: string;
  path_key: string;
  name: string;
  last_scanned_at: number | null;
  created_at: number;
}

interface ScanState {
  directoryId: number;
  dirPath: string;
  scanned: number;
  total: number;
}

/** 进行中的扫描状态（directoryId → state） */
const runningScans = new Map<number, ScanState>();

/** GET /api/scan/status 用：当前扫描状态 */
export function getScanStatus(): { running: boolean; directoryId: number | null; dirPath: string | null; scanned: number; total: number } {
  const any = runningScans.values().next();
  if (any.done) {
    return { running: false, directoryId: null, dirPath: null, scanned: 0, total: 0 };
  }
  const s = any.value;
  return { running: true, directoryId: s.directoryId, dirPath: s.dirPath, scanned: s.scanned, total: s.total };
}

interface ExistingFile {
  id: number;
  path: string;
  size: number;
  mtime: number;
}

function fileKey(p: string): string {
  return normalizePath(p);
}

/**
 * 重命名/移动接力：文件在磁盘上换了位置（或改名），数据库里存在同尺寸、同修改时间的
 * 缺失行 → 直接把该行"接盘"到新路径（保留 file_id，已挂标签随之保留，FTS 由触发器同步）。
 * 纯启发式：同尺寸+同 mtime 的文件视为同一文件。
 * @returns 是否接力成功
 */
function relinkMovedFile(
  dirId: number,
  filePath: string,
  name: string,
  ext: string | null,
  category: string,
  statSize: number,
  statMtime: number,
): boolean {
  const db = getDb();
  const cand = db
    .prepare(
      'SELECT id FROM files WHERE missing = 1 AND size = ? AND mtime = ? AND path != ? ORDER BY updated_at DESC LIMIT 1',
    )
    .get(statSize, statMtime, filePath) as { id: number } | undefined;
  if (!cand) return false;
  db.prepare(
    `UPDATE files SET dir_id=?, path=?, name=?, ext=?, category=?, missing=0, updated_at=? WHERE id=?`,
  ).run(dirId, filePath, name, ext, category, Date.now(), cand.id);
  return true;
}

/**
 * 单文件 upsert（watcher 变更同步也复用）。
 * 新文件插入；已存在且 size/mtime 有变化则更新并清 missing；
 * 新路径若能匹配到同尺寸同修改时间的缺失行（移动/改名场景），接力该行以保留标签。
 * @returns 是否有写库动作
 */
export function upsertFileStat(dirId: number, filePath: string, statSize: number, statMtime: number): boolean {
  const db = getDb();
  const now = Date.now();
  const name = path.basename(filePath);
  const ext = path.extname(name).toLowerCase() || null;
  const category = categorizeByExt(ext);
  const existing = db
    .prepare('SELECT id, size, mtime, missing FROM files WHERE path = ?')
    .get(filePath) as { id: number; size: number; mtime: number; missing: number } | undefined;

  if (existing) {
    if (existing.size === statSize && existing.mtime === statMtime && existing.missing === 0) {
      return false; // 无变化，跳过（避免 FTS 无谓重建）
    }
    db.prepare('UPDATE files SET size=?, mtime=?, missing=0, updated_at=? WHERE id=?').run(
      statSize, statMtime, now, existing.id,
    );
    return true;
  }
  // 新路径：先尝试移动/改名接力（保留旧 file_id 与标签）
  if (relinkMovedFile(dirId, filePath, name, ext, category, statSize, statMtime)) {
    return true;
  }
  db.prepare(
    `INSERT INTO files (dir_id, path, name, ext, category, size, mtime, missing, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,0,?,?)`,
  ).run(dirId, filePath, name, ext, category, statSize, statMtime, now, now);
  return true;
}

/**
 * 扫描一个目录（递归、分批事务入库、进度广播、缺失标记）。
 * @returns 扫描统计
 */
export async function scanDirectory(dirId: number): Promise<{ scanned: number; added: number; updated: number; missing: number }> {
  const db = getDb();
  const dir = db.prepare('SELECT * FROM directories WHERE id = ?').get(dirId) as DirRow | undefined;
  if (!dir) throw new Error(`目录不存在：id=${dirId}`);

  const state: ScanState = { directoryId: dirId, dirPath: dir.path, scanned: 0, total: 0 };
  runningScans.set(dirId, state);
  broadcast('scan-start', { directoryId: dirId, dirPath: dir.path });

  // 现有文件快照（用于缺失标记与增量判断）
  const existingRows = db
    .prepare('SELECT id, path, size, mtime FROM files WHERE dir_id = ?')
    .all(dirId) as ExistingFile[];
  const existingByKey = new Map<string, ExistingFile>(existingRows.map((f) => [fileKey(f.path), f]));
  const seenIds = new Set<number>();

  let added = 0;
  let updated = 0;

  /** 新路径延迟入库：等缺失标记完成后处理，让"移动接力"能匹配到缺失行 */
  const pendingInserts: Array<{ fullPath: string; size: number; mtime: number }> = [];

  const stmtMarkMissing = db.prepare('UPDATE files SET missing=1, updated_at=? WHERE id=?');

  // 批量缓冲：单批一个事务提交
  type Op = () => void;
  let buffer: Op[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    const ops = buffer;
    buffer = [];
    withTransaction(() => {
      for (const op of ops) op();
    });
    broadcast('scan-progress', {
      directoryId: dirId,
      scanned: state.scanned,
      total: Math.max(state.total, state.scanned),
    });
  };

  const handleFile = async (fullPath: string): Promise<void> => {
    let st;
    try {
      st = await fs.stat(fullPath);
    } catch {
      return; // 扫描中消失的文件直接跳过
    }
    if (!st.isFile()) return;
    const key = fileKey(fullPath);
    const existing = existingByKey.get(key);
    const size = st.size;
    const mtime = Math.round(st.mtimeMs);
    state.scanned += 1;
    state.total = state.scanned;

    if (existing) {
      seenIds.add(existing.id);
      if (existing.size !== size || existing.mtime !== mtime) {
        buffer.push(() => {
          upsertFileStat(dirId, fullPath, size, mtime);
        });
        updated += 1;
      }
    } else {
      // 新路径：先攒着，等缺失标记完成后再入库——
      // 这样"移动/改名接力"才能匹配到刚被标缺失的旧行（保留标签）
      pendingInserts.push({ fullPath, size, mtime });
      added += 1;
    }
    if (buffer.length >= BATCH_SIZE) flush();
  };

  const walk = async (dirPath: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return; // 无权限/已删除的子目录跳过
    }
    for (const e of entries) {
      const full = path.join(dirPath, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        await handleFile(full);
      }
    }
  };

  try {
    await walk(dir.path);
    flush();

    // 盘上已消失的文件标 missing=1（先于新路径入库，使"移动/改名接力"可匹配）
    const missingRows = existingRows.filter((f) => !seenIds.has(f.id));
    if (missingRows.length > 0) {
      withTransaction(() => {
        for (const f of missingRows) stmtMarkMissing.run(Date.now(), f.id);
      });
    }

    // 新路径入库（此时接力匹配可用：同尺寸同 mtime 的缺失行会被复用而非新插）
    withTransaction(() => {
      for (const p of pendingInserts) upsertFileStat(dirId, p.fullPath, p.size, p.mtime);
    });
    flush();

    db.prepare('UPDATE directories SET last_scanned_at=? WHERE id=?').run(Date.now(), dirId);

    const result = { scanned: state.scanned, added, updated, missing: missingRows.length };
    broadcast('scan-done', { directoryId: dirId, ...result });
    return result;
  } finally {
    runningScans.delete(dirId);
  }
}

/** 触发后台扫描（不阻塞调用方；错误仅打日志） */
export function scanDirectoryAsync(dirId: number): void {
  scanDirectory(dirId).catch((e) => {
    console.error(`[TagVault] 扫描目录 id=${dirId} 失败：`, e);
    broadcast('scan-error', { directoryId: dirId, message: String(e) });
  });
}

/** 供测试/路由用的文件行查询 */
export function getFileById(id: number): FileRow | undefined {
  return getDb().prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined;
}
