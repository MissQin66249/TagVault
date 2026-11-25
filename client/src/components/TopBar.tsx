/**
 * 顶栏：标题、搜索框（输入即搜 150ms 防抖）、排序、视图切换、只看定稿、设置、结果数、扫描进度。
 * 高度 48px。
 */
import { useEffect } from 'react';
import { useStore } from '../store';
import type { SortKey, SortOrder, ViewMode } from '../types';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'name', label: '名称' },
  { value: 'mtime', label: '修改时间' },
  { value: 'size', label: '大小' },
];

export function TopBar(): JSX.Element {
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const total = useStore((s) => s.total);
  const loading = useStore((s) => s.loading);
  const sort = useStore((s) => s.sort);
  const order = useStore((s) => s.order);
  const setSort = useStore((s) => s.setSort);
  const setOrder = useStore((s) => s.setOrder);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const finalOnly = useStore((s) => s.finalOnly);
  const setFinalOnly = useStore((s) => s.setFinalOnly);
  const untaggedCount = useStore((s) => s.untaggedCount);
  const untaggedOnly = useStore((s) => s.untaggedOnly);
  const setUntaggedOnly = useStore((s) => s.setUntaggedOnly);
  const refreshUntaggedCount = useStore((s) => s.refreshUntaggedCount);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const scanProgress = useStore((s) => s.scanProgress);

  // 未打标签计数：初始加载一次（后续由 SSE 防抖刷新 + 打标操作后刷新）
  useEffect(() => {
    void refreshUntaggedCount();
  }, [refreshUntaggedCount]);

  const pct =
    scanProgress.running && scanProgress.total > 0
      ? Math.min(100, Math.round((scanProgress.scanned / scanProgress.total) * 100))
      : 0;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
      <h1 className="shrink-0 text-lg font-bold tracking-wide text-slate-800">标签管家</h1>

      {/* 搜索框：输入即搜，支持 类型:值 语法 */}
      <div className="relative flex-1 max-w-xl">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">🔍</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索文件名 / 路径 / 标签，支持 类型:值 语法，如 保密级别:机密|内部"
          className="h-8 w-full rounded-md border border-slate-300 bg-slate-50 pl-8 pr-8 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:bg-white"
          aria-label="搜索"
        />
        {query && (
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-slate-400 hover:text-slate-700"
            onClick={() => setQuery('')}
            aria-label="清空搜索"
          >
            ✕
          </button>
        )}
      </div>

      <span className="shrink-0 text-xs text-slate-500">
        {loading ? '搜索中…' : `共 ${total} 条结果`}
      </span>

      {/* 排序 */}
      <select
        value={sort}
        onChange={(e) => setSort(e.target.value as SortKey)}
        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm"
        aria-label="排序字段"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}
        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm hover:bg-slate-100"
        title={order === 'asc' ? '升序（点击切换降序）' : '降序（点击切换升序）'}
        aria-label="排序方向"
      >
        {order === 'asc' ? '↑ 升序' : '↓ 降序'}
      </button>

      {/* 视图切换 */}
      <div className="flex h-8 overflow-hidden rounded-md border border-slate-300" role="group" aria-label="视图切换">
        {(
          [
            { mode: 'table' as ViewMode, label: '☰ 表格' },
            { mode: 'thumb' as ViewMode, label: '▦ 缩略图' },
          ]
        ).map((o) => (
          <button
            key={o.mode}
            type="button"
            onClick={() => setView(o.mode)}
            className={`px-2.5 text-sm ${view === o.mode ? 'bg-blue-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* 只看定稿 */}
      <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={finalOnly}
          onChange={(e) => setFinalOnly(e.target.checked)}
          className="h-4 w-4 accent-blue-500"
        />
        只看定稿
      </label>

      {/* 未打标签提醒徽标：N>0 时显示，点击切换"只看未打标签"筛选 */}
      {untaggedCount > 0 && (
        <button
          type="button"
          onClick={() => setUntaggedOnly(!untaggedOnly)}
          title={untaggedOnly ? '点击取消"只看未打标签"' : '点击只看未打标签文件'}
          aria-pressed={untaggedOnly}
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            untaggedOnly
              ? 'bg-amber-500 text-white hover:bg-amber-600'
              : 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
          }`}
        >
          🔔 未打标签 {untaggedCount}
        </button>
      )}

      {/* 扫描进度指示 */}
      {scanProgress.running && (
        <div className="w-32 shrink-0" title={`正在扫描 ${scanProgress.dirPath ?? ''}：${scanProgress.scanned}/${scanProgress.total}`}>
          <div className="text-[10px] leading-3 text-slate-500">
            扫描中 {scanProgress.scanned}/{scanProgress.total}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* 设置 */}
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        className="h-8 shrink-0 rounded-md border border-slate-300 bg-white px-2.5 text-sm hover:bg-slate-100"
        title="设置（索引目录 / 标签类型 / 导入导出）"
      >
        ⚙ 设置
      </button>
    </header>
  );
}
