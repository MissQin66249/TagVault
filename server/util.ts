/** 通用小工具：LIKE/FTS 转义、参数收敛。 */

/** 转义 LIKE 通配符（配合 ESCAPE '\' 使用） */
export function escapeLike(s: string): string {
  return String(s ?? '').replace(/[\\%_]/g, (m) => '\\' + m);
}

/** 包裹为 FTS5 安全的短语查询（双引号内转义双引号） */
export function escapeFtsPhrase(s: string): string {
  return '"' + String(s ?? '').replace(/"/g, '""') + '"';
}

/** 字符串的 unicode 字符数（CJK 按字符计） */
export function charLength(s: string): number {
  return Array.from(String(s ?? '')).length;
}

/** 解析分页参数：page 从 1 开始，pageSize 默认 20、上限 200 */
export function parsePaging(pageRaw: unknown, pageSizeRaw: unknown): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Math.floor(Number(pageRaw) || 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(Number(pageSizeRaw) || 20)));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** 归一化排序参数 */
export function parseSort(sortRaw: unknown, orderRaw: unknown): { sort: 'name' | 'mtime' | 'size'; order: 'asc' | 'desc' } {
  const sort = sortRaw === 'mtime' || sortRaw === 'size' ? sortRaw : 'name';
  const order = String(orderRaw || '').toLowerCase() === 'desc' ? 'desc' : 'asc';
  return { sort, order };
}

/** 解析可能为 JSON 或逗号分隔的字符串数组参数 */
export function parseListParam(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  const s = String(raw);
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v));
  } catch {
    // 非法 JSON 走逗号分隔
  }
  return s.split(',').map((v) => v.trim()).filter(Boolean);
}
