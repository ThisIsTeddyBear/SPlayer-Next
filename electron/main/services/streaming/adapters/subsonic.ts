import { createHash, randomBytes } from "node:crypto";
import type { Album, Artist, Playlist, Track } from "@shared/types/player";
import type { StreamingPingResult } from "@shared/types/streaming";
import type { StreamingRuntimeConfig } from "@shared/types/streaming";
import type { StreamingAdapter } from "./types";

const API_VERSION = "1.16.1";
const CLIENT_NAME = "SPlayer-Next";
const REQUEST_TIMEOUT_MS = 15_000;

interface SubsonicSong {
  id: string;
  title: string;
  artist?: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  duration?: number;
  bitRate?: number;
  samplingRate?: number;
  bitDepth?: number;
  channelCount?: number;
  suffix?: string;
  size?: number;
  coverArt?: string;
  artists?: { id?: string; name: string }[];
  displayArtist?: string;
}

interface SubsonicAlbum {
  id: string;
  name: string;
  artist?: string;
  coverArt?: string;
  songCount?: number;
  year?: number;
  displayArtist?: string;
  song?: SubsonicSong[];
}

interface SubsonicArtist {
  id: string;
  name: string;
  albumCount?: number;
  coverArt?: string;
}

interface SubsonicPlaylist {
  id: string;
  name: string;
  comment?: string;
  songCount?: number;
  coverArt?: string;
  owner?: string;
  entry?: SubsonicSong[];
}

/**
 */
const buildAuth = (config: StreamingRuntimeConfig): URLSearchParams => {
  const salt = randomBytes(6).toString("hex");
  return new URLSearchParams({
    u: config.username,
    t: createHash("md5")
      .update(config.password + salt)
      .digest("hex"),
    s: salt,
    v: API_VERSION,
    c: CLIENT_NAME,
    f: "json",
  });
};

/**
 */
const buildUrl = (
  config: StreamingRuntimeConfig,
  endpoint: string,
  extra: Record<string, string | number> = {},
): string => {
  const params = buildAuth(config);
  for (const [key, value] of Object.entries(extra)) params.set(key, String(value));
  return `${config.url.replace(/\/+$/, "")}/rest/${endpoint}?${params.toString()}`;
};

/**
 */
const callApi = async <T>(
  config: StreamingRuntimeConfig,
  endpoint: string,
  extra?: Record<string, string | number>,
): Promise<T> => {
  const response = await fetch(buildUrl(config, endpoint, extra), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${endpoint}: HTTP ${response.status}`);
  const body = (await response.json()) as { "subsonic-response"?: Record<string, unknown> };
  const result = body["subsonic-response"];
  if (!result) throw new Error("响应缺少 subsonic-response 包装");
  if (result.status !== "ok") {
    const error = result.error as { code?: number; message?: string } | undefined;
    throw new Error(error?.message ?? `Subsonic error code ${error?.code}`);
  }
  return result as T;
};

/**
 */
const coverUrl = (
  config: StreamingRuntimeConfig,
  coverId: string | undefined,
  size: number,
): string | undefined => {
  if (!coverId) return undefined;
  const params = new URLSearchParams({ serverId: config.id, coverId, size: String(size) });
  return `streaming-cover://image?${params.toString()}`;
};

/**
 */
const toTrack = (config: StreamingRuntimeConfig, song: SubsonicSong): Track => {
  const artists = song.artists?.length
    ? song.artists.map((artist) => ({ id: artist.id, name: artist.name }))
    : (song.displayArtist ?? song.artist ?? "").trim()
      ? [{ id: song.artistId, name: (song.displayArtist ?? song.artist ?? "").trim() }]
      : [];
  return {
    id: `${config.id}:${song.id}`,
    source: "streaming",
    serverId: config.id,
    originalId: song.id,
    title: song.title || "",
    artists,
    album: song.album ? { id: song.albumId, name: song.album } : undefined,
    duration: Math.round((song.duration ?? 0) * 1000),
    cover: coverUrl(config, song.coverArt, 300),
    coverOriginal: coverUrl(config, song.coverArt, 1500),
    fileSize: song.size,
    quality: {
      sampleRate: song.samplingRate ?? 0,
      channels: song.channelCount ?? 2,
      bitsPerSample: song.bitDepth ?? 0,
      bitRate: song.bitRate ? song.bitRate * 1000 : 0,
      codec: song.suffix ?? "",
    },
  };
};

/**
 */
const toAlbum = (config: StreamingRuntimeConfig, album: SubsonicAlbum): Album => ({
  id: album.id,
  name: album.name,
  artist: album.displayArtist ?? album.artist,
  cover: coverUrl(config, album.coverArt, 300),
  trackCount: album.songCount,
  year: album.year,
});

/**
 */
const toArtist = (config: StreamingRuntimeConfig, artist: SubsonicArtist): Artist => ({
  id: artist.id,
  name: artist.name,
  avatar: coverUrl(config, artist.coverArt, 300),
  albumCount: artist.albumCount,
});

/**
 */
const toPlaylist = (config: StreamingRuntimeConfig, playlist: SubsonicPlaylist): Playlist => ({
  id: playlist.id,
  name: playlist.name,
  description: playlist.comment,
  cover: coverUrl(config, playlist.coverArt, 300),
  trackCount: playlist.songCount,
  owner: playlist.owner,
});

export const subsonicAdapter: StreamingAdapter = {
  /**
   */
  async ping(config): Promise<StreamingPingResult> {
    try {
      const result = await callApi<{ version?: string; serverVersion?: string }>(config, "ping");
      return { ok: true, version: result.serverVersion ?? result.version };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
  /**
   */
  async listSongs(config, params) {
    const result = await callApi<{ searchResult3?: { song?: SubsonicSong[] } }>(config, "search3", {
      query: "",
      songCount: params?.limit ?? 100,
      songOffset: params?.offset ?? 0,
      artistCount: 0,
      albumCount: 0,
    });
    return (result.searchResult3?.song ?? []).map((song) => toTrack(config, song));
  },

  /**
   */
  async listAlbums(config, params) {
    const result = await callApi<{ albumList2?: { album?: SubsonicAlbum[] } }>(
      config,
      "getAlbumList2",
      {
        type: "alphabeticalByName",
        size: params?.limit ?? 500,
        offset: params?.offset ?? 0,
      },
    );
    return (result.albumList2?.album ?? []).map((album) => toAlbum(config, album));
  },

  /**
   */
  async listArtists(config) {
    const result = await callApi<{
      artists?: { index?: { artist?: SubsonicArtist[] }[] };
    }>(config, "getArtists");
    return (result.artists?.index ?? []).flatMap((index) =>
      (index.artist ?? []).map((artist) => toArtist(config, artist)),
    );
  },

  /**
   */
  async listPlaylists(config) {
    const result = await callApi<{ playlists?: { playlist?: SubsonicPlaylist[] } }>(
      config,
      "getPlaylists",
    );
    return (result.playlists?.playlist ?? []).map((playlist) => toPlaylist(config, playlist));
  },

  /**
   */
  async getAlbumSongs(config, albumId) {
    const result = await callApi<{ album?: SubsonicAlbum }>(config, "getAlbum", { id: albumId });
    return (result.album?.song ?? []).map((song) => toTrack(config, song));
  },

  /**
   */
  async getPlaylistSongs(config, playlistId) {
    const result = await callApi<{ playlist?: SubsonicPlaylist }>(config, "getPlaylist", {
      id: playlistId,
    });
    return (result.playlist?.entry ?? []).map((song) => toTrack(config, song));
  },

  /**
   */
  async getArtistAlbums(config, artistId) {
    const result = await callApi<{ artist?: { album?: SubsonicAlbum[] } }>(config, "getArtist", {
      id: artistId,
    });
    return (result.artist?.album ?? []).map((album) => toAlbum(config, album));
  },

  /**
   */
  async getArtistSongs(config, artistId) {
    const result = await callApi<{ artist?: { album?: SubsonicAlbum[] } }>(config, "getArtist", {
      id: artistId,
    });
    const tracks: Track[] = [];
    for (const album of result.artist?.album ?? []) {
      try {
        const albumResult = await callApi<{ album?: SubsonicAlbum }>(config, "getAlbum", {
          id: album.id,
        });
        tracks.push(...(albumResult.album?.song ?? []).map((song) => toTrack(config, song)));
      } catch {
      }
    }
    return tracks;
  },

  /**
   */
  async getStreamUrl(config, trackId) {
    return buildUrl(config, "stream", {
      id: trackId,
      estimateContentLength: "true",
      format: "raw",
      maxBitRate: 0,
    });
  },

  /**
   */
  async getLyrics(config, trackId, hint) {
    try {
      const result = await callApi<{
        lyricsList?: { structuredLyrics?: { line?: { start?: number; value: string }[] }[] };
      }>(config, "getLyricsBySongId", { id: trackId });
      const lines = result.lyricsList?.structuredLyrics?.[0]?.line ?? [];
      if (lines.length > 0) {
        return lines
          .map((line) => {
            const milliseconds = line.start ?? 0;
            const minutes = Math.floor(milliseconds / 60_000);
            const seconds = Math.floor((milliseconds % 60_000) / 1000);
            const centiseconds = Math.floor((milliseconds % 1000) / 10);
            return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}]${line.value ?? ""}`;
          })
          .join("\n");
      }
    } catch {
    }
    if (!hint?.artist && !hint?.title) return null;
    try {
      const result = await callApi<{ lyrics?: { value?: string } }>(config, "getLyrics", {
        artist: hint.artist ?? "",
        title: hint.title ?? "",
      });
      return result.lyrics?.value?.trim() ? result.lyrics.value : null;
    } catch {
      return null;
    }
  },

  /**
   */
  async getCoverUrl(config, coverId, size) {
    return buildUrl(config, "getCoverArt", { id: coverId, size });
  },
};
