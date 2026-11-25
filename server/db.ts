/**
 * 数据层：better-sqlite3 连接、schema 初始化、预设种子数据、路径归一化、事务封装。
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';

export type DB = Database.Database;

let db: DB | null = null;

/** "未分类" 固定类型名（自由输入、不可删改） */
export const UNCLASSIFIED_NAME = '未分类';

/** 预设标签类型种子 */
const PRESET_TYPES: Array<{ name: string; mode: 'enum' | 'free'; values?: string[]; hidden?: 0 | 1 }> = [
  { name: '物料类型', mode: 'free' },
  { name: '用途标签', mode: 'free' },
  { name: '适用渠道', mode: 'free' },
  { name: '保密级别', mode: 'enum', values: ['公开', '内部', '机密'] },
  { name: '版本状态', mode: 'enum', values: ['草稿', '评审中', '定稿', '归档'] },
  { name: '所属产品/项目', mode: 'free' },
  { name: '名称标签', mode: 'free' },
  { name: '重要程度', mode: 'enum', values: ['高', '中', '低'] },
  { name: '内容说明', mode: 'free', hidden: 1 },
  { name: UNCLASSIFIED_NAME, mode: 'free' },
];

/** 路径归一化键：resolve → 反斜杠转正斜杠 → 去尾随分隔符 → 转小写（Windows 判重用） */
export function normalizePath(p: string): string {
  const resolved = path.resolve(String(p ?? '')).trim();
  return resolved.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
}

/** 定位 schema.sql：兼容源码运行（__dirname=server/）与编译运行（__dirname=dist-server/） */
function findSchemaFile(): string {
  const candidates = [
    path.join(__dirname, 'schema.sql'),
    path.join(__dirname, '..', 'server', 'schema.sql'),
    path.join(process.cwd(), 'server', 'schema.sql'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`找不到 schema.sql，尝试过：${candidates.join(' , ')}`);
}

/** 打开数据库并初始化 schema 与种子数据 */
function openAndSeed(dbPath: string): DB {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const conn = new Database(dbPath);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  conn.exec(fs.readFileSync(findSchemaFile(), 'utf-8'));
  seedIfEmpty(conn);
  backfillFreeDictValues(conn);
  return conn;
}

/** 仅当 tag_types 为空时写入预设类型（避免覆盖用户删改） */
function seedIfEmpty(conn: DB): void {
  const count = (conn.prepare('SELECT COUNT(*) AS c FROM tag_types').get() as { c: number }).c;
  if (count > 0) return;
  const now = Date.now();
  const insType = conn.prepare(
    'INSERT INTO tag_types (name, input_mode, sort_order, hidden_in_filter, created_at) VALUES (?,?,?,?,?)',
  );
  const insValue = conn.prepare(
    'INSERT INTO tag_values (type_id, value, sort_order) VALUES (?,?,?)',
  );
  const seed = conn.transaction(() => {
    PRESET_TYPES.forEach((t, i) => {
      const r = insType.run(t.name, t.mode, i, t.hidden ?? 0, now);
      if (t.values && t.values.length) {
        t.values.forEach((v, j) => insValue.run(Number(r.lastInsertRowid), v, j));
      }
    });
  });
  seed();
}

/**
 * 回填：把自由类型（含"未分类"）已使用但未登记进字典（tag_values）的值补齐，
 * 使这些值在设置界面拥有字典 id，可改名 / 移动 / 删除。幂等，每次启动执行。
 */
function backfillFreeDictValues(conn: DB): void {
  conn.exec(`
    INSERT INTO tag_values (type_id, value, sort_order)
    SELECT t.type_id, t.value,
           COALESCE((SELECT MAX(v2.sort_order) FROM tag_values v2 WHERE v2.type_id = t.type_id), -1) + 1
    FROM tags t
    JOIN tag_types tt ON tt.id = t.type_id
    WHERE tt.input_mode = 'free'
      AND NOT EXISTS (SELECT 1 FROM tag_values v WHERE v.type_id = t.type_id AND v.value = t.value)
    GROUP BY t.type_id, t.value
  `);
}

/**
 * 初始化（或替换）全局数据库连接。
 * @param dbPath 显式指定库文件路径（测试隔离用）；缺省用 config.dataDir/tagvault.db
 */
export function initDb(dbPath?: string): DB {
  const p = dbPath ?? path.join(loadConfig().dataDir, 'tagvault.db');
  db = openAndSeed(p);
  return db;
}

/** 获取全局数据库连接（未初始化时按配置懒初始化） */
export function getDb(): DB {
  if (!db) initDb();
  return db as DB;
}

/** 测试钩子：替换/清空全局连接 */
export function setDb(conn: DB | null): void {
  db = conn;
}

/** 关闭当前连接 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** 同步事务封装 */
export function withTransaction<T>(fn: () => T): T {
  const conn = getDb();
  return conn.transaction(fn)();
}

/** 文件行结构 */
export interface FileRow {
  id: number;
  dir_id: number;
  path: string;
  name: string;
  ext: string | null;
  category: string;
  size: number;
  mtime: number;
  missing: number;
  created_at: number;
  updated_at: number;
}

/** 标签类型行结构 */
export interface TagTypeRow {
  id: number;
  name: string;
  input_mode: 'enum' | 'free';
  sort_order: number;
  hidden_in_filter: number;
  created_at: number;
}
