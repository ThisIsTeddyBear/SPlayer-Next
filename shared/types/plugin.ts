/**
 */

import type { LyricLine } from "./lyrics";
import type { Track } from "./player";
import type { CommentTab, MusicCommentItem } from "./comment";

/**
 */
export type PluginAction =
  "musicUrl" | "menuClick" | "musicSearch" | "musicLyric" | "musicPic" | "musicComment";

/**
 */
export type PluginQuality = "hi-res" | "lossless" | "hq" | "sq" | "lq";

export const PLUGIN_TYPES = ["source", "control"] as const;
export type PluginType = (typeof PLUGIN_TYPES)[number];

export const PLUGIN_GRANTS = ["network", "control", "ui"] as const;
export type PluginGrant = (typeof PLUGIN_GRANTS)[number];

export type PlaybackEventKind = "trackChange" | "lyricChange" | "lineChange" | "playStateChange";

export interface PlaybackEventData {
  trackChange: { track: Track | null };
  lyricChange: { lines: LyricLine[] };
  lineChange: { index: number; position: number };
  playStateChange: { state: "playing" | "paused" | "stopped"; position: number };
}

export type PluginSettingType = "switch" | "number" | "text" | "select";

export interface PluginSettingItem {
  key: string;
  type: PluginSettingType;
  label: string;
  description?: string;
  default: boolean | number | string;
  min?: number;
  max?: number;
  placeholder?: string;
  options?: { label: string; value: string }[];
}

/**
 */
export interface PluginMenuItem {
  id: string;
  label: string;
  sources?: string[];
}

export interface PluginRegistration {
  events: PlaybackEventKind[];
  controls: boolean;
  settings: PluginSettingItem[];
  menus: PluginMenuItem[];
}

export interface RegisterArgs {
  sources?: Record<string, SourceCapability>;
  events?: PlaybackEventKind[];
  controls?: boolean;
  settings?: PluginSettingItem[];
  menus?: PluginMenuItem[];
}

export interface PluginPlayerApi {
  on<K extends PlaybackEventKind>(kind: K, handler: (data: PlaybackEventData[K]) => void): void;
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(positionMs: number): void;
  setVolume(volume: number): void;
  getPosition(): Promise<number>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  grant: PluginGrant[];
  type?: PluginType;
  apiLevel: number;
  hash: string;
  updateUrl?: string;
  changelog?: string;
  installedAt: number;
  updatedAt?: number;
  fileName: string;
}

export interface SourceCapability {
  name: string;
  actions: PluginAction[];
  qualities?: PluginQuality[];
}

export type PluginStatus =
  | { state: "unloaded" }
  | { state: "loading" }
  | {
      state: "ready";
      sources: Record<string, SourceCapability>;
      events?: PlaybackEventKind[];
      controls?: boolean;
      settings?: PluginSettingItem[];
      menus?: PluginMenuItem[];
    }
  | { state: "error"; error: { code: string; message: string } }
  | { state: "disabled" };

export interface PluginUpdateInfo {
  version?: string;
  log?: string;
  updateUrl?: string;
  updatedAt: number;
}

export interface PluginInfo {
  manifest: PluginManifest;
  enabled: boolean;
  status: PluginStatus;
  updateInfo?: PluginUpdateInfo | null;
  settingsValues?: Record<string, unknown>;
}


export interface MusicUrlReq {
  source: string;
  quality: PluginQuality;
  musicInfo: {
    songmid: string;
    name?: string;
    singer?: string;
    [key: string]: unknown;
  };
}
export interface MusicUrlRes {
  url: string;
  quality?: PluginQuality;
  expire?: number;
}

export interface MenuClickReq {
  menuId: string;
  track: Track;
}
export interface MenuClickRes {
  toast?: string;
  openUrl?: string;
  copyText?: string;
}

export interface MusicSearchReq {
  source: string;
  keyword: string;
  page?: number;
  limit?: number;
}
/**
 */
export interface MusicSearchCandidate {
  id: string;
  name: string;
  singer?: string;
  album?: string;
  durationMs?: number;
  [key: string]: unknown;
}
export interface MusicSearchRes {
  list: MusicSearchCandidate[];
}

export interface MusicLyricReq {
  source: string;
  musicInfo: MusicSearchCandidate;
}
export interface MusicLyricRes {
  lyric: string;
  tlyric?: string;
  rlyric?: string;
  awlyric?: string;
}

export interface MusicPicReq {
  source: string;
  musicInfo: MusicSearchCandidate;
}
export interface MusicPicRes {
  url: string;
}

export interface MusicCommentReq {
  source: string;
  musicInfo: MusicSearchCandidate;
  type: CommentTab;
  page: number;
  limit: number;
}
export interface MusicCommentRes {
  list: MusicCommentItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ActionIO {
  musicUrl: { req: MusicUrlReq; res: MusicUrlRes };
  menuClick: { req: MenuClickReq; res: MenuClickRes };
  musicSearch: { req: MusicSearchReq; res: MusicSearchRes };
  musicLyric: { req: MusicLyricReq; res: MusicLyricRes };
  musicPic: { req: MusicPicReq; res: MusicPicRes };
  musicComment: { req: MusicCommentReq; res: MusicCommentRes };
}

export interface HostRequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | ArrayBuffer | Uint8Array;
  timeout?: number;
  responseType?: "text" | "json" | "arraybuffer";
}

export interface HostRequestResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface HostLogger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface HostStorage {
  get: <T = unknown>(key: string) => Promise<T | null>;
  set: (key: string, value: unknown) => Promise<void>;
  remove: (key: string) => Promise<void>;
  keys: () => Promise<string[]>;
}

export interface HostApi {
  readonly pluginId: string;
  readonly apiLevel: number;
  readonly locale: string;
  readonly appVersion: string;

  request: (url: string, opts?: HostRequestOptions) => Promise<HostRequestResult>;

  register: (args: RegisterArgs) => void;

  on: <A extends PluginAction>(
    action: A,
    handler: (req: ActionIO[A]["req"]) => Promise<ActionIO[A]["res"]>,
  ) => void;

  log: HostLogger;

  storage: HostStorage;

  getSetting: <T = unknown>(key: string) => T | undefined;

  player: PluginPlayerApi;

  onSettingChange: (key: string, handler: (value: unknown) => void) => void;
}


export interface PluginErrorPayload {
  code: string;
  message: string;
}

/**
 */
export type SandboxIn =
  | {
      kind: "loadPlugin";
      pluginId: string;
      apiLevel: number;
      locale: string;
      appVersion: string;
      userSettings: Record<string, unknown>;
      source: string;
      scriptInfo: {
        name: string;
        description: string;
        version: string;
        author: string;
        homepage: string;
      };
    }
  | { kind: "unloadPlugin"; pluginId: string }
  | { kind: "call"; pluginId: string; requestId: string; action: PluginAction; params: unknown }
  | { kind: "cancel"; pluginId: string; requestId: string }
  | {
      kind: "hostResult";
      pluginId: string;
      callId: string;
      ok: boolean;
      data?: unknown;
      error?: PluginErrorPayload;
    }
  | { kind: "ping" }
  | { kind: "event"; pluginId: string; event: PlaybackEventKind; data: unknown }
  | { kind: "settingsUpdate"; pluginId: string; settings: Record<string, unknown> };

export type SandboxOut =
  | { kind: "hostReady" }
  | { kind: "ready"; pluginId: string; sources: Record<string, SourceCapability> }
  | {
      kind: "result";
      pluginId: string;
      requestId: string;
      ok: boolean;
      data?: unknown;
      error?: PluginErrorPayload;
    }
  | { kind: "hostCall"; pluginId: string; callId: string; method: HostCallMethod; args: unknown[] }
  | { kind: "updateAvailable"; pluginId: string; info: PluginUpdateInfo }
  | {
      kind: "log";
      pluginId?: string;
      level: "debug" | "info" | "warn" | "error";
      args: unknown[];
    }
  | { kind: "fatal"; pluginId: string; error: PluginErrorPayload }
  | { kind: "pong" }
  | { kind: "sourcesUpdate"; pluginId: string; sources: Record<string, SourceCapability> }
  | ({ kind: "registered"; pluginId: string } & PluginRegistration);

export type HostCallMethod =
  | "request"
  | "storage.get"
  | "storage.set"
  | "storage.remove"
  | "storage.keys"
  | "player.play"
  | "player.pause"
  | "player.next"
  | "player.prev"
  | "player.seek"
  | "player.setVolume"
  | "player.getPosition";


export interface PluginResolveUrlArgs {
  pluginId: string;
  source: string;
  quality?: PluginQuality;
  musicInfo: { songmid: string; [key: string]: unknown };
}

export interface PluginInvokeMenuArgs {
  pluginId: string;
  menuId: string;
  track: Track;
}
export interface PluginInvokeMenuResult {
  ok: boolean;
  toast?: string;
  openUrl?: string;
  copyText?: string;
  error?: string;
}

export interface PluginMatchLyricArgs {
  pluginId: string;
  source: string;
  track: Track;
}
export interface PluginMatchLyricResult {
  ok: boolean;
  data?: MusicLyricRes;
  error?: string;
}

export interface PluginMatchCoverArgs {
  pluginId: string;
  source: string;
  track: Track;
}
export interface PluginMatchCoverResult {
  ok: boolean;
  data?: MusicPicRes;
  error?: string;
}

export interface PluginsApi {
  list: () => Promise<PluginInfo[]>;
  install: (filePath: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
  pickAndInstall: () => Promise<{
    ok: boolean;
    id?: string;
    error?: string;
    cancelled?: boolean;
  }>;
  installFromUrl: (url: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
  uninstall: (id: string) => Promise<{ ok: boolean; error?: string }>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /**
   */
  setSetting: (id: string, key: string, value: unknown) => Promise<void>;
  /**
   */
  checkUpdate: (
    id: string,
  ) => Promise<{ ok: boolean; hasUpdate: boolean; plugin?: PluginInfo; error?: string }>;
  /**
   */
  applyUpdate: (
    id: string,
  ) => Promise<{ ok: boolean; plugin?: PluginInfo; error?: string; fallbackUrl?: string }>;
  resolveUrl: (args: PluginResolveUrlArgs) => Promise<MusicUrlRes>;
  invokeMenu: (args: PluginInvokeMenuArgs) => Promise<PluginInvokeMenuResult>;
  matchLyric: (args: PluginMatchLyricArgs) => Promise<PluginMatchLyricResult>;
  matchCover: (args: PluginMatchCoverArgs) => Promise<PluginMatchCoverResult>;
  onStatus: (cb: (info: PluginInfo) => void) => () => void;
}


export interface PluginsConfig {
  enabled: Record<string, boolean>;
  priority: {
    musicUrl: string[];
  };
  perPlugin: Record<string, Record<string, unknown>>;
}
