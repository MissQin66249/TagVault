/**
 * 输入防抖 Hook（默认 150ms，满足"输入即搜 ≤200ms"要求）。
 */
import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delay = 150): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
