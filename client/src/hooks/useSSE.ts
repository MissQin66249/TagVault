/**
 * SSE 订阅 Hook：监听 /api/events 的扫描进度与文件变更事件。
 * - scan-start / scan-progress → 更新 store.scanProgress（进度条）
 * - scan-done → 清空进度并刷新结果与 facets；1.5s 防抖刷新未打标签计数
 * - scan-error → 清空进度 + toast
 * - files-changed → 防抖 1s 后刷新结果与 facets（watcher 批量事件合并）；
 *   paths 非空时弹 info toast（3s 内同波去重）+ 1.5s 防抖刷新未打标签计数
 */
import { useEffect } from 'react';
import { useStore } from '../store';

const REFRESH_DEBOUNCE_MS = 1000;
const UNTAGGED_REFRESH_DEBOUNCE_MS = 1500;
const NEW_FILE_TOAST_INTERVAL_MS = 3000;

interface SsePayload {
  directoryId?: number;
  dirPath?: string;
  scanned?: number;
  total?: number;
  message?: string;
  paths?: string[];
}

export function useSSE(): void {
  useEffect(() => {
    const es = new EventSource('/api/events');
    let refreshTimer: number | null = null;
    let untaggedTimer: number | null = null;
    let lastNewFileToastAt = 0;

    const refreshNow = (): void => {
      const s = useStore.getState();
      void s.runSearch(true);
      void s.refreshFacets();
    };

    const scheduleRefresh = (): void => {
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(refreshNow, REFRESH_DEBOUNCE_MS);
    };

    /** 未打标签计数：1.5s 防抖刷新（避免 watcher 事件波频繁打接口） */
    const scheduleUntaggedRefresh = (): void => {
      if (untaggedTimer != null) window.clearTimeout(untaggedTimer);
      untaggedTimer = window.setTimeout(
        () => void useStore.getState().refreshUntaggedCount(),
        UNTAGGED_REFRESH_DEBOUNCE_MS,
      );
    };

    /** 新增/变更文件提醒：同一波事件 3 秒内只提示一次 */
    const maybeNotifyNewFiles = (paths: string[] | undefined): void => {
      if (!paths || paths.length === 0) return;
      const now = Date.now();
      if (now - lastNewFileToastAt < NEW_FILE_TOAST_INTERVAL_MS) return;
      lastNewFileToastAt = now;
      useStore.getState().pushToast('info', '检测到新增/变更文件，可能有未打标签文件');
    };

    const parse = (e: MessageEvent): SsePayload => {
      try {
        return JSON.parse(String(e.data ?? '{}')) as SsePayload;
      } catch {
        return {};
      }
    };

    const onStart = (e: MessageEvent): void => {
      const d = parse(e);
      useStore.getState().setScanProgress({
        running: true,
        directoryId: d.directoryId ?? null,
        dirPath: d.dirPath ?? null,
        scanned: 0,
        total: d.total ?? 0,
      });
    };

    const onProgress = (e: MessageEvent): void => {
      const d = parse(e);
      useStore.getState().setScanProgress({
        running: true,
        directoryId: d.directoryId ?? null,
        scanned: d.scanned ?? 0,
        total: d.total ?? 0,
      });
    };

    const onDone = (): void => {
      useStore.getState().clearScanProgress();
      refreshNow();
      scheduleUntaggedRefresh();
    };

    const onErrorEvent = (e: MessageEvent): void => {
      const d = parse(e);
      useStore.getState().clearScanProgress();
      useStore.getState().pushToast('error', `扫描出错：${d.message ?? '未知原因'}`);
    };

    const onFilesChanged = (e: MessageEvent): void => {
      const d = parse(e);
      maybeNotifyNewFiles(d.paths);
      scheduleRefresh();
      scheduleUntaggedRefresh();
    };

    es.addEventListener('scan-start', onStart as EventListener);
    es.addEventListener('scan-progress', onProgress as EventListener);
    es.addEventListener('scan-done', onDone as EventListener);
    es.addEventListener('scan-error', onErrorEvent as EventListener);
    es.addEventListener('files-changed', onFilesChanged as EventListener);

    return () => {
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      if (untaggedTimer != null) window.clearTimeout(untaggedTimer);
      es.close();
    };
  }, []);
}
