/**
 * 应用根组件：三栏布局（左筛选 ~240px / 中列表 flex-1 / 右详情 ~320px），
 * 三栏独立滚动；顶栏 48px；组合 T03 检索链路与 T04 主界面组件；
 * 订阅 SSE（扫描进度 / 文件变更自动刷新）。
 */
import { useEffect, useMemo } from 'react';
import { useSSE } from './hooks/useSSE';
import { useDebounce } from './hooks/useDebounce';
import { useStore } from './store';
import { ActiveFilters } from './components/ActiveFilters';
import { BatchTagBar } from './components/BatchTagBar';
import { ContextMenu } from './components/ContextMenu';
import { DetailPanel } from './components/DetailPanel';
import { FileTable } from './components/FileTable';
import { FilterPanel } from './components/FilterPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { ThumbGrid } from './components/ThumbGrid';
import { ToastHost } from './components/Toast';
import { TopBar } from './components/TopBar';

export default function App(): JSX.Element {
  const view = useStore((s) => s.view);
  const loading = useStore((s) => s.loading);
  const total = useStore((s) => s.total);
  const itemCount = useStore((s) => s.items.length);
  const selectionCount = useStore((s) => s.selection.length);
  const runSearch = useStore((s) => s.runSearch);
  const refreshFacets = useStore((s) => s.refreshFacets);
  const loadMore = useStore((s) => s.loadMore);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  // 搜索输入 150ms 防抖 → 同步到 store.debouncedQuery
  const rawQuery = useStore((s) => s.query);
  const debounced = useDebounce(rawQuery, 150);
  const setDebouncedQuery = useStore((s) => s.setDebouncedQuery);
  useEffect(() => {
    setDebouncedQuery(debounced);
  }, [debounced, setDebouncedQuery]);

  // 检索输入变化（关键词/面板筛选/只看定稿/未打标签/排序）→ 重新搜索（含首次加载）
  const filtersKey = useStore((s) =>
    JSON.stringify([s.debouncedQuery, s.selectedTypes, s.categories, s.finalOnly, s.untaggedOnly, s.sort, s.order]),
  );
  useEffect(() => {
    void runSearch(true);
  }, [filtersKey, runSearch]);

  // 初始加载 facets
  useEffect(() => {
    void refreshFacets();
  }, [refreshFacets]);

  // SSE：扫描进度 / 文件变更自动刷新
  useSSE();

  const hasFilters = useMemo(
    () => filtersKey !== JSON.stringify(['', {}, [], false, false, 'mtime', 'desc']),
    [filtersKey],
  );

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <TopBar />
      <ActiveFilters />

      <div className="flex min-h-0 flex-1">
        {/* 左栏：筛选面板 */}
        <FilterPanel />

        {/* 中栏：结果列表 */}
        <main className="flex min-w-0 flex-1 flex-col bg-white">
          {selectionCount > 0 && <BatchTagBar />}

          {view === 'table' ? <FileTable /> : <ThumbGrid />}

          {/* 加载中 / 空态 / 加载更多 */}
          {loading && <p className="py-2 text-center text-xs text-slate-400">加载中…</p>}
          {!loading && total === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <p className="text-4xl">🗂</p>
              {hasFilters ? (
                <>
                  <p className="mt-2 text-sm text-slate-500">没有符合条件的文件</p>
                  <p className="mt-1 text-xs text-slate-400">尝试减少筛选条件或更换关键词</p>
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm text-slate-500">暂无结果，添加索引目录开始使用</p>
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="mt-3 rounded-md bg-blue-500 px-4 py-1.5 text-sm text-white hover:bg-blue-600"
                  >
                    📂 打开设置，添加索引目录
                  </button>
                </>
              )}
            </div>
          )}
          {!loading && total > 0 && itemCount < total && (
            <button
              type="button"
              onClick={() => void loadMore()}
              className="border-t border-slate-100 py-2 text-center text-xs text-blue-600 hover:bg-blue-50"
            >
              加载更多（已显示 {itemCount} / 共 {total}）
            </button>
          )}
        </main>

        {/* 右栏：详情 */}
        <DetailPanel />
      </div>

      {/* 全局浮层 */}
      <ContextMenu />
      <SettingsDialog />
      <ToastHost />
    </div>
  );
}
