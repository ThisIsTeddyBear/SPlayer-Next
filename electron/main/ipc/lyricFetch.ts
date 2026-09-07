import { ipcMain } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { fetchWithProxy } from "@main/utils/proxy";
import { libraryLog } from "@main/utils/logger";
import { ErrorCode } from "@shared/types/errors";
import type { FetchedLyricCandidate } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";

const LRCLIB_SEARCH_URL = "https://lrclib.net/api/search";
const LYRICSPLUS_URL = "https://lyricsplus.prjktla.my.id/v2/lyrics/get";
const BINIMUM_URL = "https://lyrics-api.binimum.org/";
const UNISON_URL = "https://unison.boidu.dev/lyrics";
const YOUTUBE_SEARCH_URL = "https://www.youtube.com/results";
const unisonKeyId = createHash("sha256").update(randomUUID()).digest("hex");
const LYRIC_EXTENSIONS = [
  ".ttml",
  ".json",
  ".lys",
  ".qrc",
  ".krc",
  ".yrc",
  ".lrc",
  ".ass",
  ".srt",
];

type LrcLibResult = {
  id?: unknown;
  trackName?: unknown;
  artistName?: unknown;
  albumName?: unknown;
  duration?: unknown;
  syncedLyrics?: unknown;
};

const normalize = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const score = (track: Track, result: FetchedLyricCandidate): number => {
  const title = normalize(track.title);
  const artist = normalize(track.artists.map((item) => item.name).join(" "));
  let value =
    result.title === track.title ? 10 : normalize(result.title).includes(title) ? 6 : 0;
  if (artist && normalize(result.artist).includes(artist)) value += 4;
  if (
    result.duration &&
    track.duration &&
    Math.abs(result.duration * 1000 - track.duration) < 4_000
  ) {
    value += 2;
  }
  return value;
};

const toCandidate = (value: LrcLibResult): FetchedLyricCandidate | null => {
  if (
    typeof value.id !== "number" ||
    typeof value.trackName !== "string" ||
    typeof value.artistName !== "string" ||
    typeof value.syncedLyrics !== "string" ||
    !value.syncedLyrics.trim()
  ) {
    return null;
  }
  return {
    id: value.id,
    provider: "LRCLIB",
    format: "lrc",
    title: value.trackName,
    artist: value.artistName,
    album: typeof value.albumName === "string" ? value.albumName : undefined,
    duration: typeof value.duration === "number" ? value.duration : undefined,
    content: value.syncedLyrics,
  };
};

const lyricCandidate = (
  id: number,
  provider: string,
  title: string,
  artist: string,
  content: string,
): FetchedLyricCandidate | null => {
  const format = /<tt[\s>]/i.test(content) ? "ttml" : /\[\d{1,3}:\d{2}/.test(content) ? "lrc" : null;
  return format && content.trim() ? { id, provider, format, title, artist, content } : null;
};

const stringsIn = (value: unknown, output: string[] = []): string[] => {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => stringsIn(item, output));
  return output;
};

const fetchLyricsPlus = async (track: Track, artist: string): Promise<FetchedLyricCandidate[]> => {
  const url = new URL(LYRICSPLUS_URL);
  url.search = new URLSearchParams({
    title: track.title,
    artist,
    source: "apple,lyricsplus,musixmatch,spotify,qq,deezer,musixmatch-word",
  }).toString();
  const response = await fetchWithProxy(url.toString(), { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return [];
  const text = await response.text();
  let values = [text];
  try {
    values = stringsIn(JSON.parse(text));
  } catch {
    // 原始歌词响应无需额外解析。
  }
  const content = values.find((value) => /<tt[\s>]/i.test(value) || /\[\d{1,3}:\d{2}/.test(value));
  const candidate = content ? lyricCandidate(-1, "LyricsPlus", track.title, artist, content) : null;
  return candidate ? [candidate] : [];
};

const fetchBinimum = async (track: Track, artist: string): Promise<FetchedLyricCandidate[]> => {
  const url = new URL(BINIMUM_URL);
  url.search = new URLSearchParams({ track: track.title, artist }).toString();
  const response = await fetchWithProxy(url.toString(), { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return [];
  const payload = (await response.json()) as { results?: Array<Record<string, unknown>> };
  const records = Array.isArray(payload.results) ? payload.results : [];
  const output = await Promise.all(
    records.slice(0, 3).map(async (record, index) => {
      const lyricUrl = record.lyricsUrl;
      if (
        typeof lyricUrl !== "string" ||
        !lyricUrl.startsWith("https://lyrics-storage.binimum.org/")
      ) {
        return null;
      }
      const lyricResponse = await fetchWithProxy(lyricUrl, { signal: AbortSignal.timeout(15_000) });
      if (!lyricResponse.ok) return null;
      return lyricCandidate(
        -100 - index,
        "BiniLyrics",
        String(record.track_name ?? track.title),
        String(record.artist_name ?? artist),
        await lyricResponse.text(),
      );
    }),
  );
  return output.filter((item): item is FetchedLyricCandidate => item !== null);
};

const fetchUnison = async (track: Track, artist: string): Promise<FetchedLyricCandidate[]> => {
  const searchUrl = new URL(YOUTUBE_SEARCH_URL);
  searchUrl.search = new URLSearchParams({ search_query: `${track.title} ${artist}` }).toString();
  const search = await fetchWithProxy(searchUrl.toString(), { signal: AbortSignal.timeout(15_000) });
  if (!search.ok) return [];
  const videoId = /"videoId":"([\w-]{11})"/.exec(await search.text())?.[1];
  if (!videoId) return [];
  const url = new URL(UNISON_URL);
  url.search = new URLSearchParams({ v: videoId, song: track.title, artist }).toString();
  const response = await fetchWithProxy(url.toString(), {
    headers: { "x-key-id": unisonKeyId },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { data?: { lyrics?: unknown } };
  const content = payload.data?.lyrics;
  const candidate =
    typeof content === "string" ? lyricCandidate(-200, "Unison", track.title, artist, content) : null;
  return candidate ? [candidate] : [];
};

const trackPath = (track: unknown): string | null => {
  if (!track || typeof track !== "object") return null;
  const value = track as Partial<Track>;
  return value.source === "local" && typeof value.path === "string" && value.path ? value.path : null;
};

/** 注册本地歌曲歌词搜索和替换 IPC。 */
export const registerLyricFetchIpc = (): void => {
  ipcMain.handle("lyrics:searchLocalCandidates", async (_event, rawTrack: unknown) => {
    const path = trackPath(rawTrack);
    if (!path) return { success: false, error: ErrorCode.FILE_NOT_FOUND };
    const track = rawTrack as Track;
    const artist = track.artists.map((item) => item.name).join(" ").trim();
    if (!track.title.trim() || !artist) return { success: true, data: [] };
    try {
      const url = new URL(LRCLIB_SEARCH_URL);
      url.search = new URLSearchParams({ track_name: track.title, artist_name: artist }).toString();
      const response = await fetchWithProxy(url.toString(), {
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`LRCLIB search returned HTTP ${response.status}`);
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) throw new Error("LRCLIB returned an invalid response");
      const [lyricsPlus, binimum, unison] = await Promise.all([
        fetchLyricsPlus(track, artist).catch(() => []),
        fetchBinimum(track, artist).catch(() => []),
        fetchUnison(track, artist).catch(() => []),
      ]);
      const data = [
        ...payload.map((item) => toCandidate(item as LrcLibResult)),
        ...lyricsPlus,
        ...binimum,
        ...unison,
      ]
        .filter((item): item is FetchedLyricCandidate => item !== null)
        .sort((left, right) => score(track, right) - score(track, left))
        .slice(0, 12);
      return { success: true, data };
    } catch (error) {
      libraryLog.warn("Failed to search LRCLIB lyrics:", error);
      return { success: false, error: ErrorCode.NETWORK_ERROR };
    }
  });

  ipcMain.handle(
    "lyrics:saveLocalCandidate",
    async (_event, rawTrack: unknown, content: unknown, format: unknown) => {
    const audioPath = trackPath(rawTrack);
    if (
      !audioPath ||
      typeof content !== "string" ||
      !content.trim() ||
      (format !== "lrc" && format !== "ttml")
    ) {
      return { success: false, error: ErrorCode.FILE_NOT_FOUND };
    }
    const extension = extname(audioPath);
    const basePath = audioPath.slice(0, -extension.length);
    const destination = `${basePath}.${format}`;
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content.replace(/\r?\n/g, "\n"), "utf8");
      await rename(temporary, destination);
      const removed: string[] = [];
      for (const lyricExtension of LYRIC_EXTENSIONS) {
        if (lyricExtension === `.${format}`) continue;
        const filePath = `${basePath}${lyricExtension}`;
        await rm(filePath, { force: true });
        removed.push(filePath);
      }
      return { success: true, data: { path: destination, removed } };
    } catch (error) {
      await rm(temporary, { force: true });
      libraryLog.error("Failed to save local lyric:", error);
      return { success: false, error: ErrorCode.UNKNOWN };
    }
    },
  );
};
