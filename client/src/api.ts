/**
 * 后端 API 封装：统一解 {code,data,message}，非 0 code 抛 ApiClientError。
 * 全部为同源相对路径请求，无任何外部网络调用（离线红线）。
 */
import type {
  AppConfig,
  DirectoryRow,
  FileDetail,
  ImportStats,
  InputMode,
  MissingFileRow,
  ScanStatus,
  SearchResponse,
  SuggestItem,
  StatusInfo,
  TagRef,
  TypeView,
  UntaggedCount,
} from './types';

/** 友好错误文案（按业务错误码映射） */
export const ERROR_MESSAGES: Record<number, string> = {
  40901: '目录已存在',
  40902: '名称已存在',
  40911: '「未分类」类型受保护，不可删除或改名',
  40404: '资源不存在',
  42201: '枚举类型只能从下拉中选择',
  42202: '标签值超长（≤100 字符）',
  42203: '标签值/类型名不能为空',
  50000: '内部错误',
};

/** 需要二次确认的业务码 */
export const CODE_NEED_CONFIRM = 40910;

/** 客户端业务异常（code 为后端业务码，data 为附加信息如影响数） */
export class ApiClientError extends Error {
  constructor(
    public code: number,
    message: string,
    public data: unknown = null,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/** 统一请求：解析 JSON 包裹层，code!==0 抛业务异常 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiClientError(-1, '网络请求失败，请确认 TagVault 服务已启动');
  }
  let body: { code?: number; data?: T; message?: string };
  try {
    body = await res.json();
  } catch {
    throw new ApiClientError(-1, `响应解析失败（HTTP ${res.status}）`);
  }
  if (body.code !== 0) {
    throw new ApiClientError(body.code ?? -1, body.message ?? '未知错误', body.data ?? null);
  }
  return body.data as T;
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  };
}

// ==================== 搜索与建议 ====================

export interface SearchParamsInput {
  q: string;
  /** 面板筛选：typeId → 已选值集合 */
  types: Record<number, string[]>;
  categories: string[];
  finalOnly: boolean;
  /** 只看未打标签文件（请求时传 untagged=1） */
  untagged?: boolean;
  sort: string;
  order: string;
  page: number;
  pageSize: number;
}

/** GET /api/search（types/categories 以 JSON 传输，与 tests/api.test.ts 用例一致） */
export async function search(p: SearchParamsInput): Promise<SearchResponse> {
  const sp = new URLSearchParams();
  if (p.q) sp.set('q', p.q);
  const typeEntries = Object.entries(p.types).filter(([, v]) => v.length > 0);
  if (typeEntries.length > 0) {
    sp.set('types', JSON.stringify(Object.fromEntries(typeEntries)));
  }
  if (p.categories.length > 0) {
    sp.set('categories', JSON.stringify(p.categories));
  }
  if (p.finalOnly) sp.set('final', '1');
  if (p.untagged) sp.set('untagged', '1');
  sp.set('sort', p.sort);
  sp.set('order', p.order);
  sp.set('page', String(p.page));
  sp.set('pageSize', String(p.pageSize));
  return request<SearchResponse>(`/api/search?${sp.toString()}`);
}

/** GET /api/suggest */
export function suggest(q: string): Promise<SuggestItem[]> {
  return request<SuggestItem[]>(`/api/suggest?q=${encodeURIComponent(q)}`);
}

/** GET /api/system/untagged → 未打标签文件计数 */
export function getUntaggedCount(): Promise<UntaggedCount> {
  return request<UntaggedCount>('/api/system/untagged');
}

/** GET /api/facets */
export function facets(): Promise<SearchResponse['facets']> {
  return request<SearchResponse['facets']>('/api/facets');
}

/** GET /api/files/:id */
export function getFile(id: number): Promise<FileDetail> {
  return request<FileDetail>(`/api/files/${id}`);
}

// ==================== 打标 ====================

export interface TagInput {
  typeId?: number;
  type?: string;
  value: string;
}

/** POST /api/files/:id/tags → 打标后的标签列表 */
export function addTags(fileId: number, tags: TagInput[]): Promise<TagRef[]> {
  return request<TagRef[]>(`/api/files/${fileId}/tags`, jsonInit('POST', { tags }));
}

/** GET /api/files/:id/tags → 标签列表（轻量，不含文件信息） */
export function getFileTags(fileId: number): Promise<TagRef[]> {
  return request<TagRef[]>(`/api/files/${fileId}/tags`);
}

/** DELETE /api/files/:id/tags → 去标后的标签列表 */
export function removeTags(fileId: number, tags: TagInput[]): Promise<TagRef[]> {
  return request<TagRef[]>(`/api/files/${fileId}/tags`, jsonInit('DELETE', { tags }));
}

/** POST /api/tags/batch → {affected, action} */
export function batchTags(
  fileIds: number[],
  typeId: number,
  values: string[],
  action: 'add' | 'remove',
): Promise<{ affected: number; action: string }> {
  return request<{ affected: number; action: string }>(
    '/api/tags/batch',
    jsonInit('POST', { fileIds, typeId, values, action }),
  );
}

/** POST /api/tags/clear → 一键清空所选文件的全部标签（所有类型） */
export function clearTags(fileIds: number[]): Promise<{ affected: number; files: number }> {
  return request<{ affected: number; files: number }>('/api/tags/clear', jsonInit('POST', { fileIds }));
}

// ==================== 标签类型与字典值 ====================

export function listTypes(): Promise<TypeView[]> {
  return request<TypeView[]>('/api/tag-types');
}

export function createType(name: string, inputMode: InputMode): Promise<TypeView> {
  return request<TypeView>('/api/tag-types', jsonInit('POST', { name, inputMode }));
}

export function updateType(
  id: number,
  patch: { name?: string; inputMode?: InputMode; hiddenInFilter?: boolean },
): Promise<TypeView> {
  return request<TypeView>(`/api/tag-types/${id}`, jsonInit('PUT', patch));
}

/** POST /api/tag-types/:id/move（后端实际用 POST，非 PUT sort） */
export function moveType(id: number, direction: 'up' | 'down'): Promise<TypeView[]> {
  return request<TypeView[]>(`/api/tag-types/${id}/move`, jsonInit('POST', { direction }));
}

/** DELETE /api/tag-types/:id?confirm=1；未确认时后端 40910 带影响数 */
export function deleteType(id: number, confirm = false): Promise<{ affectedFiles: number; valueCount: number }> {
  return request<{ affectedFiles: number; valueCount: number }>(
    `/api/tag-types/${id}${confirm ? '?confirm=1' : ''}`,
    { method: 'DELETE' },
  );
}

export function addDictValue(typeId: number, value: string): Promise<{ id: number | null; value: string; count: number }> {
  return request<{ id: number | null; value: string; count: number }>(
    `/api/tag-types/${typeId}/values`,
    jsonInit('POST', { value }),
  );
}

export function renameDictValue(valueId: number, value: string): Promise<void> {
  return request<void>(`/api/tag-values/${valueId}`, jsonInit('PUT', { value }));
}

export function deleteDictValue(valueId: number, confirm = false): Promise<{ affectedFiles: number }> {
  return request<{ affectedFiles: number }>(`/api/tag-values/${valueId}${confirm ? '?confirm=1' : ''}`, {
    method: 'DELETE',
  });
}

export function moveDictValue(
  valueId: number,
  target: { toTypeId?: number; newTypeName?: string },
): Promise<{ toTypeId: number }> {
  return request<{ toTypeId: number }>(`/api/tag-values/${valueId}/move`, jsonInit('POST', target));
}

// ==================== 目录与扫描 ====================

export function listDirectories(): Promise<DirectoryRow[]> {
  return request<DirectoryRow[]>('/api/directories');
}

export function addDirectory(path: string): Promise<{ id: number; path: string; scanning: boolean }> {
  return request<{ id: number; path: string; scanning: boolean }>('/api/directories', jsonInit('POST', { path }));
}

export function rescanDirectory(id: number): Promise<{ id: number; scanning: boolean }> {
  return request<{ id: number; scanning: boolean }>(`/api/directories/${id}/rescan`, jsonInit('POST', {}));
}

/** DELETE /api/directories/:id?confirm=1；未确认时 40910 带 {affected, withFiles} */
export function removeDirectory(id: number, confirm = false): Promise<{ id: number; deletedFiles: number }> {
  return request<{ id: number; deletedFiles: number }>(
    `/api/directories/${id}${confirm ? '?confirm=1' : ''}`,
    { method: 'DELETE' },
  );
}

export function getScanStatus(): Promise<ScanStatus> {
  return request<ScanStatus>('/api/scan/status');
}

/** GET /api/directories/pick → {path: string|null}（可能弹出系统对话框，慢） */
export function pickFolder(): Promise<{ path: string | null }> {
  return request<{ path: string | null }>('/api/directories/pick');
}

// ==================== 配置与状态 ====================

export function getConfig(): Promise<AppConfig> {
  return request<AppConfig>('/api/config');
}

export function saveConfig(patch: { port?: number; dataDir?: string; autoOpenBrowser?: boolean }): Promise<AppConfig> {
  return request<AppConfig>('/api/config', jsonInit('PUT', patch));
}

export function getStatus(): Promise<StatusInfo> {
  return request<StatusInfo>('/api/status');
}

// ==================== 数据管理 ====================

export function missingList(): Promise<MissingFileRow[]> {
  return request<MissingFileRow[]>('/api/system/missing');
}

/** POST /api/system/missing-check → 触发全量重扫，结果经 SSE/再次查询获取 */
export function missingCheck(): Promise<{ started: boolean; directories: number }> {
  return request<{ started: boolean; directories: number }>('/api/system/missing-check', jsonInit('POST', {}));
}

/** POST /api/system/missing/cleanup?confirm=1；未确认时 40910 带 {affected} */
export function cleanupMissing(confirm = false): Promise<{ deleted: number }> {
  return request<{ deleted: number }>(
    `/api/system/missing/cleanup${confirm ? '?confirm=1' : ''}`,
    jsonInit('POST', confirm ? { confirm: 1 } : {}),
  );
}

/** GET /api/export?format=json（注意：后端以 {code,data,message} 包裹返回 JSON 结构） */
export async function exportJsonData(): Promise<unknown> {
  const res = await fetch('/api/export?format=json');
  const body = await res.json();
  if (body.code !== 0) throw new ApiClientError(body.code ?? -1, body.message ?? '导出失败', body.data ?? null);
  return body.data;
}

/** GET /api/export?format=csv（后端直接发送 CSV 文本，带 BOM） */
export async function exportCsvText(): Promise<string> {
  const res = await fetch('/api/export?format=csv');
  if (!res.ok) throw new ApiClientError(-1, `导出失败（HTTP ${res.status}）`);
  return res.text();
}

/** POST /api/import（{data: 导出结构}）→ 导入统计 */
export function importData(payload: unknown): Promise<ImportStats> {
  return request<ImportStats>('/api/import', jsonInit('POST', { data: payload }));
}

// ==================== 系统操作 ====================

/** POST /api/system/open-file */
export function openFile(fileId: number): Promise<{ opened: string }> {
  return request<{ opened: string }>('/api/system/open-file', jsonInit('POST', { fileId }));
}

/** POST /api/system/open-folder */
export function openFolder(fileId: number): Promise<{ revealed: string }> {
  return request<{ revealed: string }>('/api/system/open-folder', jsonInit('POST', { fileId }));
}
