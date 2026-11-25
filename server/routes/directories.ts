/**
 * 目录路由：列表 / 添加（判重）/ 重扫 / 移除 / 系统对话框选目录 / SSE 事件流。
 */
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, normalizePath, withTransaction } from '../db';
import { ApiError, CODE, ok, wrap } from '../http';
import { subscribe } from '../events';
import { scanDirectory, scanDirectoryAsync, getScanStatus } from '../services/scanner';
import { pickFolder } from '../services/folder-picker';
import { watchDirectory, unwatchDirectory } from '../services/watcher';

export function directoryRoutes(): Router {
  const r = Router();

  // 目录列表（含文件计数）
  r.get(
    '/directories',
    wrap((_req, res) => {
      const db = getDb();
      const rows = db
        .prepare(
          `SELECT d.id, d.path, d.name, d.last_scanned_at, d.created_at,
                  (SELECT COUNT(*) FROM files f WHERE f.dir_id = d.id AND f.missing = 0) AS fileCount,
                  (SELECT COUNT(*) FROM files f WHERE f.dir_id = d.id AND f.missing = 1) AS missingCount
           FROM directories d ORDER BY d.id`,
        )
        .all();
      ok(res, rows);
    }),
  );

  // 添加目录（归一化判重 → 入库 → 后台扫描）
  r.post(
    '/directories',
    wrap((req, res) => {
      const rawPath = String(req.body?.path ?? '').trim();
      if (!rawPath) throw new ApiError(CODE.EMPTY_VALUE, '目录路径不能为空');
      if (!fs.existsSync(rawPath) || !fs.statSync(rawPath).isDirectory()) {
        throw new ApiError(CODE.NOT_FOUND, `目录不存在或不可访问：${rawPath}`);
      }
      const key = normalizePath(rawPath);
      const db = getDb();
      const dup = db.prepare('SELECT id FROM directories WHERE path_key = ?').get(key);
      if (dup) throw new ApiError(CODE.DIR_DUPLICATE, '目录已存在', { id: (dup as { id: number }).id });

      const resolved = path.resolve(rawPath);
      const info = db
        .prepare('INSERT INTO directories (path, path_key, name, created_at) VALUES (?,?,?,?)')
        .run(resolved, key, path.basename(resolved) || resolved, Date.now());
      const id = Number(info.lastInsertRowid);

      watchDirectory(id, resolved);
      scanDirectoryAsync(id);
      ok(res, { id, path: resolved, scanning: true }, '目录已添加，正在扫描');
    }),
  );

  // 手动重扫
  r.post(
    '/directories/:id/rescan',
    wrap((req, res) => {
      const id = Number(req.params.id);
      const db = getDb();
      const dir = db.prepare('SELECT id, path FROM directories WHERE id = ?').get(id) as
        | { id: number; path: string }
        | undefined;
      if (!dir) throw new ApiError(CODE.NOT_FOUND, `目录不存在：id=${id}`);
      watchDirectory(id, dir.path); // 确保 watcher 在位
      scanDirectoryAsync(id);
      ok(res, { id, scanning: true });
    }),
  );

  // 移除目录（连带文件与标签）；confirm=1 才执行
  r.delete(
    '/directories/:id',
    wrap((req, res) => {
      const id = Number(req.params.id);
      const confirm = req.query.confirm === '1';
      const db = getDb();
      const dir = db.prepare('SELECT id FROM directories WHERE id = ?').get(id) as { id: number } | undefined;
      if (!dir) throw new ApiError(CODE.NOT_FOUND, `目录不存在：id=${id}`);
      const affected = (
        db.prepare('SELECT COUNT(*) AS c FROM files WHERE dir_id = ?').get(id) as { c: number }
      ).c;
      if (!confirm) {
        throw new ApiError(CODE.NEED_CONFIRM, '移除目录需二次确认', { affected, withFiles: true });
      }
      unwatchDirectory(id);
      withTransaction(() => {
        // files REFERENCES directories ON DELETE CASCADE → 文件与标签级联删除（FTS 由触发器清理）
        db.prepare('DELETE FROM directories WHERE id = ?').run(id);
      });
      ok(res, { id, deletedFiles: affected });
    }),
  );

  // 扫描状态
  r.get(
    '/scan/status',
    wrap((_req, res) => {
      ok(res, getScanStatus());
    }),
  );

  // 弹出系统文件夹选择框
  r.get(
    '/directories/pick',
    wrap(async (_req, res) => {
      const p = await pickFolder();
      ok(res, { path: p });
    }),
  );

  // SSE 事件流（扫描进度 / 文件变更 / 扫描完成）
  r.get('/events', (req, res) => {
    subscribe(req, res);
  });

  return r;
}
