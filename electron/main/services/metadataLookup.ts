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

export const searchMetadata = async (query: MetadataSearchQuery): Promise<MetadataCandidate[]> => {
  const title = query.title.trim();
  const artist = query.artist.trim();
  if (!title && !artist) return [];
  return searchNetease(`${title} ${artist}`.trim());
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
