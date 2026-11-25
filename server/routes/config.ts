/**
 * 配置与状态路由：GET/PUT /api/config、GET /api/status。
 */
import { Router } from 'express';
import { loadConfig, saveConfig, AppConfig } from '../config';
import { getDb } from '../db';
import { ok, wrap } from '../http';
import { getScanStatus } from '../services/scanner';

export function configRoutes(): Router {
  const r = Router();

  r.get(
    '/config',
    wrap((_req, res) => {
      ok(res, loadConfig());
    }),
  );

  r.put(
    '/config',
    wrap((req, res) => {
      const body = (req.body ?? {}) as Partial<AppConfig>;
      const saved = saveConfig({
        port: body.port,
        dataDir: body.dataDir,
        autoOpenBrowser: body.autoOpenBrowser,
      });
      ok(res, saved, '配置已保存；修改端口/数据目录需重启生效');
    }),
  );

  r.get(
    '/status',
    wrap((_req, res) => {
      const db = getDb();
      const totalFiles = (db.prepare('SELECT COUNT(*) AS c FROM files').get() as { c: number }).c;
      const missingCount = (db.prepare('SELECT COUNT(*) AS c FROM files WHERE missing = 1').get() as { c: number }).c;
      const scan = getScanStatus();
      ok(res, {
        version: '1.0.0',
        totalFiles,
        missingCount,
        scanning: scan.running,
        scan: scan,
      });
    }),
  );

  return r;
}
