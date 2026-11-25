/**
 * 缩略图网格视图：图片文件懒加载（IntersectionObserver 进入可视区才请求），
 * URL 带 ?v=<mtime> 内容版本号；无缩略图显示扩展名占位块；缺失文件红徽标。
 * 多选交互与表格一致（单击/Ctrl/Shift 经 store.rowClick）。
 */
import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import { categoryMeta, formatSize, formatTime, thumbUrl } from '../format';
import { useStore } from '../store';
import type { FileItem } from '../types';
import { MissingBadge } from './MissingBadge';

/** 进入可视区后才设置 src 的懒加载图片 */
function LazyThumb(props: { item: FileItem }): JSX.Element {
  const { item } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setVisible(false);
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '150px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [item.id, item.mtime]);

  return (
    <div ref={ref} className="h-full w-full">
      {item.hasThumb && visible && !failed ? (
        <img
          src={thumbUrl(item.id, item.mtime)}
          alt={item.name}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        // 占位块：扩展名 + 类别图标
        <div className="flex h-full w-full flex-col items-center justify-center bg-slate-100">
          <span className="text-2xl">{categoryMeta(item.category).icon}</span>
          <span className="max-w-full truncate px-1 text-[10px] uppercase text-slate-400">
            {(item.ext ?? item.category).replace('.', '')}
          </span>
        </div>
      )}
    </div>
  );
}

export function ThumbGrid(): JSX.Element {
  const items = useStore((s) => s.items);
  const selection = useStore((s) => s.selection);
  const rowClick = useStore((s) => s.rowClick);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const openDetail = useStore((s) => s.openDetail);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const pushToast = useStore((s) => s.pushToast);
  const pushApiError = useStore((s) => s.pushApiError);

  const selectedSet = new Set(selection);

  const onDoubleClick = (item: FileItem): void => {
    if (item.missing === 1) {
      pushToast('error', '文件已缺失，无法打开');
      return;
    }
    void api.openFile(item.id).catch((err) => pushApiError(err));
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
        {items.map((item, index) => {
          const selected = selectedSet.has(item.id);
          return (
            <div
              key={item.id}
              onClick={(e) => rowClick(e, item, index)}
              onDoubleClick={() => onDoubleClick(item)}
              onContextMenu={(e) => {
                e.preventDefault();
                openContextMenu({ x: e.clientX, y: e.clientY, file: item });
              }}
              className={`group cursor-default overflow-hidden rounded-lg border bg-white shadow-sm transition-shadow hover:shadow-md ${
                selected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'
              }`}
              title={`${item.name}\n${item.path}\n${formatSize(item.size)} · ${formatTime(item.mtime)}`}
            >
              <div className="relative h-28">
                <LazyThumb item={item} />
                <label
                  className="absolute left-1.5 top-1.5 rounded bg-white/80 p-0.5 shadow-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelect(item.id)}
                    className="h-3.5 w-3.5 accent-blue-500"
                  />
                </label>
                {item.missing === 1 && (
                  <div className="absolute right-1 top-1">
                    <MissingBadge compact />
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5" onClick={() => openDetail(item.id)}>
                <p className={`truncate text-xs ${item.missing === 1 ? 'text-red-600' : 'text-slate-700'}`}>{item.name}</p>
                <p className="mt-0.5 flex justify-between text-[10px] text-slate-400">
                  <span>{categoryMeta(item.category).label}</span>
                  <span>{formatSize(item.size)}</span>
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
