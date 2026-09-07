/**
 *
 */

import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { app } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import type {
  PlaybackEventKind,
  PluginAction,
  PluginInfo,
  PluginManifest,
  PluginMenuItem,
  PluginSettingItem,
  PluginStatus,
  PluginUpdateInfo,
} from "@shared/types/plugin";
import { PluginErrorCodes, RESTART_MAX_ATTEMPTS } from "@shared/defaults/plugin-api";
import { store } from "@main/store";
import { getLocale } from "@main/utils/i18n";
import { coreLog } from "@main/utils/logger";
import { pluginsDir } from "@main/utils/paths";
import { pluginHost, type PluginHostCallbacks, type PluginLoadSpec } from "./host-process";
import { loadScript } from "./loader";
import { dispatchHostCall } from "./host";
import { pluginStorageDrop } from "./storage";
import { fetchScript } from "./net";

const pluginsRoot = (): string => pluginsDir;
const scriptsDir = (): string => path.join(pluginsRoot(), "scripts");
const manifestFile = (): string => path.join(pluginsRoot(), "manifest.json");

interface StoredManifest {
  version: 1;
  plugins: Record<string, PluginManifest>;
}

const ensureDirs = (): void => {
  const dirs = [pluginsRoot(), scriptsDir(), path.join(pluginsRoot(), "data")];
  for (const d of dirs) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
};

const readStored = (): StoredManifest => {
  try {
    const raw = fs.readFileSync(manifestFile(), "utf-8");
    const data = JSON.parse(raw) as StoredManifest;
    if (data?.version === 1 && data.plugins) return data;
  } catch {
  }
  return { version: 1, plugins: {} };
};

const writeStored = (data: StoredManifest): void => {
  ensureDirs();
  atomicWriteSync(manifestFile(), JSON.stringify(data, null, 2));
};

/**
 */
const isNewerVersion = (remote: string, current: string): boolean => {
  const parse = (v: string): number[] =>
    v
      .trim()
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .map((seg) => {
        const n = parseInt(seg, 10);
        return Number.isFinite(n) ? n : 0;
      });
  const a = parse(remote);
  const b = parse(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
};

interface PluginRuntime {
  manifest: PluginManifest;
  enabled: boolean;
  status: PluginStatus;
  loading: boolean;
  source: string;
  updateInfo: PluginUpdateInfo | null;
  events: PlaybackEventKind[];
  controls: boolean;
  settings: PluginSettingItem[];
  menus: PluginMenuItem[];
  pending: Map<
    string,
    {
      resolve: (data: unknown) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >;
}

const sanitizeSettingValue = (item: PluginSettingItem, value: unknown): unknown => {
  switch (item.type) {
    case "switch":
      return Boolean(value);
    case "number": {
      let num = Number(value);
      if (!Number.isFinite(num)) num = Number(item.default);
      if (item.min != null) num = Math.max(item.min, num);
      if (item.max != null) num = Math.min(item.max, num);
      return num;
    }
    case "select": {
      const ok = item.options?.some((opt) => opt.value === value);
      return ok ? value : item.default;
    }
    case "text":
    default:
      return String(value ?? "");
  }
};

class PluginRegistry extends EventEmitter {
  private runtimes = new Map<string, PluginRuntime>();
  private hostRestartAttempts = 0;
  private hostRestartTimer: NodeJS.Timeout | null = null;

  init(): void {
    ensureDirs();
    pluginHost.setOnHostLost(() => this.handleHostLost());
    const stored = readStored();
    const enabledMap = store.get("plugins.enabled") as Record<string, boolean>;

    for (const [id, manifest] of Object.entries(stored.plugins)) {
      const scriptPath = path.join(scriptsDir(), manifest.fileName);
      let source = "";
      try {
        source = fs.readFileSync(scriptPath, "utf-8");
        const fresh = loadScript(source, false, manifest.fileName);
        source = fresh.source;
        manifest.grant = fresh.manifest.grant;
      } catch (err) {
        coreLog.warn(`[plugin] failed to read ${manifest.fileName}:`, err);
        continue;
      }
      const enabled = enabledMap[id] ?? true;
      this.runtimes.set(id, {
        manifest,
        enabled,
        source,
        status: { state: "unloaded" },
        loading: false,
        updateInfo: null,
        events: [],
        controls: false,
        settings: [],
        menus: [],
        pending: new Map(),
      });
    }

    for (const rt of this.runtimes.values()) {
      if (rt.enabled) this.start(rt).catch(() => {});
    }
    void this.checkAllUpdates();
    coreLog.info(`[plugin] registry initialized, ${this.runtimes.size} plugins loaded`);
  }

  listInfo(): PluginInfo[] {
    return Array.from(this.runtimes.values()).map((rt) => ({
      manifest: rt.manifest,
      enabled: rt.enabled,
      status: rt.status,
      updateInfo: rt.updateInfo,
      settingsValues:
        (store.get(`plugins.perPlugin.${rt.manifest.id}` as never) as Record<string, unknown>) ??
        {},
    }));
  }

  getRuntime(id: string): PluginRuntime | undefined {
    return this.runtimes.get(id);
  }

  pickForAction(action: PluginAction, source?: string): PluginRuntime | undefined {
    const priority = store.get(`plugins.priority.${action}` as never) as string[] | undefined;
    const ordered = (priority ?? []).slice();
    for (const rt of this.runtimes.values()) {
      if (!ordered.includes(rt.manifest.id)) ordered.push(rt.manifest.id);
    }
    for (const id of ordered) {
      const rt = this.runtimes.get(id);
      if (!rt || !rt.enabled || rt.status.state !== "ready") continue;
      const sources = rt.status.sources;
      const sourceKeys = source ? [source] : Object.keys(sources);
      for (const key of sourceKeys) {
        const cap = sources[key];
        if (cap && cap.actions.includes(action)) return rt;
      }
    }
    return undefined;
  }

  async install(filePath: string): Promise<PluginInfo> {
    const raw = fs.readFileSync(filePath, "utf-8");
    return this.installFromSource(raw);
  }

  async installFromSource(raw: string): Promise<PluginInfo> {
    ensureDirs();
    const { source, manifest } = loadScript(raw, false);
    const fileName = `${manifest.id}.js`;
    fs.writeFileSync(path.join(scriptsDir(), fileName), source, "utf-8");
    manifest.fileName = fileName;

    const stored = readStored();
    stored.plugins[manifest.id] = manifest;
    writeStored(stored);

    const enabledMap = {
      ...(store.get("plugins.enabled") as Record<string, boolean>),
      [manifest.id]: true,
    };
    store.set("plugins.enabled", enabledMap);

    const existing = this.runtimes.get(manifest.id);
    if (existing) await this.stop(existing);
    const rt: PluginRuntime = {
      manifest,
      enabled: true,
      source,
      status: { state: "unloaded" },
      loading: false,
      updateInfo: null,
      events: [],
      controls: false,
      settings: [],
      menus: [],
      pending: new Map(),
    };
    this.runtimes.set(manifest.id, rt);
    await this.start(rt).catch(() => {});
    return { manifest, enabled: rt.enabled, status: rt.status, updateInfo: rt.updateInfo };
  }

  getUpdateUrl(id: string): string | undefined {
    return this.runtimes.get(id)?.updateInfo?.updateUrl ?? undefined;
  }

  private infoOf(rt: PluginRuntime): PluginInfo {
    return {
      manifest: rt.manifest,
      enabled: rt.enabled,
      status: rt.status,
      updateInfo: rt.updateInfo,
      settingsValues:
        (store.get(`plugins.perPlugin.${rt.manifest.id}` as never) as Record<string, unknown>) ??
        {},
    };
  }

  /**
   */
  async checkUpdate(id: string): Promise<{ ok: boolean; hasUpdate: boolean; plugin?: PluginInfo }> {
    const rt = this.runtimes.get(id);
    if (!rt) return { ok: false, hasUpdate: false };
    const url = rt.manifest.updateUrl;
    if (!url) return { ok: false, hasUpdate: false, plugin: this.infoOf(rt) };

    const source = await fetchScript(url);
    const { manifest: remote } = loadScript(source, false);
    const samePlugin =
      remote.id === id && (remote.type ?? "source") === (rt.manifest.type ?? "source");

    if (!samePlugin || !isNewerVersion(remote.version, rt.manifest.version)) {
      if (rt.updateInfo) {
        rt.updateInfo = null;
        this.setStatus(rt, rt.status);
      }
      return { ok: true, hasUpdate: false, plugin: this.infoOf(rt) };
    }

    rt.updateInfo = {
      version: remote.version,
      log: remote.changelog,
      updateUrl: url,
      updatedAt: Date.now(),
    };
    this.setStatus(rt, rt.status);
    return { ok: true, hasUpdate: true, plugin: this.infoOf(rt) };
  }

  async checkAllUpdates(): Promise<void> {
    const targets = [...this.runtimes.values()].filter((rt) => rt.manifest.updateUrl);
    await Promise.allSettled(targets.map((rt) => this.checkUpdate(rt.manifest.id)));
  }

  /**
   */
  async applyUpdateFromSource(id: string, rawSource: string): Promise<PluginInfo> {
    const rt = this.runtimes.get(id);
    if (!rt) {
      throw Object.assign(new Error("plugin not found"), { code: PluginErrorCodes.NOT_FOUND });
    }
    const { source, manifest } = loadScript(rawSource, false);
    if (manifest.id !== id) {
      throw Object.assign(new Error("plugin name changed, please reinstall manually"), {
        code: PluginErrorCodes.INVALID_MANIFEST,
      });
    }
    if ((manifest.type ?? "source") !== (rt.manifest.type ?? "source")) {
      throw Object.assign(new Error("plugin type changed, please reinstall manually"), {
        code: PluginErrorCodes.INVALID_MANIFEST,
      });
    }

    manifest.fileName = `${id}.js`;
    manifest.installedAt = rt.manifest.installedAt;
    manifest.updatedAt = Date.now();

    fs.writeFileSync(path.join(scriptsDir(), manifest.fileName), source, "utf-8");
    const stored = readStored();
    stored.plugins[id] = manifest;
    writeStored(stored);

    rt.updateInfo = null;
    await this.stop(rt);
    rt.manifest = manifest;
    rt.source = source;
    rt.events = [];
    rt.controls = false;
    rt.settings = [];
    rt.menus = [];

    if (rt.enabled) await this.start(rt).catch(() => {});
    else this.setStatus(rt, { state: "disabled" });

    return {
      manifest: rt.manifest,
      enabled: rt.enabled,
      status: rt.status,
      updateInfo: rt.updateInfo,
      settingsValues:
        (store.get(`plugins.perPlugin.${id}` as never) as Record<string, unknown>) ?? {},
    };
  }

  async uninstall(id: string): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    await this.stop(rt);
    this.runtimes.delete(id);

    const stored = readStored();
    delete stored.plugins[id];
    writeStored(stored);

    try {
      fs.unlinkSync(path.join(scriptsDir(), rt.manifest.fileName));
    } catch {
    }
    pluginStorageDrop(id);

    const enabledMap = { ...(store.get("plugins.enabled") as Record<string, boolean>) };
    delete enabledMap[id];
    store.set("plugins.enabled", enabledMap);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    const before = this.hasEnabledControlPlugin();
    rt.enabled = enabled;
    const enabledMap = {
      ...(store.get("plugins.enabled") as Record<string, boolean>),
      [id]: enabled,
    };
    store.set("plugins.enabled", enabledMap);

    if (enabled) {
      this.hostRestartAttempts = 0; // 手动启用：恢复 host 重启额度
      if (rt.status.state !== "ready") await this.start(rt).catch(() => {});
    } else {
      await this.stop(rt);
      this.setStatus(rt, { state: "disabled" });
      this.notifyControlActivity(before);
    }
  }

  private async start(rt: PluginRuntime): Promise<void> {
    const id = rt.manifest.id;
    if (pluginHost.isReady(id) || rt.loading) return; // 已就绪或正在加载
    rt.loading = true;
    this.setStatus(rt, { state: "loading" });

    const userSettings =
      (store.get(`plugins.perPlugin.${id}` as never) as Record<string, unknown> | undefined) ?? {};

    const spec: PluginLoadSpec = {
      pluginId: id,
      apiLevel: rt.manifest.apiLevel,
      locale: getLocale(),
      appVersion: app.getVersion(),
      userSettings,
      source: rt.source,
      scriptInfo: {
        name: rt.manifest.name,
        description: rt.manifest.description ?? "",
        version: rt.manifest.version,
        author: rt.manifest.author ?? "",
        homepage: rt.manifest.homepage ?? "",
      },
    };

    const callbacks: PluginHostCallbacks = {
      onReady: (sources) => {
        this.hostRestartAttempts = 0; // host 成功带起插件 → 重置 host 重启计数
        this.setStatus(rt, {
          state: "ready",
          sources,
          events: rt.events,
          controls: rt.controls,
          settings: rt.settings,
          menus: rt.menus,
        });
        this.maybePrimeControl(rt);
      },
      onResult: (requestId, ok, data, error) => {
        const p = rt.pending.get(requestId);
        if (!p) return;
        rt.pending.delete(requestId);
        clearTimeout(p.timer);
        if (ok) p.resolve(data);
        else {
          const err = new Error(error?.message ?? "call failed");

          (err as any).code = error?.code ?? PluginErrorCodes.UNKNOWN;
          p.reject(err);
        }
      },
      onHostCall: (callId, method, args) => {
        void dispatchHostCall(id, rt.manifest.grant, callId, method, args);
      },
      onLog: (level, args) => {
        coreLog[level](`[plugin:${id}]`, ...args);
      },
      onUpdateAvailable: (info) => {
        rt.updateInfo = info;
        this.setStatus(rt, rt.status);
      },
      onSourcesUpdate: (sources) => {
        if (rt.status.state === "ready") {
          const merged = { ...rt.status.sources, ...sources };
          this.setStatus(rt, { ...rt.status, sources: merged });
        } else {
          this.setStatus(rt, {
            state: "ready",
            sources,
            events: rt.events,
            controls: rt.controls,
            settings: rt.settings,
            menus: rt.menus,
          });
        }
      },
      onRegistered: ({ events, controls, settings, menus: declaredMenus }) => {
        const menus = rt.manifest.grant.includes("ui") ? declaredMenus : [];
        if (declaredMenus.length && !menus.length) {
          coreLog.warn(`[plugin:${id}] declared a menu but lacks the "ui" permission; ignored`);
        }
        rt.events = events;
        rt.controls = controls;
        rt.settings = settings;
        rt.menus = menus;
        if (rt.status.state === "ready") {
          this.setStatus(rt, { ...rt.status, events, controls, settings, menus });
        } else {
          this.setStatus(rt, { state: "ready", sources: {}, events, controls, settings, menus });
        }
        this.maybePrimeControl(rt);
      },
      onFatal: (error) => {
        coreLog.error(`[plugin:${id}] fatal ${error.code}: ${error.message}`);
        this.setStatus(rt, { state: "error", error });
        this.rejectAllPending(rt, error.message, error.code);
      },
      onHostLost: () => {
        this.rejectAllPending(rt, "plugin host lost", PluginErrorCodes.WORKER_CRASHED);
      },
    };

    try {
      await pluginHost.loadPlugin(spec, callbacks);
    } catch (err) {
      const code = ((err as any)?.code as string) ?? PluginErrorCodes.UNKNOWN;
      if (code !== PluginErrorCodes.WORKER_CRASHED && rt.enabled && rt.status.state === "loading") {
        const message = err instanceof Error ? err.message : String(err);
        coreLog.error(`[plugin:${id}] load failed ${code}: ${message}`);
        this.setStatus(rt, { state: "error", error: { code, message } });
      }
    } finally {
      rt.loading = false;
    }
  }

  private handleHostLost(): void {
    if (this.hostRestartTimer) return; // 已安排重启
    this.hostRestartAttempts++;
    const enabled = [...this.runtimes.values()].filter((rt) => rt.enabled);
    if (this.hostRestartAttempts > RESTART_MAX_ATTEMPTS) {
      for (const rt of enabled) {
        this.setStatus(rt, {
          state: "error",
          error: {
            code: PluginErrorCodes.WORKER_CRASHED,
            message: "plugin host crashed too many times",
          },
        });
      }
      return;
    }
    for (const rt of enabled) this.setStatus(rt, { state: "loading" });
    const delayMs = [2_000, 8_000, 30_000][this.hostRestartAttempts - 1] ?? 30_000;
    coreLog.warn(`[plugin] host lost; reloading ${enabled.length} plugins in ${delayMs}ms`);
    this.hostRestartTimer = setTimeout(() => {
      this.hostRestartTimer = null;
      for (const rt of enabled) {
        if (rt.enabled) this.start(rt).catch(() => {});
      }
    }, delayMs);
  }

  private async stop(rt: PluginRuntime): Promise<void> {
    rt.loading = false;
    pluginHost.unloadPlugin(rt.manifest.id);
    this.rejectAllPending(rt, "plugin stopped", PluginErrorCodes.NOT_READY);
    this.setStatus(rt, { state: "unloaded" });
  }

  private rejectAllPending(rt: PluginRuntime, message: string, code: string): void {
    for (const pendingCall of rt.pending.values()) {
      clearTimeout(pendingCall.timer);
      pendingCall.reject(Object.assign(new Error(message), { code }));
    }
    rt.pending.clear();
  }

  private setStatus(rt: PluginRuntime, status: PluginStatus): void {
    const before = this.hasEnabledControlPlugin();
    rt.status = status;
    this.emit("status", {
      manifest: rt.manifest,
      enabled: rt.enabled,
      status,
      updateInfo: rt.updateInfo,
      settingsValues:
        (store.get(`plugins.perPlugin.${rt.manifest.id}` as never) as Record<string, unknown>) ??
        {},
    } satisfies PluginInfo);
    this.notifyControlActivity(before);
  }

  /**
   */
  private maybePrimeControl(rt: PluginRuntime): void {
    if (
      rt.manifest.type === "control" &&
      rt.status.state === "ready" &&
      pluginHost.isReady(rt.manifest.id)
    ) {
      this.emit("controlPluginReady", rt.manifest.id);
    }
  }

  private notifyControlActivity(before: boolean): void {
    const after = this.hasEnabledControlPlugin();
    if (before !== after) this.emit("controlActivityChange", after);
  }

  hasEnabledControlPlugin(): boolean {
    for (const rt of this.runtimes.values()) {
      if (rt.enabled && rt.manifest.type === "control" && rt.status.state === "ready") return true;
    }
    return false;
  }

  /**
   */
  broadcastPlaybackEvent(event: PlaybackEventKind, data: unknown): void {
    for (const rt of this.runtimes.values()) {
      if (
        rt.enabled &&
        rt.manifest.type === "control" &&
        rt.status.state === "ready" &&
        rt.events.includes(event)
      ) {
        pluginHost.sendEvent(rt.manifest.id, event, data);
      }
    }
  }

  /**
   */
  sendPlaybackEventTo(id: string, event: PlaybackEventKind, data: unknown): void {
    const rt = this.runtimes.get(id);
    if (
      rt &&
      rt.enabled &&
      rt.manifest.type === "control" &&
      rt.status.state === "ready" &&
      rt.events.includes(event)
    ) {
      pluginHost.sendEvent(id, event, data);
    }
  }

  /**
   */
  async setSetting(id: string, key: string, value: unknown): Promise<void> {
    const rt = this.runtimes.get(id);
    if (!rt) return;
    const item = rt.settings.find((setting) => setting.key === key);
    if (!item) return;
    const sanitized = sanitizeSettingValue(item, value);
    const all = {
      ...((store.get(`plugins.perPlugin.${id}` as never) as Record<string, unknown>) ?? {}),
      [key]: sanitized,
    };
    store.set(`plugins.perPlugin.${id}` as never, all);
    if (pluginHost.isReady(id)) pluginHost.sendSettingsUpdate(id, { [key]: sanitized });
  }

  async shutdown(): Promise<void> {
    if (this.hostRestartTimer) {
      clearTimeout(this.hostRestartTimer);
      this.hostRestartTimer = null;
    }
    pluginHost.shutdown();
  }
}

export const pluginRegistry = new PluginRegistry();
export type { PluginRuntime };
