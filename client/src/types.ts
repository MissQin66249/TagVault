/**
 * 与后端 API 契约对齐的类型定义（字段命名与 server/routes 实际响应一致）。
 */

/** 标签输入模式：枚举（字典白名单）/ 自由输入 */
export type InputMode = 'enum' | 'free';

/** 文件类别（scanner 归类） */
export type CategoryKey =
  | 'image'
  | 'pdf'
  | 'word'
  | 'sheet'
  | 'ppt'
  | 'text'
  | 'video'
  | 'audio'
  | 'archive'
  | 'other';

/** 排序字段 */
export type SortKey = 'name' | 'mtime' | 'size';
/** 排序方向 */
export type SortOrder = 'asc' | 'desc';
/** 视图模式 */
export type ViewMode = 'table' | 'thumb';

/** 标签视图（带类型名） */
export interface TagRef {
  typeId: number;
  typeName: string;
  value: string;
}

/** 搜索结果文件项 */
export interface FileItem {
  id: number;
  dirId: number;
  path: string;
  name: string;
  ext: string | null;
  category: CategoryKey;
  size: number;
  mtime: number;
  /** 0/1（列表项为数字） */
  missing: number;
  tags: TagRef[];
  hasThumb: boolean;
}

/** 文件详情（GET /api/files/:id） */
export interface FileDetail {
  id: number;
  dirId: number;
  path: string;
  name: string;
  ext: string | null;
  category: CategoryKey;
  size: number;
  mtime: number;
  /** 详情接口为布尔 */
  missing: boolean;
  hasThumb: boolean;
  tags: TagRef[];
}

/** facets 字典值/自由值条目 */
export interface FacetValue {
  id: number | null;
  value: string;
  count: number;
}

/** facets 标签类型（hiddenInFilter 为 0/1 数字） */
export interface FacetType {
  id: number;
  name: string;
  inputMode: InputMode;
  hiddenInFilter: number;
  values: FacetValue[];
}

/** facets 结构（GET /api/facets 及 /api/search 内嵌） */
export interface Facets {
  categories: Record<string, number>;
  tagTypes: FacetType[];
}

/** `类型:值` 解析出的字段条件（只读展示用） */
export interface ParsedFieldFilter {
  typeId: number;
  typeName: string;
  values: string[];
}

/** 搜索串解析结果 */
export interface ParsedQuery {
  keywords: string[];
  fieldFilters: ParsedFieldFilter[];
}

/** GET /api/search 响应 data */
export interface SearchResponse {
  total: number;
  page: number;
  pageSize: number;
  items: FileItem[];
  facets: Facets;
  parsedConditions: ParsedQuery;
}

/** GET /api/suggest 候选项 */
export interface SuggestItem {
  value: string;
  typeName: string;
  typeId: number;
  count: number;
  exact: boolean;
}

/** 类型字典值（GET /api/tag-types） */
export interface TypeValueView {
  id: number | null;
  value: string;
  count: number;
}

/** 标签类型视图（hiddenInFilter 为布尔） */
export interface TypeView {
  id: number;
  name: string;
  inputMode: InputMode;
  sortOrder: number;
  hiddenInFilter: boolean;
  values: TypeValueView[];
}

/** 目录行（GET /api/directories，保留后端 snake_case 字段） */
export interface DirectoryRow {
  id: number;
  path: string;
  name: string;
  last_scanned_at: number | null;
  created_at: number;
  fileCount: number;
  missingCount: number;
}

/** 配置（GET /api/config，与 server/config.ts 契约一致） */
export interface AppConfig {
  port: number;
  dataDir: string;
  /** 启动后自动打开浏览器 */
  autoOpenBrowser: boolean;
}

/** GET /api/status 响应 data */
export interface StatusInfo {
  version: string;
  totalFiles: number;
  missingCount: number;
  scanning: boolean;
  scan?: {
    running: boolean;
    directoryId: number | null;
    dirPath: string | null;
    scanned: number;
    total: number;
  };
}

/** GET /api/system/untagged 响应 data（未打标签文件计数） */
export interface UntaggedCount {
  count: number;
}

/** 缺失文件行（GET /api/system/missing） */
export interface MissingFileRow {
  id: number;
  dir_id: number;
  path: string;
  name: string;
  ext: string | null;
  category: CategoryKey;
  size: number;
  mtime: number;
}

/** 导入统计（POST /api/import） */
export interface ImportStats {
  restoredTypes: number;
  restoredTags: number;
  restoredValues: number;
  unmatched: string[];
}

/** 扫描状态（GET /api/scan/status 与 SSE 进度） */
export interface ScanStatus {
  running: boolean;
  directoryId: number | null;
  dirPath: string | null;
  scanned: number;
  total: number;
}
