import type { PluginsConfig, PluginQuality } from "./plugin";
import type { HotkeyConfig } from "./hotkey";
import type { DownloadLyricFormat, DownloadFolderScheme } from "./download";

export type LocaleCode = "en-US";

export const LOCALES: { value: LocaleCode; label: string }[] = [
  { value: "en-US", label: "English" },
];

export type EqualizerPreset =
  | "flat"
  | "custom"
  | "pop"
  | "rock"
  | "classical"
  | "electronic"
  | "bass"
  | "vocal"
  | "dance"
  | "soft";

export interface EqualizerSettings {
  enabled: boolean;
  preset: EqualizerPreset;
  bands: number[];
  preamp: number;
}

export interface PlayerSettings {
  autoPlay: boolean;
  rememberLastTrack: boolean;
  fadeEnabled: boolean;
  fadeDuration: number;
  outputDevice: string | null;
  volume: number;
  loudnessNormalization: boolean;
  equalizer: EqualizerSettings;
  lyricOffsets: Record<string, number>;
}

export type DiscordDisplayMode = "name" | "state" | "details";

export interface DiscordSettings {
  enabled: boolean;
  showWhenPaused: boolean;
  displayMode: DiscordDisplayMode;
}

export interface LastfmSettings {
  enabled: boolean;
  scrobble: boolean;
  nowPlaying: boolean;
  loveSync: boolean;
}

export interface MediaSettings {
  systemMediaControls: boolean;
  discord: DiscordSettings;
}

export type DesktopLyricAlign = "left" | "center" | "right" | "justify";

export interface DesktopLyricSettings {
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  showTranslation: boolean;
  doubleLine: boolean;
  align: DesktopLyricAlign;
  wordByWord: boolean;
  autoGenerateWordByWord: boolean;
  playedColor: string;
  unplayedColor: string;
  strokeColor: string;
  backgroundMask: boolean;
  backgroundMaskColor: string;
  alwaysShowSongInfo: boolean;
  limitBounds: boolean;
  animation: boolean;
  alwaysOnTop: boolean;
  locked: boolean;
  useCSSDrag: boolean;
}

export type DynamicIslandTransition = "bounce" | "smooth";

export interface DynamicIslandSettings {
  scale: number;
  fontWeight: number;
  fontFamily: string;
  wordByWord: boolean;
  transition: DynamicIslandTransition;
  playedColor: string;
  unplayedColor: string;
  backgroundColor: string;
  alwaysOnTop: boolean;
  snapCentered: boolean;
  notchFusion: boolean;
  nonOcclusive: boolean;
  doubleLine: boolean;
  showTranslation: boolean;
  useCSSDrag: boolean;
}

export type TaskbarLyricPosition = "auto" | "left" | "right";

export type TaskbarLyricColorMode = "taskbar" | "taskbarInverse" | "light" | "dark";

export interface TaskbarLyricSettings {
  position: TaskbarLyricPosition;
  autoMaxWidth: boolean;
  autoAdjustOccupiedSpace: boolean;
  maxWidth: number;
  leftMargin: number;
  rightMargin: number;
  colorMode: TaskbarLyricColorMode;
  showBackground: boolean;
  doubleLine: boolean;
  showTranslation: boolean;
  showCover: boolean;
  wordByWord: boolean;
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
}

export interface LibrarySettings {
  scanDirs: string[];
}

export interface StreamingSettings {
  enabled: boolean;
}

export interface ExternalApiSettings {
  enabled: boolean;
  wsEnabled: boolean;
  allowLan: boolean;
  port: number;
}

export interface McpSettings {
  enabled: boolean;
  port: number;
  accessKey: string;
}

export type NetworkProxyProtocol = "off" | "http" | "https" | "socks5";

export interface NetworkProxySettings {
  protocol: NetworkProxyProtocol;
  host: string;
  port: number;
}

export interface ExternalApiStatus {
  listening: boolean;
  allowLan: boolean;
  host: string | null;
  port: number | null;
  error: { code: string; message: string } | null;
}

export interface McpStatus {
  listening: boolean;
  port: number | null;
  error: { code: string; message: string } | null;
}

export interface McpClientConfigParams {
  port: number;
  accessKey: string;
}

export interface McpAgentApp {
  id: string;
  name: string;
  configPath: string;
  configured: boolean;
  injectable: boolean;
}

export interface OnlineLyricSettings {
  enableOnlineTTMLLyric: boolean;
  amllDbServer: string;
}

export interface LocalLyricSettings {
  enableLocalTTMLOverride: boolean;
  repoDir: string;
}

export interface SongCacheSettings {
  enabled: boolean;
  cacheStreaming: boolean;
  sizeLimitGb: number;
}

export interface CacheSettings {
  dir: string | null;
  songCache: SongCacheSettings;
}

export interface DownloadSettings {
  enabled: boolean;
  dir: string | null;
  quality: PluginQuality;
  usePlaybackForDownload: boolean;
  fileTemplate: string;
  folderScheme: DownloadFolderScheme;
  overwritePolicy: "rename" | "overwrite" | "skip";
  embedCover: boolean;
  embedMeta: boolean;
  embedLyric: boolean;
  writeLrc: boolean;
  saveTtml: boolean;
  lyricFileFormat: DownloadLyricFormat;
}

export interface MainWindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  maximized: boolean;
}

export interface DesktopLyricWindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  visible: boolean;
}

export interface DynamicIslandWindowState {
  mode: "snapped" | "floating";
  x: number | null;
  y: number | null;
  visible: boolean;
}

export interface TaskbarLyricWindowState {
  visible: boolean;
}

export interface WindowStates {
  main: MainWindowState;
  desktopLyric: DesktopLyricWindowState;
  dynamicIsland: DynamicIslandWindowState;
  taskbarLyric: TaskbarLyricWindowState;
}

export type UpdateChannel = "stable" | "beta" | "alpha";

export interface AppUpdateSettings {
  autoCheck: boolean;
  channel: UpdateChannel;
}

export type NeteaseScrobbleMode = "legacy" | "ncbl";

export type KugouLoginVersion = "standard" | "concept";

export interface SystemConfig {
  player: PlayerSettings;
  media: MediaSettings;
  library: LibrarySettings;
  desktopLyric: DesktopLyricSettings;
  dynamicIsland: DynamicIslandSettings;
  taskbarLyric: TaskbarLyricSettings;
  lyric: OnlineLyricSettings;
  localLyric: LocalLyricSettings;
  cache: CacheSettings;
  download: DownloadSettings;
  streaming: StreamingSettings;
  lastfm: LastfmSettings;
  externalApi: ExternalApiSettings;
  mcp: McpSettings;
  update: AppUpdateSettings;
  system: {
    rememberWindowState: boolean;
    borderlessWindow: boolean;
    taskbarProgress: boolean;
    taskbarThumbnailCover: boolean;
    uiZoom: number;
    onboardingCompleted: boolean;
    agreedAgreementVersion: number;
    neteaseRealIp: boolean;
    kugouLoginVersion: KugouLoginVersion;
    networkProxy: NetworkProxySettings;
    neteaseScrobbleEnabled: boolean;
    neteaseScrobbleMode: NeteaseScrobbleMode;
    registerOrpheusProtocol: boolean;
  };
  windowStates: WindowStates;
  plugins: PluginsConfig;
  hotkeys: HotkeyConfig;
}

export interface ConfigApi {
  get: (keyPath: string) => Promise<unknown>;
  set: (keyPath: string, value: unknown) => Promise<void>;
  getAll: () => Promise<SystemConfig>;
  reset: () => Promise<void>;
  replaceAll: (config: unknown) => Promise<void>;
  exportToFile: (payload: unknown) => Promise<{ ok: boolean; reason?: "canceled" | "writeFailed" }>;
  importFromFile: () => Promise<
    { ok: true; data: unknown } | { ok: false; reason: "canceled" | "readFailed" | "parseFailed" }
  >;
}
