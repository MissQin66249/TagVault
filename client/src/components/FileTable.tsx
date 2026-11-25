/**
 * 表格视图：@tanstack/react-virtual 虚拟滚动。
 * 列：复选框 / 名称 / 类型 / 标签摘要 / 大小 / 修改时间。
 * 行点击选中（Ctrl 多选、Shift 范围选）、双击打开、右键菜单。
 */
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as api from '../api';
import { categoryMeta, formatSize, formatTime } from '../format';
import { useStore } from '../store';
import type { FileItem } from '../types';
import { MissingBadge } from './MissingBadge';

const ROW_HEIGHT = 36;

export function FileTable(): JSX.Element {
  const items = useStore((s) => s.items);
  const selection = useStore((s) => s.selection);
  const rowClick = useStore((s) => s.rowClick);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const selectAllVisible = useStore((s) => s.selectAllVisible);
  const clearSelection = useStore((s) => s.clearSelection);
  const openDetail = useStore((s) => s.openDetail);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const pushToast = useStore((s) => s.pushToast);
  const pushApiError = useStore((s) => s.pushApiError);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const selectedSet = new Set(selection);
  const allSelected = items.length > 0 && items.every((i) => selectedSet.has(i.id));

  const onDoubleClick = (item: FileItem): void => {
    if (item.missing === 1) {
      pushToast('error', '文件已缺失，无法打开');
      return;
    }
    api.openFile(item.id).catch((err) => pushApiError(err));
  };

  const tagSummary = (item: FileItem): string =>
    item.tags.slice(0, 3).map((t) => `${t.typeName}:${t.value}`).join('　');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 表头（固定，不随虚拟滚动） */}
      <div className="grid shrink-0 items-center border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500"
        style={{ gridTemplateColumns: '2.25rem minmax(0,1fr) 4.5rem minmax(0,1.5fr) 5rem 9.5rem' }}
      >
        <label className="flex h-8 items-center justify-center">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => (allSelected ? clearSelection() : selectAllVisible())}
            className="h-3.5 w-3.5 accent-blue-500"
            title="全选 / 取消全选"
          />
        </label>
        <div className="px-2">名称</div>
        <div className="px-2">类型</div>
        <div className="px-2">标签</div>
        <div className="px-2 text-right">大小</div>
        <div className="px-2">修改时间</div>
      </div>

      {/* 虚拟滚动区 */}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto bg-white">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const item = items[vRow.index];
            const selected = selectedSet.has(item.id);
            return (
              <div
                key={item.id}
                role="row"
                onClick={(e) => rowClick(e, item, vRow.index)}
                onDoubleClick={() => onDoubleClick(item)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openContextMenu({ x: e.clientX, y: e.clientY, file: item });
                }}
                className={`grid cursor-default items-center border-b border-slate-100 hover:bg-blue-50 ${
                  selected ? 'bg-blue-50' : 'bg-white'
                }`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: vRow.size,
                  transform: `translateY(${vRow.start}px)`,
                  gridTemplateColumns: '2.25rem minmax(0,1fr) 4.5rem minmax(0,1.5fr) 5rem 9.5rem',
                }}
              >
                <label className="flex h-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelect(item.id)}
                    className="h-3.5 w-3.5 accent-blue-500"
                  />
                </label>
                <div className="flex min-w-0 items-center gap-1.5 px-2">
                  <span className="shrink-0 text-sm" title={categoryMeta(item.category).label}>
                    {categoryMeta(item.category).icon}
                  </span>
                  <span
                    className={`truncate text-sm ${item.missing === 1 ? 'text-red-600' : 'text-slate-800'}`}
                    title={item.path}
                  >
                    {item.name}
                  </span>
                  {item.missing === 1 && <MissingBadge compact />}
                </div>
                <div className="px-2 text-xs text-slate-500">{categoryMeta(item.category).label}</div>
                <div className="truncate px-2 text-xs text-slate-500" title={item.tags.map((t) => `${t.typeName}:${t.value}`).join('；')}>
                  {tagSummary(item)}
                  {item.tags.length > 3 && <span className="ml-1 text-slate-400">+{item.tags.length - 3}</span>}
                </div>
                <div className="px-2 text-right text-xs text-slate-500">{formatSize(item.size)}</div>
                <div className="px-2 text-xs text-slate-500">{formatTime(item.mtime)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
