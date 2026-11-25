/**
 * 标签类型与字典值路由：类型 CRUD / 排序 / 显隐，字典值增改删移（均带影响数二次确认）。
 */
import { Router } from 'express';
import { ok, wrap } from '../http';
import {
  listTypes,
  createType,
  updateType,
  moveType,
  deleteType,
  addDictValue,
  renameDictValue,
  deleteDictValue,
  moveDictValue,
} from '../services/tags-service';

export function tagTypeRoutes(): Router {
  const r = Router();

  // 类型列表（含各类型字典值与使用计数）
  r.get(
    '/tag-types',
    wrap((_req, res) => {
      ok(res, listTypes());
    }),
  );

  // 新建类型
  r.post(
    '/tag-types',
    wrap((req, res) => {
      const body = req.body ?? {};
      ok(res, createType(body.name, body.inputMode ?? body.input_mode));
    }),
  );

  // 修改类型（改名 / 模式 / 显隐）
  r.put(
    '/tag-types/:id',
    wrap((req, res) => {
      const body = req.body ?? {};
      ok(
        res,
        updateType(Number(req.params.id), {
          name: body.name,
          inputMode: body.inputMode ?? body.input_mode,
          hiddenInFilter: body.hiddenInFilter ?? body.hidden_in_filter,
        }),
      );
    }),
  );

  // 排序：▲▼
  r.post(
    '/tag-types/:id/move',
    wrap((req, res) => {
      const direction = req.body?.direction === 'down' ? 'down' : 'up';
      moveType(Number(req.params.id), direction);
      ok(res, listTypes());
    }),
  );

  // 删除类型（confirm=1 执行；否则 40910 带影响数）
  r.delete(
    '/tag-types/:id',
    wrap((req, res) => {
      const result = deleteType(Number(req.params.id), req.query.confirm === '1');
      ok(res, result);
    }),
  );

  // 新增字典值
  r.post(
    '/tag-types/:id/values',
    wrap((req, res) => {
      ok(res, addDictValue(Number(req.params.id), req.body?.value));
    }),
  );

  // 字典值改名
  r.put(
    '/tag-values/:id',
    wrap((req, res) => {
      renameDictValue(Number(req.params.id), req.body?.value);
      ok(res, { id: Number(req.params.id) });
    }),
  );

  // 删除字典值（confirm=1）
  r.delete(
    '/tag-values/:id',
    wrap((req, res) => {
      const result = deleteDictValue(Number(req.params.id), req.query.confirm === '1');
      ok(res, result);
    }),
  );

  // 移动字典值到其他类型（或新建类型）
  r.post(
    '/tag-values/:id/move',
    wrap((req, res) => {
      const body = (req.body ?? {}) as { toTypeId?: unknown; newTypeName?: unknown };
      ok(res, moveDictValue(Number(req.params.id), body));
    }),
  );

  return r;
}
