import type { LyricLine } from "@shared/types/lyrics";

/**
 * Synchronize the active time window between a main line and its adjacent background lines.
 * Background lines attach to their preceding main line and share the widest combined duration.
 *
 * @param lines - Lyric lines array
 * @returns Normalized lyric lines array
 */
export const syncMainAndBackgroundLines = (lines: LyricLine[]): LyricLine[] => {
  for (let lineIdx = lines.length - 1; lineIdx >= 0; lineIdx--) {
    const line = lines[lineIdx];
    if (line.isBG) continue;

    const backgrounds: LyricLine[] = [];
    for (let bgIdx = lineIdx + 1; lines[bgIdx]?.isBG; bgIdx++) {
      backgrounds.push(lines[bgIdx]);
    }
    if (backgrounds.length === 0) continue;

    let minStart = line.startTime;
    let maxEnd = line.endTime;

    const allWords = [...line.words, ...backgrounds.flatMap((bg) => bg.words)].filter(
      (word) => word.word.trim().length > 0,
    );
    for (const word of allWords) {
      if (word.startTime < minStart) minStart = word.startTime;
      if (word.endTime > maxEnd) maxEnd = word.endTime;
    }
    for (const bg of backgrounds) {
      minStart = Math.min(minStart, bg.startTime);
      maxEnd = Math.max(maxEnd, bg.endTime);
    }

    line.startTime = minStart;
    line.endTime = maxEnd;
    for (const bg of backgrounds) {
      bg.startTime = minStart;
      bg.endTime = maxEnd;
    }
  }

  return lines;
};
