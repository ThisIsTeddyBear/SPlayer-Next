import { fetchWithProxy } from "@main/utils/proxy";
import type {
  MetadataCandidate,
  MetadataCandidateDetail,
  MetadataSearchQuery,
} from "@shared/types/tagEditor";

const USER_AGENT = "SPlayer-Next/1.2 (https://github.com/SPlayer-Dev/SPlayer-Next)";
const TIMEOUT_MS = 10_000;

const requestJson = async <T>(url: string): Promise<T> => {
  const response = await fetchWithProxy(url, {
    headers: {
      Accept: "application/json",
      Referer: "https://music.163.com/",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Metadata request failed: HTTP ${response.status}`);
  return (await response.json()) as T;
};

interface NeteaseArtist {
  id?: number;
  name?: string;
}

interface NeteaseAlbum {
  id?: number;
  name?: string;
  picUrl?: string;
  artist?: NeteaseArtist;
  artists?: NeteaseArtist[];
  publishTime?: number;
}

interface NeteaseSong {
  id: number;
  name: string;

  // Old search API fields
  duration?: number;
  artists?: NeteaseArtist[];
  album?: NeteaseAlbum;

  // Newer/detail API aliases
  dt?: number;
  ar?: NeteaseArtist[];
  al?: NeteaseAlbum;
}

const getAlbum = (song: NeteaseSong): NeteaseAlbum | undefined => song.al ?? song.album;

const getArtists = (song: NeteaseSong): NeteaseArtist[] => song.ar ?? song.artists ?? [];

const normalizeCoverUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined;

  // NetEase still occasionally returns http:// artwork URLs.
  // Use HTTPS so the renderer/CSP does not reject the image.
  const httpsUrl = url.replace(/^http:\/\/(p\d*\.music\.126\.net)/i, "https://$1");

  // Candidate thumbnails do not need the original full-size image.
  if (httpsUrl.includes("?param=")) return httpsUrl;
  return `${httpsUrl}?param=500y500`;
};

const getAlbumArtist = (album: NeteaseAlbum | undefined): string | undefined => {
  if (!album) return undefined;

  const names = (album.artists ?? [])
    .map((artist) => artist.name?.trim())
    .filter((name): name is string => Boolean(name));

  if (names.length > 0) return names.join(" / ");

  const single = album.artist?.name?.trim();
  return single || undefined;
};

const getYear = (album: NeteaseAlbum | undefined): number | undefined => {
  if (!album?.publishTime) return undefined;
  const year = new Date(album.publishTime).getFullYear();
  return Number.isFinite(year) ? year : undefined;
};

/**
 * The legacy /api/search/get response is inconsistent about album artwork.
 * Hydrate search results through /api/song/detail, which normally contains
 * the full album object including picUrl (and, on old-style responses,
 * album artist / publishTime as well).
 */
const hydrateNeteaseSongs = async (songs: NeteaseSong[]): Promise<NeteaseSong[]> => {
  if (songs.length === 0) return songs;

  try {
    const ids = songs.map((song) => song.id);
    const params = new URLSearchParams({
      id: String(ids[0]),
      ids: JSON.stringify(ids),
    });

    const detail = await requestJson<{ songs?: NeteaseSong[] }>(
      `https://music.163.com/api/song/detail?${params.toString()}`,
    );

    const detailById = new Map((detail.songs ?? []).map((song) => [String(song.id), song]));

    return songs.map((song) => {
      const full = detailById.get(String(song.id));
      if (!full) return song;

      // Prefer the detail response, but keep any search-only values.
      return {
        ...song,
        ...full,
        artists: full.artists ?? song.artists,
        album: full.album ?? song.album,
        ar: full.ar ?? song.ar,
        al: full.al ?? song.al,
      };
    });
  } catch {
    // Metadata search itself should still work if the detail hydration fails.
    return songs;
  }
};

const searchNetease = async (keyword: string): Promise<MetadataCandidate[]> => {
  const params = new URLSearchParams({
    s: keyword,
    type: "1",
    offset: "0",
    limit: "10",
  });

  const body = await requestJson<{ result?: { songs?: NeteaseSong[] } }>(
    `https://music.163.com/api/search/get?${params.toString()}`,
  );

  const songs = await hydrateNeteaseSongs(body.result?.songs ?? []);

  return songs.map((song) => {
    const album = getAlbum(song);
    const artists = getArtists(song);

    return {
      provider: "netease",
      id: String(song.id),
      title: song.name,
      artist: artists
        .map((artist) => artist.name?.trim())
        .filter((name): name is string => Boolean(name))
        .join(" / "),
      album: album?.name,
      albumArtist: getAlbumArtist(album),
      year: getYear(album),
      durationMs: song.dt ?? song.duration,
      coverUrl: normalizeCoverUrl(album?.picUrl),
    };
  });
};

export const searchMetadata = async (
  query: MetadataSearchQuery,
): Promise<MetadataCandidate[]> => {
  const title = query.title.trim();
  const artist = query.artist.trim();
  if (!title && !artist) return [];

  // Current metadata lookup implementation still uses NetEase for search.
  return searchNetease(`${title} ${artist}`.trim());
};

export const getMetadataDetail = async (
  provider: MetadataSearchQuery["provider"],
  id: string,
): Promise<MetadataCandidateDetail> => {
  if (provider !== "netease") return {};

  const params = new URLSearchParams({
    id,
    lv: "-1",
    kv: "-1",
    tv: "-1",
  });

  const body = await requestJson<{ lrc?: { lyric?: string } }>(
    `https://music.163.com/api/song/lyric?${params.toString()}`,
  );

  return {
    lyrics: body.lrc?.lyric?.trim() || undefined,
  };
};
