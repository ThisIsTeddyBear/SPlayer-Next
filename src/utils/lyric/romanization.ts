import type { LyricLine } from "@shared/types/lyrics";
import { needsRomanization } from "@shared/utils/romanization";

export const getLyricLineText = (line: LyricLine): string =>
  line.words
    .map((word) => word.word)
    .join("")
    .trim();

export const collectMissingRomanization = (lines: LyricLine[]): string[] => [
  ...new Set(
    lines
      .filter((line) => !line.romanLyric.trim())
      .map(getLyricLineText)
      .filter(needsRomanization),
  ),
];

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
