import { fetchWithProxy } from "@main/utils/proxy";
import type {
  MetadataCandidate,
  MetadataCandidateDetail,
  MetadataSearchQuery,
} from "@shared/types/tagEditor";

const USER_AGENT = "SPlayer-Next/1.2 (https://github.com/SPlayer-Dev/SPlayer-Next)";
const TIMEOUT_MS = 10_000;
const MUSICBRAINZ_INTERVAL_MS = 1_100;

let nextMusicBrainzRequestAt = 0;

const waitForMusicBrainz = async (): Promise<void> => {
  const now = Date.now();
  const waitMs = Math.max(0, nextMusicBrainzRequestAt - now);
  nextMusicBrainzRequestAt = Math.max(now, nextMusicBrainzRequestAt) + MUSICBRAINZ_INTERVAL_MS;
  if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
};

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

interface NeteaseSong {
  id: number;
  name: string;
  duration?: number;
  artists?: { name: string }[];
  album?: { name?: string; picUrl?: string; artist?: { name?: string }; publishTime?: number };
}

const searchNetease = async (keyword: string): Promise<MetadataCandidate[]> => {
  const params = new URLSearchParams({ s: keyword, type: "1", offset: "0", limit: "10" });
  const body = await requestJson<{ result?: { songs?: NeteaseSong[] } }>(
    `https://music.163.com/api/search/get?${params.toString()}`,
  );
  return (body.result?.songs ?? []).map((song) => ({
    provider: "netease",
    id: String(song.id),
    title: song.name,
    artist: (song.artists ?? []).map((artist) => artist.name).join(" / "),
    album: song.album?.name,
    albumArtist: song.album?.artist?.name,
    year: song.album?.publishTime ? new Date(song.album.publishTime).getFullYear() : undefined,
    durationMs: song.duration,
    coverUrl: song.album?.picUrl,
  }));
};

interface MusicBrainzRecording {
  id: string;
  title: string;
  length?: number;
  score?: number;
  "artist-credit"?: { name?: string }[];
  releases?: {
    id?: string;
    title?: string;
    date?: string;
    "artist-credit"?: { name?: string }[];
  }[];
}

const searchMusicBrainz = async (title: string, artist: string): Promise<MetadataCandidate[]> => {
  const params = new URLSearchParams({
    query: `${title} ${artist}`.trim(),
    fmt: "json",
    limit: "10",
  });
  await waitForMusicBrainz();
  const body = await requestJson<{ recordings?: MusicBrainzRecording[] }>(
    `https://musicbrainz.org/ws/2/recording/?${params.toString()}`,
  );
  return (body.recordings ?? []).map((recording) => {
    const release = recording.releases?.find((item) => item.id && item.title);
    return {
      provider: "musicbrainz",
      id: recording.id,
      title: recording.title,
      artist: (recording["artist-credit"] ?? [])
        .map((credit) => credit.name)
        .filter(Boolean)
        .join(" / "),
      album: release?.title,
      albumArtist:
        (release?.["artist-credit"] ?? [])
          .map((credit) => credit.name)
          .filter(Boolean)
          .join(" / ") || undefined,
      year: release?.date ? Number(release.date.slice(0, 4)) || undefined : undefined,
      durationMs: recording.length,
      coverUrl: release?.id
        ? `https://coverartarchive.org/release/${release.id}/front-500`
        : undefined,
      score: recording.score,
    };
  });
};

export const searchMetadata = async (query: MetadataSearchQuery): Promise<MetadataCandidate[]> => {
  const title = query.title.trim();
  const artist = query.artist.trim();
  if (!title && !artist) return [];
  return query.provider === "netease"
    ? searchNetease(`${title} ${artist}`.trim())
    : searchMusicBrainz(title, artist);
};

export const getMetadataDetail = async (
  provider: MetadataSearchQuery["provider"],
  id: string,
): Promise<MetadataCandidateDetail> => {
  if (provider !== "netease") return {};
  const params = new URLSearchParams({ id, lv: "-1", kv: "-1", tv: "-1" });
  const body = await requestJson<{ lrc?: { lyric?: string } }>(
    `https://music.163.com/api/song/lyric?${params.toString()}`,
  );
  return { lyrics: body.lrc?.lyric?.trim() || undefined };
};
