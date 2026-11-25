/**
 * 测试基础设施：临时隔离库 + app 实例工厂。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { initDb, setDb } from '../server/db';
import { setDataDirForTest, setConfigFileForTest } from '../server/config';
import { createApp } from '../server/app';
import type { Express } from 'express';

export interface TestContext {
  app: Express;
  db: Database.Database;
  dataDir: string;
}

/** 创建隔离的临时目录 */
export function makeTempDir(prefix = 'tagvault-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** 初始化一个隔离的测试库与 app（互不干扰，可多实例并存） */
export function createTestContext(): TestContext {
  const dataDir = makeTempDir();
  const db = initDb(path.join(dataDir, 'test.db'));
  setDataDirForTest(dataDir);
  // config.json 重定向到临时目录，避免测试 PUT /api/config 污染项目根配置
  setConfigFileForTest(path.join(dataDir, 'config.json'));
  setDb(db);
  const app = createApp();
  return { app, db, dataDir };
}

/** 清理测试上下文：关闭自己的连接并删除临时目录 */
export function destroyTestContext(ctx: TestContext): void {
  try {
    ctx.db.close();
  } catch {
    // 已关闭则忽略
  }
  // 测试中上下文互不并发使用，直接清空全局单例引用
  setDb(null);
  setDataDirForTest(null);
  setConfigFileForTest(null);
  try {
    fs.rmSync(ctx.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (e) {
    console.warn('[setup] 临时目录清理失败（可忽略）：', e);
  }
}

/** 轮询等待条件成立（扫描为后台任务，测试需等待） */
export async function waitUntil<T>(fn: () => T | Promise<T>, timeoutMs = 15000, intervalMs = 100): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil 超时');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
