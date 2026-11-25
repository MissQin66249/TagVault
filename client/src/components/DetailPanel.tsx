/**
 * 右栏详情面板（~320px，独立滚动）：预览图 / 缺失标记 / 路径大小时间 / 类别 /
 * "内容说明"置顶 / 当前标签按类型分组（× 去标）/ 按类型添加（枚举复选面板带过滤与
 * 已挂标记、自由输入逗号多值）/ QuickTagInput 快速添加。
 * 多选（Ctrl/Shift）时进入批量模式：打标/去标应用到全部所选文件，标签区显示并集与覆盖数。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { splitValues, thumbUrl } from '../format';
import { useStore } from '../store';
import * as api from '../api';
import type { FacetType, TagRef } from '../types';
import { MissingBadge } from './MissingBadge';
import { QuickTagInput, QuickTagInputHandle } from './QuickTagInput';

/** 多选时批量拉取各文件标签的上限（超过则退化为仅显示锚点文件） */
const MULTI_FETCH_LIMIT = 50;

/** 标签覆盖状态：all=所选全部都有 / some=部分有 / none=都没有 */
type HasState = 'all' | 'some' | 'none';

/** 当前标签分组视图 */
function TagGroup(props: {
  typeName: string;
  values: TagRef[];
  /** 值 → 覆盖状态（批量模式标注「部分」） */
  hasState?: (value: string) => HasState;
  onRemove: (tag: TagRef) => void;
  muted?: boolean;
}): JSX.Element {
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs font-semibold text-slate-400">{props.typeName}</div>
      <div className="flex flex-wrap gap-1.5">
        {props.values.map((t) => {
          const st = props.hasState?.(t.value) ?? 'all';
          return (
            <span
              key={`${t.typeId}-${t.value}`}
              className={`group flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${
                props.muted ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-sky-200 bg-sky-50 text-sky-800'
              }`}
            >
              <span className="max-w-[180px] truncate" title={t.value}>
                {t.value}
              </span>
              {st === 'some' && (
                <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-700">部分</span>
              )}
              <button
                type="button"
                onClick={() => props.onRemove(t)}
                className="text-slate-400 hover:text-red-600"
                title="从所选文件移除该标签"
                aria-label={`移除标签 ${t.value}`}
              >
                ✕
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** 按类型添加：枚举 → 复选面板（过滤 + 已挂标记）；自由 → 多值输入。均作用于 ids 全部文件 */
function AddByType(props: {
  type: FacetType;
  ids: number[];
  hasState: (value: string) => HasState;
}): JSX.Element | null {
  const { type, ids } = props;
  const afterTagMutation = useStore((s) => s.afterTagMutation);
  const pushToast = useStore((s) => s.pushToast);
  const pushApiError = useStore((s) => s.pushApiError);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  if (ids.length === 0) return null;

  const mutate = (fn: () => Promise<unknown>): void => {
    if (busy) return;
    setBusy(true);
    void fn()
      .then(() => afterTagMutation())
      .catch((err) => pushApiError(err))
      .finally(() => setBusy(false));
  };

  const toggleEnumValue = (value: string): void => {
    const st = props.hasState(value);
    // 全部都有或部分有 → 勾掉即从全部所选文件移除；都没有 → 勾上即给全部所选文件添加
    mutate(() =>
      st === 'none'
        ? api.batchTags(ids, type.id, [value], 'add')
        : api.batchTags(ids, type.id, [value], 'remove'),
    );
  };

  const addFree = (): void => {
    const values = splitValues(text);
    if (values.length === 0) {
      pushToast('info', '请输入标签值');
      return;
    }
    mutate(() => api.batchTags(ids, type.id, values, 'add'));
    setText('');
  };

  return (
    <div className="mb-3 rounded-md border border-slate-200 bg-slate-50/60 p-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left text-xs font-medium text-slate-600 hover:text-blue-700"
        aria-expanded={open}
      >
        <span>
          {type.inputMode === 'enum' ? '☑' : '✎'} 添加 / 编辑「{type.name}」
        </span>
        <span className="text-[10px] text-slate-400">{open ? '收起 ▲' : '展开 ▼'}</span>
      </button>

      {open && type.inputMode === 'enum' && (
        <div className="mt-2">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="过滤字典值…"
            className="mb-1.5 h-7 w-full rounded border border-slate-300 px-2 text-xs"
          />
          <div className="max-h-40 overflow-y-auto">
            {type.values
              .filter((v) => v.id != null)
              .filter((v) => !filter || v.value.includes(filter))
              .map((v) => {
                const st = props.hasState(v.value);
                return (
                  <label
                    key={v.value}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-slate-700 hover:bg-white"
                  >
                    <input
                      type="checkbox"
                      checked={st !== 'none'}
                      disabled={busy}
                      onChange={() => toggleEnumValue(v.value)}
                      className="h-3.5 w-3.5 accent-blue-500"
                    />
                    <span className="flex-1 truncate">{v.value}</span>
                    {st === 'all' && (
                      <span className="shrink-0 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">已挂</span>
                    )}
                    {st === 'some' && (
                      <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] text-amber-700">部分</span>
                    )}
                    <span className="shrink-0 text-[10px] text-slate-400">{v.count}</span>
                  </label>
                );
              })}
            {type.values.filter((v) => v.id != null).length === 0 && (
              <p className="py-1 text-xs text-slate-400">该枚举类型暂无字典值，可在设置的「标签类型管理」中添加</p>
            )}
          </div>
        </div>
      )}

      {open && type.inputMode === 'free' && (
        <div className="mt-2 flex gap-1.5">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFree()}
            placeholder="逗号/顿号/分号分隔一次加多个，Enter 添加"
            className="h-7 min-w-0 flex-1 rounded border border-slate-300 px-2 text-xs"
            maxLength={300}
          />
          <button
            type="button"
            onClick={addFree}
            disabled={busy}
            className="h-7 shrink-0 rounded bg-blue-500 px-2.5 text-xs text-white hover:bg-blue-600 disabled:opacity-50"
          >
            添加
          </button>
        </div>
      )}
    </div>
  );
}

export function DetailPanel(): JSX.Element {
  const detail = useStore((s) => s.detail);
  const detailLoading = useStore((s) => s.detailLoading);
  const detailId = useStore((s) => s.detailId);
  const selection = useStore((s) => s.selection);
  const facets = useStore((s) => s.facets);
  const closeDetail = useStore((s) => s.closeDetail);
  const afterTagMutation = useStore((s) => s.afterTagMutation);
  const pushApiError = useStore((s) => s.pushApiError);
  const pushToast = useStore((s) => s.pushToast);
  const detailFocusSignal = useStore((s) => s.detailFocusSignal);
  const quickRef = useRef<QuickTagInputHandle>(null);

  const batchMode = selection.length > 1 && detailId != null;
  /** 批量模式：各所选文件的标签（键=文件 id）；超过上限时为 null（退化为锚点文件） */
  const [multiTags, setMultiTags] = useState<Map<number, TagRef[]> | null>(null);
  const selKey = selection.join(',');

  // 「编辑标签」右键动作 → 聚焦快速添加输入框
  useEffect(() => {
    if (detailFocusSignal > 0 && detailId != null) {
      quickRef.current?.focus();
    }
  }, [detailFocusSignal, detailId]);

  // 批量模式拉取各文件标签（≤50 个；detail 刷新后重拉以保持并集最新）
  useEffect(() => {
    if (!batchMode || !detail || selection.length > MULTI_FETCH_LIMIT) {
      setMultiTags(null);
      return;
    }
    let alive = true;
    void Promise.all(
      selection.map((id) =>
        api
          .getFileTags(id)
          .then((tags) => [id, tags] as const)
          .catch(() => [id, [] as TagRef[]] as const),
      ),
    ).then((entries) => {
      if (alive) setMultiTags(new Map(entries));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchMode, selKey, detail]);

  // 当前标签按类型名分组（批量模式：所选文件并集）
  const groups = useMemo(() => {
    const map = new Map<string, TagRef[]>();
    if (batchMode && multiTags) {
      const seen = new Set<string>();
      for (const tags of multiTags.values()) {
        for (const t of tags) {
          const key = `${t.typeId}-${t.value}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const arr = map.get(t.typeName) ?? [];
          arr.push(t);
          map.set(t.typeName, arr);
        }
      }
    } else {
      for (const t of detail?.tags ?? []) {
        const arr = map.get(t.typeName) ?? [];
        arr.push(t);
        map.set(t.typeName, arr);
      }
    }
    return map;
  }, [batchMode, multiTags, detail]);

  if (detailId == null || (!detail && !detailLoading)) {
    return (
      <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white" aria-label="详情面板">
        <div className="flex h-full flex-col items-center justify-center px-6 text-center text-sm text-slate-400">
          <p className="text-3xl">🏷</p>
          <p className="mt-2">点击列表中的文件查看详情与标签</p>
        </div>
      </aside>
    );
  }

  if (detailLoading || !detail) {
    return (
      <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white">
        <p className="p-4 text-sm text-slate-400">加载详情中…</p>
      </aside>
    );
  }

  /** 本次标签操作的目标文件集合：批量模式=全部所选，否则=当前文件 */
  const targetIds = batchMode ? selection : [detail.id];
  const typeNameOrder = facets?.tagTypes.map((t) => t.name) ?? [];
  // 分组排序：内容说明置顶 → 按类型面板顺序 → 其余按出现顺序
  const orderedNames = [...groups.keys()].sort((a, b) => {
    const ia = a === '内容说明' ? -1 : typeNameOrder.indexOf(a);
    const ib = b === '内容说明' ? -1 : typeNameOrder.indexOf(b);
    return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
  });

  /** 标签覆盖状态（批量模式基于并集统计，单文件基于当前文件） */
  const hasStateFor = (typeName: string) => (value: string): HasState => {
    if (!batchMode) {
      return detail.tags.some((t) => t.typeName === typeName && t.value === value) ? 'all' : 'none';
    }
    if (!multiTags) return 'none';
    let count = 0;
    for (const tags of multiTags.values()) {
      if (tags.some((t) => t.typeName === typeName && t.value === value)) count += 1;
    }
    if (count === 0) return 'none';
    return count === multiTags.size ? 'all' : 'some';
  };

  /** 去标：统一走批量接口（单文件时 ids 长度为 1） */
  const removeTag = (tag: TagRef): void => {
    void api
      .batchTags(targetIds, tag.typeId, [tag.value], 'remove')
      .then(() => afterTagMutation())
      .catch((err) => pushApiError(err));
  };

  const copyPath = (): void => {
    void navigator.clipboard
      .writeText(detail.path)
      .then(() => pushToast('success', '路径已复制'))
      .catch(() => pushToast('error', '复制失败'));
  };

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white" aria-label="详情面板">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
        <h2 className="truncate text-sm font-bold text-slate-800" title={detail.name}>
          {batchMode ? `已选 ${selection.length} 个文件（批量模式）` : detail.name}
        </h2>
        <button type="button" onClick={closeDetail} className="shrink-0 rounded px-1.5 text-slate-400 hover:text-slate-700" aria-label="关闭详情">
          ✕
        </button>
      </div>

      <div className="p-3">
        {/* 批量模式提示条 */}
        {batchMode && (
          <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs text-blue-800">
            批量模式：下方打标 / 去标将应用到所选全部 {selection.length} 个文件
            {multiTags == null && selection.length > MULTI_FETCH_LIMIT
              ? '（文件较多，标签区仅显示当前文件）'
              : ''}
          </div>
        )}

        {/* 预览图 / 占位（批量模式隐藏，避免误导） */}
        {!batchMode && detail.category === 'image' && detail.hasThumb ? (
          <div className="mb-3 flex h-44 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            <img
              key={`${detail.id}-${detail.mtime}`}
              src={thumbUrl(detail.id, detail.mtime)}
              alt={detail.name}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : null}

        {!batchMode && detail.missing && <MissingBadge />}

        {/* 基本信息（批量模式隐藏） */}
        {!batchMode && (
          <dl className="mb-3 space-y-1 text-xs text-slate-600">
            <div className="flex gap-2">
              <dt className="w-14 shrink-0 text-slate-400">路径</dt>
              <dd className="min-w-0 flex-1 break-all">{detail.path}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="w-14 shrink-0 text-slate-400">类别</dt>
              <dd>{detail.category}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="w-14 shrink-0 text-slate-400">大小</dt>
              <dd>{detail.size} 字节</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="w-14 shrink-0 text-slate-400">修改时间</dt>
              <dd>{new Date(detail.mtime).toLocaleString('zh-CN', { hour12: false })}</dd>
            </div>
          </dl>
        )}

        {/* 快速添加 */}
        <div className="mb-3">
          <QuickTagInput ref={quickRef} />
        </div>

        {/* 当前标签分组（内容说明置顶；批量模式显示并集） */}
        {orderedNames.length === 0 ? (
          <p className="mb-3 text-xs text-slate-400">暂无标签，通过上方输入框或下方类型面板添加</p>
        ) : (
          orderedNames.map((name) => (
            <TagGroup
              key={name}
              typeName={name}
              values={groups.get(name) ?? []}
              hasState={hasStateFor(name)}
              onRemove={removeTag}
              muted={name === '内容说明'}
            />
          ))
        )}

        {/* 按类型添加（全部类型均可添加；批量模式作用于全部所选文件） */}
        <div className="border-t border-slate-100 pt-2">
          <div className="mb-2 text-xs font-semibold text-slate-400">按类型添加标签</div>
          {(facets?.tagTypes ?? []).map((t) => (
            <AddByType key={t.id} type={t} ids={targetIds} hasState={hasStateFor(t.name)} />
          ))}
        </div>
      </div>
    </aside>
  );
}
