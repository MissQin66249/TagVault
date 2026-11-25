/**
 * 已选条件 chips 条：面板筛选（可移除）+ 搜索框解析出的 `类型:值` 字段条件（只读展示）。
 */
import { useStore } from '../store';

export function ActiveFilters(): JSX.Element | null {
  const categories = useStore((s) => s.categories);
  const selectedTypes = useStore((s) => s.selectedTypes);
  const finalOnly = useStore((s) => s.finalOnly);
  const untaggedOnly = useStore((s) => s.untaggedOnly);
  const setUntaggedOnly = useStore((s) => s.setUntaggedOnly);
  const parsedConditions = useStore((s) => s.parsedConditions);
  const query = useStore((s) => s.query);
  const toggleCategory = useStore((s) => s.toggleCategory);
  const toggleTypeValue = useStore((s) => s.toggleTypeValue);
  const facets = useStore((s) => s.facets);

  const typeChips: Array<{ typeId: number; value: string }> = [];
  for (const [idStr, values] of Object.entries(selectedTypes)) {
    const typeId = Number(idStr);
    for (const v of values) typeChips.push({ typeId, value: v });
  }

  const typeNameOf = (typeId: number): string =>
    facets?.tagTypes.find((t) => t.id === typeId)?.name ?? `类型${typeId}`;

  const chipsCount = categories.length + typeChips.length + (finalOnly ? 1 : 0) + (untaggedOnly ? 1 : 0);
  if (chipsCount === 0 && (parsedConditions?.fieldFilters.length ?? 0) === 0) return null;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-1.5">
      {/* 面板筛选：文件类别 */}
      {categories.map((c) => (
        <button
          key={`cat-${c}`}
          type="button"
          onClick={() => toggleCategory(c)}
          className="group flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2.5 py-0.5 text-xs text-blue-800 hover:bg-blue-100"
          title="点击移除"
        >
          类型:{c}
          <span className="text-blue-400 group-hover:text-blue-700">✕</span>
        </button>
      ))}

      {/* 面板筛选：标签值 */}
      {typeChips.map(({ typeId, value }) => (
        <button
          key={`tag-${typeId}-${value}`}
          type="button"
          onClick={() => toggleTypeValue(typeId, value)}
          className="group flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2.5 py-0.5 text-xs text-sky-800 hover:bg-sky-100"
          title="点击移除"
        >
          {typeNameOf(typeId)}:{value}
          <span className="text-sky-400 group-hover:text-sky-700">✕</span>
        </button>
      ))}

      {/* 只看定稿 chip */}
      {finalOnly && (
        <span className="flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-800">
          只看定稿
        </span>
      )}

      {/* 未打标签 chip（可点击移除） */}
      {untaggedOnly && (
        <button
          type="button"
          onClick={() => setUntaggedOnly(false)}
          className="group flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
          title="点击移除"
        >
          未打标签
          <span className="text-amber-400 group-hover:text-amber-700">✕</span>
        </button>
      )}

      {/* 搜索串解析出的字段条件：只读展示（修改需在搜索框编辑） */}
      {(parsedConditions?.fieldFilters ?? []).map((f) => (
        <span
          key={`pf-${f.typeId}-${f.values.join('|')}`}
          className="flex items-center gap-1 rounded-full border border-dashed border-slate-400 bg-white px-2.5 py-0.5 text-xs text-slate-600"
          title={`来自搜索条件（只读），在搜索框中修改"${query || '关键词'}"`}
        >
          {f.typeName}:{f.values.join('|')}
          <span className="text-slate-400">🔒</span>
        </span>
      ))}
    </div>
  );
}
