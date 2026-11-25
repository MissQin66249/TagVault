/**
 * 全局 toast 提示（右上角堆叠，错误 5s / 其他 3s 自动消失）。
 */
import { useStore } from '../store';

const KIND_STYLE: Record<string, string> = {
  error: 'bg-red-50 border-red-300 text-red-800',
  success: 'bg-emerald-50 border-emerald-300 text-emerald-800',
  info: 'bg-sky-50 border-sky-300 text-sky-800',
};

const KIND_ICON: Record<string, string> = {
  error: '✕',
  success: '✓',
  info: 'ℹ',
};

export function ToastHost(): JSX.Element | null {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-14 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-md ${KIND_STYLE[t.kind] ?? KIND_STYLE.info}`}
        >
          <span className="mt-0.5 font-bold">{KIND_ICON[t.kind] ?? KIND_ICON.info}</span>
          <span className="flex-1 break-words">{t.message}</span>
          <button
            type="button"
            className="ml-1 shrink-0 rounded px-1 text-slate-400 hover:text-slate-700"
            onClick={() => dismiss(t.id)}
            aria-label="关闭提示"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
