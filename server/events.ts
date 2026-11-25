/**
 * SSE 广播中心：扫描进度 / 文件变更 / 扫描完成等事件推送给前端。
 */
import type { Request, Response } from 'express';

const clients = new Set<Response>();

let heartbeat: ReturnType<typeof setInterval> | null = null;

/** 注册一个 SSE 客户端连接 */
export function subscribe(req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('event: connected\ndata: {}\n\n');
  clients.add(res);
  req.on('close', () => {
    clients.delete(res);
  });
  if (!heartbeat) {
    heartbeat = setInterval(() => {
      for (const c of clients) {
        try {
          c.write(':hb\n\n');
        } catch {
          clients.delete(c);
        }
      }
    }, 25000);
    // 测试环境下不阻止进程退出
    (heartbeat as unknown as { unref?: () => void }).unref?.();
  }
}

/** 向所有客户端广播事件（data 会被 JSON 序列化） */
export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const c of clients) {
    try {
      c.write(payload);
    } catch {
      clients.delete(c);
    }
  }
}

/** 当前连接数 */
export function clientCount(): number {
  return clients.size;
}
