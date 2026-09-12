import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { RendererRuntime } from "@shared/types/runtime";
import type { ExternalApiStatus, McpStatus, TaskbarLyricSettings } from "@shared/types/settings";
import type {
  PluginInfo,
  PluginResolveUrlArgs,
  PluginInvokeMenuArgs,
  PluginMatchLyricArgs,
  PluginMatchCoverArgs,
} from "@shared/types/plugin";
import type { HotkeyActionId, HotkeyBinding, HotkeyConflict } from "@shared/types/hotkey";
import type { LoadOptions, TrackSource } from "@shared/types/player";
import type { StreamingServerInput } from "@shared/types/streaming";
import type { RecognitionConfig, RecognitionEvent } from "@shared/types/recognition";
import type { PlayEventInput, FavoriteEventInput } from "@shared/types/stats";
import type {
  MetadataProvider,
  MetadataSearchQuery,
  TagEditRequest,
} from "@shared/types/tagEditor";
import type { UpdateEvent } from "@shared/types/update";
import type { AiModelSaveInput } from "@shared/types/ai";
import type { DesktopLyricUnlockButtonBounds } from "@shared/types/window";
import type {
  LegacyPlaylistRecord,
  PlaylistCreateInput,
  PlaylistUpdateInput,
} from "@shared/types/playlist";
import type { CjkTransformMode } from "@shared/types/opencc";

const subscribe = <T>(channel: string, callback: (data: T) => void): (() => void) => {
  const handler = (_event: Electron.IpcRendererEvent, data: T): void => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const runtimePrefix = "--splayer-runtime=";
const runtimeArgument = process.argv.find((argument) => argument.startsWith(runtimePrefix));
if (!runtimeArgument) throw new Error("Missing renderer runtime configuration");
const runtime = JSON.parse(
  decodeURIComponent(runtimeArgument.slice(runtimePrefix.length)),
) as RendererRuntime;

const api = {
  config: {
    get: (keyPath: string) => ipcRenderer.invoke("config:get", keyPath),
    set: (keyPath: string, value: unknown) => ipcRenderer.invoke("config:set", keyPath, value),
    getAll: () => ipcRenderer.invoke("config:getAll"),
    reset: () => ipcRenderer.invoke("config:reset"),
    replaceAll: (config: unknown) => ipcRenderer.invoke("config:replaceAll", config),
    exportToFile: (
      payload: unknown,
    ): Promise<{ ok: boolean; reason?: "canceled" | "writeFailed" }> =>
      ipcRenderer.invoke("config:exportToFile", payload),
    importFromFile: (): Promise<
      { ok: true; data: unknown } | { ok: false; reason: "canceled" | "readFailed" | "parseFailed" }
    > => ipcRenderer.invoke("config:importFromFile"),
  },
  player: {
    load: (source: string, options?: LoadOptions) =>
      ipcRenderer.invoke("player:load", source, options ?? {}),
    play: () => ipcRenderer.invoke("player:play"),
    pause: () => ipcRenderer.invoke("player:pause"),
    stop: () => ipcRenderer.invoke("player:stop"),
    seek: (position: number) => ipcRenderer.invoke("player:seek", position),
    setVolume: (volume: number) => ipcRenderer.invoke("player:setVolume", volume),
    setPauseOnDeviceSwitch: (enabled: boolean) =>
      ipcRenderer.invoke("player:setPauseOnDeviceSwitch", enabled),
    getVolume: () => ipcRenderer.invoke("player:getVolume"),
    setFadeDuration: (ms: number) => ipcRenderer.invoke("player:setFadeDuration", ms),
    getFadeDuration: () => ipcRenderer.invoke("player:getFadeDuration"),
    getStatus: () => ipcRenderer.invoke("player:getStatus"),
    getFftData: () => ipcRenderer.invoke("player:getFftData"),
    setFftEnabled: (enabled: boolean) => ipcRenderer.invoke("player:setFftEnabled", enabled),
    setNormalizationEnabled: (enabled: boolean) =>
      ipcRenderer.invoke("player:setNormalizationEnabled", enabled),
    setEqualizerEnabled: (enabled: boolean) =>
      ipcRenderer.invoke("player:setEqualizerEnabled", enabled),
    setEqualizerBands: (gainsDb: number[]) =>
      ipcRenderer.invoke("player:setEqualizerBands", gainsDb),
    setPreampGain: (preampDb: number) => ipcRenderer.invoke("player:setPreampGain", preampDb),
    setSpeed: (speed: number) => ipcRenderer.invoke("player:setSpeed", speed),
    setPitch: (semitones: number) => ipcRenderer.invoke("player:setPitch", semitones),
    setPitchSync: (sync: boolean) => ipcRenderer.invoke("player:setPitchSync", sync),
    reinit: () => ipcRenderer.invoke("player:reinit"),
    getOutputDevices: () => ipcRenderer.invoke("player:getOutputDevices"),
    getDefaultDeviceName: () => ipcRenderer.invoke("player:getDefaultDeviceName"),
    setOutputDevice: (deviceId: string | null, pauseBeforeSwitch = false) =>
      ipcRenderer.invoke("player:setOutputDevice", deviceId, pauseBeforeSwitch),
    setExclusiveAudio: (enabled: boolean) =>
      ipcRenderer.invoke("player:setExclusiveAudio", enabled),
    getSelectedDeviceName: () => ipcRenderer.invoke("player:getSelectedDeviceName"),
    getCoverRaw: () => ipcRenderer.invoke("player:getCoverRaw"),
    readLyricFile: (filePath: string) => ipcRenderer.invoke("player:readLyricFile", filePath),
    syncPlayMode: (repeatMode: string, shuffleMode: string) =>
      ipcRenderer.send("player:syncPlayMode", repeatMode, shuffleMode),
    syncLikeState: (liked: boolean) => ipcRenderer.send("player:syncLikeState", liked),
    dispatch: (type: string) => ipcRenderer.send("player:dispatch", type),
    onEvent: (callback: (event: unknown) => void) => subscribe("player:event", callback),
  },
  system: {
    installType: runtime.installType,
    platform: process.platform,
    osInfo: runtime.osInfo,
    toggleDevTools: () => ipcRenderer.invoke("system:toggleDevTools"),
    showInExplorer: (filePath: string) => ipcRenderer.invoke("system:showInExplorer", filePath),
    openLogsDir: () => ipcRenderer.invoke("system:openLogsDir"),
    setLocale: (locale: string) => ipcRenderer.send("system:setLocale", locale),
    focusMainWindow: () => ipcRenderer.invoke("system:focusMainWindow"),
    openSettings: (category?: string, highlight?: string) =>
      ipcRenderer.invoke("system:openSettings", category, highlight),
    onOpenSettings: (callback: (payload: { category?: string; highlight?: string }) => void) =>
      subscribe<{ category?: string; highlight?: string }>("system:openSettings", callback),
    listFonts: () => ipcRenderer.invoke("system:listFonts"),
    fetchRemoteBytes: (url: string) => ipcRenderer.invoke("system:fetchRemoteBytes", url),
    saveFile: (data: ArrayBuffer, defaultName: string) =>
      ipcRenderer.invoke("system:saveFile", data, defaultName),
    relaunch: () => ipcRenderer.invoke("system:relaunch"),
    testNetworkProxy: () => ipcRenderer.invoke("system:testNetworkProxy"),
    onProtocolUrl: (callback: (url: string) => void) =>
      subscribe<string>("protocol:orpheus", callback),
    consumePendingProtocolUrl: (): Promise<string | null> =>
      ipcRenderer.invoke("system:consumePendingProtocolUrl"),
    onOpenFiles: (callback: (files: string[]) => void) =>
      subscribe<string[]>("system:open-files", callback),
    consumePendingAudioFiles: (): Promise<string[]> =>
      ipcRenderer.invoke("system:consumePendingAudioFiles"),
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  },
  library: {
    scan: (incremental?: boolean) => ipcRenderer.invoke("library:scan", incremental),
    cancelScan: () => ipcRenderer.invoke("library:cancelScan"),
    getTracks: () => ipcRenderer.invoke("library:getTracks"),
    getAlbums: () => ipcRenderer.invoke("library:getAlbums"),
    getArtists: () => ipcRenderer.invoke("library:getArtists"),
    prefetchArtistImages: (artistNames: string[]) =>
      ipcRenderer.invoke("library:prefetchArtistImages", artistNames),
    onArtistImage: (callback: (value: { artistName: string; image: string }) => void) => {
      ipcRenderer.removeAllListeners("library:artistImage");
      return subscribe("library:artistImage", callback);
    },
    getAlbumTracks: (albumName: string) => ipcRenderer.invoke("library:getAlbumTracks", albumName),
    getArtistTracks: (artistName: string) =>
      ipcRenderer.invoke("library:getArtistTracks", artistName),
    getTracksByIds: (ids: string[]) => ipcRenderer.invoke("library:getTracksByIds", ids),
    searchTracks: (query: string) => ipcRenderer.invoke("library:searchTracks", query),
    getTrackCount: () => ipcRenderer.invoke("library:getTrackCount"),
    getRandomTrack: () => ipcRenderer.invoke("library:getRandomTrack"),
    getRandomTracks: (limit: number) => ipcRenderer.invoke("library:getRandomTracks", limit),
    isScanning: () => ipcRenderer.invoke("library:isScanning"),
    addScanDir: () => ipcRenderer.invoke("library:addScanDir"),
    removeScanDir: (dir: string) => ipcRenderer.invoke("library:removeScanDir", dir),
    getScanDirs: () => ipcRenderer.invoke("library:getScanDirs"),
    deleteTracks: (paths: string[]) => ipcRenderer.invoke("library:deleteTracks", paths),
    readTags: (path: string) => ipcRenderer.invoke("library:readTags", path),
    writeTags: (edits: TagEditRequest[]) => ipcRenderer.invoke("library:writeTags", edits),
    pickCoverImage: () => ipcRenderer.invoke("library:pickCoverImage"),
    searchMetadata: (query: MetadataSearchQuery) =>
      ipcRenderer.invoke("library:searchMetadata", query),
    getMetadataDetail: (provider: MetadataProvider, id: string) =>
      ipcRenderer.invoke("library:getMetadataDetail", provider, id),
    onScanProgress: (callback: (progress: unknown) => void) =>
      subscribe("library:scanProgress", callback),
  },
  playlist: {
    list: () => ipcRenderer.invoke("playlist:list"),
    get: (id: string) => ipcRenderer.invoke("playlist:get", id),
    create: (input: PlaylistCreateInput) => ipcRenderer.invoke("playlist:create", input),
    update: (id: string, input: PlaylistUpdateInput) =>
      ipcRenderer.invoke("playlist:update", id, input),
    remove: (id: string) => ipcRenderer.invoke("playlist:remove", id),
    addTracks: (id: string, trackIds: string[]) =>
      ipcRenderer.invoke("playlist:addTracks", id, trackIds),
    removeTracks: (id: string, trackIds: string[]) =>
      ipcRenderer.invoke("playlist:removeTracks", id, trackIds),
    importLegacy: (records: LegacyPlaylistRecord[]) =>
      ipcRenderer.invoke("playlist:importLegacy", records),
    clear: () => ipcRenderer.invoke("playlist:clear"),
  },
  window: {
    toggleDesktopLyric: () => ipcRenderer.invoke("window:toggleDesktopLyric"),
    closeDesktopLyric: () => ipcRenderer.invoke("window:closeDesktopLyric"),
    isDesktopLyricOpen: () => ipcRenderer.invoke("window:isDesktopLyricOpen"),
    onDesktopLyricVisibilityChange: (callback: (open: boolean) => void) =>
      subscribe<boolean>("desktopLyric:visibilityChange", callback),
    toggleDynamicIsland: () => ipcRenderer.invoke("window:toggleDynamicIsland"),
    closeDynamicIsland: () => ipcRenderer.invoke("window:closeDynamicIsland"),
    isDynamicIslandOpen: () => ipcRenderer.invoke("window:isDynamicIslandOpen"),
    onDynamicIslandVisibilityChange: (callback: (open: boolean) => void) =>
      subscribe<boolean>("dynamicIsland:visibilityChange", callback),
    toggleTaskbarLyric: () => ipcRenderer.invoke("window:toggleTaskbarLyric"),
    closeTaskbarLyric: () => ipcRenderer.invoke("window:closeTaskbarLyric"),
    isTaskbarLyricOpen: () => ipcRenderer.invoke("window:isTaskbarLyricOpen"),
    onTaskbarLyricVisibilityChange: (callback: (open: boolean) => void) =>
      subscribe<boolean>("taskbarLyric:visibilityChange", callback),
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggleMaximize"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
    onMaximizeChange: (callback: (maximized: boolean) => void) =>
      subscribe<boolean>("window:maximizeChange", callback),
    toggleFullscreen: () => ipcRenderer.send("window:toggleFullscreen"),
    isFullscreen: () => ipcRenderer.invoke("window:isFullscreen"),
    onFullscreenChange: (callback: (fullscreen: boolean) => void) =>
      subscribe<boolean>("window:fullscreenChange", callback),
    hide: () => ipcRenderer.send("window:hide"),
    quit: () => ipcRenderer.send("window:quit"),
  },
  desktopLyric: {
    onConfigChange: (callback: (config: unknown) => void) =>
      subscribe("desktopLyric:configChange", callback),
    setHeight: (height: number) => ipcRenderer.invoke("desktopLyric:setHeight", height),
    setUnlockButtonBounds: (bounds: DesktopLyricUnlockButtonBounds) =>
      ipcRenderer.send("desktopLyric:setUnlockButtonBounds", bounds),
    move: (x: number, y: number) => ipcRenderer.send("desktopLyric:move", x, y),
    saveState: () => ipcRenderer.send("desktopLyric:saveState"),
    onCursorInside: (callback: (inside: boolean) => void) =>
      subscribe<boolean>("desktopLyric:cursorInside", callback),
  },
  dynamicIsland: {
    onConfigChange: (callback: (config: unknown) => void) =>
      subscribe("dynamicIsland:configChange", callback),
    move: (x: number, y: number) => ipcRenderer.send("dynamicIsland:move", x, y),
    saveState: () => ipcRenderer.send("dynamicIsland:saveState"),
    resize: (width: number) => ipcRenderer.send("dynamicIsland:resize", width),
    setShape: (width: number | null) => ipcRenderer.send("dynamicIsland:setShape", width),
    setHeight: (height: number) => ipcRenderer.send("dynamicIsland:setHeight", height),
    getMode: () => ipcRenderer.invoke("dynamicIsland:getMode"),
    onModeChange: (callback: (mode: "snapped" | "floating") => void) =>
      subscribe<"snapped" | "floating">("dynamicIsland:modeChange", callback),
    onCursorInside: (callback: (inside: boolean) => void) =>
      subscribe<boolean>("dynamicIsland:cursorInside", callback),
  },
  taskbarLyric: {
    setContentWidth: (width: number) => ipcRenderer.send("taskbarLyric:setContentWidth", width),
    onLayout: (
      callback: (data: {
        isCentered: boolean;
        systemType: string;
        isLight: boolean;
        anchor: "left" | "right";
        maxWidth: number;
      }) => void,
    ) =>
      subscribe<{
        isCentered: boolean;
        systemType: string;
        isLight: boolean;
        anchor: "left" | "right";
        maxWidth: number;
      }>("taskbarLyric:layout", callback),
    onConfigChange: (callback: (config: TaskbarLyricSettings) => void) =>
      subscribe<TaskbarLyricSettings>("taskbarLyric:configChange", callback),
  },
  plugins: {
    list: () => ipcRenderer.invoke("plugin:list"),
    install: (filePath: string) => ipcRenderer.invoke("plugin:install", filePath),
    pickAndInstall: () => ipcRenderer.invoke("plugin:pickAndInstall"),
    installFromUrl: (url: string) => ipcRenderer.invoke("plugin:installFromUrl", url),
    uninstall: (id: string) => ipcRenderer.invoke("plugin:uninstall", id),
    setEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke("plugin:setEnabled", id, enabled),
    setSetting: (id: string, key: string, value: unknown) =>
      ipcRenderer.invoke("plugin:setSetting", id, key, value),
    checkUpdate: (id: string) => ipcRenderer.invoke("plugin:checkUpdate", id),
    applyUpdate: (id: string) => ipcRenderer.invoke("plugin:applyUpdate", id),
    resolveUrl: (args: PluginResolveUrlArgs) => ipcRenderer.invoke("plugin:resolveUrl", args),
    invokeMenu: (args: PluginInvokeMenuArgs) => ipcRenderer.invoke("plugin:invokeMenu", args),
    matchLyric: (args: PluginMatchLyricArgs) => ipcRenderer.invoke("plugin:matchLyric", args),
    matchCover: (args: PluginMatchCoverArgs) => ipcRenderer.invoke("plugin:matchCover", args),
    onStatus: (callback: (info: PluginInfo) => void) =>
      subscribe<PluginInfo>("plugin:status", callback),
  },
  apis: {
    call: (platform: string, name: string, params?: Record<string, unknown>) =>
      ipcRenderer.invoke("apis:call", platform, name, params ?? {}),
    clearSession: (platform: string) => ipcRenderer.invoke("apis:clearSession", platform),
    openLoginWeb: (platform: string) => ipcRenderer.invoke("apis:openLoginWeb", platform),
    setCookie: (platform: string, cookie: string) =>
      ipcRenderer.invoke("apis:setCookie", platform, cookie),
  },
  lyrics: {
    romanize: (lines: string[]) => ipcRenderer.invoke("lyrics:romanize", lines),
    matchById: (platform: string, id: string) =>
      ipcRenderer.invoke("lyrics:matchById", platform, id),
    matchByQuery: (platform: string, track: unknown) =>
      ipcRenderer.invoke("lyrics:matchByQuery", platform, track),
    fetchTTMLOverlay: (track: unknown, platform: string) =>
      ipcRenderer.invoke("lyrics:fetchTTMLOverlay", track, platform),
    matchLocalTTML: (track: unknown) => ipcRenderer.invoke("lyrics:matchLocalTTML", track),
    pickLyricRepoDir: () => ipcRenderer.invoke("lyrics:pickLyricRepoDir"),
  },
  opencc: {
    convert: (text: string, config: CjkTransformMode): Promise<string> =>
      ipcRenderer.invoke("opencc:convert", text, config),
    convertBatch: (texts: string[], config: CjkTransformMode): Promise<string[]> =>
      ipcRenderer.invoke("opencc:convertBatch", texts, config),
  },
  download: {
    start: (req: unknown) => ipcRenderer.invoke("download:start", req),
    startMany: (reqs: unknown[]) => ipcRenderer.invoke("download:startMany", reqs),
    cancel: (taskId: string) => ipcRenderer.invoke("download:cancel", taskId),
    retry: (req: unknown) => ipcRenderer.invoke("download:retry", req),
    submitResolution: (taskId: string, res: unknown) =>
      ipcRenderer.invoke("download:resolution", taskId, res),
    failResolution: (taskId: string) => ipcRenderer.invoke("download:resolveFailed", taskId),
    remove: (taskId: string) => ipcRenderer.invoke("download:remove", taskId),
    clearFinished: () => ipcRenderer.invoke("download:clearFinished"),
    list: () => ipcRenderer.invoke("download:list"),
    pickDir: () => ipcRenderer.invoke("download:pickDir"),
    getDir: () => ipcRenderer.invoke("download:getDir"),
    resetDir: () => ipcRenderer.invoke("download:resetDir"),
    onProgress: (callback: (data: unknown) => void) => subscribe("download:progress", callback),
    onState: (callback: (task: unknown) => void) => subscribe("download:state", callback),
    onResolve: (callback: (payload: unknown) => void) => {
      ipcRenderer.removeAllListeners("download:resolve");
      return subscribe("download:resolve", callback);
    },
  },
  nowPlaying: {
    update: (payload: unknown) => ipcRenderer.send("nowPlaying:update", payload),
    requestSnapshot: () => ipcRenderer.invoke("nowPlaying:requestSnapshot"),
    setLyricOffset: (trackId: string, offsetMs: number) =>
      ipcRenderer.send("nowPlaying:setLyricOffset", trackId, offsetMs),
    onTrackChange: (callback: (data: unknown) => void) =>
      subscribe("nowPlaying:track-change", callback),
    onLyricChange: (callback: (snapshot: unknown) => void) =>
      subscribe("nowPlaying:lyric-change", callback),
    onPositionSync: (callback: (data: unknown) => void) =>
      subscribe("nowPlaying:position-sync", callback),
    onLyricOffsetChange: (callback: (data: unknown) => void) =>
      subscribe("nowPlaying:lyric-offset-change", callback),
  },
  theme: {
    pickBackgroundImage: (): Promise<string | null> =>
      ipcRenderer.invoke("theme:pickBackgroundImage"),
    clearBackgroundImages: (): Promise<void> => ipcRenderer.invoke("theme:clearBackgroundImages"),
  },
  cache: {
    getStats: () => ipcRenderer.invoke("cache:getStats"),
    clear: (id: string) => ipcRenderer.invoke("cache:clear", id),
    clearAllByKind: (kind: "file" | "db") => ipcRenderer.invoke("cache:clearAllByKind", kind),
    getDir: () => ipcRenderer.invoke("cache:getDir"),
    pickDir: () => ipcRenderer.invoke("cache:pickDir"),
    resetDir: () => ipcRenderer.invoke("cache:resetDir"),
    song: {
      lookup: (cacheKey: string): Promise<string | null> =>
        ipcRenderer.invoke("cache:song:lookup", cacheKey),
      fetch: (cacheKey: string, source: TrackSource, streamUrl: string): Promise<string | null> =>
        ipcRenderer.invoke("cache:song:fetch", cacheKey, source, streamUrl),
      cancel: (cacheKey: string): Promise<void> =>
        ipcRenderer.invoke("cache:song:cancel", cacheKey),
    },
  },
  streaming: {
    loadServers: () => ipcRenderer.invoke("streaming:loadServers"),
    /**
     */
    addServer: (input: StreamingServerInput) => ipcRenderer.invoke("streaming:addServer", input),
    /**
     */
    updateServer: (serverId: string, input: StreamingServerInput) =>
      ipcRenderer.invoke("streaming:updateServer", serverId, input),
    /**
     */
    removeServer: (serverId: string) => ipcRenderer.invoke("streaming:removeServer", serverId),
    /**
     */
    setActiveServer: (serverId: string | null) =>
      ipcRenderer.invoke("streaming:setActiveServer", serverId),
    /**
     */
    testConnection: (input: StreamingServerInput, serverId?: string) =>
      ipcRenderer.invoke("streaming:testConnection", input, serverId),
    /**
     */
    connect: (serverId: string) => ipcRenderer.invoke("streaming:connect", serverId),
    /**
     */
    disconnect: (serverId: string) => ipcRenderer.invoke("streaming:disconnect", serverId),
    getSnapshot: (serverId: string) => ipcRenderer.invoke("streaming:getSnapshot", serverId),
    sync: (serverId: string, force?: boolean): Promise<boolean> =>
      ipcRenderer.invoke("streaming:sync", serverId, force),
    /**
     */
    onLibraryUpdated: (callback: (serverId: string) => void) => {
      ipcRenderer.removeAllListeners("streaming:libraryUpdated");
      return subscribe<string>("streaming:libraryUpdated", callback);
    },
    search: (serverId: string, query: string) =>
      ipcRenderer.invoke("streaming:search", serverId, query),
    getAlbumSongs: (serverId: string, albumId: string) =>
      ipcRenderer.invoke("streaming:getAlbumSongs", serverId, albumId),
    getPlaylistSongs: (serverId: string, playlistId: string) =>
      ipcRenderer.invoke("streaming:getPlaylistSongs", serverId, playlistId),
    getArtistAlbums: (serverId: string, artistId: string) =>
      ipcRenderer.invoke("streaming:getArtistAlbums", serverId, artistId),
    getArtistSongs: (serverId: string, artistId: string) =>
      ipcRenderer.invoke("streaming:getArtistSongs", serverId, artistId),
    /**
     */
    getStreamUrl: (serverId: string, trackId: string, playSessionId?: string) =>
      ipcRenderer.invoke("streaming:getStreamUrl", serverId, trackId, playSessionId),
    /**
     */
    getLyrics: (serverId: string, trackId: string, hint?: { artist?: string; title?: string }) =>
      ipcRenderer.invoke("streaming:getLyrics", serverId, trackId, hint),
  },
  recognition: {
    isSupported: () => ipcRenderer.invoke("recognition:isSupported"),
    /**
     */
    start: (config: RecognitionConfig) => ipcRenderer.invoke("recognition:start", config),
    cancel: () => ipcRenderer.invoke("recognition:cancel"),
    /**
     */
    onEvent: (callback: (event: RecognitionEvent) => void) => {
      ipcRenderer.removeAllListeners("recognition:event");
      return subscribe<RecognitionEvent>("recognition:event", callback);
    },
  },
  lastfm: {
    connect: () => ipcRenderer.invoke("lastfm:connect"),
    cancelConnect: () => ipcRenderer.invoke("lastfm:cancelConnect"),
    disconnect: () => ipcRenderer.invoke("lastfm:disconnect"),
    getStatus: () => ipcRenderer.invoke("lastfm:getStatus"),
    love: (artist: string, track: string, loved: boolean) =>
      ipcRenderer.invoke("lastfm:love", artist, track, loved),
  },
  externalApi: {
    getAccessKey: () => ipcRenderer.invoke("externalApi:getAccessKey"),
    rotateAccessKey: () => ipcRenderer.invoke("externalApi:rotateAccessKey"),
    restart: () => ipcRenderer.invoke("externalApi:restart"),
    getStatus: () => ipcRenderer.invoke("externalApi:getStatus"),
    onStatus: (callback: (status: ExternalApiStatus) => void) => {
      ipcRenderer.removeAllListeners("externalApi:status");
      return subscribe<ExternalApiStatus>("externalApi:status", callback);
    },
  },
  mcp: {
    restart: () => ipcRenderer.invoke("mcp:restart"),
    getStatus: () => ipcRenderer.invoke("mcp:getStatus"),
    getClientConfigParams: () => ipcRenderer.invoke("mcp:getClientConfigParams"),
    detectAgents: () => ipcRenderer.invoke("mcp:detectAgents"),
    injectAgentConfig: (agentId: string, params: any) =>
      ipcRenderer.invoke("mcp:injectAgentConfig", agentId, params),
    onStatus: (callback: (status: McpStatus) => void) => {
      ipcRenderer.removeAllListeners("mcp:status");
      return subscribe<McpStatus>("mcp:status", callback);
    },
  },
  aiModel: {
    list: () => ipcRenderer.invoke("aiModel:list"),
    save: (input: AiModelSaveInput) => ipcRenderer.invoke("aiModel:save", input),
    remove: (id: string) => ipcRenderer.invoke("aiModel:remove", id),
    setActive: (id: string | null) => ipcRenderer.invoke("aiModel:setActive", id),
  },
  update: {
    check: (manual: boolean) => ipcRenderer.invoke("update:check", manual),
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
    openDownloadPage: () => ipcRenderer.invoke("update:openDownloadPage"),
    onEvent: (callback: (event: UpdateEvent) => void) => subscribe("update:event", callback),
  },
  stats: {
    recordPlay: (event: PlayEventInput) => ipcRenderer.send("stats:recordPlay", event),
    recordFavorite: (event: FavoriteEventInput) => ipcRenderer.send("stats:recordFavorite", event),
    getStatsSummary: () => ipcRenderer.invoke("stats:getStatsSummary"),
    getTopTracks: (limit: number) => ipcRenderer.invoke("stats:getTopTracks", limit),
    getLibraryStats: () => ipcRenderer.invoke("stats:getLibraryStats"),
    getPlayHistoryDaily: (days: number) => ipcRenderer.invoke("stats:getPlayHistoryDaily", days),
    getPlayHistoryHourly: () => ipcRenderer.invoke("stats:getPlayHistoryHourly"),
    getTopAlbums: (limit: number) => ipcRenderer.invoke("stats:getTopAlbums", limit),
    getTopArtists: (limit: number) => ipcRenderer.invoke("stats:getTopArtists", limit),
  },
  hotkey: {
    getAll: () => ipcRenderer.invoke("hotkey:getAll"),
    set: (id: HotkeyActionId, binding: HotkeyBinding) =>
      ipcRenderer.invoke("hotkey:set", id, binding),
    reset: (id?: HotkeyActionId) => ipcRenderer.invoke("hotkey:reset", id),
    setGlobalEnabled: (enabled: boolean) => ipcRenderer.invoke("hotkey:setGlobalEnabled", enabled),
    probe: (accelerator: string) => ipcRenderer.invoke("hotkey:probe", accelerator),
    getConflicts: () => ipcRenderer.invoke("hotkey:getConflicts"),
    onTrigger: (callback: (id: HotkeyActionId) => void) =>
      subscribe<HotkeyActionId>("hotkey:trigger", callback),
    onConflicts: (callback: (conflicts: HotkeyConflict[]) => void) =>
      subscribe<HotkeyConflict[]>("hotkey:conflicts", callback),
  },
};

contextBridge.exposeInMainWorld("electron", { process: { versions: process.versions } });
contextBridge.exposeInMainWorld("api", api);
