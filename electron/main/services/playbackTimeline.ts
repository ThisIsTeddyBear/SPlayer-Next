interface CueRange {
  startMs: number;
  durationMs: number;
}

let cueRange: CueRange | null = null;
let generation = 0;

/** 所有播放入口共用分轨时间轴及加载代次。 */
export const beginPlaybackLoad = (track?: { cueStartMs?: number; cueEndMs?: number } | null): number => {
  const start = track?.cueStartMs;
  const end = track?.cueEndMs;
  cueRange =
    typeof start === "number" &&
    typeof end === "number" &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end > start
      ? { startMs: start, durationMs: end - start }
      : null;
  return ++generation;
};

export const getPlaybackGeneration = (): number => generation;
export const isCurrentPlaybackLoad = (value: number): boolean => value === generation;
export const getCueRange = (): CueRange | null => cueRange;
export const clearPlaybackTimeline = (): void => {
  beginPlaybackLoad();
};

export const toDisplayPositionMs = (positionMs: number): number =>
  cueRange
    ? Math.max(0, Math.min(cueRange.durationMs, positionMs - cueRange.startMs))
    : positionMs;

export const toDisplayDurationMs = (durationMs: number): number => cueRange?.durationMs ?? durationMs;

export const toEnginePositionMs = (positionMs: number): number => {
  if (!Number.isFinite(positionMs) || positionMs < 0) throw new Error("Invalid seek position");
  return cueRange ? cueRange.startMs + Math.min(positionMs, cueRange.durationMs) : positionMs;
};
