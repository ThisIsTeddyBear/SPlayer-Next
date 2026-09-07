import type { Album, Artist, Playlist, Track } from "./player";

export type StreamingServerType =
  "subsonic" | "navidrome" | "opensubsonic" | "airsonic" | "gonic" | "lms" | "jellyfin" | "emby";

export interface StreamingServerConfig {
  id: string;
  name: string;
  type: StreamingServerType;
  url: string;
  username: string;
  hasPassword: boolean;
  lastConnected?: number;
}

export interface StreamingRuntimeConfig extends StreamingServerConfig {
  password: string;
  accessToken?: string;
  userId?: string;
}

export interface StreamingServerInput {
  name: string;
  type: StreamingServerType;
  url: string;
  username: string;
  password: string;
}

export type StreamingErrorCode = "auth" | "network" | "protocol" | "unknown";

export interface StreamingPingResult {
  ok: boolean;
  version?: string;
  error?: string;
  code?: StreamingErrorCode;
}

export type StreamingConnectResult =
  | { ok: true; server: StreamingServerConfig }
  | { ok: false; error: string; code: StreamingErrorCode };

export interface StreamingListParams {
  offset?: number;
  limit?: number;
}

export interface StreamingSearchResult {
  songs: Track[];
  albums: Album[];
  artists: Artist[];
}

export interface StreamingLibrarySnapshot {
  songs: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
}

export interface StreamingApi {
  /**
   */
  loadServers: () => Promise<{
    servers: StreamingServerConfig[];
    activeServerId: string | null;
  }>;
  /**
   */
  addServer: (input: StreamingServerInput) => Promise<StreamingServerConfig>;
  /**
   */
  updateServer: (serverId: string, input: StreamingServerInput) => Promise<StreamingServerConfig>;
  /**
   */
  removeServer: (serverId: string) => Promise<void>;
  /**
   */
  setActiveServer: (serverId: string | null) => Promise<void>;
  /**
   */
  testConnection: (input: StreamingServerInput, serverId?: string) => Promise<StreamingPingResult>;
  /**
   */
  connect: (serverId: string) => Promise<StreamingConnectResult>;
  /**
   */
  disconnect: (serverId: string) => Promise<void>;
  /**
   */
  getSnapshot: (serverId: string) => Promise<StreamingLibrarySnapshot>;
  /**
   */
  sync: (serverId: string, force?: boolean) => Promise<boolean>;
  /**
   */
  onLibraryUpdated: (callback: (serverId: string) => void) => () => void;
  /**
   */
  search: (serverId: string, query: string) => Promise<StreamingSearchResult>;
  /**
   */
  getAlbumSongs: (serverId: string, albumId: string) => Promise<Track[]>;
  /**
   */
  getPlaylistSongs: (serverId: string, playlistId: string) => Promise<Track[]>;
  /**
   */
  getArtistAlbums: (serverId: string, artistId: string) => Promise<Album[]>;
  /**
   */
  getArtistSongs: (serverId: string, artistId: string) => Promise<Track[]>;
  /**
   */
  getStreamUrl: (serverId: string, trackId: string, playSessionId?: string) => Promise<string>;
  /**
   */
  getLyrics: (
    serverId: string,
    trackId: string,
    hint?: { artist?: string; title?: string },
  ) => Promise<string | null>;
}
