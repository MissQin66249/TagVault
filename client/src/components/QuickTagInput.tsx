/**
 * 快速添加标签输入框：输入 ≥1 字即调 /api/suggest 实时提示（值+类型名+次数，
 * 精确匹配置顶徽标）；点击提示项直接挂上；Enter 支持逗号/顿号/分号分隔多值，
 * 无匹配的值自动归"未分类"（后端处理，前端直接 POST）。打标后刷新详情与 facets。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useDebounce } from '../hooks/useDebounce';
import { splitValues } from '../format';
import * as api from '../api';
import { useStore } from '../store';
import type { SuggestItem } from '../types';

export interface QuickTagInputHandle {
  focus(): void;
}

export const QuickTagInput = forwardRef<QuickTagInputHandle>(function QuickTagInput(_props, ref) {
  const fileId = useStore((s) => s.detailId);
  const selection = useStore((s) => s.selection);
  const facets = useStore((s) => s.facets);
  const afterTagMutation = useStore((s) => s.afterTagMutation);
  const pushToast = useStore((s) => s.pushToast);
  const pushApiError = useStore((s) => s.pushApiError);

  // 多选批量模式：目标为全部所选文件；单选为当前文件
  const targetIds =
    fileId != null && selection.length > 1 ? selection : fileId != null ? [fileId] : [];
  const batchMode = targetIds.length > 1;

  const [text, setText] = useState('');
  const [items, setItems] = useState<SuggestItem[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const debouncedText = useDebounce(text, 150);

  useImperativeHandle(ref, () => ({
    focus: (): void => inputRef.current?.focus(),
  }));

  // 输入 ≥1 字 → 实时提示
  useEffect(() => {
    const q = debouncedText.trim();
    if (!q || fileId == null) {
      setItems([]);
      setOpen(false);
      return;
    }
    let alive = true;
    api
      .suggest(q)
      .then((res) => {
        if (!alive) return;
        setItems(res);
        setOpen(res.length > 0);
      })
      .catch((err) => pushApiError(err));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedText, fileId]);

  // 点击外部关闭下拉
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  /** 挂标签：给定值与可选 typeId；作用于全部目标文件（多选=批量）。打标后刷新并清空输入 */
  const attach = (values: Array<{ typeId?: number; type?: string; value: string }>): void => {
    if (targetIds.length === 0 || values.length === 0 || busy) return;
    setBusy(true);
    // 按 typeId 分组走批量接口；未带类型的值归「未分类」（类型不存在时逐文件兜底）
    const unclassifiedId = facets?.tagTypes.find((t) => t.name === '未分类')?.id;
    const groups = new Map<number, string[]>();
    const fallbackItems: Array<{ typeId?: number; type?: string; value: string }> = [];
    for (const it of values) {
      const tid = it.typeId ?? (it.type == null ? unclassifiedId : undefined);
      if (tid != null) {
        const arr = groups.get(tid) ?? [];
        arr.push(it.value);
        groups.set(tid, arr);
      } else {
        fallbackItems.push(it);
      }
    }
    const tasks: Array<Promise<unknown>> = [];
    for (const [tid, vals] of groups) tasks.push(api.batchTags(targetIds, tid, vals, 'add'));
    if (fallbackItems.length > 0) {
      for (const id of targetIds) tasks.push(api.addTags(id, fallbackItems));
    }
    void Promise.all(tasks)
      .then(() => {
        pushToast('success', batchMode ? `已为 ${targetIds.length} 个文件添加标签` : '标签已添加');
        setText('');
        setItems([]);
        setOpen(false);
        return afterTagMutation();
      })
      .catch((err) => pushApiError(err))
      .finally(() => setBusy(false));
  };

  /** 点击提示项（一个值多类型时后端已按 (值,类型) 拆分为多条候选，直接点选） */
  const onPick = (item: SuggestItem): void => {
    attach([{ typeId: item.typeId, value: item.value }]);
  };

  /** Enter：按分隔符拆分多值；能精确匹配建议的值带上其类型，否则交由后端归"未分类" */
  const onEnter = (): void => {
    const tokens = splitValues(text);
    if (tokens.length === 0) return;
    const payload = tokens.map((v) => {
      const exact = items.find((it) => it.exact && it.value === v);
      return exact ? { typeId: exact.typeId, value: v } : { value: v };
    });
    attach(payload);
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="flex gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => items.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEnter();
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder={
            batchMode
              ? `快速添加标签（将添加到所选 ${targetIds.length} 个文件）：Enter 可逗号分隔多值`
              : '快速添加标签：输入即提示，Enter 可逗号分隔多值'
          }
          className="h-8 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2.5 text-sm focus:border-blue-400"
          aria-label="快速添加标签"
        />
        <button
          type="button"
          onClick={onEnter}
          disabled={busy}
          className="h-8 shrink-0 rounded-md bg-blue-500 px-3 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
        >
          添加
        </button>
      </div>

      {/* 建议下拉 */}
      {open && items.length > 0 && (
        <div className="absolute left-0 right-14 top-9 z-30 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {items.map((it, idx) => (
            <button
              key={`${it.typeId}-${it.value}-${idx}`}
              type="button"
              onClick={() => onPick(it)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-blue-50"
            >
              <span className="truncate font-medium">{it.value}</span>
              {it.exact && (
                <span className="shrink-0 rounded bg-blue-100 px-1 text-[10px] font-semibold text-blue-700">精确</span>
              )}
              <span className="shrink-0 rounded bg-slate-100 px-1.5 text-[11px] text-slate-500">{it.typeName}</span>
              <span className="ml-auto shrink-0 text-[11px] text-slate-400">
                {it.count > 0 ? `${it.count} 次` : '字典值'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
