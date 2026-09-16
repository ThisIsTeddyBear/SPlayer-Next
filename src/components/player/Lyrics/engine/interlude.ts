/**
 * Lyric rendering engine — Interlude dots animation.
 * Manages the lifecycle of the three interlude dots: entrance scaling/fade-in, breathing animation, exit scaling/fade-out.
 * Dots light up sequentially to indicate progress.
 */

import { clamp, easeInOutBack, easeOutExpo } from "../utils/math";
import type { LyricLine } from "@shared/types/lyrics";

/** Interlude detection result: [startTime, endTime, prevLineIndex, isNextDuet] */
export type InterludeInfo = [number, number, number, boolean];

/**
 * Detect whether current playback time is within an interlude.
 * Searches for interlude gaps within one line before and after the active line.
 *
 * @param currentTime - Current playback time in milliseconds
 * @param activeLineIndex - Currently active line index
 * @param lines - Array of lyric lines
 * @param minInterludeGap - Minimum gap duration in milliseconds to trigger interlude
 * @returns Interlude info or undefined
 */
export const detectInterlude = (
  currentTime: number,
  activeLineIndex: number,
  lines: LyricLine[],
  minInterludeGap: number,
): InterludeInfo | undefined => {
  const adjustedTime = currentTime + 20;

  const checkGap = (lineIndex: number): InterludeInfo | undefined => {
    if (lineIndex < -1 || lineIndex >= lines.length - 1) return undefined;
    const prevLine = lineIndex === -1 ? null : lines[lineIndex];
    const nextLine = lines[lineIndex + 1];
    const gapStart = prevLine ? prevLine.endTime : 0;
    const gapEnd = Math.max(gapStart, nextLine.startTime - 250);
    if (gapEnd - gapStart < minInterludeGap) return undefined;
    if (gapEnd > adjustedTime && gapStart < adjustedTime)
      return [gapStart, gapEnd, lineIndex, nextLine.isDuet];
    return undefined;
  };

  return (
    checkGap(activeLineIndex - 1) || checkGap(activeLineIndex) || checkGap(activeLineIndex + 1)
  );
};

/** State of the interlude dots renderer */
export interface InterludeState {
  /** Whether the interlude is active */
  isActive: boolean;
  /** Interlude start time in milliseconds */
  startTime: number;
  /** Interlude end time in milliseconds */
  endTime: number;
  /** Dot X coordinate */
  x: number;
  /** Dot Y coordinate */
  y: number;
  /** Whether dots are right-aligned (for interlude before duet line) */
  alignRight: boolean;
  /** Anchored next lyric line index */
  anchorIndex: number;
  /** Dot vertical offset relative to anchor line */
  anchorOffset: number;
}

/** Style cache for interlude dots renderer */
export interface InterludeCache {
  /** Last written container style string */
  containerStyle: string;
  /** Last written dot opacities */
  dotOpacities: [string, string, string];
}

/**
 * Create interlude dots DOM structure.
 *
 * @param parentElement - Parent container element
 * @returns [Container element, tuple of 3 dot elements]
 */
export const createInterludeDots = (
  parentElement: HTMLElement,
): [HTMLDivElement, [HTMLSpanElement, HTMLSpanElement, HTMLSpanElement]] => {
  const container = document.createElement("div");
  container.className = "lp-dots";
  const dot0 = document.createElement("span");
  const dot1 = document.createElement("span");
  const dot2 = document.createElement("span");
  container.append(dot0, dot1, dot2);
  parentElement.appendChild(container);
  return [container, [dot0, dot1, dot2]];
};

/**
 * Render interlude dots animation.
 * Covers entrance (scale + fade-in), breathing (sine wave scale), and exit (rebound scale + fade-out).
 *
 * @param currentTime - Current playback time in milliseconds
 * @param state - Current interlude state
 * @param dotsContainer - Dots container element
 * @param dotElements - Three dot elements
 * @param cache - Style cache to prevent redundant DOM writes
 * @param breatheCycleTarget - Target breathing animation cycle in milliseconds
 */
export const renderInterludeDots = (
  currentTime: number,
  state: InterludeState,
  dotsContainer: HTMLDivElement,
  dotElements: [HTMLSpanElement, HTMLSpanElement, HTMLSpanElement],
  cache: InterludeCache,
  breatheCycleTarget: number,
) => {
  if (!state.isActive) {
    if (cache.containerStyle !== "hide") {
      dotsContainer.style.opacity = "0";
      cache.containerStyle = "hide";
    }
    return;
  }

  const totalDuration = state.endTime - state.startTime;
  const elapsed = currentTime - state.startTime;

  if (elapsed < 0 || elapsed > totalDuration) {
    if (cache.containerStyle !== "hide") {
      dotsContainer.style.opacity = "0";
      cache.containerStyle = "hide";
    }
    return;
  }

  const breatheCycle = totalDuration / Math.ceil(totalDuration / breatheCycleTarget);

  let scale = 1;
  let opacity = 1;

  // Breathing scale (subtle sine wave)
  scale *= Math.sin(1.5 * Math.PI - (elapsed / breatheCycle) * 2) / 20 + 1;

  // Entrance scale (exponential ease-out)
  if (elapsed < 2000) scale *= easeOutExpo(elapsed / 2000);

  // Entrance fade-in
  if (elapsed < 500) opacity = 0;
  else if (elapsed < 1000) opacity *= (elapsed - 500) / 500;

  // Exit animation
  const remaining = totalDuration - elapsed;
  if (remaining < 750) scale *= 1 - easeInOutBack((750 - remaining) / 750 / 2);
  if (remaining < 375) opacity *= clamp(0, remaining / 375, 1);

  scale = Math.max(0, scale);

  const origin = state.alignRight ? "right center" : "left center";
  const transformStr = `translate(${state.x.toFixed(1)}px,${state.y.toFixed(1)}px) scale(${scale.toFixed(4)})`;
  const styleKey = transformStr + origin;
  if (cache.containerStyle !== styleKey) {
    cache.containerStyle = styleKey;
    dotsContainer.style.opacity = String(opacity);
    dotsContainer.style.transform = transformStr;
    dotsContainer.style.transformOrigin = origin;
  }

  // Individual dot opacities without per-frame array allocations
  const activeDuration = Math.max(0, totalDuration - 750);
  for (let i = 0; i < 3; i++) {
    const segElapsed = elapsed - (activeDuration / 3) * i;
    const segOpacity = clamp(0.25, ((segElapsed * 3) / activeDuration) * 0.75, 1);
    const newOpacity = String(clamp(0, opacity * segOpacity, 1));
    if (cache.dotOpacities[i] !== newOpacity) {
      cache.dotOpacities[i] = newOpacity;
      dotElements[i].style.opacity = newOpacity;
    }
  }
};
