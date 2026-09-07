import type { LyricLine, LyricSingerRole, LyricWord } from "@shared/types/lyrics";

type JsonToken = {
  text: string;
  time: number;
  duration: number;
  synthetic?: boolean;
};

type JsonLine = {
  time: number;
  duration: number;
  syllabus: JsonToken[];
  element?: {
    key?: string;
    singer?: string;
    songPartIndex?: number;
  };
};

type JsonAgent = {
  type?: string;
  name?: string;
};

type JsonLyrics = {
  type: "Word";
  metadata?: { agents?: Record<string, JsonAgent> };
  lyrics: JsonLine[];
};

const isJsonLyrics = (value: unknown): value is JsonLyrics => {
  if (!value || typeof value !== "object") return false;
  const lyrics = value as Partial<JsonLyrics>;
  return lyrics.type === "Word" && Array.isArray(lyrics.lyrics);
};

/**
 * 解析 Lyrics+ / QQ Music 的逐词 JSON 歌词。
 * @param text - JSON 歌词原文
 * @returns 统一歌词行
 */
export const parseJsonLyrics = (text: string): LyricLine[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON lyrics");
  }
  if (!isJsonLyrics(parsed)) throw new Error("Unsupported JSON lyric format");

  const agents = parsed.metadata?.agents ?? {};
  const mainSinger = Object.entries(agents).find(([, agent]) => agent.type === "person")?.[0] ?? "";

  return parsed.lyrics.map((line) => {
    const singerId = line.element?.singer || undefined;
    const singer = singerId ? agents[singerId] : undefined;
    const singerRole: LyricSingerRole =
      singer?.type === "group"
        ? "group"
        : singerId && singerId !== mainSinger
          ? "response"
          : "lead";
    const words: LyricWord[] = line.syllabus.map((token) => ({
      word: token.text,
      startTime: token.time,
      endTime: token.time + token.duration,
      synthetic: token.synthetic || undefined,
    }));
    return {
      words,
      translatedLyric: "",
      romanLyric: "",
      startTime: line.time,
      endTime: line.time + line.duration,
      isBG: false,
      isDuet: singerRole === "response",
      singerId,
      singerName: singer?.name || undefined,
      singerRole,
      alignment: singerRole === "group" ? "center" : singerRole === "response" ? "end" : "start",
      sourceKey: line.element?.key,
      songPartIndex: line.element?.songPartIndex,
    };
  });
};
