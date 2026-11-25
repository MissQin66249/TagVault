/**
 * shell 操作：用系统默认程序打开文件 / 打开所在文件夹并选中。
 * 仅调用本机命令，无网络请求。
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

/** 用系统默认程序打开文件（cmd /c start "" "path"） */
export function openFile(filePath: string): void {
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', filePath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [filePath], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' }).unref();
  }
}

/** 打开文件所在文件夹并选中该文件（explorer /select,"path"） */
export function openFolderContaining(filePath: string): void {
  if (process.platform === 'win32') {
    const child = spawn('explorer.exe', [`/select,${filePath}`], { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    // 非 Windows：打开父目录
    const parent = path.dirname(filePath);
    if (process.platform === 'darwin') {
      spawn('open', [parent], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [parent], { detached: true, stdio: 'ignore' }).unref();
    }
  }
}
