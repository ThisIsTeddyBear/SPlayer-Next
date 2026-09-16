import type { LyricLine } from "@shared/types/lyrics";

/**
 * Synchronize the active time window between a main line and its adjacent background line.
 * Background lines attach to their preceding main line and share the widest combined duration.
 *
 * @param lines - Lyric lines array
 * @returns Normalized lyric lines array
 */
export const syncMainAndBackgroundLines = (lines: LyricLine[]): LyricLine[] => {
  for (let lineIdx = lines.length - 1; lineIdx >= 0; lineIdx--) {
    const line = lines[lineIdx];
    if (line.isBG) continue;

    const bg = lines[lineIdx + 1];
    if (!bg?.isBG) continue;

    let minStart = Math.min(line.startTime, bg.startTime);
    let maxEnd = Math.max(line.endTime, bg.endTime);

    const allWords = [...line.words, ...bg.words].filter((word) => word.word.trim().length > 0);
    for (const word of allWords) {
      if (word.startTime < minStart) minStart = word.startTime;
      if (word.endTime > maxEnd) maxEnd = word.endTime;
    }

    line.startTime = bg.startTime = minStart;
    line.endTime = bg.endTime = maxEnd;
  }

  return lines;
};

