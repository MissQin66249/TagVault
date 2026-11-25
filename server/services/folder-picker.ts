/**
 * 文件夹选择对话框：
 * 1) 首选：常驻 PowerShell 宿主进程（WinForms FolderBrowserDialog，TopMost 防遮挡），
 *    启动时预热，每次选择通过 stdin 触发、stdout 读结果。
 *    宿主初始化完成后会输出 READY 行；只有收到 READY 才认为宿主可用。
 * 2) 兜底：宿主未就绪 / 意外退出 / 写入失败时，立即降级为一次性 PowerShell COM
 *    Shell.Application BrowseForFolder（STA）。
 * 3) 取消 / 失败 / 超时 → null（前端提示"未选择文件夹"，绝不长时间挂起）。
 */
import { spawn, ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';

const PICK_TIMEOUT_MS = 600000; // 用户停在对话框上的时间可以很长（10 分钟）
const HOST_READY_TIMEOUT_MS = 15000; // 宿主 READY 超时 → 立即走 COM 兜底
const CANCEL_SENTINEL = '__CANCELLED__';

/** 常驻宿主 PowerShell 脚本：初始化后输出 READY，逐行读 stdin 触发对话框 */
const HOST_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
  Add-Type -AssemblyName System.Drawing -ErrorAction Stop
} catch {
  [Console]::Out.WriteLine('ERROR:' + $_.Exception.Message)
  exit 1
}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Size = New-Object System.Drawing.Size(1,1)
$owner.Show()
[System.Windows.Forms.Application]::DoEvents()
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = '选择要索引的文件夹'
  $dlg.ShowNewFolderButton = $false
  $result = $dlg.ShowDialog($owner)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.WriteLine($dlg.SelectedPath)
  } else {
    [Console]::Out.WriteLine('${CANCEL_SENTINEL}')
  }
  [Console]::Out.Flush()
  $dlg.Dispose()
}
`;

let host: ChildProcess | null = null;
let hostRl: readline.Interface | null = null;
let hostReady = false;
let hostReadyWaiters: Array<() => void> = [];
let pendingResolver: ((line: string | null) => void) | null = null;

function isWindows(): boolean {
  return process.platform === 'win32';
}

function cleanupHost(): void {
  try {
    host?.kill();
  } catch {
    /* 忽略 */
  }
  host = null;
  hostRl = null;
  hostReady = false;
}

/** 唤醒所有等待 READY 的协程 */
function resolveReadyWaiters(): void {
  const waiters = hostReadyWaiters;
  hostReadyWaiters = [];
  for (const w of waiters) w();
}

/** 启动（或复用）常驻宿主进程；返回是否就绪（带超时） */
async function ensureHostReady(): Promise<boolean> {
  if (!isWindows()) return false;
  if (host && hostReady && host.exitCode === null && !host.killed) return true;

  // 旧宿主已死/未就绪：清理后重启
  if (host) cleanupHost();

  hostReady = false;
  const readyPromise = new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (v: boolean): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const encoded = Buffer.from(HOST_SCRIPT, 'utf16le').toString('base64');
      host = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      host = null;
      done(false);
      return;
    }

    hostRl = readline.createInterface({ input: host.stdout as NodeJS.ReadableStream });
    hostRl.on('line', (line: string) => {
      const t = line.trim();
      if (t === 'READY') {
        hostReady = true;
        resolveReadyWaiters();
        done(true);
        return;
      }
      if (t.startsWith('ERROR:')) {
        console.error('[TagVault] 文件夹选择宿主初始化失败：', t.slice(6));
        cleanupHost();
        resolveReadyWaiters();
        done(false);
        return;
      }
      // 选择结果 / 取消哨兵
      const resolver = pendingResolver;
      pendingResolver = null;
      if (resolver) resolver(t || null);
    });

    host.on('exit', () => {
      const wasPending = pendingResolver !== null;
      host = null;
      hostRl = null;
      hostReady = false;
      resolveReadyWaiters();
      const resolver = pendingResolver;
      pendingResolver = null;
      if (resolver) resolver(null); // 宿主意外退出：本次 pick 失败，由上层走 COM 兜底
      if (!wasPending) done(false);
    });
    host.on('error', () => {
      cleanupHost();
      resolveReadyWaiters();
      done(false);
    });

    // READY 超时（宿主卡住不动）→ 放弃等待，走 COM 兜底
    const timer = setTimeout(() => {
      if (!hostReady) {
        console.error('[TagVault] 文件夹选择宿主 READY 超时，降级 COM 兜底');
        cleanupHost();
        resolveReadyWaiters();
        done(false);
      }
    }, HOST_READY_TIMEOUT_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
  });

  return readyPromise;
}

/** 启动时预热（提前加载 WinForms，首次选择更快） */
export function prewarmFolderPicker(): void {
  if (!isWindows()) return;
  void ensureHostReady();
}

/** 兜底：一次性 PowerShell COM 对话框（STA） */
function pickViaComFallback(): Promise<string | null> {
  if (!isWindows()) return Promise.resolve(null);
  const script = `
$ErrorActionPreference='Stop'
$shell = New-Object -ComObject Shell.Application
$f = $shell.BrowseForFolder(0, '选择要索引的文件夹', 0)
if ($f) { Write-Output $f.Self.Path } else { Write-Output '${CANCEL_SENTINEL}' }
`;
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: string | null): void => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], {
        windowsHide: false, // COM 对话框需要可见桌面
      });
      let out = '';
      child.stdout?.on('data', (d: Buffer) => {
        out += d.toString('utf-8');
      });
      child.on('error', () => done(null));
      child.on('close', () => {
        const line = out.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
        done(line && line !== CANCEL_SENTINEL ? line : null);
      });
      setTimeout(() => {
        done(null);
        try {
          child.kill();
        } catch {
          /* 忽略 */
        }
      }, PICK_TIMEOUT_MS).unref?.();
    } catch {
      done(null);
    }
  });
}

/**
 * 弹出系统文件夹选择框。
 * @returns 选中路径；取消 / 失败 / 超时返回 null（快速失败，绝不长时间挂起）
 */
export async function pickFolder(): Promise<string | null> {
  // 1) 宿主就绪（最多等 HOST_READY_TIMEOUT_MS）→ 走常驻宿主
  const ready = await ensureHostReady();
  if (ready && host && host.stdin && host.exitCode === null) {
    const line = await new Promise<string | null>((resolve) => {
      let settled = false;
      const done = (v: string | null): void => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      pendingResolver = done;
      try {
        host!.stdin!.write('pick\n');
      } catch {
        pendingResolver = null;
        cleanupHost();
        done(null);
        return;
      }
      const timer = setTimeout(() => {
        pendingResolver = null;
        done(null);
      }, PICK_TIMEOUT_MS);
      (timer as unknown as { unref?: () => void }).unref?.();
    });
    if (line !== null) {
      return line !== CANCEL_SENTINEL ? line : null;
    }
    // 宿主路径失败（意外退出/超时）→ 继续走 COM 兜底
  }
  // 2) COM 兜底（宿主未就绪 / 已死 / 无响应）
  return pickViaComFallback();
}
