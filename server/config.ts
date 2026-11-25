/**
 * 运行时配置：读写项目根 config.json。
 * 端口 / 数据目录 / 是否自动打开浏览器。
 */
import fs from 'node:fs';
import path from 'node:path';

export interface AppConfig {
  /** HTTP 监听端口（修改后需重启生效） */
  port: number;
  /** 数据目录：存放 tagvault.db 与 thumbs/ 缓存 */
  dataDir: string;
  /** 启动后自动打开浏览器 */
  autoOpenBrowser: boolean;
}

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(PROJECT_ROOT, 'config.json');

const DEFAULTS: AppConfig = {
  port: 48765,
  dataDir: path.join(PROJECT_ROOT, 'data'),
  autoOpenBrowser: true,
};

/** 测试用 dataDir 覆盖（优先于 config.json） */
let dataDirOverride: string | null = null;
/** 测试用 config.json 路径覆盖（避免测试写脏项目根配置） */
let configFileOverride: string | null = null;

/** 测试钩子：覆盖数据目录（传 null 还原） */
export function setDataDirForTest(dir: string | null): void {
  dataDirOverride = dir;
}

/** 测试钩子：覆盖 config.json 路径（传 null 还原为项目根 config.json） */
export function setConfigFileForTest(p: string | null): void {
  configFileOverride = p;
}

function configFile(): string {
  return configFileOverride ?? CONFIG_FILE;
}

/**
 * 端口优先级：环境变量 TV_PORT（便携版启动器用于端口占用时自动顺延）> config.json > 默认 48765。
 */
function pickPort(rawPort: unknown): number {
  const envPort = Number(process.env.TV_PORT);
  if (Number.isInteger(envPort) && envPort > 0 && envPort < 65536) return envPort;
  return Number.isInteger(rawPort) && (rawPort as number) > 0 ? (rawPort as number) : DEFAULTS.port;
}

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

/** 读取配置（合并默认值；dataDir 不存在时自动创建） */
export function loadConfig(): AppConfig {
  let raw: Partial<AppConfig> = {};
  try {
    if (fs.existsSync(configFile())) {
      raw = JSON.parse(fs.readFileSync(configFile(), 'utf-8')) as Partial<AppConfig>;
    }
  } catch {
    // 配置损坏时回退默认值，不阻断启动
    raw = {};
  }
  const cfg: AppConfig = {
    port: pickPort(raw.port),
    dataDir:
      dataDirOverride ??
      (typeof raw.dataDir === 'string' && raw.dataDir.trim() ? raw.dataDir.trim() : DEFAULTS.dataDir),
    autoOpenBrowser: typeof raw.autoOpenBrowser === 'boolean' ? raw.autoOpenBrowser : DEFAULTS.autoOpenBrowser,
  };
  try {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
  } catch {
    // 目录创建失败交由后续写库时报错
  }
  return cfg;
}

/** 保存配置补丁，返回保存后的完整配置 */
export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  const next: AppConfig = {
    port: Number.isInteger(patch.port) && (patch.port as number) > 0 ? (patch.port as number) : current.port,
    dataDir:
      typeof patch.dataDir === 'string' && patch.dataDir.trim() ? patch.dataDir.trim() : current.dataDir,
    autoOpenBrowser:
      typeof patch.autoOpenBrowser === 'boolean' ? patch.autoOpenBrowser : current.autoOpenBrowser,
  };
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

/** 数据目录（测试覆盖优先） */
export function getDataDir(): string {
  return dataDirOverride ?? loadConfig().dataDir;
}
