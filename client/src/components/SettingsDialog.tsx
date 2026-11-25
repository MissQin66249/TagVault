/**
 * 设置弹窗（5 个 Tab）：
 * 1. 数据与端口  2. 索引目录（📂选择/粘贴/重扫/移除/扫描进度/缺失清理）
 * 3. 标签类型管理（排序/显隐/模式/改名/字典值改删移）  4. 导入导出  5. 关于。
 * 所有删除类操作走 40910 两段确认流程（先拿影响数 → confirm → confirm=1 重发）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiClientError,
  CODE_NEED_CONFIRM,
  addDictValue,
  addDirectory,
  cleanupMissing,
  createType,
  deleteDictValue,
  deleteType,
  exportCsvText,
  exportJsonData,
  getConfig,
  importData,
  listDirectories,
  listTypes,
  missingCheck,
  missingList,
  moveDictValue,
  moveType,
  pickFolder,
  removeDirectory,
  renameDictValue,
  rescanDirectory,
  saveConfig,
  updateType,
  getStatus,
} from '../api';
import { formatSize, formatTime } from '../format';
import { useStore } from '../store';
import type { AppConfig, DirectoryRow, ImportStats, InputMode, MissingFileRow, StatusInfo, TypeView } from '../types';

type TabKey = 'config' | 'dirs' | 'types' | 'data' | 'about';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'config', label: '数据与端口' },
  { key: 'dirs', label: '索引目录' },
  { key: 'types', label: '标签类型管理' },
  { key: 'data', label: '导入导出' },
  { key: 'about', label: '关于' },
];

/** 40910 二次确认流程：先无 confirm 调用拿影响数 → confirm 弹窗 → confirm=1 重发 */
async function twoPhase<T>(
  attempt: () => Promise<T>,
  buildMessage: (data: unknown) => string,
  exec: () => Promise<T>,
): Promise<T | null> {
  try {
    // 理论上不会走到这（首次必 40910），保持防御
    return await attempt();
  } catch (err) {
    if (err instanceof ApiClientError && err.code === CODE_NEED_CONFIRM) {
      if (!window.confirm(buildMessage(err.data))) return null;
      return exec();
    }
    throw err;
  }
}

/** 下载 blob 文件 */
function downloadBlob(content: BlobPart, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

// ==================== Tab 1：数据与端口 ====================

function ConfigTab(): JSX.Element {
  const pushToast = useStore((s) => s.pushToast);
  const pushApiError = useStore((s) => s.pushApiError);
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [port, setPort] = useState('');
  const [dataDir, setDataDir] = useState('');
  const [autoOpen, setAutoOpen] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getConfig()
      .then((c) => {
        setCfg(c);
        setPort(String(c.port));
        setDataDir(c.dataDir);
        setAutoOpen(c.autoOpenBrowser);
      })
      .catch((err) => pushApiError(err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = (): void => {
    const p = Number(port);
    setSaving(true);
    void saveConfig({
      port: Number.isInteger(p) && p > 0 ? p : undefined,
      dataDir: dataDir.trim() || undefined,
      autoOpenBrowser: autoOpen,
    })
      .then(() => pushToast('success', '配置已保存，重启后生效'))
      .catch((err) => pushApiError(err))
      .finally(() => setSaving(false));
  };

  if (!cfg) return <p className="p-4 text-sm text-slate-400">读取配置中…</p>;

  return (
    <div className="space-y-4 p-4 text-sm">
      <div>
        <label className="mb-1 block font-medium text-slate-700">服务端口</label>
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          className="h-8 w-40 rounded border border-slate-300 px-2"
        />
        <p className="mt-1 text-xs text-slate-400">当前 {cfg.port}；修改后需重启应用生效</p>
      </div>
      <div>
        <label className="mb-1 block font-medium text-slate-700">数据目录</label>
        <input
          type="text"
          value={dataDir}
          onChange={(e) => setDataDir(e.target.value)}
          className="h-8 w-full rounded border border-slate-300 px-2"
          spellCheck={false}
        />
        <p className="mt-1 text-xs text-slate-400">SQLite 数据库与缩略图缓存所在目录，修改后需重启生效</p>
      </div>
      <div>
        <label className="mb-1 flex cursor-pointer select-none items-center gap-2 font-medium text-slate-700">
          <input
            type="checkbox"
            checked={autoOpen}
            onChange={(e) => setAutoOpen(e.target.checked)}
            className="h-4 w-4 accent-blue-500"
          />
          启动后自动打开浏览器
        </label>
        <p className="mt-1 text-xs text-slate-400">当前 {cfg.autoOpenBrowser ? '开启' : '关闭'}</p>
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="h-8 rounded bg-blue-500 px-4 text-white hover:bg-blue-600 disabled:opacity-50"
      >
        保存配置
      </button>
    </div>
  );
}

// ==================== Tab 2：索引目录 ====================

function DirsTab(): JSX.Element {
  const pushToast = useStore((s) => s.pushToast);
  const pushApiError = useStore((s) => s.pushApiError);
  const scanProgress = useStore((s) => s.scanProgress);

  const [dirs, setDirs] = useState<DirectoryRow[]>([]);
  const [manualPath, setManualPath] = useState('');
  const [missing, setMissing] = useState<MissingFileRow[]>([]);
  const [picking, setPicking] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [d, m] = await Promise.all([listDirectories(), missingList()]);
      setDirs(d);
      setMissing(m);
    } catch (err) {
      pushApiError(err);
    }
  }, [pushApiError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 扫描结束（running true→false）后刷新目录与缺失列表
  const prevRunning = useRef(scanProgress.running);
  useEffect(() => {
    if (prevRunning.current && !scanProgress.running) void reload();
    prevRunning.current = scanProgress.running;
  }, [scanProgress.running, reload]);

  const add = (path: string): void => {
    const p = path.trim();
    if (!p) return;
    void addDirectory(p)
      .then(() => {
        pushToast('success', '目录已添加，正在扫描');
        setManualPath('');
        return reload();
      })
      .catch((err) => pushApiError(err));
  };

  const pick = (): void => {
    if (picking) return;
    setPicking(true);
    void pickFolder()
      .then((r) => {
        if (r.path) add(r.path);
        else pushToast('info', '未选择文件夹');
      })
      .catch((err) => pushApiError(err))
      .finally(() => setPicking(false));
  };

  const rescan = (d: DirectoryRow): void => {
    void rescanDirectory(d.id)
      .then(() => {
        pushToast('success', `已开始重扫「${d.name}」`);
        return reload();
      })
      .catch((err) => pushApiError(err));
  };

  const remove = (d: DirectoryRow): void => {
    void twoPhase(
      () => removeDirectory(d.id),
      (data) => {
        const info = (data ?? {}) as { affected?: number };
        return `目录「${d.name}」下有 ${info.affected ?? 0} 个文件，移除将连带删除这些文件的记录与全部标签，确定移除？`;
      },
      () => removeDirectory(d.id, true),
    )
      .then(() => {
        pushToast('success', '目录已移除');
        return reload();
      })
      .catch((err) => pushApiError(err));
  };

  const doMissingCheck = (): void => {
    void missingCheck()
      .then(() => pushToast('info', '已开始全量存在性校验，完成后自动刷新'))
      .catch((err) => pushApiError(err));
  };

  const doCleanupMissing = (): void => {
    if (missing.length === 0) {
      pushToast('info', '当前没有缺失文件');
      return;
    }
    void twoPhase(
      () => cleanupMissing(),
      (data) => {
        const info = (data ?? {}) as { affected?: number };
        return `共有 ${info.affected ?? missing.length} 个缺失文件记录，清理将连同其标签一并删除，确定？`;
      },
      () => cleanupMissing(true),
    )
      .then((r) => {
        const res = (r ?? { deleted: 0 }) as { deleted: number };
        pushToast('success', `已清理 ${res.deleted} 条缺失记录`);
        return reload();
      })
      .catch((err) => pushApiError(err));
  };

  const pct =
    scanProgress.running && scanProgress.total > 0
      ? Math.min(100, Math.round((scanProgress.scanned / scanProgress.total) * 100))
      : 0;

  return (
    <div className="space-y-4 p-4 text-sm">
      {/* 添加目录 */}
      <div className="rounded-md border border-slate-200 p-3">
        <div className="mb-2 font-medium text-slate-700">添加索引目录</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={pick}
            disabled={picking}
            className="h-8 rounded border border-blue-300 bg-blue-50 px-3 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {picking ? '等待选择…' : '📂 选择文件夹'}
          </button>
          <input
            type="text"
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add(manualPath)}
            placeholder="或粘贴完整路径后回车，如 D:\\资料\\图片"
            className="h-8 min-w-0 flex-1 rounded border border-slate-300 px-2"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => add(manualPath)}
            className="h-8 rounded bg-blue-500 px-3 text-white hover:bg-blue-600"
          >
            添加
          </button>
        </div>
        {scanProgress.running && (
          <div className="mt-2">
            <div className="text-xs text-slate-500">
              扫描中 {scanProgress.scanned}/{scanProgress.total}（{scanProgress.dirPath ?? ''}）
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* 目录列表 */}
      <div className="rounded-md border border-slate-200">
        <div className="border-b border-slate-100 px-3 py-2 font-medium text-slate-700">
          已索引目录（{dirs.length}）
        </div>
        {dirs.length === 0 ? (
          <p className="px-3 py-3 text-xs text-slate-400">暂无索引目录，添加后开始扫描</p>
        ) : (
          dirs.map((d) => (
            <div key={d.id} className="flex items-center gap-2 border-b border-slate-50 px-3 py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-slate-800" title={d.path}>
                  📁 {d.name}
                </p>
                <p className="truncate text-[11px] text-slate-400" title={d.path}>
                  {d.path} · {d.fileCount} 个文件
                  {d.missingCount > 0 && <span className="text-red-500"> · {d.missingCount} 缺失</span>}
                  {d.last_scanned_at ? ` · 上次扫描 ${formatTime(d.last_scanned_at)}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => rescan(d)}
                className="h-7 shrink-0 rounded border border-slate-300 px-2 text-xs hover:bg-slate-100"
              >
                重扫
              </button>
              <button
                type="button"
                onClick={() => remove(d)}
                className="h-7 shrink-0 rounded border border-red-300 px-2 text-xs text-red-600 hover:bg-red-50"
              >
                移除
              </button>
            </div>
          ))
        )}
      </div>

      {/* 缺失文件 */}
      <div className="rounded-md border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <span className="font-medium text-slate-700">
            缺失文件（{missing.length}）
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={doMissingCheck} className="h-7 rounded border border-slate-300 px-2 text-xs hover:bg-slate-100">
              检查缺失
            </button>
            <button
              type="button"
              onClick={doCleanupMissing}
              disabled={missing.length === 0}
              className="h-7 rounded border border-red-300 px-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              一键清理
            </button>
          </div>
        </div>
        {missing.length === 0 ? (
          <p className="px-3 py-3 text-xs text-slate-400">没有缺失文件记录</p>
        ) : (
          <div className="max-h-48 overflow-y-auto">
            {missing.map((m) => (
              <p key={m.id} className="truncate px-3 py-1 text-xs text-red-600" title={m.path}>
                ⚠ {m.path}（原 {formatSize(m.size)}）
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Tab 3：标签类型管理 ====================

function TypesTab(): JSX.Element {
  const pushToast = useStore((s) => s.pushToast);
  const pushApiError = useStore((s) => s.pushApiError);
  const refreshFacets = useStore((s) => s.refreshFacets);
  const afterTagMutation = useStore((s) => s.afterTagMutation);

  const [types, setTypes] = useState<TypeView[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editingType, setEditingType] = useState<number | null>(null);
  const [typeDraft, setTypeDraft] = useState('');
  const [editingValue, setEditingValue] = useState<number | null>(null);
  const [valueDraft, setValueDraft] = useState('');
  const [movingValue, setMovingValue] = useState<number | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>('');
  const [moveNewName, setMoveNewName] = useState('');
  const [newValueDraft, setNewValueDraft] = useState<Record<number, string>>({});
  const [newTypeName, setNewTypeName] = useState('');
  const [newTypeMode, setNewTypeMode] = useState<InputMode>('free');

  const reload = useCallback(async (): Promise<void> => {
    try {
      setTypes(await listTypes());
    } catch (err) {
      pushApiError(err);
    }
  }, [pushApiError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 变更成功后：类型列表 + facets + 结果一起刷新 */
  const refreshAllTypes = useCallback(async (): Promise<void> => {
    await reload();
    await refreshFacets();
    await afterTagMutation();
  }, [reload, refreshFacets, afterTagMutation]);

  const toggleExpand = (id: number): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveTypeName = async (t: TypeView): Promise<void> => {
    const name = typeDraft.trim();
    setEditingType(null);
    if (!name || name === t.name) return;
    try {
      await updateType(t.id, { name });
      pushToast('success', '类型已改名');
      await refreshAllTypes();
    } catch (err) {
      pushApiError(err);
    }
  };

  const setMode = async (t: TypeView, mode: InputMode): Promise<void> => {
    try {
      await updateType(t.id, { inputMode: mode });
      await reload();
    } catch (err) {
      pushApiError(err);
    }
  };

  const setHidden = async (t: TypeView, hidden: boolean): Promise<void> => {
    try {
      await updateType(t.id, { hiddenInFilter: hidden });
      pushToast('success', hidden ? '该类型已从筛选面板隐藏' : '该类型已恢复显示');
      await Promise.all([reload(), refreshFacets()]);
    } catch (err) {
      pushApiError(err);
    }
  };

  const moveDir = async (t: TypeView, direction: 'up' | 'down'): Promise<void> => {
    try {
      await moveType(t.id, direction);
      await reload();
    } catch (err) {
      pushApiError(err);
    }
  };

  const delType = async (t: TypeView): Promise<void> => {
    try {
      await twoPhase(
        () => deleteType(t.id),
        (data) => {
          const info = (data ?? {}) as { affectedFiles?: number; valueCount?: number };
          return `类型「${t.name}」有 ${info.affectedFiles ?? 0} 个文件挂有标签、${info.valueCount ?? 0} 个字典值，删除将一并移除这些标签，确定？`;
        },
        () => deleteType(t.id, true),
      );
      pushToast('success', '类型已删除');
      await refreshAllTypes();
    } catch (err) {
      pushApiError(err);
    }
  };

  const addValue = async (t: TypeView): Promise<void> => {
    const value = (newValueDraft[t.id] ?? '').trim();
    if (!value) return;
    try {
      await addDictValue(t.id, value);
      setNewValueDraft((prev) => ({ ...prev, [t.id]: '' }));
      await refreshAllTypes();
    } catch (err) {
      pushApiError(err);
    }
  };

  const saveValueName = async (valueId: number): Promise<void> => {
    const value = valueDraft.trim();
    setEditingValue(null);
    if (!value) return;
    try {
      await renameDictValue(valueId, value);
      pushToast('success', '字典值已改名（已同步全部已挂标签）');
      await refreshAllTypes();
    } catch (err) {
      pushApiError(err);
    }
  };

  const delValue = async (valueId: number, value: string): Promise<void> => {
    try {
      await twoPhase(
        () => deleteDictValue(valueId),
        (data) => {
          const info = (data ?? {}) as { affectedFiles?: number };
          return `有 ${info.affectedFiles ?? 0} 个文件使用了值「${value}」，删除将一并移除这些标签，确定？`;
        },
        () => deleteDictValue(valueId, true),
      );
      pushToast('success', '字典值已删除');
      await refreshAllTypes();
    } catch (err) {
      pushApiError(err);
    }
  };

  const doMoveValue = async (valueId: number, value: string): Promise<void> => {
    const target = moveTarget === '__new__' ? { newTypeName: moveNewName.trim() } : { toTypeId: Number(moveTarget) };
    if (target.newTypeName != null && !target.newTypeName) {
      pushToast('info', '请输入新类型名或选择目标类型');
      return;
    }
    try {
      await moveDictValue(valueId, target);
      pushToast('success', `值「${value}」及其标签已移动`);
      setMovingValue(null);
      setMoveTarget('');
      setMoveNewName('');
      await refreshAllTypes();
    } catch (err) {
      pushApiError(err);
    }
  };

  const createNewType = async (): Promise<void> => {
    const name = newTypeName.trim();
    if (!name) return;
    try {
      await createType(name, newTypeMode);
      pushToast('success', `类型「${name}」已创建`);
      setNewTypeName('');
      await refreshAllTypes();
    } catch (err) {
      pushApiError(err);
    }
  };

  return (
    <div className="space-y-2 p-4 text-sm">
      {types.map((t, idx) => {
        const isUnclassified = t.name === '未分类';
        const isOpen = expanded.has(t.id);
        return (
          <div key={t.id} className="rounded-md border border-slate-200">
            {/* 类型行 */}
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              {/* 排序 */}
              <span className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => moveDir(t, 'up')}
                  disabled={idx === 0}
                  className="text-[10px] leading-3 text-slate-400 hover:text-blue-600 disabled:opacity-30"
                  title="上移"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => moveDir(t, 'down')}
                  disabled={idx === types.length - 1}
                  className="text-[10px] leading-3 text-slate-400 hover:text-blue-600 disabled:opacity-30"
                  title="下移"
                >
                  ▼
                </button>
              </span>

              {/* 名称（双击行内改名） */}
              <div className="min-w-0 flex-1">
                {editingType === t.id ? (
                  <input
                    type="text"
                    value={typeDraft}
                    autoFocus
                    onChange={(e) => setTypeDraft(e.target.value)}
                    onBlur={() => void saveTypeName(t)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveTypeName(t);
                      if (e.key === 'Escape') setEditingType(null);
                    }}
                    className="h-7 w-40 rounded border border-blue-400 px-2"
                    maxLength={30}
                  />
                ) : (
                  <button
                    type="button"
                    onDoubleClick={() => !isUnclassified && (setEditingType(t.id), setTypeDraft(t.name))}
                    onClick={() => toggleExpand(t.id)}
                    className={`text-left font-medium ${isUnclassified ? 'text-slate-400' : 'text-slate-800 hover:text-blue-700'}`}
                    title={isUnclassified ? '受保护类型' : '单击展开字典值，双击改名'}
                  >
                    {t.name}
                    <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                      {t.inputMode === 'enum' ? '枚举' : '自由'} · {t.values.length} 值
                    </span>
                  </button>
                )}
              </div>

              {/* 不在筛选面板显示开关（黄色标识） */}
              <label
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
                title="勾选后该类型不在左侧筛选面板显示"
              >
                <input
                  type="checkbox"
                  checked={t.hiddenInFilter}
                  disabled={isUnclassified}
                  onChange={(e) => void setHidden(t, e.target.checked)}
                  className="h-3.5 w-3.5 accent-amber-500"
                />
                <span className={t.hiddenInFilter ? 'font-semibold text-amber-600' : 'text-slate-400'}>
                  {t.hiddenInFilter ? '面板隐藏' : '面板显示'}
                </span>
              </label>

              {/* 输入模式 */}
              <select
                value={t.inputMode}
                disabled={isUnclassified}
                onChange={(e) => void setMode(t, e.target.value as InputMode)}
                className="h-7 shrink-0 rounded border border-slate-300 px-1 text-xs disabled:opacity-50"
                title="输入模式：枚举=字典白名单 / 自由=任意值"
              >
                <option value="enum">枚举</option>
                <option value="free">自由</option>
              </select>

              {/* 删除 */}
              <button
                type="button"
                onClick={() => void delType(t)}
                disabled={isUnclassified}
                className="h-7 shrink-0 rounded border border-red-300 px-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-30"
                title={isUnclassified ? '「未分类」不可删除' : '删除类型（先返回影响数再确认）'}
              >
                删除
              </button>
            </div>

            {/* 字典值 chips */}
            {isOpen && (
              <div className="border-t border-slate-100 px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {t.values.map((v) => (
                    <span
                      key={`${v.id ?? 'f'}-${v.value}`}
                      className="group flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs"
                    >
                      {editingValue === v.id && v.id != null ? (
                        <input
                          type="text"
                          value={valueDraft}
                          autoFocus
                          onChange={(e) => setValueDraft(e.target.value)}
                          onBlur={() => void saveValueName(v.id as number)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveValueName(v.id as number);
                            if (e.key === 'Escape') setEditingValue(null);
                          }}
                          className="h-5 w-24 rounded border border-blue-400 px-1"
                          maxLength={100}
                        />
                      ) : (
                        <>
                          <span
                            className="max-w-[140px] cursor-pointer truncate"
                            onDoubleClick={() => v.id != null && (setEditingValue(v.id), setValueDraft(v.value))}
                            title={`${v.value}（${v.count} 个文件）双击改名`}
                          >
                            {v.value}
                          </span>
                          <span className="text-[10px] text-slate-400">{v.count}</span>
                          {v.id != null && (
                            <button
                              type="button"
                              onClick={() => (setEditingValue(v.id), setValueDraft(v.value))}
                              className="text-slate-400 hover:text-blue-600"
                              title="改名"
                            >
                              ✎
                            </button>
                          )}
                          {v.id != null && (
                            <button
                              type="button"
                              onClick={() => setMovingValue(movingValue === v.id ? null : v.id)}
                              className="text-slate-400 hover:text-blue-600"
                              title="移动到其他类型"
                            >
                              ⇄
                            </button>
                          )}
                          {v.id != null && (
                            <button
                              type="button"
                              onClick={() => void delValue(v.id as number, v.value)}
                              className="text-slate-400 hover:text-red-600"
                              title="删除（带影响数确认）"
                            >
                              ✕
                            </button>
                          )}
                        </>
                      )}
                    </span>
                  ))}
                  {t.values.length === 0 && <span className="text-xs text-slate-400">暂无字典值（自由类型可直接在文件上打标）</span>}

                  {/* 新增字典值 */}
                  <span className="flex items-center gap-1">
                    <input
                      type="text"
                      value={newValueDraft[t.id] ?? ''}
                      onChange={(e) => setNewValueDraft((prev) => ({ ...prev, [t.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && void addValue(t)}
                      placeholder="新增字典值"
                      className="h-6 w-28 rounded border border-slate-300 px-1.5 text-xs"
                      maxLength={100}
                    />
                    <button
                      type="button"
                      onClick={() => void addValue(t)}
                      className="h-6 rounded bg-slate-200 px-1.5 text-xs hover:bg-slate-300"
                    >
                      +
                    </button>
                  </span>
                </div>

                {/* 移动面板 */}
                {movingValue != null && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs">
                    <span className="text-blue-800">移动值「{t.values.find((v) => v.id === movingValue)?.value ?? ''}」到：</span>
                    <select
                      value={moveTarget}
                      onChange={(e) => setMoveTarget(e.target.value)}
                      className="h-6 rounded border border-slate-300 px-1"
                    >
                      <option value="">选择类型…</option>
                      <option value="__new__">➕ 新建类型…</option>
                      {types
                        .filter((x) => x.id !== t.id)
                        .map((x) => (
                          <option key={x.id} value={String(x.id)}>
                            {x.name}
                          </option>
                        ))}
                    </select>
                    {moveTarget === '__new__' && (
                      <input
                        type="text"
                        value={moveNewName}
                        onChange={(e) => setMoveNewName(e.target.value)}
                        placeholder="新类型名（自动创建）"
                        className="h-6 w-32 rounded border border-slate-300 px-1.5"
                        maxLength={30}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => void doMoveValue(movingValue, t.values.find((v) => v.id === movingValue)?.value ?? '')}
                      className="h-6 rounded bg-blue-500 px-2 text-white"
                    >
                      移动
                    </button>
                    <button type="button" onClick={() => setMovingValue(null)} className="text-slate-500 hover:text-slate-700">
                      取消
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* 新建类型 */}
      <div className="mt-3 flex items-center gap-2 rounded-md border border-dashed border-slate-300 p-3">
        <input
          type="text"
          value={newTypeName}
          onChange={(e) => setNewTypeName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void createNewType()}
          placeholder="新类型名（≤30 字符，不含冒号）"
          className="h-8 min-w-0 flex-1 rounded border border-slate-300 px-2"
          maxLength={30}
        />
        <select
          value={newTypeMode}
          onChange={(e) => setNewTypeMode(e.target.value as InputMode)}
          className="h-8 rounded border border-slate-300 px-1 text-xs"
        >
          <option value="free">自由输入</option>
          <option value="enum">枚举</option>
        </select>
        <button type="button" onClick={() => void createNewType()} className="h-8 rounded bg-blue-500 px-3 text-white hover:bg-blue-600">
          新建类型
        </button>
      </div>
    </div>
  );
}

// ==================== Tab 4：导入导出 ====================

function DataTab(): JSX.Element {
  const pushToast = useStore((s) => s.pushToast);
  const pushApiError = useStore((s) => s.pushApiError);
  const refreshFacets = useStore((s) => s.refreshFacets);
  const runSearch = useStore((s) => s.runSearch);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [stats, setStats] = useState<ImportStats | null>(null);

  const doExportJson = (): void => {
    void exportJsonData()
      .then((data) => {
        downloadBlob(JSON.stringify(data, null, 2), `tagvault-export-${stamp()}.json`, 'application/json');
        pushToast('success', 'JSON 已导出下载');
      })
      .catch((err) => pushApiError(err));
  };

  const doExportCsv = (): void => {
    void exportCsvText()
      .then((text) => {
        downloadBlob(text, `tagvault-export-${stamp()}.csv`, 'text/csv;charset=utf-8');
        pushToast('success', 'CSV（带 BOM）已导出下载');
      })
      .catch((err) => pushApiError(err));
  };

  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const reader = new FileReader();
    reader.onload = (): void => {
      let payload: unknown;
      try {
        payload = JSON.parse(String(reader.result ?? ''));
      } catch {
        pushToast('error', '文件不是合法的 JSON');
        setImporting(false);
        return;
      }
      void importData(payload)
        .then((s) => {
          setStats(s);
          pushToast(
            'success',
            `导入完成：类型 ${s.restoredTypes}、字典值 ${s.restoredValues}、标签 ${s.restoredTags}` +
              (s.unmatched.length > 0 ? `，未匹配 ${s.unmatched.length} 条` : ''),
          );
          void refreshFacets();
          void runSearch(true);
        })
        .catch((err) => pushApiError(err))
        .finally(() => {
          setImporting(false);
          if (fileRef.current) fileRef.current.value = '';
        });
    };
    reader.readAsText(file, 'utf-8');
  };

  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="rounded-md border border-slate-200 p-3">
        <div className="mb-2 font-medium text-slate-700">导出</div>
        <div className="flex gap-2">
          <button type="button" onClick={doExportJson} className="h-8 rounded border border-slate-300 px-3 hover:bg-slate-100">
            ⬇ 导出 JSON（含类型与字典）
          </button>
          <button type="button" onClick={doExportCsv} className="h-8 rounded border border-slate-300 px-3 hover:bg-slate-100">
            ⬇ 导出 CSV（Excel 友好，带 BOM）
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">导出按路径+类型名组织，可在其他机器导入还原标签</p>
      </div>

      <div className="rounded-md border border-slate-200 p-3">
        <div className="mb-2 font-medium text-slate-700">导入 JSON</div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          onChange={onImportFile}
          disabled={importing}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded file:border-0 file:bg-blue-500 file:px-3 file:py-1.5 file:text-white hover:file:bg-blue-600"
        />
        <p className="mt-1 text-xs text-slate-400">按类型名对齐还原：同名类型存在则复用，不存在则自动创建；路径未索引的条目列入"未匹配"</p>
        {stats && (
          <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
            <p>类型 {stats.restoredTypes} 个 · 字典值 {stats.restoredValues} 个 · 标签 {stats.restoredTags} 条</p>
            {stats.unmatched.length > 0 && (
              <p className="mt-1 max-h-24 overflow-y-auto text-amber-700">
                未匹配 {stats.unmatched.length} 条：
                {stats.unmatched.slice(0, 10).join('；')}
                {stats.unmatched.length > 10 ? '…' : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Tab 5：关于 ====================

function AboutTab(): JSX.Element {
  const [status, setStatus] = useState<StatusInfo | null>(null);
  useEffect(() => {
    getStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  return (
    <div className="space-y-3 p-4 text-sm text-slate-600">
      <div className="text-lg font-bold text-slate-800">标签管家 TagVault</div>
      <p>
        版本 {status?.version ?? '1.0.0'} · 文件总数 {status?.totalFiles ?? '-'} · 缺失 {status?.missingCount ?? '-'} ·
        库内标签类型 {status ? '见"标签类型管理"' : '-'}
      </p>
      <ul className="list-disc space-y-1 pl-5 text-xs">
        <li>本地文件标签检索工具：文件原地不动，仅读取元数据与生成缩略图缓存。</li>
        <li>搜索框支持 <code className="rounded bg-slate-100 px-1">类型:值</code> 字段化语法，<code className="rounded bg-slate-100 px-1">|</code> 表示或、空格表示且。</li>
        <li>左侧筛选面板与搜索关键词组合为 AND；同类型多值=或、跨类型=且。</li>
        <li>枚举类型打标只能从字典中选择；自由类型可输入任意值（≤100 字符）。</li>
        <li>无匹配类型的快速添加值自动归入「未分类」类型；「未分类」不可删除或改名。</li>
        <li>完全离线运行，不发起任何外部网络请求。</li>
      </ul>
    </div>
  );
}

// ==================== 弹窗容器 ====================

export function SettingsDialog(): JSX.Element | null {
  const open = useStore((s) => s.settingsOpen);
  const setOpen = useStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<TabKey>('dirs');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
      <div
        className="flex h-[82vh] w-[720px] max-w-[95vw] flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        {/* Tab 栏 */}
        <div className="flex shrink-0 items-center border-b border-slate-200 bg-slate-50">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`border-b-2 px-4 py-2.5 text-sm ${
                tab === t.key
                  ? 'border-blue-500 font-semibold text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto mr-3 rounded px-2 py-1 text-slate-400 hover:text-slate-700"
            aria-label="关闭设置"
          >
            ✕
          </button>
        </div>

        {/* 内容区（独立滚动） */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'config' && <ConfigTab />}
          {tab === 'dirs' && <DirsTab />}
          {tab === 'types' && <TypesTab />}
          {tab === 'data' && <DataTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  );
}
