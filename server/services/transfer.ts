/**
 * 数据导入导出：
 * - JSON 导出：类型名对齐结构，可跨库还原；
 * - CSV 导出：UTF-8 BOM，Excel 可直接打开；
 * - JSON 导入：按类型名对齐还原（缺失类型自动创建），返回统计。
 */
import { getDb, withTransaction } from '../db';
import { ApiError, CODE } from '../http';

export interface ExportTagType {
  name: string;
  input_mode: 'enum' | 'free';
  hidden: 0 | 1;
  values: string[];
}

export interface ExportFile {
  path: string;
  name: string;
  size: number;
  mtime: number;
  category: string;
  tags: Record<string, string[]>;
}

export interface ExportPayload {
  version: number;
  exportedAt: number;
  tagTypes: ExportTagType[];
  files: ExportFile[];
}

/** 导出 JSON 结构（类型名对齐） */
export function exportJson(): ExportPayload {
  const db = getDb();
  const types = db
    .prepare('SELECT * FROM tag_types ORDER BY sort_order, id')
    .all() as Array<{ id: number; name: string; input_mode: 'enum' | 'free'; hidden_in_filter: number }>;
  const valueStmt = db.prepare('SELECT value FROM tag_values WHERE type_id = ? ORDER BY sort_order, id');

  const tagTypes: ExportTagType[] = types.map((t) => ({
    name: t.name,
    input_mode: t.input_mode,
    hidden: t.hidden_in_filter === 1 ? 1 : 0,
    values: (valueStmt.all(t.id) as Array<{ value: string }>).map((v) => v.value),
  }));

  const files = db
    .prepare('SELECT path, name, size, mtime, category FROM files ORDER BY path')
    .all() as Array<{ path: string; name: string; size: number; mtime: number; category: string }>;
  const tagStmt = db.prepare(
    `SELECT t.value, tt.name AS type_name FROM tags t JOIN tag_types tt ON tt.id = t.type_id
     WHERE t.file_id = ? ORDER BY tt.sort_order, t.id`,
  );
  const fileIdStmt = db.prepare('SELECT id FROM files WHERE path = ?');

  const exportFiles: ExportFile[] = files.map((f) => {
    const fid = (fileIdStmt.get(f.path) as { id: number }).id;
    const tags: Record<string, string[]> = {};
    for (const t of tagStmt.all(fid) as Array<{ value: string; type_name: string }>) {
      (tags[t.type_name] ??= []).push(t.value);
    }
    return { path: f.path, name: f.name, size: f.size, mtime: f.mtime, category: f.category, tags };
  });

  return { version: 1, exportedAt: Date.now(), tagTypes, files: exportFiles };
}

/** CSV 转义：双引号翻倍，两侧包引号 */
function csvCell(s: string): string {
  return `"${String(s ?? '').replace(/"/g, '""')}"`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 导出 CSV（UTF-8 BOM；列：路径/名称/类型/大小/修改时间/各标签类型列） */
export function exportCsv(): string {
  const payload = exportJson();
  const typeNames = payload.tagTypes.map((t) => t.name);
  const header = ['路径', '名称', '类型', '大小', '修改时间', ...typeNames];
  const lines = [header.map(csvCell).join(',')];
  for (const f of payload.files) {
    const row = [
      f.path,
      f.name,
      f.category,
      String(f.size),
      formatTime(f.mtime),
      ...typeNames.map((tn) => (f.tags[tn] ?? []).join(';')),
    ];
    lines.push(row.map(csvCell).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

export interface ImportStats {
  restoredTypes: number;
  restoredTags: number;
  restoredValues: number;
  unmatched: string[];
}

/** 归一化导入载荷：接受 {data:{...}} 或直接导出结构 */
export function normalizeImportPayload(body: unknown): ExportPayload {
  const obj = (body as { data?: unknown })?.data ?? body;
  const p = obj as Partial<ExportPayload>;
  if (!p || !Array.isArray(p.tagTypes) || !Array.isArray(p.files)) {
    throw new ApiError(CODE.EMPTY_VALUE, '导入数据格式不正确：需要 {tagTypes:[], files:[]}');
  }
  return p as ExportPayload;
}

/**
 * 导入还原：按类型名对齐（缺失类型自动创建）；
 * 文件按 path 精确匹配（先扫描目录入库再导入即可还原标签）。
 */
export function importJson(payload: ExportPayload): ImportStats {
  const db = getDb();
  const stats: ImportStats = { restoredTypes: 0, restoredTags: 0, restoredValues: 0, unmatched: [] };

  withTransaction(() => {
    // 1) 类型与字典值
    const typeNameToId = new Map<string, number>();
    const insType = db.prepare(
      'INSERT OR IGNORE INTO tag_types (name, input_mode, sort_order, hidden_in_filter, created_at) VALUES (?,?,?,?,?)',
    );
    const insValue = db.prepare('INSERT OR IGNORE INTO tag_values (type_id, value, sort_order) VALUES (?,?,?)');
    const existingTypes = db.prepare('SELECT id, name FROM tag_types').all() as Array<{ id: number; name: string }>;
    for (const t of existingTypes) typeNameToId.set(t.name, t.id);

    let sort = existingTypes.length;
    const now = Date.now();
    for (const t of payload.tagTypes ?? []) {
      const name = String(t.name ?? '').trim();
      if (!name) continue;
      if (!typeNameToId.has(name)) {
        const r = insType.run(name, t.input_mode === 'enum' ? 'enum' : 'free', sort++, t.hidden ? 1 : 0, now);
        typeNameToId.set(name, Number(r.lastInsertRowid));
        stats.restoredTypes += 1;
      }
      const typeId = typeNameToId.get(name) as number;
      if (Array.isArray(t.values)) {
        (t.values as string[]).forEach((v, i) => {
          const r = insValue.run(typeId, String(v), i);
          stats.restoredValues += Number(r.changes);
        });
      }
    }

    // 2) 文件按 path 匹配 + 打标
    const findFile = db.prepare('SELECT id FROM files WHERE path = ?');
    const insTag = db.prepare(
      'INSERT OR IGNORE INTO tags (file_id, type_id, value, created_at) VALUES (?,?,?,?)',
    );
    for (const f of payload.files ?? []) {
      if (!f || typeof f.path !== 'string' || !f.path) continue;
      const hit = findFile.get(f.path) as { id: number } | undefined;
      if (!hit) {
        stats.unmatched.push(f.path);
        continue;
      }
      const tags = f.tags ?? {};
      for (const [typeName, values] of Object.entries(tags)) {
        const typeId = typeNameToId.get(typeName);
        if (typeId == null) {
          stats.unmatched.push(`${f.path}#${typeName}`);
          continue;
        }
        if (!Array.isArray(values)) continue;
        for (const v of values) {
          const value = String(v ?? '').trim();
          if (!value) continue;
          const r = insTag.run(hit.id, typeId, value, now);
          stats.restoredTags += Number(r.changes);
        }
      }
    }
  });

  return stats;
}
