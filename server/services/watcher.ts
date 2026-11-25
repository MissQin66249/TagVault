/**
 * 文件监听：chokidar 监听所有已索引目录，增/删/改 ≤10s 内同步 files 表。
 * 事件做 500ms 合并去抖后批量处理。
 */
import chokidar from 'chokidar';
import path from 'node:path';
import { promises as fsp, statSync } from 'node:fs';
import { getDb, withTransaction } from '../db';
import { broadcast } from '../events';
import { upsertFileStat } from './scanner';

const watchers = new Map<number, chokidar.FSWatcher>();
const pendingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const pendingPaths = new Map<number, Set<string>>();

/** 防抖间隔（ms） */
const DEBOUNCE_MS = 500;

function scheduleFlush(dirId: number): void {
  if (pendingTimers.has(dirId)) return;
  const timer = setTimeout(() => {
    pendingTimers.delete(dirId);
    flushPending(dirId);
  }, DEBOUNCE_MS);
  // 进程退出不因等待定时器被阻塞
  (timer as unknown as { unref?: () => void }).unref?.();
  pendingTimers.set(dirId, timer);
}

function flushPending(dirId: number): void {
  const paths = pendingPaths.get(dirId);
  if (!paths || paths.size === 0) return;
  pendingPaths.set(dirId, new Set());
  const db = getDb();
  const dir = db.prepare('SELECT id, path FROM directories WHERE id = ?').get(dirId) as { id: number; path: string } | undefined;
  if (!dir) return;

  // 先区分：磁盘上仍在的（可能新增/修改）与已消失的（标缺失）
  const present: Array<{ p: string; size: number; mtime: number }> = [];
  const vanished: string[] = [];
  for (const p of paths) {
    let st;
    try {
      st = statSync(p);
    } catch {
      vanished.push(p);
      continue;
    }
    if (!st.isFile()) continue;
    present.push({ p, size: st.size, mtime: Math.round(st.mtimeMs) });
  }

  const changed: string[] = [];
  const stmtMissing = db.prepare('UPDATE files SET missing=1, updated_at=? WHERE path=?');
  const now = Date.now();
  withTransaction(() => {
    // 1) 先标缺失——同批次里的"移动/改名"新路径随后可接力缺失行（保留标签）
    for (const p of vanished) {
      stmtMissing.run(now, p);
      changed.push(p);
    }
    // 2) 再 upsert 在盘文件：新路径若匹配到刚标缺失的同尺寸同 mtime 行则接力
    for (const a of present) {
      if (upsertFileStat(dirId, a.p, a.size, a.mtime)) {
        changed.push(a.p);
      }
    }
  });
  if (changed.length > 0) {
    broadcast('files-changed', { directoryId: dirId, paths: changed });
  }
}

function markPending(dirId: number, filePath: string): void {
  let set = pendingPaths.get(dirId);
  if (!set) {
    set = new Set();
    pendingPaths.set(dirId, set);
  }
  set.add(filePath);
  scheduleFlush(dirId);
}

/** 监听单个已索引目录 */
export function watchDirectory(dirId: number, dirPath: string): void {
  unwatchDirectory(dirId);
  const watcher = chokidar.watch(dirPath, {
    ignoreInitial: true,
    persistent: true,
    ignorePermissionErrors: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  const onFsEvent = (p: string): void => markPending(dirId, p);
  watcher.on('add', onFsEvent);
  watcher.on('change', onFsEvent);
  // rename 在 Windows 上表现为 unlink+add：unlink 标缺失、add 恢复/新建
  watcher.on('unlink', onFsEvent);
  watcher.on('unlinkDir', (dir) => markPendingDir(dirId, dir));
  watcher.on('error', (err) => console.error(`[TagVault] watcher(id=${dirId}) 错误：`, err));
  watchers.set(dirId, watcher);
}

/** 子目录整体消失：其下所有已入库文件标缺失 */
function markPendingDir(dirId: number, dirPath: string): void {
  const db = getDb();
  const rows = db
    .prepare("SELECT path FROM files WHERE dir_id=? AND path LIKE ? ESCAPE '\\'")
    .all(dirId, dirPath.replace(/[\\%_]/g, (m) => '\\' + m) + path.sep + '%') as Array<{ path: string }>;
  for (const r of rows) markPending(dirId, r.path);
}

/** 停止监听某个目录 */
export function unwatchDirectory(dirId: number): void {
  const w = watchers.get(dirId);
  if (w) {
    w.close().catch(() => undefined);
    watchers.delete(dirId);
  }
  const timer = pendingTimers.get(dirId);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(dirId);
  }
}

/** 启动时调用：监听数据库中所有已索引目录 */
export function watchAllIndexed(): void {
  const db = getDb();
  const dirs = db.prepare('SELECT id, path FROM directories').all() as Array<{ id: number; path: string }>;
  for (const d of dirs) {
    try {
      watchDirectory(d.id, d.path);
    } catch (e) {
      console.error(`[TagVault] 监听目录失败：${d.path}`, e);
    }
  }
  console.log(`[TagVault] 文件监听已启动（${dirs.length} 个目录）`);
}

/** 全部关闭（进程退出用） */
export function closeAllWatchers(): void {
  for (const id of Array.from(watchers.keys())) unwatchDirectory(id);
}
