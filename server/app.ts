/**
 * Express 应用工厂：挂载全部 /api 路由、静态托管 dist/、错误中间件。
 * 独立成工厂是为了测试（supertest 无需真实监听端口）。
 */
import express, { Express } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { getProjectRoot } from './config';
import { errorMiddleware } from './http';
import { configRoutes } from './routes/config';
import { directoryRoutes } from './routes/directories';
import { searchRoutes } from './routes/search';
import { tagRoutes } from './routes/tags';
import { tagTypeRoutes } from './routes/tagTypes';
import { dataRoutes } from './routes/data';
import { systemRoutes } from './routes/system';

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '100mb' }));

  app.use('/api', configRoutes());
  app.use('/api', directoryRoutes());
  app.use('/api', searchRoutes());
  app.use('/api', tagRoutes());
  app.use('/api', tagTypeRoutes());
  app.use('/api', dataRoutes());
  app.use('/api', systemRoutes());

  // 静态托管前端构建产物 dist/
  const distDir = path.join(getProjectRoot(), 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    // SPA 兜底：非 /api 路径回 index.html
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .type('html')
        .send('<meta charset="utf-8"><h3>TagVault 后端已启动</h3><p>前端尚未构建：请先运行 <code>npm run build</code>，或开发模式 <code>npm run dev</code>。</p>');
    });
  }

  app.use(errorMiddleware);
  return app;
}
