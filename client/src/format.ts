/**
 * 展示辅助：文件大小/时间格式化、文件类别元信息、多值拆分。
 */
import type { CategoryKey } from './types';

/** 文件类别 → 中文标签 + 图标字符（系统 emoji，无外部资源） */
export const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  image: { label: '图片', icon: '🖼' },
  pdf: { label: 'PDF', icon: '📕' },
  word: { label: 'Word', icon: '📄' },
  sheet: { label: '表格', icon: '📊' },
  ppt: { label: '演示', icon: '📽' },
  text: { label: '文本', icon: '📝' },
  video: { label: '视频', icon: '🎬' },
  audio: { label: '音频', icon: '🎵' },
  archive: { label: '压缩包', icon: '🗜' },
  other: { label: '其他', icon: '📁' },
};

export function categoryMeta(key: string): { label: string; icon: string } {
  return CATEGORY_META[key] ?? { label: key, icon: '📁' };
}

/** 字节数 → 人类可读 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** epoch ms → 本地时间字符串 */
export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 快速输入多值拆分：逗号/顿号/分号（半角全角） */
export function splitValues(raw: string): string[] {
  return raw
    .split(/[,，、;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 缩略图 URL（必须带 ?v=<mtime> 内容版本号，防串图） */
export function thumbUrl(fileId: number, mtime: number): string {
  return `/api/thumbs/${fileId}?v=${mtime}`;
}
