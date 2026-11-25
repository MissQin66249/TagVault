/**
 * 左栏筛选面板：全部清除 / 文件类型分组 / 各标签类型分组（可折叠、清空、checkbox 多选）。
 * hidden_in_filter=1 的类型不显示。三栏中此栏 ~240px、独立滚动（由父容器控制）。
 */
import { useState } from 'react';
import { categoryMeta } from '../format';
import { useStore } from '../store';

/** 可折叠分组容器 */
function CollapsibleGroup(props: {
  title: string;
  count?: number;
  extra?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState<boolean>(props.defaultOpen ?? true);
  return (
    <div className="border-b border-slate-100 py-2">
      <div className="flex items-center gap-1 px-3">
        <button
          type="button"
          className="flex flex-1 items-center gap-1 text-left text-sm font-semibold text-slate-700 hover:text-blue-700"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span className={`inline-block text-[10px] text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
          <span className="truncate">{props.title}</span>
          {props.count != null && <span className="text-xs font-normal text-slate-400">({props.count})</span>}
        </button>
        {props.extra}
      </div>
      {open && <div className="mt-1 px-3">{props.children}</div>}
    </div>
  );
}

export function FilterPanel(): JSX.Element {
  const facets = useStore((s) => s.facets);
  const categories = useStore((s) => s.categories);
  const selectedTypes = useStore((s) => s.selectedTypes);
  const finalOnly = useStore((s) => s.finalOnly);
  const toggleCategory = useStore((s) => s.toggleCategory);
  const toggleTypeValue = useStore((s) => s.toggleTypeValue);
  const clearType = useStore((s) => s.clearType);
  const clearFilters = useStore((s) => s.clearFilters);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);

  const hasFilters =
    categories.length > 0 || Object.keys(selectedTypes).length > 0 || finalOnly;
  const visibleTypes = (facets?.tagTypes ?? []).filter((t) => t.hiddenInFilter !== 1);
  const catTotal = Object.values(facets?.categories ?? {}).reduce((a, b) => a + b, 0);

  return (
    <aside className="w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white" aria-label="筛选面板">
      {/* 全部清除（无筛选时置灰） */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-bold text-slate-700">筛选</span>
        <button
          type="button"
          disabled={!hasFilters}
          onClick={clearFilters}
          className={`rounded px-2 py-0.5 text-xs ${
            hasFilters ? 'bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-600' : 'cursor-not-allowed text-slate-300'
          }`}
        >
          全部清除
        </button>
      </div>

      {/* 文件类型分组 */}
      <CollapsibleGroup title="文件类型" count={Object.keys(facets?.categories ?? {}).length}>
        {catTotal === 0 ? (
          <p className="py-1 text-xs text-slate-400">暂无文件</p>
        ) : (
          Object.entries(facets?.categories ?? {})
            .sort((a, b) => b[1] - a[1])
            .map(([cat, count]) => (
              <label
                key={cat}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={categories.includes(cat)}
                  onChange={() => toggleCategory(cat)}
                  className="h-3.5 w-3.5 accent-blue-500"
                />
                <span className="shrink-0">{categoryMeta(cat).icon}</span>
                <span className="flex-1 truncate">{categoryMeta(cat).label}</span>
                <span className="text-xs text-slate-400">{count}</span>
              </label>
            ))
        )}
      </CollapsibleGroup>

      {/* 各标签类型分组（hidden_in_filter=1 不显示） */}
      {visibleTypes.map((t) => {
        const selected = selectedTypes[t.id] ?? [];
        const groupHasValues = t.values.length > 0;
        return (
          <CollapsibleGroup
            key={t.id}
            title={t.name}
            count={selected.length > 0 ? selected.length : undefined}
            extra={
              groupHasValues && selected.length > 0 ? (
                <button
                  type="button"
                  onClick={() => clearType(t.id)}
                  className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-red-50 hover:text-red-600"
                  title={`清空「${t.name}」的已选值`}
                >
                  清空
                </button>
              ) : null
            }
          >
            {groupHasValues ? (
              <div className="max-h-56 overflow-y-auto">
                {t.values
                  .filter((v) => v.count > 0 || selected.includes(v.value))
                  .map((v) => (
                    <label
                      key={`${v.id ?? 'f'}-${v.value}`}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(v.value)}
                        onChange={() => toggleTypeValue(t.id, v.value)}
                        className="h-3.5 w-3.5 accent-blue-500"
                      />
                      <span className="flex-1 truncate" title={v.value}>
                        {v.value}
                      </span>
                      <span className="text-xs text-slate-400">{v.count}</span>
                    </label>
                  ))}
                {t.values.every((v) => v.count === 0 && !selected.includes(v.value)) && (
                  <p className="py-1 text-xs text-slate-400">暂无已挂标记</p>
                )}
              </div>
            ) : (
              <p className="py-1 text-xs text-slate-400">暂无标签值</p>
            )}
          </CollapsibleGroup>
        );
      })}

      {/* 索引目录入口（设置弹窗内） */}
      <div className="px-3 py-3">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="w-full rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-xs text-slate-500 hover:border-blue-400 hover:text-blue-600"
        >
          📂 管理索引目录
        </button>
      </div>
    </aside>
  );
}
