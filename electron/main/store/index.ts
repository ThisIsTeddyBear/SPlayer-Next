import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { defaultSystemConfig } from "@shared/defaults/settings";
import type { SystemConfig } from "@shared/types/settings";
import type { ConfigPath, PathValue } from "./types";
import { deepMerge, getByPath, setByPath } from "./utils";
import { migrations } from "./migrations";
import { configDir } from "@main/utils/paths";
import { systemLog } from "@main/utils/logger";

let readError: unknown;

/** 配置文件路径 */
const configPath = path.join(configDir, "settings.json");
/** 配置版本键名 */
const META_KEY = "__configVersion";

/** 读取配置文件 */
const readFile = (): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid settings document");
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      readError = error;
      systemLog.error("配置读取失败，已保留原文件", error);
    }
    return {};
  }
};

/** 防抖窗口 */
const FLUSH_DEBOUNCE_MS = 200;
let flushTimer: NodeJS.Timeout | null = null;

/** 同步写盘的内部实现 */
const writeNow = (config: SystemConfig, recover = false): void => {
  if (readError && !recover) {
    throw new Error("Settings cannot be read. Restore a backup or reset settings to recover.");
  }
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  atomicWriteSync(configPath, JSON.stringify(config, null, 2));
};

/** 立即写盘 */
const flushImmediate = (config: SystemConfig): void => {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  writeNow(config);
};

/**
 * 将配置写入磁盘
 * @param config 配置对象
 */
const flush = (config: SystemConfig): void => {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      writeNow(config);
    } catch (error) {
      systemLog.error("配置保存失败", error);
    }
  }, FLUSH_DEBOUNCE_MS);
};

/**
 * 加载配置、执行迁移、回写磁盘
 * @returns 配置对象
 */
const init = (): SystemConfig => {
  const raw = readFile();
  const data = deepMerge(defaultSystemConfig, raw);

  let currentVersion: number = (raw[META_KEY] as number) ?? 0;
  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);
  for (const m of pending) {
    m.migrate(data);
    currentVersion = m.version;
  }
  if (pending.length > 0) {
    (data as unknown as Record<string, unknown>)[META_KEY] = currentVersion;
  }

  if (!readError) {
    try {
      flushImmediate(data);
    } catch (error) {
      systemLog.error("启动时配置保存失败", error);
    }
  }
  return data;
};

/** 配置存储 */
let data: SystemConfig = init();

app.on("before-quit", () => {
  if (readError) return;
  try {
    flushImmediate(data);
  } catch (error) {
    systemLog.error("退出时配置保存失败", error);
  }
});

/** 配置存储 */
export const store = {
  /**
   * 获取配置存储
   * @returns 配置存储
   */
  get store(): SystemConfig {
    return data;
  },

  /**
   * 获取配置值
   * @param keyPath 配置键路径
   * @returns 配置值
   */
  get<P extends ConfigPath>(keyPath: P): PathValue<SystemConfig, P> {
    return getByPath(data, keyPath) as PathValue<SystemConfig, P>;
  },

  /**
   * 设置配置值
   * @param keyPath 配置键路径
   * @param value 配置值
   * @returns 配置对象
   */
  set(keyPath: ConfigPath | (string & {}), value: unknown): void {
    if (readError) throw new Error("Restore or reset the unreadable settings file before saving.");
    setByPath(data, keyPath, value);
    flush(data);
  },

  /** 清空配置 */
  clear(): void {
    const next = structuredClone(defaultSystemConfig);
    writeNow(next, true);
    readError = undefined;
    data = next;
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
  },

  /** 用导入的配置替换当前配置 */
  replaceAll(input: unknown): void {
    const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const next = deepMerge(defaultSystemConfig, raw);
    writeNow(next, true);
    readError = undefined;
    data = next;
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
  },

  /** 立即将设置写入磁盘 */
  flushImmediate: () => flushImmediate(data),
};
