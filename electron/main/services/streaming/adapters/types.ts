import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type {
  StreamingListParams,
  StreamingPingResult,
  StreamingRuntimeConfig,
} from "@shared/types/streaming";

export interface StreamingAdapter {
  /**
   */
  ping(config: StreamingRuntimeConfig): Promise<StreamingPingResult>;
  /**
   */
  listSongs(config: StreamingRuntimeConfig, params?: StreamingListParams): Promise<Track[]>;
  /**
   */
  listAlbums(config: StreamingRuntimeConfig, params?: StreamingListParams): Promise<Album[]>;
  /**
   */
  listArtists(config: StreamingRuntimeConfig): Promise<Artist[]>;
  /**
   */
  listPlaylists(config: StreamingRuntimeConfig): Promise<Playlist[]>;
  /**
   */
  getAlbumSongs(config: StreamingRuntimeConfig, albumId: string): Promise<Track[]>;
  /**
   */
  getPlaylistSongs(config: StreamingRuntimeConfig, playlistId: string): Promise<Track[]>;
  /**
   */
  getArtistAlbums(config: StreamingRuntimeConfig, artistId: string): Promise<Album[]>;
  /**
   */
  getArtistSongs(config: StreamingRuntimeConfig, artistId: string): Promise<Track[]>;
  /**
   */
  getStreamUrl(
    config: StreamingRuntimeConfig,
    trackId: string,
    playSessionId?: string,
  ): Promise<string>;
  /**
   */
  getLyrics(
    config: StreamingRuntimeConfig,
    trackId: string,
    hint?: { artist?: string; title?: string },
  ): Promise<string | null>;
  /**
   */
  getCoverUrl(config: StreamingRuntimeConfig, coverId: string, size: number): Promise<string>;
}
