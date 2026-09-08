import { ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { fetchWithProxy } from "@main/utils/proxy";
import { libraryLog } from "@main/utils/logger";
import { ErrorCode } from "@shared/types/errors";
import type { FetchedLyricCandidate, LyricFormat } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";

const LRCLIB_SEARCH_URL = "https://lrclib.net/api/search";
const LYRICSPLUS_URL = "https://lyricsplus.prjktla.my.id/v2/lyrics/get";
const BINIMUM_URL = "https://lyrics-api.binimum.org/";
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
const SAVABLE_FORMATS = new Set<LyricFormat>([
  "ttml",
  "json",
  "lys",
  "yrc",
  "qrc",
  "krc",
  "lrc",
  "ass",
  "srt",
]);

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

const lyricTiming = (content: string, format: LyricFormat): "word" | "line" | "unsynced" => {
  if (format === "ttml") return /<span\b[^>]*\bbegin=/i.test(content) ? "word" : "line";
  if (["qrc", "krc", "yrc", "lys"].includes(format)) return "word";
  if (format === "json") return /"words"\s*:/i.test(content) ? "word" : "line";
  return /<\d{1,3}:\d{2}|\[\d{1,3}:\d{2}/.test(content) ? "line" : "unsynced";
};

const detectFormat = (content: string): LyricFormat | null => {
  const text = content.trimStart();
  if (/^\{\s*"type"\s*:\s*"Word"\b/.test(text)) return "json";
  if (/LyricContent=|<QrcInfos|<Lyric_/i.test(text) || /\[\d+,\d+\][^\n]+\(\d+,\d+\)/.test(text)) return "qrc";
  if (/\[\d+,\d+\]\(\d+,\d+,\d+\)/.test(text)) return "yrc";
  if (/^\[\d\][^\]]+\(\d+,\d+\)/m.test(text)) return "lys";
  if (/<tt[\s>]/i.test(text)) return "ttml";
  if (/\[\d{1,3}:\d{2}/.test(text)) return "lrc";
  return null;
};

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
    timing: lyricTiming(value.syncedLyrics, "lrc"),
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
  const format = detectFormat(content);
  return format && content.trim()
    ? { id, provider, format, timing: lyricTiming(content, format), title, artist, content }
    : null;
};

const stringsIn = (value: unknown, output: string[] = []): string[] => {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => stringsIn(item, output));
  return output;
};

const fetchLyricsPlus = async (track: Track, artist: string): Promise<FetchedLyricCandidate[]> => {
  const metadata = track as Track & { isrc?: string };
  const url = new URL(LYRICSPLUS_URL);
  const params: Record<string, string> = {
    title: track.title,
    artist,
    source: "apple,lyricsplus,musixmatch,spotify,qq,deezer,musixmatch-word",
  };
  if (track.album?.name) params.album = track.album.name;
  if (track.duration > 0) params.duration = String(track.duration / 1000);
  if (metadata.isrc) params.isrc = metadata.isrc;
  url.search = new URLSearchParams(params).toString();
  const response = await fetchWithProxy(url.toString(), { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) return [];
  const text = await response.text();
  let values = [text];
  try {
    values = [text, ...stringsIn(JSON.parse(text))];
  } catch {
    // 原始歌词响应无需额外解析。
  }
  return values
    .map((content, index) => lyricCandidate(-1 - index, "LyricsPlus", track.title, artist, content))
    .filter((item): item is FetchedLyricCandidate => item !== null);
};

const fetchBinimum = async (track: Track, artist: string): Promise<FetchedLyricCandidate[]> => {
  const metadata = track as Track & { isrc?: string };
  const url = new URL(BINIMUM_URL);
  const params: Record<string, string> = { track: track.title, artist };
  if (track.album?.name) params.album = track.album.name;
  if (track.duration > 0) params.duration = String(Math.round(track.duration / 1000));
  if (metadata.isrc) params.isrc = metadata.isrc;
  url.search = new URLSearchParams(params).toString();
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
      const [lyricsPlus, binimum] = await Promise.all([
        fetchLyricsPlus(track, artist).catch(() => []),
        fetchBinimum(track, artist).catch(() => []),
      ]);
      const data = [
        ...payload.map((item) => toCandidate(item as LrcLibResult)),
        ...lyricsPlus,
        ...binimum,
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
      (typeof format !== "string" || !SAVABLE_FORMATS.has(format as LyricFormat))
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
