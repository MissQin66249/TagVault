/**
 * 数据管理路由：JSON/CSV 导出（文件下载）、JSON 导入。
 */
import { Router } from 'express';
import { ok, wrap } from '../http';
import { exportJson, exportCsv, importJson, normalizeImportPayload } from '../services/transfer';

export function dataRoutes(): Router {
  const r = Router();

  // 导出（文件下载）
  r.get(
    '/export',
    wrap((req, res) => {
      const format = String(req.query.format ?? 'json').toLowerCase();
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'csv') {
        const csv = exportCsv();
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="tagvault-export-${stamp}.csv"`);
        res.send(csv);
        return;
      }
      const json = exportJson();
      res.setHeader('Content-Disposition', `attachment; filename="tagvault-export-${stamp}.json"`);
      ok(res, json);
    }),
  );

  // 导入（JSON body：{data:{...}} 或直接导出结构）
  r.post(
    '/import',
    wrap((req, res) => {
      const payload = normalizeImportPayload(req.body);
      const stats = importJson(payload);
      ok(res, stats);
    }),
  );

  return r;
}
