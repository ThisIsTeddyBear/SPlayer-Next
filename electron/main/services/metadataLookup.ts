import { fetchWithProxy } from "@main/utils/proxy";
import type {
  MetadataCandidate,
  MetadataCandidateDetail,
  MetadataProvider,
  MetadataSearchQuery,
} from "@shared/types/tagEditor";

const USER_AGENT =
  "SPlayer-Next/1.2 (https://github.com/SPlayer-Dev/SPlayer-Next)";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const TIMEOUT_MS = 10_000;

/* -------------------------------------------------------------------------- */
/* NetEase                                                                    */
/* -------------------------------------------------------------------------- */

const requestJson = async <T>(url: string): Promise<T> => {
  const response = await fetchWithProxy(url, {
    headers: {
      Accept: "application/json",
      Referer: "https://music.163.com/",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`Metadata request failed: HTTP ${response.status}`);
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
  duration?: number;
  artists?: NeteaseArtist[];
  album?: NeteaseAlbum;
  dt?: number;
  ar?: NeteaseArtist[];
  al?: NeteaseAlbum;
}

const neteaseAlbum = (song: NeteaseSong): NeteaseAlbum | undefined =>
  song.al ?? song.album;
const neteaseArtists = (song: NeteaseSong): NeteaseArtist[] =>
  song.ar ?? song.artists ?? [];

const neteaseCover = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  const secure = url.replace(
    /^http:\/\/(p\d*\.music\.126\.net)/i,
    "https://$1",
  );
  return secure.includes("?param=") ? secure : `${secure}?param=500y500`;
};

const neteaseAlbumArtist = (
  album: NeteaseAlbum | undefined,
): string | undefined => {
  if (!album) return undefined;

  const artists = (album.artists ?? [])
    .map((artist) => artist.name?.trim())
    .filter((name): name is string => Boolean(name));

  if (artists.length > 0) return artists.join(" / ");

  const artist = album.artist?.name?.trim();
  return artist || undefined;
};

const neteaseYear = (album: NeteaseAlbum | undefined): number | undefined => {
  if (!album?.publishTime) return undefined;
  const year = new Date(album.publishTime).getFullYear();
  return Number.isFinite(year) ? year : undefined;
};

const hydrateNeteaseSongs = async (
  songs: NeteaseSong[],
): Promise<NeteaseSong[]> => {
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

    const details = new Map(
      (detail.songs ?? []).map((song) => [String(song.id), song]),
    );

    return songs.map((song) => {
      const full = details.get(String(song.id));
      return full ? { ...song, ...full } : song;
    });
  } catch {
    // Search results are still usable even if the detail hydration endpoint fails.
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
    const album = neteaseAlbum(song);

    return {
      provider: "netease",
      id: String(song.id),
      title: song.name,
      artist: neteaseArtists(song)
        .map((artist) => artist.name?.trim())
        .filter((name): name is string => Boolean(name))
        .join(" / "),
      album: album?.name,
      albumArtist: neteaseAlbumArtist(album),
      year: neteaseYear(album),
      durationMs: song.dt ?? song.duration,
      coverUrl: neteaseCover(album?.picUrl),
    };
  });
};

/* -------------------------------------------------------------------------- */
/* Spotify public web/embed metadata (no developer key or user login)         */
/* -------------------------------------------------------------------------- */

const SPOTIFY_TOKEN_TRACK_ID = "4uLU6hMCjMI75M1A2tKUQC";
const SPOTIFY_SEARCH_HASH =
  "1d021289df50166c61630e02f002ec91182b518e56bcd681ac6b0640390c0245";
const SPOTIFY_TRACK_HASH =
  "d208301e63ccb8504831114cb8db1201636a016187d7c832c8c00933e2cd64c6";
const SPOTIFY_ALBUM_HASH =
  "46ae954ef2d2fe7732b4b2b4022157b2e18b7ea84f70591ceb164e4de1b5d5d3";

interface SpotifyImage {
  url?: string;
  width?: number;
  height?: number;
}

interface SpotifyArtist {
  id?: string;
  uri?: string;
  profile?: {
    name?: string;
  };
}

interface SpotifySearchTrack {
  id?: string;
  uri?: string;
  name?: string;
  albumOfTrack?: {
    id?: string;
    uri?: string;
    name?: string;
    coverArt?: {
      sources?: SpotifyImage[];
    };
  };
  artists?: {
    items?: SpotifyArtist[];
  };
  duration?: {
    totalMilliseconds?: number;
  };
}

interface SpotifySearchResponse {
  data?: {
    searchV2?: {
      tracksV2?: {
        items?: Array<{
          item?: {
            data?: SpotifySearchTrack;
          };
        }>;
      };
    };
  };
  errors?: unknown[];
}

interface SpotifyTrackResponse {
  data?: {
    trackUnion?: {
      id?: string;
      uri?: string;
      name?: string;
      trackNumber?: number;
      artistsWithRoles?: {
        items?: Array<{
          role?: string;
          artist?: SpotifyArtist;
        }>;
      };
      albumOfTrack?: {
        id?: string;
        uri?: string;
        name?: string;
        date?: {
          isoString?: string;
          year?: number;
        };
        coverArt?: {
          sources?: SpotifyImage[];
        };
      };
    };
  };
  errors?: unknown[];
}

interface SpotifyAlbumResponse {
  data?: {
    albumUnion?: {
      uri?: string;
      name?: string;
      artists?: {
        items?: SpotifyArtist[];
      };
      coverArt?: {
        sources?: SpotifyImage[];
      };
      date?: {
        isoString?: string;
      };
      tracks?: {
        items?: Array<{
          track?: {
            uri?: string;
            name?: string;
            discNumber?: number;
            trackNumber?: number;
            artists?: {
              items?: SpotifyArtist[];
            };
          };
        }>;
      };
    };
  };
  errors?: unknown[];
}

interface SpotifyTokenResponse {
  accessToken?: string;
  accessTokenExpirationTimestampMs?: number;
}

interface SpotifyEmbedState {
  props?: {
    pageProps?: {
      state?: {
        settings?: {
          session?: SpotifyTokenResponse;
        };
      };
    };
  };
}

let spotifyAccessToken = "";
let spotifyTokenExpiresAt = 0;

const cacheSpotifyToken = (token: SpotifyTokenResponse): string | null => {
  const accessToken = token.accessToken?.trim();
  if (!accessToken) return null;

  spotifyAccessToken = accessToken;
  spotifyTokenExpiresAt =
    token.accessTokenExpirationTimestampMs ?? Date.now() + 5 * 60_000;

  return spotifyAccessToken;
};

const requestSpotifyWebToken = async (): Promise<string | null> => {
  try {
    const response = await fetchWithProxy(
      "https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
      {
        headers: {
          Accept: "application/json",
          Referer: "https://open.spotify.com/",
          "User-Agent": BROWSER_USER_AGENT,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (!response.ok) return null;
    return cacheSpotifyToken((await response.json()) as SpotifyTokenResponse);
  } catch {
    return null;
  }
};

const requestSpotifyEmbedToken = async (): Promise<string | null> => {
  try {
    const response = await fetchWithProxy(
      `https://open.spotify.com/embed/track/${SPOTIFY_TOKEN_TRACK_ID}`,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          Referer: "https://open.spotify.com/",
          "User-Agent": BROWSER_USER_AGENT,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );

    if (!response.ok) return null;

    const html = await response.text();
    const nextData = html.match(
      /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    )?.[1];

    if (!nextData) return null;

    const state = JSON.parse(nextData) as SpotifyEmbedState;
    return cacheSpotifyToken(
      state.props?.pageProps?.state?.settings?.session ?? {},
    );
  } catch {
    return null;
  }
};

const getSpotifyAnonymousToken = async (): Promise<string> => {
  if (spotifyAccessToken && spotifyTokenExpiresAt > Date.now() + 30_000) {
    return spotifyAccessToken;
  }

  // Primary path: this is the same anonymous web-player token endpoint used by
  // current no-login Spotify metadata clients.
  const webToken = await requestSpotifyWebToken();
  if (webToken) return webToken;

  // Fallback: recover the anonymous session token from a public embed page.
  const embedToken = await requestSpotifyEmbedToken();
  if (embedToken) return embedToken;

  throw new Error("Unable to obtain an anonymous Spotify web-player token");
};

const spotifyGraphqlUrl = (
  operationName: string,
  variables: Record<string, unknown>,
  sha256Hash: string,
): string => {
  const params = new URLSearchParams({
    operationName,
    variables: JSON.stringify(variables),
    extensions: JSON.stringify({
      persistedQuery: {
        version: 1,
        sha256Hash,
      },
    }),
  });

  return `https://api-partner.spotify.com/pathfinder/v1/query?${params.toString()}`;
};

const spotifyRequest = async <T>(
  operationName: string,
  variables: Record<string, unknown>,
  sha256Hash: string,
  retry = true,
): Promise<T> => {
  const token = await getSpotifyAnonymousToken();
  const response = await fetchWithProxy(
    spotifyGraphqlUrl(operationName, variables, sha256Hash),
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        Origin: "https://open.spotify.com",
        Referer: "https://open.spotify.com/",
        "User-Agent": BROWSER_USER_AGENT,
        "App-Platform": "WebPlayer",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  if ((response.status === 401 || response.status === 403) && retry) {
    spotifyAccessToken = "";
    spotifyTokenExpiresAt = 0;
    return spotifyRequest<T>(operationName, variables, sha256Hash, false);
  }

  if (!response.ok) {
    throw new Error(`Spotify metadata request failed: HTTP ${response.status}`);
  }

  return (await response.json()) as T;
};

const spotifyNames = (
  artists: SpotifyArtist[] | undefined,
): string | undefined => {
  const names = (artists ?? [])
    .map((artist) => artist.profile?.name?.trim())
    .filter((name): name is string => Boolean(name));

  return names.length > 0 ? names.join(" / ") : undefined;
};

const spotifyCover = (
  images: SpotifyImage[] | undefined,
): string | undefined => {
  const usable = (images ?? []).filter((image) => Boolean(image.url));
  if (usable.length === 0) return undefined;

  return [...usable].sort(
    (a, b) =>
      (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
  )[0]?.url;
};

const spotifyYear = (
  isoDate?: string,
  explicitYear?: number,
): number | undefined => {
  if (explicitYear && Number.isFinite(explicitYear)) return explicitYear;
  const match = isoDate?.match(/^(\d{4})/);
  return match ? Number(match[1]) : undefined;
};

const searchSpotify = async (keyword: string): Promise<MetadataCandidate[]> => {
  const body = await spotifyRequest<SpotifySearchResponse>(
    "searchTracks",
    {
      searchTerm: keyword,
      offset: 0,
      limit: 10,
      numberOfTopResults: 20,
      includeAudiobooks: false,
    },
    SPOTIFY_SEARCH_HASH,
  );

  if (body.errors?.length)
    throw new Error("Spotify search returned GraphQL errors");

  return (body.data?.searchV2?.tracksV2?.items ?? [])
    .map((entry): MetadataCandidate | null => {
      const track = entry.item?.data;
      if (!track?.id || !track.name) return null;

      return {
        provider: "spotify",
        id: track.id,
        title: track.name,
        artist: spotifyNames(track.artists?.items) ?? "",
        album: track.albumOfTrack?.name,
        durationMs: track.duration?.totalMilliseconds,
        coverUrl: spotifyCover(track.albumOfTrack?.coverArt?.sources),
      };
    })
    .filter((candidate): candidate is MetadataCandidate => candidate !== null);
};

const getSpotifyDetail = async (
  id: string,
): Promise<MetadataCandidateDetail> => {
  const trackBody = await spotifyRequest<SpotifyTrackResponse>(
    "getTrack",
    { uri: `spotify:track:${id}` },
    SPOTIFY_TRACK_HASH,
  );

  if (trackBody.errors?.length)
    throw new Error("Spotify track lookup returned GraphQL errors");

  const track = trackBody.data?.trackUnion;
  if (!track) return {};

  const trackArtists = (track.artistsWithRoles?.items ?? [])
    .map((item) => item.artist)
    .filter((artist): artist is SpotifyArtist => Boolean(artist));

  const albumId = track.albumOfTrack?.id;
  if (!albumId) {
    return {
      title: track.name,
      artist: spotifyNames(trackArtists),
      album: track.albumOfTrack?.name,
      year: spotifyYear(
        track.albumOfTrack?.date?.isoString,
        track.albumOfTrack?.date?.year,
      ),
      trackNumber: track.trackNumber,
      coverUrl: spotifyCover(track.albumOfTrack?.coverArt?.sources),
    };
  }

  const albumBody = await spotifyRequest<SpotifyAlbumResponse>(
    "getAlbum",
    {
      uri: `spotify:album:${albumId}`,
      locale: "",
      offset: 0,
      limit: 100,
    },
    SPOTIFY_ALBUM_HASH,
  );

  if (albumBody.errors?.length)
    throw new Error("Spotify album lookup returned GraphQL errors");

  const album = albumBody.data?.albumUnion;
  const albumTrack = album?.tracks?.items?.find(
    (item) => item.track?.uri === `spotify:track:${id}`,
  )?.track;

  return {
    title: albumTrack?.name ?? track.name,
    artist:
      spotifyNames(albumTrack?.artists?.items) ?? spotifyNames(trackArtists),
    album: album?.name ?? track.albumOfTrack?.name,
    albumArtist: spotifyNames(album?.artists?.items),
    year:
      spotifyYear(album?.date?.isoString) ??
      spotifyYear(
        track.albumOfTrack?.date?.isoString,
        track.albumOfTrack?.date?.year,
      ),
    trackNumber: albumTrack?.trackNumber ?? track.trackNumber,
    discNumber: albumTrack?.discNumber,
    coverUrl:
      spotifyCover(album?.coverArt?.sources) ??
      spotifyCover(track.albumOfTrack?.coverArt?.sources),
  };
};

/* -------------------------------------------------------------------------- */
/* Public service                                                             */
/* -------------------------------------------------------------------------- */

export const searchMetadata = async (
  query: MetadataSearchQuery,
): Promise<MetadataCandidate[]> => {
  const title = query.title.trim();
  const artist = query.artist.trim();
  if (!title && !artist) return [];

  const keyword = `${title} ${artist}`.trim();

  if (query.provider === "spotify") return searchSpotify(keyword);
  return searchNetease(keyword);
};

export const getMetadataDetail = async (
  provider: MetadataProvider,
  id: string,
): Promise<MetadataCandidateDetail> => {
  if (provider === "spotify") return getSpotifyDetail(id);
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
