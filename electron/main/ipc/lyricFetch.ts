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

const similarity = (left: string, right: string): number => {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.93;
  const tokens = new Set(a.split(" "));
  const overlap = b.split(" ").filter((token) => tokens.has(token)).length;
  return overlap / Math.max(tokens.size, new Set(b.split(" ")).size);
};

const durationSeconds = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value > 10_000 ? value / 1000 : value;
};

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
  const records = Array.isArray(payload.results) ? payload.results.slice(0, 12) : [];
  const ranked = records
    .map((record, index) => {
      const titleScore = similarity(track.title, String(record.track_name ?? ""));
      const artistScore = similarity(artist, String(record.artist_name ?? ""));
      let score = titleScore * 5 + artistScore * 3.5;
      if (track.album?.name && typeof record.album_name === "string") {
        score += similarity(track.album.name, record.album_name);
      }
      const duration = durationSeconds(record.duration);
      if (duration && track.duration > 0) {
        const gap = Math.abs(track.duration / 1000 - duration);
        score += gap <= 1 ? 4 : gap <= 2 ? 3.92 : gap <= 4 ? 3.52 : gap <= 8 ? 2.8 : 0;
        if (gap > 30) score -= 6;
      }
      if (metadata.isrc && typeof record.isrc === "string") {
        score += normalize(metadata.isrc) === normalize(record.isrc) ? 20 : -10;
      }
      if (titleScore < 0.5) score -= 5;
      if (artistScore < 0.35) score -= 3;
      return { record, index, score };
    })
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best || best.score < (metadata.isrc && best.record.isrc ? 5 : 7)) {
    libraryLog.info(`Binimum found ${records.length} candidates but none matched ${artist} - ${track.title}`);
    return [];
  }
  const lyricUrl = best.record.lyricsUrl;
  if (typeof lyricUrl !== "string") return [];
  const parsedUrl = new URL(lyricUrl);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "lyrics-storage.binimum.org") {
    libraryLog.warn(`Binimum rejected an untrusted lyric host: ${parsedUrl.hostname}`);
    return [];
  }
  const lyricResponse = await fetchWithProxy(lyricUrl, { signal: AbortSignal.timeout(15_000) });
  if (!lyricResponse.ok) throw new Error(`Binimum lyric download returned HTTP ${lyricResponse.status}`);
  const candidate = lyricCandidate(
    -100 - best.index,
    "BiniLyrics",
    String(best.record.track_name ?? track.title),
    String(best.record.artist_name ?? artist),
    await lyricResponse.text(),
  );
  if (candidate) libraryLog.info(`Binimum selected candidate #${best.index + 1} score=${best.score.toFixed(1)}`);
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
      const [lyricsPlus, binimum] = await Promise.all([
        fetchLyricsPlus(track, artist).catch((error) => {
          libraryLog.warn("LyricsPlus lyric search failed:", error);
          return [];
        }),
        fetchBinimum(track, artist).catch((error) => {
          libraryLog.warn("Binimum lyric search failed:", error);
          return [];
        }),
      ]);
      libraryLog.info(
        `Lyric search results for ${artist} - ${track.title}: LRCLIB=${payload.length}, LyricsPlus=${lyricsPlus.length}, Binimum=${binimum.length}`,
      );
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
