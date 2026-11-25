/**
 * 打标路由：文件标签查/增/删、批量打标/去标、文件详情。
 */
import { Router } from 'express';
import fs from 'node:fs';
import { getDb, FileRow } from '../db';
import { ApiError, CODE, ok, wrap } from '../http';
import { addTags, removeTags, batchTag, clearAllTags, listTagsForFile, requireFileExists } from '../services/tags-service';
import { upsertFileStat } from '../services/scanner';

/** 兼容两种请求体：{typeId, values[]}（单类型）与 {tags:[{typeId|type, value}]}（混合） */
function normalizeTagBody(body: {
  typeId?: unknown;
  values?: unknown;
  tags?: Array<{ typeId?: unknown; type?: unknown; value: unknown }>;
}): Array<{ typeId?: number; type?: string; value: string }> {
  if (Array.isArray(body?.tags)) {
    return body.tags.map((t) => ({
      typeId: t.typeId != null ? Number(t.typeId) : undefined,
      type: t.type != null ? String(t.type) : undefined,
      value: String(t.value ?? ''),
    }));
  }
  if (body?.typeId != null && Array.isArray(body.values)) {
    const typeId = Number(body.typeId);
    return (body.values as unknown[]).map((v) => ({ typeId, value: String(v ?? '') }));
  }
  return [];
}

export function tagRoutes(): Router {
  const r = Router();

  // 文件详情（含全部标签）
  r.get(
    '/files/:id',
    wrap((req, res) => {
      const id = Number(req.params.id);
      requireFileExists(id);
      const file = getDb().prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow;
      ok(res, {
        id: file.id,
        dirId: file.dir_id,
        path: file.path,
        name: file.name,
        ext: file.ext,
        category: file.category,
        size: file.size,
        mtime: file.mtime,
        missing: file.missing === 1,
        hasThumb: file.category === 'image',
        tags: listTagsForFile(id),
      });
    }),
  );

  r.get(
    '/files/:id/tags',
    wrap((req, res) => {
      const id = Number(req.params.id);
      requireFileExists(id);
      ok(res, listTagsForFile(id));
    }),
  );

  // 打标（幂等）
  r.post(
    '/files/:id/tags',
    wrap((req, res) => {
      const id = Number(req.params.id);
      ok(res, addTags(id, normalizeTagBody(req.body ?? {})));
    }),
  );

  // 去标
  r.delete(
    '/files/:id/tags',
    wrap((req, res) => {
      const id = Number(req.params.id);
      ok(res, removeTags(id, normalizeTagBody(req.body ?? {})));
    }),
  );

  // 批量打标/去标
  r.post(
    '/tags/batch',
    wrap((req, res) => {
      const body = req.body ?? {};
      const fileIds = Array.isArray(body.fileIds) ? body.fileIds.map((x: unknown) => Number(x)) : [];
      const typeId = Number(body.typeId);
      const values = Array.isArray(body.values) ? body.values.map((v: unknown) => String(v)) : [];
      const action = body.action === 'remove' ? 'remove' : 'add';
      const affected = batchTag(fileIds, typeId, values, action);
      ok(res, { affected, action });
    }),
  );

  // 一键清空所选文件的全部标签（所有类型）
  r.post(
    '/tags/clear',
    wrap((req, res) => {
      const body = req.body ?? {};
      const fileIds = Array.isArray(body.fileIds) ? body.fileIds.map((x: unknown) => Number(x)) : [];
      if (fileIds.length === 0) {
        throw new ApiError(CODE.EMPTY_VALUE, 'fileIds 不能为空');
      }
      const affected = clearAllTags(fileIds);
      ok(res, { affected, files: fileIds.length });
    }),
  );

  // 文件内容变更通知（前端「刷新元数据」按钮可用；watcher 缺席场景兜底）
  r.post(
    '/files/:id/refresh',
    wrap((req, res) => {
      const id = Number(req.params.id);
      requireFileExists(id);
      const file = getDb().prepare('SELECT dir_id, path FROM files WHERE id = ?').get(id) as {
        dir_id: number;
        path: string;
      };
      let updated = false;
      try {
        const st = fs.statSync(file.path);
        updated = upsertFileStat(file.dir_id, file.path, st.size, Math.round(st.mtimeMs));
      } catch {
        // 文件已消失：由缺失检查流程处理
      }
      ok(res, { id, updated });
    }),
  );

  return r;
}
