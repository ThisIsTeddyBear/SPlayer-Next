import type { LyricLine, LyricWord } from "../types/lyrics";

/**
 * Get plain text content of a single word/syllable (automatically handles trailing space).
 * @param word - Lyric word node
 * @returns Word text with handled trailing space
 */
export const getWordText = (word?: LyricWord | null): string => {
  if (!word) return "";
  return word.word + (word.endsWithSpace && !/\s$/.test(word.word) ? " " : "");
};

/**
 * Get transliteration/romaji text of a single word (automatically handles trailing space).
 * @param word - Lyric word node
 * @returns Romaji text with handled trailing space
 */
export const getWordRomaji = (word?: LyricWord | null): string => {
  if (!word?.romanWord) return "";
  return word.romanWord + (word.endsWithSpace && !/\s$/.test(word.romanWord) ? " " : "");
};

/**
 * Extract plain text of a lyric line (concatenates words and preserves inter-word spaces).
 * @param line - Lyric line data
 * @returns Complete plain text content
 */
export const getLineText = (line?: LyricLine | null): string => {
  if (!line?.words || line.words.length === 0) return "";
  return line.words.map(getWordText).join("");
};

/**
 * Extract transliteration/romaji text of a lyric line.
 * Prefers line-level romanLyric; falls back to concatenating word-level romaji with spacing.
 * @param line - Lyric line data
 * @returns Combined transliteration text
 */
export const getLineRomaji = (line?: LyricLine | null): string => {
  if (!line) return "";
  if (line.romanLyric) return line.romanLyric;
  if (!line.words || line.words.length === 0) return "";
  return line.words.map(getWordRomaji).join("");
};

const hasSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter !== "undefined";
let graphemeSegmenter: Intl.Segmenter | undefined;

/**
 * 将文本拆分为 Unicode 扩展字形簇（Grapheme Clusters）
 * 保证印地语/旁遮普语等复杂文字的变音符号（matra）、合字不被断开
 * @param text - 待拆分文本
 * @returns 字形簇字符串数组
 */
export const splitGraphemes = (text: string): string[] => {
  if (!text) return [];
  if (hasSegmenter) {
    graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
};
