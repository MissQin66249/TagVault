/**
 * 入口：加载配置 → 初始化库 → 启动 Express → 预热文件夹选择宿主 → 监听已索引目录 → 自动开浏览器。
 */
import { exec } from 'node:child_process';
import { loadConfig } from './config';
import { initDb, getDb } from './db';
import { createApp } from './app';
import { prewarmFolderPicker } from './services/folder-picker';
import { watchAllIndexed } from './services/watcher';
import { scanDirectoryAsync } from './services/scanner';

function openBrowser(url: string): void {
  // 仅调用本机 shell 打开浏览器，无任何网络请求
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`, { shell: 'cmd.exe' }, () => {
      /* 忽略打开失败 */
    });
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

function main(): void {
  const config = loadConfig();
  initDb();
  const app = createApp();

  const server = app.listen(config.port, '127.0.0.1', () => {
    console.log(`[TagVault] 服务已启动：http://localhost:${config.port}`);
    console.log(`[TagVault] 数据目录：${config.dataDir}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[TagVault] 端口 ${config.port} 被占用。请修改项目根 config.json 中的 port 后重试（不自动换端口以保证地址可预期）。`);
      process.exit(1);
    }
    throw err;
  });

  // 预热文件夹选择对话框宿主（PowerShell 常驻进程）
  prewarmFolderPicker();

  // 监听所有已索引目录（≤10s 同步变更）
  try {
    watchAllIndexed();
  } catch (e) {
    console.error('[TagVault] 文件监听启动失败：', e);
  }

  // 启动回扫：补上程序关闭期间新增/变更的文件（后台异步执行，不阻塞启动；
  // 进度经 SSE 广播，失败仅记日志）
  try {
    const dirs = getDb().prepare('SELECT id FROM directories').all() as Array<{ id: number }>;
    if (dirs.length > 0) {
      console.log(`[TagVault] 启动回扫 ${dirs.length} 个目录`);
      for (const d of dirs) scanDirectoryAsync(d.id);
    }
  } catch (e) {
    console.error('[TagVault] 启动回扫失败：', e);
  }

  // 打开浏览器（测试/无头模式跳过）
  if (config.autoOpenBrowser && !process.env.TV_NO_BROWSER) {
    openBrowser(`http://localhost:${config.port}`);
  }

  // 首次启动提示
  const cnt = (getDb().prepare('SELECT COUNT(*) AS c FROM directories').get() as { c: number }).c;
  if (cnt === 0) {
    console.log('[TagVault] 尚未索引任何目录，可在界面「设置 → 索引目录」中添加。');
  }
}

main();
