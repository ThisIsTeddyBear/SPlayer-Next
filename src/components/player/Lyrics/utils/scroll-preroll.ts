import type { LyricLine } from "@shared/types/lyrics";

/** Scroll pre-roll optimization options */
export interface ScrollPrerollOptions {
  /** Advance time when there is no overlap with the previous line in milliseconds. Default: 600 */
  advanceNoOverlap: number;
  /** Advance time when overlapping with the previous line in milliseconds. Default: 400 */
  advanceOverlap: number;
  /** Overlap boundary ratio relative to the previous line's duration (0-1). Default: 0.3 */
  overlapBoundaryRatio: number;
}

/** Default scroll pre-roll configuration */
export const DEFAULT_SCROLL_PREROLL_OPTIONS: Required<ScrollPrerollOptions> = {
  advanceNoOverlap: 600,
  advanceOverlap: 400,
  overlapBoundaryRatio: 0.3,
};

/**
 * Scroll pre-roll: advances each line's start time slightly ahead of time
 * so the renderer smoothly scrolls the target line into view before singing begins.
 *
 * Decisions are strictly based on the lines' original timestamps. Overlapping consecutive
 * main lines (e.g., duet sections) are grouped together to prevent advancing into an active group.
 *
 * @param sourceLines - Normalized lyric line array
 * @param options - Custom advance amounts and boundary ratios
 * @returns Cloned line array with pre-roll applied
 */
export const applyScrollPreroll = (
  sourceLines: readonly LyricLine[],
  options?: Partial<ScrollPrerollOptions>,
): LyricLine[] => {
  const advanceNoOverlap =
    options?.advanceNoOverlap ?? DEFAULT_SCROLL_PREROLL_OPTIONS.advanceNoOverlap;
  const advanceOverlap = options?.advanceOverlap ?? DEFAULT_SCROLL_PREROLL_OPTIONS.advanceOverlap;
  const overlapBoundaryRatio =
    options?.overlapBoundaryRatio ?? DEFAULT_SCROLL_PREROLL_OPTIONS.overlapBoundaryRatio;

  const lines = sourceLines.map((line) => ({ ...line }));

  let prevLineStartTime = 0;
  let prevLineEndTime = 0;
  let prevGroupStartTime = 0;
  let prevGroupEndTime = 0;
  let hasPrevLine = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    if (line.isBG) continue;

    const originalStartTime = line.startTime;
    const originalEndTime = line.endTime;

    let advance: number;
    let boundary: number;

    if (hasPrevLine) {
      const hadGap = originalStartTime >= prevLineEndTime;
      if (hadGap) {
        advance = advanceNoOverlap;
        boundary = prevGroupEndTime;
      } else {
        advance = advanceOverlap;
        boundary = prevLineStartTime + (prevLineEndTime - prevLineStartTime) * overlapBoundaryRatio;
      }
    } else {
      advance = advanceNoOverlap;
      boundary = 0;
    }

    const newStart = Math.max(boundary, originalStartTime - advance);
    if (newStart < line.startTime) line.startTime = newStart;

    // Paired background lines advance alongside their main line, but not later than their original onset
    const bg = lines[lineIdx + 1];
    if (bg?.isBG) bg.startTime = Math.min(bg.startTime, line.startTime);

    // Update overlapping group: merge if overlapping with previous group, else start fresh
    if (
      hasPrevLine &&
      originalStartTime < prevGroupEndTime &&
      originalEndTime > prevGroupStartTime
    ) {
      prevGroupStartTime = Math.min(prevGroupStartTime, originalStartTime);
      prevGroupEndTime = Math.max(prevGroupEndTime, originalEndTime);
    } else {
      prevGroupStartTime = originalStartTime;
      prevGroupEndTime = originalEndTime;
    }

    prevLineStartTime = originalStartTime;
    prevLineEndTime = originalEndTime;
    hasPrevLine = true;
  }

  return lines;
};
