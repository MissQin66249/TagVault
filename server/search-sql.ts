/**
 * 搜索 SQL 构建器：
 * - 关键词（文件名/路径/标签值）统一走 search_fts MATCH（trigram）；
 *   unicode 字符数 <3 的短词自动降级 LIKE（trigram 最小 3 字符）；
 * - 字段筛选（`类型:值` 解析结果 + 面板勾选）：每类型一个 EXISTS，同类型 IN=或，类型间 AND；
 * - 与 category / missing / 只看定稿 / 排序 / 分页组合。
 */
import { getDb } from './db';
import { escapeLike, escapeFtsPhrase, charLength, parsePaging, parseSort } from './util';

export interface FieldCond {
  typeId: number;
  values: string[];
}

export interface SearchOptions {
  keywords: string[];
  fieldConds: FieldCond[];
  categories?: string[];
  /** '1' 只看缺失；'0' 只看正常；undefined 全部 */
  missing?: '0' | '1';
  /** 只看定稿（版本状态类标签值含"定稿"） */
  finalOnly?: boolean;
  /** 只看未打标签文件（missing=0 且无任何标签由调用方叠加，此处仅过滤无标签） */
  untagged?: boolean;
  sort?: 'name' | 'mtime' | 'size';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

interface WhereResult {
  whereSql: string;
  params: unknown[];
}

/** 构建全部 WHERE 条件（不含排序分页） */
function buildWhere(opts: SearchOptions): WhereResult {
  const conds: string[] = [];
  const params: unknown[] = [];

  // 关键词：FTS MATCH / 短词 LIKE 降级
  for (const kwRaw of opts.keywords) {
    const kw = kwRaw.trim();
    if (!kw) continue;
    if (charLength(kw) >= 3) {
      conds.push(
        `f.id IN (SELECT ref_id FROM search_fts WHERE search_fts MATCH ? AND kind IN ('file','tag'))`,
      );
      params.push(escapeFtsPhrase(kw));
    } else {
      const like = `%${escapeLike(kw)}%`;
      conds.push(
        `(f.name LIKE ? ESCAPE '\\' OR f.path LIKE ? ESCAPE '\\' OR EXISTS ` +
          `(SELECT 1 FROM tags t2 WHERE t2.file_id = f.id AND t2.value LIKE ? ESCAPE '\\'))`,
      );
      params.push(like, like, like);
    }
  }

  // 字段筛选：每类型一个 EXISTS（同类型多值 = 或；类型之间 = 且）
  for (const cond of opts.fieldConds) {
    if (!cond.values || cond.values.length === 0) continue;
    const orParts = cond.values.map(() => `(t.value = ? OR t.value LIKE ('%' || ? || '%') ESCAPE '\\')`);
    const orParams: unknown[] = [];
    for (const v of cond.values) {
      orParams.push(v, escapeLike(v));
    }
    conds.push(
      `EXISTS (SELECT 1 FROM tags t WHERE t.file_id = f.id AND t.type_id = ? AND (${orParts.join(' OR ')}))`,
    );
    params.push(cond.typeId, ...orParams);
  }

  // 文件类别
  if (opts.categories && opts.categories.length > 0) {
    conds.push(`f.category IN (${opts.categories.map(() => '?').join(',')})`);
    params.push(...opts.categories);
  }

  // 缺失过滤
  if (opts.missing === '1') {
    conds.push('f.missing = 1');
  } else if (opts.missing === '0') {
    conds.push('f.missing = 0');
  }

  // 只看定稿：任意类型下值含"定稿"即可命中（不限定类型名，用户自定义类型同样生效）
  if (opts.finalOnly) {
    conds.push(
      `EXISTS (SELECT 1 FROM tags t3 JOIN tag_types tt3 ON tt3.id = t3.type_id ` +
        `WHERE t3.file_id = f.id AND t3.value LIKE '%定稿%')`,
    );
  }

  // 只看未打标签：无任何标签记录的文件
  if (opts.untagged) {
    conds.push('NOT EXISTS (SELECT 1 FROM tags t WHERE t.file_id = f.id)');
  }

  return {
    whereSql: conds.length ? `WHERE ${conds.join(' AND ')}` : '',
    params,
  };
}

/** ORDER BY 子句 */
function orderClause(sort: 'name' | 'mtime' | 'size', order: 'asc' | 'desc'): string {
  const col = sort === 'mtime' ? 'f.mtime' : sort === 'size' ? 'f.size' : 'f.name COLLATE NOCASE';
  return `ORDER BY ${col} ${order.toUpperCase()}, f.id ASC`;
}

export interface FileItem {
  id: number;
  dirId: number;
  path: string;
  name: string;
  ext: string | null;
  category: string;
  size: number;
  mtime: number;
  missing: number;
  tags: Array<{ typeId: number; typeName: string; value: string }>;
  hasThumb: boolean;
}

export interface SearchResult {
  total: number;
  page: number;
  pageSize: number;
  items: FileItem[];
}

/** 执行搜索（分页 + 每文件标签列表） */
export function runSearch(opts: SearchOptions): SearchResult {
  const db = getDb();
  const { whereSql, params } = buildWhere(opts);
  const { sort, order } = parseSort(opts.sort, opts.order);
  const { page, pageSize, offset } = parsePaging(opts.page, opts.pageSize);

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM files f ${whereSql}`).get(...params) as { c: number }
  ).c;

  const rows = db
    .prepare(
      `SELECT f.* FROM files f ${whereSql} ${orderClause(sort, order)} LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset) as Array<{
    id: number;
    dir_id: number;
    path: string;
    name: string;
    ext: string | null;
    category: string;
    size: number;
    mtime: number;
    missing: number;
  }>;

  const items: FileItem[] = rows.map((r) => ({
    id: r.id,
    dirId: r.dir_id,
    path: r.path,
    name: r.name,
    ext: r.ext,
    category: r.category,
    size: r.size,
    mtime: r.mtime,
    missing: r.missing,
    tags: [],
    hasThumb: r.category === 'image',
  }));

  // 批量取标签
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const tagRows = db
      .prepare(
        `SELECT t.file_id, t.type_id, tt.name AS type_name, t.value
         FROM tags t JOIN tag_types tt ON tt.id = t.type_id
         WHERE t.file_id IN (${placeholders}) ORDER BY tt.sort_order, t.id`,
      )
      .all(...ids) as Array<{ file_id: number; type_id: number; type_name: string; value: string }>;
    const byFile = new Map<number, FileItem>();
    for (const it of items) byFile.set(it.id, it);
    for (const tr of tagRows) {
      const it = byFile.get(tr.file_id);
      if (it) it.tags.push({ typeId: tr.type_id, typeName: tr.type_name, value: tr.value });
    }
  }

  return { total, page, pageSize, items };
}

export interface Facets {
  categories: Record<string, number>;
  tagTypes: Array<{
    id: number;
    name: string;
    inputMode: 'enum' | 'free';
    hiddenInFilter: number;
    values: Array<{ id: number | null; value: string; count: number }>;
  }>;
}

/** 全量 facets（文件类型计数 + 各标签类型字典值/自由值计数） */
export function buildFacets(): Facets {
  const db = getDb();
  const catRows = db
    .prepare('SELECT category, COUNT(*) AS c FROM files GROUP BY category')
    .all() as Array<{ category: string; c: number }>;
  const categories: Record<string, number> = {};
  for (const r of catRows) categories[r.category] = r.c;

  const types = db
    .prepare('SELECT id, name, input_mode, hidden_in_filter FROM tag_types ORDER BY sort_order, id')
    .all() as Array<{ id: number; name: string; input_mode: 'enum' | 'free'; hidden_in_filter: number }>;

  const dictStmt = db.prepare(
    `SELECT v.id, v.value,
            (SELECT COUNT(*) FROM tags t WHERE t.type_id = v.type_id AND t.value = v.value) AS c
     FROM tag_values v WHERE v.type_id = ? ORDER BY v.sort_order, v.id`,
  );
  const freeStmt = db.prepare(
    `SELECT value, COUNT(*) AS c FROM tags WHERE type_id = ? AND value NOT IN
     (SELECT value FROM tag_values WHERE type_id = ?) GROUP BY value ORDER BY c DESC, value`,
  );

  const tagTypes: Facets['tagTypes'] = types.map((t) => {
    const dict = dictStmt.all(t.id) as Array<{ id: number; value: string; c: number }>;
    const free = freeStmt.all(t.id, t.id) as Array<{ value: string; c: number }>;
    return {
      id: t.id,
      name: t.name,
      inputMode: t.input_mode,
      hiddenInFilter: t.hidden_in_filter,
      values: [
        ...dict.map((d) => ({ id: d.id as number | null, value: d.value, count: d.c })),
        ...free.map((f) => ({ id: null, value: f.value, count: f.c })),
      ],
    };
  });

  return { categories, tagTypes };
}
