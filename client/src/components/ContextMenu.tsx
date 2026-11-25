/**
 * 右键菜单：打开 / 打开所在文件夹 / 复制路径 / 编辑标签（聚焦右栏）。
 */
import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import { useStore } from '../store';

/** 复制到剪贴板（非安全上下文降级 execCommand） */
function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
  return Promise.resolve();
}

export function ContextMenu(): JSX.Element | null {
  const target = useStore((s) => s.contextMenu);
  const close = useStore((s) => s.closeContextMenu);
  const pushToast = useStore((s) => s.pushToast);
  const pushApiError = useStore((s) => s.pushApiError);
  const openDetail = useStore((s) => s.openDetail);
  const requestDetailFocus = useStore((s) => s.requestDetailFocus);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  // 打开后按菜单实际尺寸修正位置，避免溢出视口
  useEffect(() => {
    if (!target) {
      setPos(null);
      return;
    }
    const el = menuRef.current;
    let x = target.x;
    let y = target.y;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (x + rect.width > window.innerWidth - 8) x = window.innerWidth - rect.width - 8;
      if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
    }
    setPos({ x: Math.max(4, x), y: Math.max(4, y) });
  }, [target]);

  if (!target || !pos) return null;

  const run = (fn: () => Promise<unknown>, okMsg?: string): void => {
    void fn()
      .then(() => {
        if (okMsg) pushToast('success', okMsg);
      })
      .catch((err) => pushApiError(err));
    close();
  };

  const items: Array<{ label: string; action: () => void; disabled?: boolean }> = [
    {
      label: '打 开',
      disabled: target.file.missing === 1,
      action: () => run(() => api.openFile(target.file.id), '已调用系统程序打开'),
    },
    {
      label: '打开所在文件夹',
      action: () => run(() => api.openFolder(target.file.id)),
    },
    {
      label: '复制路径',
      action: () => {
        void copyText(target.file.path)
          .then(() => pushToast('success', '路径已复制'))
          .catch(() => pushToast('error', '复制失败'));
        close();
      },
    },
    {
      label: '编辑标签',
      action: () => {
        void openDetail(target.file.id);
        requestDetailFocus();
        close();
      },
    },
  ];

  return (
    <>
      {/* 全局点击/右键遮罩：关闭菜单 */}
      <div
        className="fixed inset-0 z-40"
        onClick={close}
        onContextMenu={(e) => {
          e.preventDefault();
          close();
        }}
      />
      <div
        ref={menuRef}
        className="fixed z-50 min-w-[160px] rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        style={{ left: pos.x, top: pos.y }}
        role="menu"
      >
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={it.action}
            className={`block w-full px-4 py-1.5 text-left text-sm ${
              it.disabled ? 'cursor-not-allowed text-slate-300' : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700'
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}
