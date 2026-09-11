import type { LyricLine } from "@shared/types/lyrics";

/** 获取一行歌词的原文。 */
export const getLyricLineText = (line: LyricLine): string =>
  line.words
    .map((word) => word.word)
    .join("")
    .trim();

/** 收集没有内嵌罗马音的非拉丁歌词行。 */
export const collectMissingRomanization = (lines: LyricLine[]): string[] => [
  ...new Set(
    lines
      .filter((line) => !line.romanLyric.trim())
      .map(getLyricLineText)
      .filter((text) =>
        [...text].some((char) => /\p{Letter}/u.test(char) && !/\p{Script=Latin}/u.test(char)),
      ),
  ),
];

/** 将生成的罗马音填入原本没有内嵌转写的行。 */
export const applyGeneratedRomanization = (
  lines: LyricLine[],
  readings: Record<string, string>,
): LyricLine[] => {
  let changed = false;
  const result = lines.map((line) => {
    if (line.romanLyric.trim()) return line;

    const reading = readings[getLyricLineText(line)];
    if (!reading) return line;

    changed = true;
    return { ...line, romanLyric: reading };
  });

  return changed ? result : lines;
};
