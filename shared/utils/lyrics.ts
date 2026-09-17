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
