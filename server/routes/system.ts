/**
 * 系统路由：缺失文件检查/清理、统计、打开文件/文件夹、缩略图。
 */
import { Router } from 'express';
import fs from 'node:fs';
import { getDb, withTransaction, FileRow } from '../db';
import { ApiError, CODE, ok, wrap } from '../http';
import { openFile, openFolderContaining } from '../services/shell';
import { ensureThumb } from '../services/thumbnails';
import { scanDirectoryAsync } from '../services/scanner';

export function systemRoutes(): Router {
  const r = Router();

  // 缺失文件列表
  r.get(
    '/system/missing',
    wrap((_req, res) => {
      const rows = getDb()
        .prepare('SELECT id, dir_id, path, name, ext, category, size, mtime FROM files WHERE missing = 1 ORDER BY path')
        .all();
      ok(res, rows);
    }),
  );

  // 全量存在性校验（异步执行，结果经 SSE / 再次查询获取）
  r.post(
    '/system/missing-check',
    wrap((_req, res) => {
      const db = getDb();
      const dirs = db.prepare('SELECT id FROM directories').all() as Array<{ id: number }>;
      for (const d of dirs) scanDirectoryAsync(d.id);
      ok(res, { started: true, directories: dirs.length });
    }),
  );

  // 清理缺失文件记录（级联删标签）；confirm=1 执行
  r.post(
    '/system/missing/cleanup',
    wrap((req, res) => {
      const confirm = req.query.confirm === '1' || req.body?.confirm === 1;
      const db = getDb();
      const count = (db.prepare('SELECT COUNT(*) AS c FROM files WHERE missing = 1').get() as { c: number }).c;
      if (!confirm) {
        throw new ApiError(CODE.NEED_CONFIRM, '清理缺失文件需二次确认', { affected: count });
      }
      withTransaction(() => {
        // tags REFERENCES files ON DELETE CASCADE；FTS 由触发器清理
        db.prepare('DELETE FROM files WHERE missing = 1').run();
      });
      ok(res, { deleted: count });
    }),
  );

  // 未打标签文件计数（missing=0 且无任何标签；顶栏提醒徽标用）
  r.get(
    '/system/untagged',
    wrap((_req, res) => {
      const count = (
        getDb()
          .prepare('SELECT COUNT(*) AS c FROM files f WHERE f.missing = 0 AND NOT EXISTS (SELECT 1 FROM tags t WHERE t.file_id = f.id)')
          .get() as { c: number }
      ).c;
      ok(res, { count });
    }),
  );

  // 统计
  r.get(
    '/system/stats',
    wrap((_req, res) => {
      const db = getDb();
      const totalFiles = (db.prepare('SELECT COUNT(*) AS c FROM files').get() as { c: number }).c;
      const missingCount = (db.prepare('SELECT COUNT(*) AS c FROM files WHERE missing = 1').get() as { c: number }).c;
      const totalDirs = (db.prepare('SELECT COUNT(*) AS c FROM directories').get() as { c: number }).c;
      const totalTags = (db.prepare('SELECT COUNT(*) AS c FROM tags').get() as { c: number }).c;
      const tagTypes = (db.prepare('SELECT COUNT(*) AS c FROM tag_types').get() as { c: number }).c;
      const totalSize = (db.prepare('SELECT COALESCE(SUM(size), 0) AS s FROM files').get() as { s: number }).s;
      ok(res, { totalDirs, totalFiles, missingCount, totalTags, tagTypes, totalSize });
    }),
  );

  // 用系统默认程序打开文件
  r.post(
    '/system/open-file',
    wrap((req, res) => {
      const fileId = Number(req.body?.fileId);
      const file = getDb().prepare('SELECT * FROM files WHERE id = ?').get(fileId) as FileRow | undefined;
      if (!file) throw new ApiError(CODE.NOT_FOUND, `文件不存在：id=${fileId}`);
      if (file.missing === 1) throw new ApiError(CODE.NOT_FOUND, '文件已缺失，无法打开');
      if (!fs.existsSync(file.path)) throw new ApiError(CODE.NOT_FOUND, '文件不存在于磁盘');
      openFile(file.path);
      ok(res, { opened: file.path });
    }),
  );

  // 打开所在文件夹并选中
  r.post(
    '/system/open-folder',
    wrap((req, res) => {
      const fileId = Number(req.body?.fileId);
      const file = getDb().prepare('SELECT * FROM files WHERE id = ?').get(fileId) as FileRow | undefined;
      if (!file) throw new ApiError(CODE.NOT_FOUND, `文件不存在：id=${fileId}`);
      openFolderContaining(file.path);
      ok(res, { revealed: file.path });
    }),
  );

  // 缩略图（仅图片类；mtime 变化后自动重生成）
  r.get(
    '/thumbs/:fileId',
    wrap(async (req, res) => {
      const fileId = Number(req.params.fileId);
      const thumbPath = await ensureThumb(fileId);
      if (!thumbPath) {
        throw new ApiError(CODE.NOT_FOUND, '缩略图不可用（不存在或非图片）');
      }
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      fs.createReadStream(thumbPath).pipe(res);
    }),
  );

  return r;
}
