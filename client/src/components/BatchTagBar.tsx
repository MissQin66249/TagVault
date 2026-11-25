/**
 * 批量标签工具条：选中 >0 时出现在中栏顶部。
 * 默认（不选类型）直接输入值回车即批量打标，自动归入「未分类」；
 * 也可选定类型后按类型打标/去标（枚举下拉选值、自由输入多值），另有全清选择。
 */
import { useMemo, useState } from 'react';
import { splitValues } from '../format';
import { runBatchTag, useStore } from '../store';
import * as api from '../api';

export function BatchTagBar(): JSX.Element {
  const selection = useStore((s) => s.selection);
  const clearSelection = useStore((s) => s.clearSelection);
  const afterTagMutation = useStore((s) => s.afterTagMutation);
  const pushToast = useStore((s) => s.pushToast);
  const pushApiError = useStore((s) => s.pushApiError);
  const facets = useStore((s) => s.facets);

  /** 0 = 不指定类型（默认，归入未分类）；>0 = 具体类型 id */
  const [typeId, setTypeId] = useState<number>(0);
  const [enumValue, setEnumValue] = useState<string>('');
  const [freeText, setFreeText] = useState<string>('');

  const types = useMemo(() => facets?.tagTypes ?? [], [facets]);
  const unclassifiedId = useMemo(
    () => types.find((t) => t.name === '未分类')?.id ?? null,
    [types],
  );
  const currentType = types.find((t) => t.id === typeId) ?? null;

  const changeType = (id: number): void => {
    setTypeId(id);
    setEnumValue('');
    setFreeText('');
  };

  const currentValues = (): string[] => {
    if (currentType?.inputMode === 'enum') return enumValue ? [enumValue] : [];
    return splitValues(freeText);
  };

  /** 实际生效的类型 id：未指定 → 未分类 id；未分类类型尚未创建时返回 null */
  const effectiveTypeId = (): number | null => {
    if (typeId > 0) return typeId;
    return unclassifiedId;
  };

  const doBatch = (action: 'add' | 'remove'): void => {
    const values = currentValues();
    const tid = effectiveTypeId();

    // 未指定类型且「未分类」尚未创建：打标走逐文件接口（后端自动创建未分类）；去标无目标类型
    if (tid == null) {
      if (action === 'add' && values.length > 0) {
        void Promise.all(selection.map((id) => api.addTags(id, values.map((v) => ({ value: v })))))
          .then(() => {
            pushToast('success', `已为 ${selection.length} 个文件添加 ${values.length} 个标签（未分类）`);
            return afterTagMutation();
          })
          .catch((err) => pushApiError(err));
        return;
      }
      if (action === 'remove') {
        pushToast('info', '尚无「未分类」类型，没有可移除的标签');
        return;
      }
      return;
    }

    // 去标允许不填值：只选类型 → 移除所选文件该类型下的全部标签
    if (action === 'remove' && values.length === 0) {
      const typeName = currentType?.name ?? '未分类';
      if (!window.confirm(`确定移除所选 ${selection.length} 个文件的全部「${typeName}」标签？`)) return;
      void runBatchTag(selection, tid, [], 'remove')
        .then((affected) => {
          pushToast(
            'success',
            affected > 0 ? `已移除 ${affected} 个「${typeName}」标签` : '所选文件没有该类型的标签',
          );
          return afterTagMutation();
        })
        .catch((err) => pushApiError(err));
      return;
    }
    if (values.length === 0) {
      pushToast('info', '请输入标签值（逗号分隔可加多个）');
      return;
    }
    void runBatchTag(selection, tid, values, action)
      .then((affected) => {
        pushToast(
          'success',
          affected > 0
            ? `已${action === 'add' ? '添加' : '移除'} ${affected} 个标签`
            : '没有需要变更的标签',
        );
        return afterTagMutation();
      })
      .catch((err) => pushApiError(err));
  };

  /** 一键清空所选文件的全部标签（所有类型，需确认） */
  const clearAll = (): void => {
    if (selection.length === 0) return;
    if (!window.confirm(`确定移除所选 ${selection.length} 个文件的全部标签（所有类型）？`)) return;
    void api
      .clearTags(selection)
      .then((res) => {
        pushToast(
          'success',
          res.affected > 0
            ? `已移除 ${res.affected} 个标签（${selection.length} 个文件）`
            : '所选文件没有标签',
        );
        return afterTagMutation();
      })
      .catch((err) => pushApiError(err));
  };

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-blue-200 bg-blue-50 px-3 py-1.5 text-sm">
      <span className="font-medium text-blue-800">已选 {selection.length} 个文件</span>

      <select
        value={typeId}
        onChange={(e) => changeType(Number(e.target.value))}
        className="h-7 rounded border border-slate-300 bg-white px-2 text-sm"
        aria-label="批量标签类型"
      >
        <option value={0}>不指定类型（未分类）</option>
        {types
          .filter((t) => t.name !== '未分类')
          .map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.inputMode === 'enum' ? '（枚举）' : ''}
            </option>
          ))}
      </select>

      {currentType?.inputMode === 'enum' ? (
        <select
          value={enumValue}
          onChange={(e) => setEnumValue(e.target.value)}
          className="h-7 rounded border border-slate-300 bg-white px-2 text-sm"
          aria-label="枚举值"
        >
          <option value="">选择值…</option>
          {currentType.values
            .filter((v) => v.id != null)
            .map((v) => (
              <option key={v.value} value={v.value}>
                {v.value}
              </option>
            ))}
        </select>
      ) : (
        <input
          type="text"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doBatch('add')}
          placeholder="输入标签值，Enter 直接打标（逗号分隔多个；默认归入未分类）"
          className="h-7 w-64 rounded border border-slate-300 bg-white px-2 text-sm"
          aria-label="批量标签值"
        />
      )}

      <button
        type="button"
        onClick={() => doBatch('add')}
        className="h-7 rounded bg-blue-500 px-3 text-white hover:bg-blue-600"
        title="Enter 或点击即打标；未选类型时自动归入「未分类」"
      >
        批量打标
      </button>
      <button
        type="button"
        onClick={() => doBatch('remove')}
        className="h-7 rounded border border-red-300 bg-white px-3 text-red-600 hover:bg-red-50"
        title="不填值时：移除所选文件该类型下的全部标签"
      >
        批量去标
      </button>
      <button
        type="button"
        onClick={clearAll}
        className="h-7 rounded bg-red-500 px-3 text-white hover:bg-red-600"
        title="移除所选文件的所有类型的全部标签"
      >
        清空全部标签
      </button>
      <button
        type="button"
        onClick={clearSelection}
        className="ml-auto h-7 rounded px-2 text-xs text-slate-500 hover:bg-slate-100"
      >
        全清选择
      </button>
    </div>
  );
}
