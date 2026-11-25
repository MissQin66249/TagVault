/**
 * 搜索路由：GET /api/search（关键词 + 字段化 + 面板筛选 + facets + 分页）、GET /api/suggest。
 */
import { Router } from 'express';
import { getDb } from '../db';
import { ok, wrap } from '../http';
import { parseQuery, TypeCandidate } from '../query-parser';
import { runSearch, buildFacets, FieldCond } from '../search-sql';
import { suggest } from '../services/tags-service';
import { parseListParam } from '../util';

/** 解析 types 参数：兼容 {"1":["机密"]} 对象与 [{"typeId":1,"values":["机密"]}] 数组两种形状 */
function parseTypesParam(raw: unknown): FieldCond[] {
  if (raw == null || raw === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return [];
  }
  const conds: FieldCond[] = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed as Array<{ typeId?: unknown; values?: unknown }>) {
      const typeId = Number(item?.typeId);
      if (Number.isInteger(typeId) && Array.isArray(item?.values)) {
        conds.push({ typeId, values: (item.values as unknown[]).map((v) => String(v)) });
      }
    }
  } else if (parsed && typeof parsed === 'object') {
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const typeId = Number(k);
      if (Number.isInteger(typeId) && Array.isArray(v)) {
        conds.push({ typeId, values: v.map((x) => String(x)) });
      }
    }
  }
  return conds.filter((c) => c.values.length > 0);
}

export function searchRoutes(): Router {
  const r = Router();

  r.get(
    '/search',
    wrap((req, res) => {
      const db = getDb();
      const q = String(req.query.q ?? '');
      const types = parseTypesParam(req.query.types ?? req.query.f);

      // 字段化解析 `类型:值`（基于当前类型名白名单）
      const tagTypes = db.prepare('SELECT id, name FROM tag_types').all() as TypeCandidate[];
      const parsed = parseQuery(q, tagTypes);

      const categories = parseListParam(req.query.categories ?? req.query.cats);
      const missingRaw = String(req.query.missing ?? '');
      const missing = missingRaw === '1' || missingRaw === '0' ? (missingRaw as '0' | '1') : undefined;
      const finalOnly = req.query.final === '1' || req.query.finalOnly === '1';
      const untagged = req.query.untagged === '1';

      const result = runSearch({
        keywords: parsed.keywords,
        fieldConds: [...types, ...parsed.fieldFilters.map((f) => ({ typeId: f.typeId, values: f.values }))],
        categories,
        missing,
        finalOnly,
        untagged,
        sort: req.query.sort as 'name' | 'mtime' | 'size' | undefined,
        order: req.query.order as 'asc' | 'desc' | undefined,
        page: Number(req.query.page) || 1,
        pageSize: Number(req.query.pageSize) || 20,
      });

      ok(res, {
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        items: result.items,
        facets: buildFacets(),
        parsedConditions: parsed, // 字段化解析条件（前端只读展示）
      });
    }),
  );

  r.get(
    '/suggest',
    wrap((req, res) => {
      ok(res, suggest(String(req.query.q ?? '')));
    }),
  );

  // 独立 facets 端点（筛选面板初始化用；/api/search 响应中也内嵌同一结构）
  r.get(
    '/facets',
    wrap((_req, res) => {
      ok(res, buildFacets());
    }),
  );

  return r;
}
