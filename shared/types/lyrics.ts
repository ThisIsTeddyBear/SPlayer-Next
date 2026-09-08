import type { Platform } from "./platform";
import type { IpcResponse, Track } from "./player";

export type LyricFormat = "ttml" | "json" | "lys" | "yrc" | "qrc" | "krc" | "lrc" | "srt" | "ass";

export const DEFAULT_LYRIC_FORMAT_ORDER: readonly LyricFormat[] = [
  "ttml",
  "json",
  "lys",
  "qrc",
  "krc",
  "yrc",
  "lrc",
  "ass",
  "srt",
];

export type LyricSource = "external" | "embedded" | "online";

export type LyricLanguage = "ja" | "ko" | "zh-CN" | "und-Latn";

export type LyricSingerRole = "lead" | "background" | "response" | "group";
export type LyricLineAlignment = "start" | "center" | "end";

export type LyricData = {
  source: LyricSource;
  format: LyricFormat;
  platform?: Platform;
} | null;

export interface LyricSpan {
  startTime: number;
  endTime: number;
  word: string;
}

export interface LyricWord extends LyricSpan {
  romanWord?: string;
  obscene?: boolean;
  ruby?: LyricSpan[];
  synthetic?: boolean;
}

export interface LyricLine {
  language?: LyricLanguage;
  /**
   */
  words: LyricWord[];
  translatedLyric: string;
  romanLyric: string;
  startTime: number;
  endTime: number;
  isBG: boolean;
  isDuet: boolean;
  singerId?: string;
  singerName?: string;
  singerRole?: LyricSingerRole;
  alignment?: LyricLineAlignment;
  sourceKey?: string;
  songPartIndex?: number;
}

/**
 */
export interface LyricInput {
  content: string;
  translation?: string;
  translationFormat?: LyricFormat;
  romaji?: string;
  romajiFormat?: LyricFormat;
}

export interface LyricMatchExtra {
  mid?: string;
}

export interface LyricMatchResult extends LyricInput {
  platform: Platform;
  format: LyricFormat;
  extra?: LyricMatchExtra;
}

export interface FetchedLyricCandidate {
  id: number;
  provider: string;
  format: LyricFormat;
  timing: "word" | "line" | "unsynced";
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  content: string;
}

export interface SavedLyric {
  path: string;
  removed: string[];
}

export type LyricMatchResponse =
  { ok: true; data: LyricMatchResult | null } | { ok: false; error: string };

export type LyricTTMLResponse = { ok: true; data: string | null } | { ok: false; error: string };

export interface LyricsApi {
  romanize: (lines: string[]) => Promise<Record<string, string>>;
  matchById: (platform: Platform, id: string) => Promise<LyricMatchResponse>;
  matchByQuery: (platform: Platform, track: Track) => Promise<LyricMatchResponse>;
  fetchTTMLOverlay: (track: Track, platform: "netease" | "qqmusic") => Promise<LyricTTMLResponse>;
  matchLocalTTML: (track: Track) => Promise<LyricTTMLResponse>;
  pickLyricRepoDir: () => Promise<string | null>;
  searchLocalCandidates: (track: Track) => Promise<IpcResponse<FetchedLyricCandidate[]>>;
  saveLocalCandidate: (
    track: Track,
    content: string,
    format: LyricFormat,
  ) => Promise<IpcResponse<SavedLyric>>;
}
