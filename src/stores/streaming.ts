import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type {
  StreamingErrorCode,
  StreamingPingResult,
  StreamingSearchResult,
  StreamingServerConfig,
  StreamingServerInput,
} from "@shared/types/streaming";
import * as session from "@/services/streaming/session";
import { removeServerTracks } from "@/stores/queue";

export const useStreamingStore = defineStore("streaming", () => {
  const servers = ref<StreamingServerConfig[]>([]);
  const activeServerId = ref<string | null>(null);
  const connectionStatus = ref<{
    connected: boolean;
    error?: string;
    errorCode?: StreamingErrorCode;
  }>({ connected: false });
  const loading = ref(false);

  const songs = shallowRef<Track[]>([]);
  const albums = shallowRef<Album[]>([]);
  const artists = shallowRef<Artist[]>([]);
  const playlists = shallowRef<Playlist[]>([]);
  let initialized = false;
  let snapshotFetchSeq = 0;

  const activeServer = computed<StreamingServerConfig | null>(
    () => servers.value.find((s) => s.id === activeServerId.value) ?? null,
  );
  const hasServer = computed(() => servers.value.length > 0);
  const isConnected = computed(() => connectionStatus.value.connected);

  const clearMemoryLists = (): void => {
    snapshotFetchSeq += 1;
    songs.value = [];
    albums.value = [];
    artists.value = [];
    playlists.value = [];
  };

  /**
   */
  const addServer = async (input: StreamingServerInput): Promise<StreamingServerConfig> => {
    const server = await window.api.streaming.addServer(toRaw(input));
    servers.value = [...servers.value, server];
    return server;
  };

  /**
   */
  const updateServer = async (
    id: string,
    input: StreamingServerInput,
  ): Promise<StreamingServerConfig> => {
    const updated = await window.api.streaming.updateServer(id, toRaw(input));
    const idx = servers.value.findIndex((server) => server.id === id);
    if (idx < 0) return updated;
    const list = [...servers.value];
    list[idx] = updated;
    servers.value = list;
    return updated;
  };

  /**
   */
  const removeServer = async (id: string): Promise<void> => {
    await window.api.streaming.removeServer(id);
    removeServerTracks(id);
    servers.value = servers.value.filter((s) => s.id !== id);
    if (activeServerId.value === id) {
      activeServerId.value = null;
      connectionStatus.value = { connected: false };
      clearMemoryLists();
    }
  };

  /**
   */
  const testConnection = async (
    input: StreamingServerInput,
    serverId?: string,
  ): Promise<StreamingPingResult> => {
    return window.api.streaming.testConnection(toRaw(input), serverId);
  };

  type ConnectResult = { ok: true } | { ok: false; error: string; code: StreamingErrorCode };

  /**
   */
  const runConnect = async (id: string, isActive: () => boolean): Promise<ConnectResult> => {
    const cfg = servers.value.find((s) => s.id === id);
    if (!cfg) return { ok: false, error: "找不到服务器配置", code: "unknown" };
    const writeStatus = (next: typeof connectionStatus.value): void => {
      if (isActive()) connectionStatus.value = next;
    };
    try {
      const result = await window.api.streaming.connect(id);
      if (result.ok) {
        const index = servers.value.findIndex((server) => server.id === id);
        if (index >= 0) {
          const list = [...servers.value];
          list[index] = result.server;
          servers.value = list;
        }
        writeStatus({ connected: true });
        return { ok: true };
      }
      writeStatus({ connected: false, error: result.error, errorCode: result.code });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const code = "unknown" as const;
      writeStatus({ connected: false, error, errorCode: code });
      return { ok: false, error, code };
    }
  };

  /**
   */
  const connectToServer = async (id: string): Promise<boolean> => {
    const r = await runConnect(id, () => id === activeServerId.value);
    return r.ok;
  };

  /**
   */
  const setActiveServer = async (id: string | null): Promise<void> => {
    if (id !== activeServerId.value) {
      activeServerId.value = id;
      connectionStatus.value = { connected: false };
      clearMemoryLists();
      await window.api.streaming.setActiveServer(id);
    }
    if (!id) return;
    await connectToServer(id);
  };

  const disconnect = (): void => {
    const id = activeServerId.value;
    if (id) void window.api.streaming.disconnect(id);
    connectionStatus.value = { connected: false };
  };

  /**
   */
  const loadLibrarySnapshot = async (serverId: string): Promise<void> => {
    const seq = ++snapshotFetchSeq;
    try {
      const snapshot = await window.api.streaming.getSnapshot(serverId);
      if (seq !== snapshotFetchSeq || activeServerId.value !== serverId) return;
      songs.value = snapshot.songs;
      albums.value = snapshot.albums;
      artists.value = snapshot.artists;
      playlists.value = snapshot.playlists;
    } catch (err) {
      console.error("[streaming] loadLibrarySnapshot failed:", err);
    }
  };

  /**
   */
  const refreshLibrary = async (force = false): Promise<void> => {
    const serverId = activeServerId.value;
    if (!serverId) return;
    loading.value = true;
    try {
      await loadLibrarySnapshot(serverId);
      const started = await window.api.streaming.sync(serverId, force);
      if (!started && activeServerId.value === serverId) loading.value = false;
    } catch (err) {
      if (activeServerId.value === serverId) loading.value = false;
      console.error("[streaming] refreshLibrary failed:", err);
    }
  };

  /**
   */
  const fetchAlbumSongs = (albumId: string): Promise<Track[]> =>
    activeServerId.value
      ? window.api.streaming.getAlbumSongs(activeServerId.value, albumId)
      : Promise.reject(new Error("没有激活的流媒体服务器"));

  /**
   */
  const fetchPlaylistSongs = (playlistId: string): Promise<Track[]> =>
    activeServerId.value
      ? window.api.streaming.getPlaylistSongs(activeServerId.value, playlistId)
      : Promise.reject(new Error("没有激活的流媒体服务器"));

  /**
   */
  const fetchArtistAlbums = (artistId: string): Promise<Album[]> =>
    activeServerId.value
      ? window.api.streaming.getArtistAlbums(activeServerId.value, artistId)
      : Promise.reject(new Error("没有激活的流媒体服务器"));

  /**
   */
  const fetchArtistSongs = (artistId: string): Promise<Track[]> =>
    activeServerId.value
      ? window.api.streaming.getArtistSongs(activeServerId.value, artistId)
      : Promise.reject(new Error("没有激活的流媒体服务器"));

  /**
   */
  const search = (query: string): Promise<StreamingSearchResult> =>
    activeServerId.value
      ? window.api.streaming.search(activeServerId.value, query)
      : Promise.reject(new Error("没有激活的流媒体服务器"));

  /**
   */
  const getStreamUrl = async (track: Track, opts?: { playSessionId?: string }): Promise<string> => {
    if (track.source !== "streaming" || !track.serverId || !track.originalId) {
      throw new Error("非流媒体 Track");
    }
    const cfg = servers.value.find((server) => server.id === track.serverId);
    if (!cfg) throw new Error("找不到服务器配置");
    if (cfg.id === activeServerId.value && !connectionStatus.value.connected) {
      const result = await runConnect(cfg.id, () => cfg.id === activeServerId.value);
      if (!result.ok) throw new Error(result.error);
    }
    const sessionId = opts?.playSessionId ?? session.sessionIdForTrack(track.id);
    return window.api.streaming.getStreamUrl(cfg.id, track.originalId!, sessionId);
  };

  const init = async (): Promise<void> => {
    if (initialized) return;
    window.api.streaming.onLibraryUpdated(async (serverId) => {
      if (serverId !== activeServerId.value) return;
      await loadLibrarySnapshot(serverId);
      if (serverId === activeServerId.value) loading.value = false;
    });
    const result = await window.api.streaming.loadServers();
    servers.value = result.servers;
    activeServerId.value = result.activeServerId;
    if (activeServerId.value && !servers.value.find((s) => s.id === activeServerId.value)) {
      activeServerId.value = null;
    }
    initialized = true;
    if (activeServerId.value) void connectToServer(activeServerId.value);
  };

  return {
    servers,
    activeServerId,
    activeServer,
    connectionStatus,
    loading,
    hasServer,
    isConnected,
    songs,
    albums,
    artists,
    playlists,
    init,
    addServer,
    updateServer,
    removeServer,
    setActiveServer,
    connectToServer,
    disconnect,
    testConnection,
    refreshLibrary,
    fetchAlbumSongs,
    fetchPlaylistSongs,
    fetchArtistAlbums,
    fetchArtistSongs,
    search,
    getStreamUrl,
  };
});
