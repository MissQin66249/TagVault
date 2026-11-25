/**
 * zustand 全局状态：搜索词/面板筛选/排序视图/结果列表/facets/选中集合/
 * 详情/设置弹窗/toast/扫描进度。排序、视图、只看定稿持久化到 localStorage。
 */
import { create } from 'zustand';
import {
  ApiClientError,
  addTags,
  batchTags,
  facets as apiFacets,
  getUntaggedCount,
  getFile,
  search,
} from './api';
import type { Facets, FileDetail, FileItem, ParsedQuery, SortKey, SortOrder, ViewMode } from './types';

const LS_PREFIX = 'tagvault.';
const PAGE_SIZE = 200;

function loadLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function saveLS(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    // localStorage 不可用时静默降级
  }
}

export interface ToastItem {
  id: number;
  kind: 'error' | 'success' | 'info';
  message: string;
}

export interface ContextMenuTarget {
  x: number;
  y: number;
  file: FileItem;
}

const IDLE_SCAN: ScanProgress = {
  running: false,
  directoryId: null,
  dirPath: null,
  scanned: 0,
  total: 0,
};

export interface ScanProgress {
  running: boolean;
  directoryId: number | null;
  dirPath: string | null;
  scanned: number;
  total: number;
}

let toastSeq = 1;

interface StoreState {
  // —— 检索输入 ——
  query: string;
  debouncedQuery: string;
  selectedTypes: Record<number, string[]>;
  categories: string[];
  finalOnly: boolean;
  /** 只看未打标签文件（不持久化） */
  untaggedOnly: boolean;
  /** 未打标签文件计数（顶栏提醒徽标） */
  untaggedCount: number;
  sort: SortKey;
  order: SortOrder;
  view: ViewMode;

  // —— 结果 ——
  items: FileItem[];
  total: number;
  page: number;
  loading: boolean;
  facets: Facets | null;
  parsedConditions: ParsedQuery | null;

  // —— 多选 ——
  selection: number[];
  lastClickIndex: number | null;

  // —— 详情 ——
  detailId: number | null;
  detail: FileDetail | null;
  detailLoading: boolean;
  detailFocusSignal: number;

  // —— 弹窗 / 菜单 / 提示 ——
  settingsOpen: boolean;
  contextMenu: ContextMenuTarget | null;
  toasts: ToastItem[];
  scanProgress: ScanProgress;

  // —— actions ——
  setQuery(q: string): void;
  setDebouncedQuery(q: string): void;
  toggleCategory(cat: string): void;
  toggleTypeValue(typeId: number, value: string): void;
  clearType(typeId: number): void;
  clearFilters(): void;
  setFinalOnly(v: boolean): void;
  setUntaggedOnly(v: boolean): void;
  /** 刷新未打标签文件计数（静默失败，不打扰用户） */
  refreshUntaggedCount(): Promise<void>;
  setSort(s: SortKey): void;
  setOrder(o: SortOrder): void;
  setView(v: ViewMode): void;

  runSearch(reset?: boolean): Promise<void>;
  loadMore(): Promise<void>;
  refreshFacets(): Promise<void>;
  /** 打标/去标后统一刷新：详情 + facets + 结果列表 */
  afterTagMutation(): Promise<void>;

  setSelection(ids: number[]): void;
  toggleSelect(id: number): void;
  selectAllVisible(): void;
  clearSelection(): void;
  setLastClickIndex(i: number | null): void;
  /** 表格/网格行点击统一入口（Ctrl 追加、Shift 范围选） */
  rowClick(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, item: FileItem, index: number): void;

  openDetail(id: number): Promise<void>;
  closeDetail(): void;
  refreshDetail(): Promise<void>;
  requestDetailFocus(): void;

  setSettingsOpen(open: boolean): void;
  openContextMenu(target: ContextMenuTarget): void;
  closeContextMenu(): void;
  pushToast(kind: ToastItem['kind'], message: string): void;
  pushApiError(err: unknown): void;
  dismissToast(id: number): void;
  setScanProgress(p: Partial<ScanProgress>): void;
  clearScanProgress(): void;
}

export const useStore = create<StoreState>((set, get) => ({
  query: '',
  debouncedQuery: '',
  selectedTypes: {},
  categories: [],
  finalOnly: loadLS('finalOnly', false),
  untaggedOnly: false,
  untaggedCount: 0,
  sort: loadLS<SortKey>('sort', 'mtime'),
  order: loadLS<SortOrder>('order', 'desc'),
  view: loadLS<ViewMode>('view', 'table'),

  items: [],
  total: 0,
  page: 1,
  loading: false,
  facets: null,
  parsedConditions: null,

  selection: [],
  lastClickIndex: null,

  detailId: null,
  detail: null,
  detailLoading: false,
  detailFocusSignal: 0,

  settingsOpen: false,
  contextMenu: null,
  toasts: [],
  scanProgress: IDLE_SCAN,

  setQuery(q) {
    set({ query: q });
  },
  setDebouncedQuery(q) {
    set({ debouncedQuery: q });
  },

  toggleCategory(cat) {
    const cur = get().categories;
    set({ categories: cur.includes(cat) ? cur.filter((c) => c !== cat) : [...cur, cat] });
  },

  toggleTypeValue(typeId, value) {
    const cur = { ...get().selectedTypes };
    const vals = cur[typeId] ? [...cur[typeId]] : [];
    const idx = vals.indexOf(value);
    if (idx >= 0) vals.splice(idx, 1);
    else vals.push(value);
    if (vals.length > 0) cur[typeId] = vals;
    else delete cur[typeId];
    set({ selectedTypes: cur });
  },

  clearType(typeId) {
    const cur = { ...get().selectedTypes };
    delete cur[typeId];
    set({ selectedTypes: cur });
  },

  clearFilters() {
    set({ selectedTypes: {}, categories: [], finalOnly: false, untaggedOnly: false });
    saveLS('finalOnly', false);
  },

  setFinalOnly(v) {
    set({ finalOnly: v });
    saveLS('finalOnly', v);
  },
  setUntaggedOnly(v) {
    set({ untaggedOnly: v });
  },
  async refreshUntaggedCount() {
    try {
      const { count } = await getUntaggedCount();
      set({ untaggedCount: count });
    } catch {
      // 计数刷新失败静默忽略（不打扰用户）
    }
  },
  setSort(s) {
    set({ sort: s });
    saveLS('sort', s);
  },
  setOrder(o) {
    set({ order: o });
    saveLS('order', o);
  },
  setView(v) {
    set({ view: v });
    saveLS('view', v);
  },

  async runSearch(reset = true) {
    const s = get();
    const page = reset ? 1 : s.page + 1;
    set({ loading: true });
    try {
      const data = await search({
        q: s.debouncedQuery,
        types: s.selectedTypes,
        categories: s.categories,
        finalOnly: s.finalOnly,
        untagged: s.untaggedOnly,
        sort: s.sort,
        order: s.order,
        page,
        pageSize: PAGE_SIZE,
      });
      set((prev) => ({
        items: reset ? data.items : mergeItems(prev.items, data.items),
        total: data.total,
        page: data.page,
        facets: data.facets,
        parsedConditions: data.parsedConditions,
        loading: false,
      }));
    } catch (err) {
      set({ loading: false });
      get().pushApiError(err);
    }
  },

  async loadMore() {
    const s = get();
    if (s.loading || s.items.length >= s.total) return;
    await get().runSearch(false);
  },

  async refreshFacets() {
    try {
      const f = await apiFacets();
      set({ facets: f });
    } catch (err) {
      get().pushApiError(err);
    }
  },

  async afterTagMutation() {
    const s = get();
    // 打标/去标会改变"未打标签"集合，计数一并刷新
    const tasks: Array<Promise<unknown>> = [s.refreshFacets(), s.runSearch(true), s.refreshUntaggedCount()];
    if (s.detailId != null) tasks.push(s.refreshDetail());
    await Promise.all(tasks);
  },

  setSelection(ids) {
    set({ selection: ids });
  },
  toggleSelect(id) {
    const cur = get().selection;
    set({ selection: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  },
  selectAllVisible() {
    set({ selection: get().items.map((i) => i.id) });
  },
  clearSelection() {
    set({ selection: [], lastClickIndex: null });
  },
  setLastClickIndex(i) {
    set({ lastClickIndex: i });
  },
  rowClick(e, item, index) {
    const s = get();
    if (e.shiftKey && s.lastClickIndex != null) {
      // Shift 范围选：覆盖为区间（与资源管理器习惯一致）
      const a = Math.min(s.lastClickIndex, index);
      const b = Math.max(s.lastClickIndex, index);
      s.setSelection(s.items.slice(a, b + 1).map((i) => i.id));
      s.setLastClickIndex(index);
      // 以本次点击为锚点打开右侧面板（多选时进入批量模式）
      void s.openDetail(item.id);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      s.toggleSelect(item.id);
      s.setLastClickIndex(index);
      if (get().selection.length > 0) {
        // 以本次点击为锚点打开右侧面板（多选时进入批量模式）
        void s.openDetail(item.id);
      } else {
        s.closeDetail();
      }
      return;
    }
    s.setSelection([item.id]);
    s.setLastClickIndex(index);
    // 单击文件 → 右侧详情（标签编辑）面板自动打开
    void s.openDetail(item.id);
  },

  async openDetail(id) {
    set({ detailId: id, detailLoading: true });
    try {
      const d = await getFile(id);
      set({ detail: d, detailLoading: false });
    } catch (err) {
      set({ detail: null, detailLoading: false, detailId: null });
      get().pushApiError(err);
    }
  },
  closeDetail() {
    set({ detailId: null, detail: null, detailLoading: false });
  },
  async refreshDetail() {
    const id = get().detailId;
    if (id == null) return;
    try {
      const d = await getFile(id);
      if (get().detailId === id) set({ detail: d });
    } catch {
      // 文件可能已被清理：静默保留旧详情
    }
  },
  requestDetailFocus() {
    set((s) => ({ detailFocusSignal: s.detailFocusSignal + 1 }));
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open });
  },
  openContextMenu(target) {
    set({ contextMenu: target });
  },
  closeContextMenu() {
    set({ contextMenu: null });
  },
  pushToast(kind, message) {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    // 自动消失（错误停留更久）
    window.setTimeout(() => get().dismissToast(id), kind === 'error' ? 5000 : 3000);
  },
  pushApiError(err) {
    if (err instanceof ApiClientError) {
      // 40910 由调用方实现二次确认流程，不在此弹错
      if (err.code === 40910) return;
      const friendly = FRIENDLY_CODES[err.code];
      get().pushToast('error', friendly ? `${friendly}（${err.message}）` : err.message);
      return;
    }
    get().pushToast('error', err instanceof Error ? err.message : String(err));
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  setScanProgress(p) {
    set((s) => ({ scanProgress: { ...s.scanProgress, ...p } }));
  },
  clearScanProgress() {
    set({ scanProgress: IDLE_SCAN });
  },
}));

/** 错误码 → 简短友好文案（详情仍附后端 message） */
const FRIENDLY_CODES: Record<number, string> = {
  40901: '目录已存在',
  40902: '名称已存在',
  40911: '「未分类」类型受保护',
  40404: '资源不存在',
  42201: '枚举类型只能从下拉中选择',
  42202: '标签值超长（≤100 字符）',
  42203: '标签值/类型名不能为空',
  50000: '内部错误',
};

/** 分页追加去重（按文件 id） */
function mergeItems(prev: FileItem[], next: FileItem[]): FileItem[] {
  const seen = new Set(prev.map((i) => i.id));
  return [...prev, ...next.filter((i) => !seen.has(i.id))];
}

/** 批量打标/去标便捷封装（BatchTagBar 用） */
export async function runBatchTag(
  fileIds: number[],
  typeId: number,
  values: string[],
  action: 'add' | 'remove',
): Promise<number> {
  const res = await batchTags(fileIds, typeId, values, action);
  return res.affected;
}

/** 单文件打标便捷封装（QuickTagInput / DetailPanel 用） */
export async function addFileTags(fileId: number, values: Array<{ typeId?: number; type?: string; value: string }>): Promise<void> {
  await addTags(fileId, values);
}
