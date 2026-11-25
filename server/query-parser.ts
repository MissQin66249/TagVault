/**
 * `类型:值` 字段化检索解析器（纯函数）。
 * 语法：空格=且、`|`=或（全角 `｜` 等价）、半角/全角冒号等价；
 * 冒号左侧为当前存在的标签类型名 → 字段条件；否则整个 token 退化为普通关键词。
 * 含空格的类型名用引号语法：`"所属产品":A1`。
 */

export interface ParsedFieldFilter {
  /** 命中的标签类型 id */
  typeId: number;
  /** 类型名（只读展示用） */
  typeName: string;
  /** `|` 分隔的多值（同类型内 = 或） */
  values: string[];
}

export interface ParsedQuery {
  keywords: string[];
  fieldFilters: ParsedFieldFilter[];
}

export interface TypeCandidate {
  id: number;
  name: string;
}

/** 去掉两侧成对引号 */
function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”')))) {
    return t.slice(1, -1).trim();
  }
  return t;
}

/**
 * 解析搜索串。
 * @param raw 原始搜索串
 * @param tagTypes 当前全部标签类型（用于识别 `类型:` 前缀）
 */
export function parseQuery(raw: string, tagTypes: TypeCandidate[]): ParsedQuery {
  const keywords: string[] = [];
  const fieldFilters: ParsedFieldFilter[] = [];

  const normalized = String(raw ?? '')
    .replace(/：/g, ':') // 全角冒号等价
    .replace(/｜/g, '|'); // 全角竖线等价

  // 按空白（含全角空格）切分 token
  const tokens = normalized.split(/[\s\u3000]+/).filter(Boolean);

  // 类型名索引：精确匹配 + 引号内匹配
  const typeByName = new Map<string, TypeCandidate>();
  for (const t of tagTypes) {
    typeByName.set(t.name, t);
    typeByName.set(t.name.toLowerCase(), t);
  }

  for (const token of tokens) {
    const colonIdx = token.indexOf(':');
    if (colonIdx <= 0) {
      keywords.push(token);
      continue;
    }
    const leftRaw = token.slice(0, colonIdx);
    const right = token.slice(colonIdx + 1);
    const left = stripQuotes(leftRaw);
    if (!left) {
      // `:value` 无类型名 → 关键词
      keywords.push(token);
      continue;
    }
    const matched = typeByName.get(left) ?? typeByName.get(left.toLowerCase());
    if (!matched || !right.trim()) {
      // 非类型名前缀（或空值）→ 整个 token 退化为关键词
      keywords.push(token);
      continue;
    }
    const values = right
      .split('|')
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length === 0) {
      keywords.push(token);
      continue;
    }
    fieldFilters.push({ typeId: matched.id, typeName: matched.name, values });
  }

  return { keywords, fieldFilters };
}
