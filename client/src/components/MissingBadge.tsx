/**
 * 缺失文件醒目红色徽标（表格 / 缩略图网格 / 详情通用）。
 */

export function MissingBadge({ compact = false }: { compact?: boolean }): JSX.Element {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded border border-red-300 bg-red-100 font-semibold text-red-700 ${
        compact ? 'px-1 py-0 text-[10px] leading-4' : 'px-1.5 py-0.5 text-xs'
      }`}
      title="该文件在磁盘上已不存在"
    >
      ⚠ 文件缺失
    </span>
  );
}
