/**
 * 标签服务：打标（幂等/枚举白名单/长度上限）、去标、批量、快速添加建议、
 * 未分类自动归组、字典值改名/移动/删除（同步 tags 与 FTS）、类型 CRUD。
 */
import { getDb, withTransaction, TagTypeRow, UNCLASSIFIED_NAME } from '../db';
import { ApiError, CODE } from '../http';
import { escapeLike } from '../util';

/** 标签值/类型名长度上限 */
export const MAX_VALUE_LEN = 100;
export const MAX_TYPE_NAME_LEN = 30;

interface TagItemInput {
  typeId?: number;
  type?: string;
  value: string;
}

export interface TagView {
  typeId: number;
  typeName: string;
  value: string;
}

function validateValue(valueRaw: unknown): string {
  const value = String(valueRaw ?? '').trim();
  if (!value) throw new ApiError(CODE.EMPTY_VALUE, '标签值不能为空');
  if (Array.from(value).length > MAX_VALUE_LEN) {
    throw new ApiError(CODE.VALUE_TOO_LONG, `标签值不能超过 ${MAX_VALUE_LEN} 字符`, { value });
  }
  return value;
}

function getTypeById(id: number): TagTypeRow {
  const t = getDb().prepare('SELECT * FROM tag_types WHERE id = ?').get(id) as TagTypeRow | undefined;
  if (!t) throw new ApiError(CODE.NOT_FOUND, `标签类型不存在：id=${id}`);
  return t;
}

function getTypeByName(name: string): TagTypeRow | undefined {
  return getDb().prepare('SELECT * FROM tag_types WHERE name = ?').get(name) as TagTypeRow | undefined;
}

/** "未分类"类型（不存在则创建） */
export function getOrCreateUnclassified(): TagTypeRow {
  const existing = getTypeByName(UNCLASSIFIED_NAME);
  if (existing) return existing;
  const maxSort = (
    getDb().prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM tag_types').get() as { m: number }
  ).m;
  const r = getDb()
    .prepare(
      "INSERT INTO tag_types (name, input_mode, sort_order, hidden_in_filter, created_at) VALUES (?, 'free', ?, 0, ?)",
    )
    .run(UNCLASSIFIED_NAME, maxSort + 1, Date.now());
  return getTypeById(Number(r.lastInsertRowid));
}

function assertIsProtected(type: TagTypeRow, action: string): void {
  if (type.name === UNCLASSIFIED_NAME) {
    throw new ApiError(CODE.PROTECTED, `"${UNCLASSIFIED_NAME}"类型不可${action}`);
  }
}

function ensureEnumValueAllowed(type: TagTypeRow, value: string): void {
  if (type.input_mode !== 'enum') return;
  const hit = getDb()
    .prepare('SELECT id FROM tag_values WHERE type_id = ? AND value = ?')
    .get(type.id, value);
  if (!hit) {
    throw new ApiError(CODE.ENUM_NOT_ALLOWED, `枚举类型"${type.name}"不接受字典外的值："${value}"`, {
      typeId: type.id,
      value,
    });
  }
}

/**
 * 自由类型打标时自动把值登记进字典（幂等）。
 * 保证所有实际使用的自由值都有 tag_values.id，可在设置中改名 / 移动 / 删除。
 */
function ensureDictValueForFree(type: TagTypeRow, value: string): void {
  if (type.input_mode !== 'free') return;
  getDb()
    .prepare('INSERT OR IGNORE INTO tag_values (type_id, value, sort_order) VALUES (?,?,?)')
    .run(type.id, value, Date.now());
}

/** 该文件的标签列表（带类型名，camelCase 契约） */
export function listTagsForFile(fileId: number): TagView[] {
  return getDb()
    .prepare(
      `SELECT t.type_id AS "typeId", tt.name AS "typeName", t.value AS "value"
       FROM tags t JOIN tag_types tt ON tt.id = t.type_id
       WHERE t.file_id = ? ORDER BY tt.sort_order, t.id`,
    )
    .all(fileId) as unknown as TagView[];
}

/** 文件是否存在 */
export function requireFileExists(fileId: number): void {
  const f = getDb().prepare('SELECT id FROM files WHERE id = ?').get(fileId);
  if (!f) throw new ApiError(CODE.NOT_FOUND, `文件不存在：id=${fileId}`);
}

/**
 * 给文件打标（幂等 INSERT OR IGNORE）。
 * 条目未指定类型或类型不存在时自动归入"未分类"。
 * @returns 打标后的标签列表
 */
export function addTags(fileId: number, items: TagItemInput[]): TagView[] {
  requireFileExists(fileId);
  const db = getDb();
  withTransaction(() => {
    const ins = db.prepare(
      'INSERT OR IGNORE INTO tags (file_id, type_id, value, created_at) VALUES (?,?,?,?)',
    );
    const now = Date.now();
    for (const raw of items ?? []) {
      const value = validateValue(raw.value);
      let type: TagTypeRow | undefined;
      if (raw.typeId != null) {
        type = db.prepare('SELECT * FROM tag_types WHERE id = ?').get(raw.typeId) as TagTypeRow | undefined;
      } else if (raw.type) {
        type = getTypeByName(String(raw.type).trim());
      }
      if (!type) type = getOrCreateUnclassified();
      ensureEnumValueAllowed(type, value);
      ensureDictValueForFree(type, value);
      ins.run(fileId, type.id, value, now);
    }
  });
  return listTagsForFile(fileId);
}

/** 去标（类型+值精确匹配；枚举值不必在字典内也可去） */
export function removeTags(fileId: number, items: TagItemInput[]): TagView[] {
  requireFileExists(fileId);
  const db = getDb();
  withTransaction(() => {
    const del = db.prepare('DELETE FROM tags WHERE file_id = ? AND type_id = ? AND value = ?');
    for (const raw of items ?? []) {
      const value = String(raw.value ?? '').trim();
      if (!value) throw new ApiError(CODE.EMPTY_VALUE, '标签值不能为空');
      let typeId: number | null = null;
      if (raw.typeId != null) {
        typeId = raw.typeId;
      } else if (raw.type) {
        const t = getTypeByName(String(raw.type).trim());
        typeId = t ? t.id : null;
      }
      if (typeId == null) continue;
      del.run(fileId, typeId, value);
    }
  });
  return listTagsForFile(fileId);
}

/**
 * 批量打标/去标（单事务）。
 * 去标时 values 为空数组 → 移除所选文件该类型下的全部标签（按类型整类去标）。
 * @param action 'add' | 'remove'
 * @returns 受影响的标签行数
 */
export function batchTag(fileIds: number[], typeId: number, values: string[], action: 'add' | 'remove'): number {
  const db = getDb();
  const type = getTypeById(typeId);
  if (action === 'remove' && (values ?? []).length === 0) {
    // 整类去标：不校验具体值
    let removedAll = 0;
    withTransaction(() => {
      const del = db.prepare('DELETE FROM tags WHERE file_id = ? AND type_id = ?');
      for (const fileId of fileIds) {
        removedAll += Number(del.run(fileId, type.id).changes);
      }
    });
    return removedAll;
  }
  const cleanValues = (values ?? []).map((v) => validateValue(v));
  if (cleanValues.length === 0) throw new ApiError(CODE.EMPTY_VALUE, '标签值不能为空');
  if (action === 'add') {
    for (const v of cleanValues) ensureEnumValueAllowed(type, v);
    for (const v of cleanValues) ensureDictValueForFree(type, v);
  }
  let affected = 0;
  withTransaction(() => {
    if (action === 'add') {
      const ins = db.prepare(
        'INSERT OR IGNORE INTO tags (file_id, type_id, value, created_at) VALUES (?,?,?,?)',
      );
      const now = Date.now();
      for (const fileId of fileIds) {
        if (!db.prepare('SELECT id FROM files WHERE id = ?').get(fileId)) continue;
        for (const v of cleanValues) {
          const r = ins.run(fileId, type.id, v, now);
          affected += Number(r.changes);
        }
      }
    } else {
      const del = db.prepare('DELETE FROM tags WHERE file_id = ? AND type_id = ? AND value = ?');
      for (const fileId of fileIds) {
        for (const v of cleanValues) {
          const r = del.run(fileId, type.id, v);
          affected += Number(r.changes);
        }
      }
    }
  });
  return affected;
}

/**
 * 一键清空所选文件的全部标签（所有类型，单事务）。
 * @returns 受影响的标签行数
 */
export function clearAllTags(fileIds: number[]): number {
  const db = getDb();
  let affected = 0;
  withTransaction(() => {
    const del = db.prepare('DELETE FROM tags WHERE file_id = ?');
    for (const fileId of fileIds) {
      affected += Number(del.run(fileId).changes);
    }
  });
  return affected;
}

export interface SuggestItem {
  value: string;
  typeName: string;
  typeId: number;
  count: number;
  exact: boolean;
}

/**
 * 快速添加建议：跨全部类型前缀匹配，精确匹配置顶，按使用次数排序。
 */
export function suggest(queryRaw: string, limit = 12): SuggestItem[] {
  const q = String(queryRaw ?? '').trim();
  if (!q) return [];
  const db = getDb();
  const like = `${escapeLike(q)}%`;
  const rows = db
    .prepare(
      `SELECT t.value AS value, tt.name AS typeName, tt.id AS typeId, COUNT(*) AS count
       FROM tags t JOIN tag_types tt ON tt.id = t.type_id
       WHERE t.value LIKE ? ESCAPE '\\'
       GROUP BY t.value, t.type_id
       UNION ALL
       SELECT v.value AS value, tt.name AS typeName, tt.id AS typeId, 0 AS count
       FROM tag_values v JOIN tag_types tt ON tt.id = v.type_id
       WHERE v.value LIKE ? ESCAPE '\\'
       LIMIT ?`,
    )
    .all(like, like, limit * 4) as Array<{ value: string; typeName: string; typeId: number; count: number }>;

  // 跨类型同值合并为多条候选（值+类型名 各算一条），排序后截断
  const items: SuggestItem[] = rows.map((r) => ({
    value: r.value,
    typeName: r.typeName,
    typeId: r.typeId,
    count: r.count,
    exact: r.value === q,
  }));
  // 同 (值, 类型) 去重（tags 计数与字典 0 计数重复时保留高计数）
  const dedup = new Map<string, SuggestItem>();
  for (const it of items) {
    const key = `${it.value}\u0000${it.typeId}`;
    const prev = dedup.get(key);
    if (!prev || it.count > prev.count) dedup.set(key, it);
  }
  const merged = Array.from(dedup.values());
  merged.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    if (b.count !== a.count) return b.count - a.count;
    return a.value.localeCompare(b.value, 'zh-CN');
  });
  return merged.slice(0, limit);
}

// ==================== 类型 CRUD ====================

export interface TypeValueView {
  id: number | null;
  value: string;
  count: number;
}

export interface TypeView {
  id: number;
  name: string;
  inputMode: 'enum' | 'free';
  sortOrder: number;
  hiddenInFilter: boolean;
  values: TypeValueView[];
}

function typeValues(typeId: number): TypeValueView[] {
  const db = getDb();
  const dict = db
    .prepare(
      `SELECT v.id, v.value, (SELECT COUNT(*) FROM tags t WHERE t.type_id = v.type_id AND t.value = v.value) AS c
       FROM tag_values v WHERE v.type_id = ? ORDER BY v.sort_order, v.id`,
    )
    .all(typeId) as Array<{ id: number; value: string; c: number }>;
  const free = db
    .prepare(
      `SELECT value, COUNT(*) AS c FROM tags WHERE type_id = ? AND value NOT IN
       (SELECT value FROM tag_values WHERE type_id = ?) GROUP BY value ORDER BY c DESC, value`,
    )
    .all(typeId, typeId) as Array<{ value: string; c: number }>;
  return [
    ...dict.map((d) => ({ id: d.id as number | null, value: d.value, count: d.c })),
    ...free.map((f) => ({ id: null, value: f.value, count: f.c })),
  ];
}

export function listTypes(): TypeView[] {
  const types = getDb()
    .prepare('SELECT * FROM tag_types ORDER BY sort_order, id')
    .all() as TagTypeRow[];
  return types.map((t) => ({
    id: t.id,
    name: t.name,
    inputMode: t.input_mode,
    sortOrder: t.sort_order,
    hiddenInFilter: t.hidden_in_filter === 1,
    values: typeValues(t.id),
  }));
}

function validateTypeName(nameRaw: unknown): string {
  const name = String(nameRaw ?? '').trim();
  if (!name) throw new ApiError(CODE.EMPTY_VALUE, '类型名不能为空');
  if (name.includes(':') || name.includes('：')) {
    throw new ApiError(CODE.EMPTY_VALUE, '类型名不能包含冒号');
  }
  if (Array.from(name).length > MAX_TYPE_NAME_LEN) {
    throw new ApiError(CODE.VALUE_TOO_LONG, `类型名不能超过 ${MAX_TYPE_NAME_LEN} 字符`);
  }
  return name;
}

/** 新建类型 */
export function createType(nameRaw: unknown, inputModeRaw: unknown): TypeView {
  const name = validateTypeName(nameRaw);
  const mode = inputModeRaw === 'enum' ? 'enum' : 'free';
  const db = getDb();
  if (getTypeByName(name)) throw new ApiError(CODE.NAME_DUPLICATE, `类型"${name}"已存在`);
  const maxSort = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM tag_types').get() as { m: number }).m;
  db.prepare(
    'INSERT INTO tag_types (name, input_mode, sort_order, hidden_in_filter, created_at) VALUES (?,?,?,0,?)',
  ).run(name, mode, maxSort + 1, Date.now());
  const t = getTypeByName(name) as TagTypeRow;
  return { id: t.id, name: t.name, inputMode: t.input_mode, sortOrder: t.sort_order, hiddenInFilter: false, values: [] };
}

/** 修改类型（改名/模式/显隐）。改名经触发器同步 tag 类 FTS 文本。 */
export function updateType(id: number, patch: { name?: unknown; inputMode?: unknown; hiddenInFilter?: unknown }): TypeView {
  const db = getDb();
  const type = getTypeById(id);
  assertIsProtected(type, '改名或修改模式');
  const name = patch.name != null ? validateTypeName(patch.name) : type.name;
  const mode = patch.inputMode === 'enum' ? 'enum' : patch.inputMode === 'free' ? 'free' : type.input_mode;
  const hidden =
    typeof patch.hiddenInFilter === 'boolean'
      ? patch.hiddenInFilter ? 1 : 0
      : patch.hiddenInFilter === 1 || patch.hiddenInFilter === 0
        ? (patch.hiddenInFilter as number)
        : type.hidden_in_filter;
  if (name !== type.name) {
    const dup = getTypeByName(name);
    if (dup && dup.id !== id) throw new ApiError(CODE.NAME_DUPLICATE, `类型"${name}"已存在`);
  }
  withTransaction(() => {
    db.prepare('UPDATE tag_types SET name=?, input_mode=?, hidden_in_filter=? WHERE id=?').run(
      name, mode, hidden, id,
    );
  });
  const updated = getTypeById(id);
  return {
    id: updated.id,
    name: updated.name,
    inputMode: updated.input_mode,
    sortOrder: updated.sort_order,
    hiddenInFilter: updated.hidden_in_filter === 1,
    values: typeValues(updated.id),
  };
}

/** 类型排序：▲▼ 上移/下移（与相邻类型交换 sort_order） */
export function moveType(id: number, direction: 'up' | 'down'): void {
  const db = getDb();
  const type = getTypeById(id);
  const neighbor = db
    .prepare(
      direction === 'up'
        ? 'SELECT * FROM tag_types WHERE sort_order < ? ORDER BY sort_order DESC, id DESC LIMIT 1'
        : 'SELECT * FROM tag_types WHERE sort_order > ? ORDER BY sort_order ASC, id ASC LIMIT 1',
    )
    .get(type.sort_order) as TagTypeRow | undefined;
  if (!neighbor) return;
  withTransaction(() => {
    db.prepare('UPDATE tag_types SET sort_order=? WHERE id=?').run(-1, type.id); // 临时占位防唯一冲突
    db.prepare('UPDATE tag_types SET sort_order=? WHERE id=?').run(type.sort_order, neighbor.id);
    db.prepare('UPDATE tag_types SET sort_order=? WHERE id=?').run(neighbor.sort_order, type.id);
  });
}

/** 删除类型（级联字典值与标签）。未带 confirm 时返回影响数（40910）。 */
export function deleteType(id: number, confirm: boolean): { affectedFiles: number; valueCount: number } {
  const db = getDb();
  const type = getTypeById(id);
  assertIsProtected(type, '删除');
  const affectedFiles = (
    db.prepare('SELECT COUNT(DISTINCT file_id) AS c FROM tags WHERE type_id = ?').get(id) as { c: number }
  ).c;
  const valueCount = (
    db.prepare('SELECT COUNT(*) AS c FROM tag_values WHERE type_id = ?').get(id) as { c: number }
  ).c;
  if (!confirm) {
    throw new ApiError(CODE.NEED_CONFIRM, '删除类型需二次确认', { affectedFiles, valueCount });
  }
  // FK ON DELETE CASCADE 级联 tag_values / tags；触发器同步清理 FTS
  withTransaction(() => {
    db.prepare('DELETE FROM tag_types WHERE id = ?').run(id);
  });
  return { affectedFiles, valueCount };
}

// ==================== 字典值 ====================

/** 新增字典值 */
export function addDictValue(typeId: number, valueRaw: unknown): TypeValueView {
  const type = getTypeById(typeId);
  const value = validateValue(valueRaw);
  const db = getDb();
  const maxSort = (
    db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM tag_values WHERE type_id = ?').get(typeId) as { m: number }
  ).m;
  const r = db.prepare('INSERT OR IGNORE INTO tag_values (type_id, value, sort_order) VALUES (?,?,?)').run(
    typeId, value, maxSort + 1,
  );
  if (Number(r.changes) === 0) throw new ApiError(CODE.NAME_DUPLICATE, `值"${value}"已存在于"${type.name}"`);
  return { id: Number(r.lastInsertRowid), value, count: 0 };
}

/** 字典值改名：同步 tag_values、tags（触发器同步 FTS） */
export function renameDictValue(valueId: number, valueRaw: unknown): void {
  const value = validateValue(valueRaw);
  const db = getDb();
  const row = db.prepare('SELECT * FROM tag_values WHERE id = ?').get(valueId) as
    | { id: number; type_id: number; value: string }
    | undefined;
  if (!row) throw new ApiError(CODE.NOT_FOUND, `字典值不存在：id=${valueId}`);
  const dup = db
    .prepare('SELECT id FROM tag_values WHERE type_id = ? AND value = ? AND id != ?')
    .get(row.type_id, value, valueId);
  if (dup) throw new ApiError(CODE.NAME_DUPLICATE, `值"${value}"已存在`);
  withTransaction(() => {
    // tags 中若该文件已有同名目标值，先移除旧行避免 UNIQUE 冲突（结果语义不变）
    db.prepare(
      `DELETE FROM tags WHERE type_id = ? AND value = ? AND file_id IN
       (SELECT file_id FROM tags WHERE type_id = ? AND value = ?)`,
    ).run(row.type_id, value, row.type_id, row.value);
    db.prepare('UPDATE tags SET value = ? WHERE type_id = ? AND value = ?').run(value, row.type_id, row.value);
    db.prepare('UPDATE tag_values SET value = ? WHERE id = ?').run(value, valueId);
  });
}

/** 删除字典值：级联移除该值全部标签；未带 confirm 返回影响数（40910） */
export function deleteDictValue(valueId: number, confirm: boolean): { affectedFiles: number } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tag_values WHERE id = ?').get(valueId) as
    | { id: number; type_id: number; value: string }
    | undefined;
  if (!row) throw new ApiError(CODE.NOT_FOUND, `字典值不存在：id=${valueId}`);
  const affectedFiles = (
    db
      .prepare('SELECT COUNT(DISTINCT file_id) AS c FROM tags WHERE type_id = ? AND value = ?')
      .get(row.type_id, row.value) as { c: number }
  ).c;
  if (!confirm) {
    throw new ApiError(CODE.NEED_CONFIRM, '删除字典值需二次确认', { affectedFiles });
  }
  withTransaction(() => {
    db.prepare('DELETE FROM tags WHERE type_id = ? AND value = ?').run(row.type_id, row.value);
    db.prepare('DELETE FROM tag_values WHERE id = ?').run(valueId);
  });
  return { affectedFiles };
}

/**
 * 移动字典值到其他类型（带走全部已挂标签；FTS 经触发器同步）。
 * @param valueId 源字典值 id
 * @param target  {toTypeId} 或 {newTypeName}（自动创建 free 类型）
 */
export function moveDictValue(valueId: number, target: { toTypeId?: unknown; newTypeName?: unknown }): { toTypeId: number } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tag_values WHERE id = ?').get(valueId) as
    | { id: number; type_id: number; value: string }
    | undefined;
  if (!row) throw new ApiError(CODE.NOT_FOUND, `字典值不存在：id=${valueId}`);

  let targetType: TagTypeRow | undefined;
  if (target.toTypeId != null) {
    targetType = getTypeById(Number(target.toTypeId));
  } else if (target.newTypeName) {
    const name = validateTypeName(target.newTypeName);
    targetType = getTypeByName(name);
    if (!targetType) {
      createType(name, 'free'); // 自动创建自由输入类型
      targetType = getTypeByName(name) as TagTypeRow;
    }
  } else {
    throw new ApiError(CODE.EMPTY_VALUE, '必须指定 toTypeId 或 newTypeName');
  }
  if (!targetType) throw new ApiError(CODE.NOT_FOUND, '目标类型不存在');

  if (targetType.id === row.type_id) return { toTypeId: targetType.id };

  withTransaction(() => {
    const srcTypeId = row.type_id;
    const value = row.value;
    // 目标类型 tags 中已有同值行：删除源侧对应行（合并语义）
    db.prepare(
      `DELETE FROM tags WHERE type_id = ? AND value = ? AND file_id IN
       (SELECT file_id FROM tags WHERE type_id = ? AND value = ?)`,
    ).run(srcTypeId, value, targetType.id, value);
    // 迁移标签
    db.prepare('UPDATE tags SET type_id = ? WHERE type_id = ? AND value = ?').run(targetType.id, srcTypeId, value);
    // 迁移字典值（目标字典已有同值则删除源字典行）
    const dupDict = db
      .prepare('SELECT id FROM tag_values WHERE type_id = ? AND value = ?')
      .get(targetType.id, value);
    if (dupDict) {
      db.prepare('DELETE FROM tag_values WHERE id = ?').run(valueId);
    } else {
      const maxSort = (
        db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM tag_values WHERE type_id = ?').get(targetType.id) as { m: number }
      ).m;
      db.prepare('UPDATE tag_values SET type_id = ?, sort_order = ? WHERE id = ?').run(targetType.id, maxSort + 1, valueId);
    }
  });
  return { toTypeId: targetType.id };
}
