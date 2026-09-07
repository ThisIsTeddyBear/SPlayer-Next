import type { LyricLine } from "@shared/types/lyrics";
import type { DesktopLyricAlign, DesktopLyricSettings } from "@shared/types/settings";

export interface DisplayItem {
  key: string;
  index: number;
  line: LyricLine;
  align: DesktopLyricAlign;
  scrollEnabled?: boolean;
  isPlaceholder?: boolean;
  isNext?: boolean;
}

export interface HorizontalScrollRange {
  startOffset: number;
  distance: number;
}

/**
 */
export const computeHorizontalScrollRange = (
  containerWidth: number,
  contentWidth: number,
  contentLeft: number,
): HorizontalScrollRange => {
  const distance = contentWidth - containerWidth;
  if (distance <= 0.5) return { startOffset: 0, distance: 0 };
  return { startOffset: contentLeft === 0 ? 0 : -contentLeft, distance };
};

/**
 */
export const measureHorizontalScrollRange = (
  container: Pick<HTMLElement, "clientWidth">,
  content: Pick<HTMLElement, "scrollWidth" | "offsetLeft">,
): HorizontalScrollRange =>
  computeHorizontalScrollRange(container.clientWidth, content.scrollWidth, content.offsetLeft);

const HORIZONTAL_SCROLL_START_RATIO = 0.3;
const HORIZONTAL_SCROLL_END_MARGIN_MS = 2000;
const HORIZONTAL_SCROLL_END_MARGIN_RATIO = 0.2;
const MIN_HORIZONTAL_SCROLL_DURATION_MS = 1200;

export interface HorizontalScrollOffsetOptions {
  currentMs: number;
  activatedAtMs: number;
  lineStartTime: number;
  lineEndTime: number;
  startOffset: number;
  distance: number;
}

/**
 */
export const computeHorizontalScrollOffset = (options: HorizontalScrollOffsetOptions): number => {
  const { currentMs, activatedAtMs, lineStartTime, lineEndTime, startOffset, distance } = options;
  if (distance <= 0) return startOffset;

  const scrollStartTime = Math.max(lineStartTime, activatedAtMs);
  const naturalDuration = Math.max(0, lineEndTime - scrollStartTime);
  const duration = Math.max(MIN_HORIZONTAL_SCROLL_DURATION_MS, naturalDuration);
  const endMargin = Math.min(
    HORIZONTAL_SCROLL_END_MARGIN_MS,
    duration * HORIZONTAL_SCROLL_END_MARGIN_RATIO,
  );
  const motionDuration = Math.max(1, duration - endMargin);
  const progress = Math.max(0, Math.min(1, (currentMs - scrollStartTime) / motionDuration));
  if (progress <= HORIZONTAL_SCROLL_START_RATIO) return startOffset;

  const ratio = (progress - HORIZONTAL_SCROLL_START_RATIO) / (1 - HORIZONTAL_SCROLL_START_RATIO);
  return startOffset - distance * ratio;
};

/**
 */
export const hasRealWordTiming = (line: LyricLine): boolean => {
  if (line.words.length <= 1) return false;
  const first = line.words[0];
  return first.endTime > first.startTime;
};

/**
 */
export const makePlaceholderLine = (text: string): LyricLine => ({
  words: [{ word: text, startTime: 0, endTime: 0 }],
  translatedLyric: "",
  romanLyric: "",
  startTime: 0,
  endTime: 0,
  isBG: false,
  isDuet: false,
});

/**
 */
export const getLineTop = (index: number, fontSize: number): string => {
  if (index === 0) return "0px";
  return `${Math.round(fontSize * 1.6)}px`;
};

const MIN_FONT_SIZE = 20;
const MAX_FONT_SIZE = 96;
const MIN_WINDOW_HEIGHT = 140;
const MAX_WINDOW_HEIGHT = 360;

/**
 */
export const computeWindowHeight = (fontSize: number): number => {
  const clamped = Math.min(Math.max(Math.round(fontSize), MIN_FONT_SIZE), MAX_FONT_SIZE);
  const ratio = (clamped - MIN_FONT_SIZE) / (MAX_FONT_SIZE - MIN_FONT_SIZE);
  return Math.round(MIN_WINDOW_HEIGHT + ratio * (MAX_WINDOW_HEIGHT - MIN_WINDOW_HEIGHT));
};

/**
 */
export const resolveAlign = (index: number, baseAlign: DesktopLyricAlign): DesktopLyricAlign => {
  if (baseAlign !== "justify") return baseAlign;
  return index % 2 === 0 ? "left" : "right";
};

/**
 */
export const resolveWordByWord = (
  config: Pick<DesktopLyricSettings, "wordByWord" | "autoGenerateWordByWord">,
  item: DisplayItem,
): boolean => {
  if (!config.wordByWord) return false;
  if (item.isPlaceholder) return false;
  if (config.autoGenerateWordByWord) return true;
  return hasRealWordTiming(item.line);
};
