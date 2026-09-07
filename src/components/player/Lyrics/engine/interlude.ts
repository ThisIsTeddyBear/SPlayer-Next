/**
 *
 */

import { clamp, easeInOutBack, easeOutExpo } from "../utils/math";
import type { LyricLine } from "@shared/types/lyrics";

export type InterludeInfo = [number, number, number, boolean];

/**
 *
 *
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

export interface InterludeState {
  isActive: boolean;
  startTime: number;
  endTime: number;
  x: number;
  y: number;
  alignRight: boolean;
  anchorIndex: number;
  anchorOffset: number;
}

export interface InterludeCache {
  containerStyle: string;
  dotOpacities: [string, string, string];
}

/**
 *
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
 *
 *
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

  scale *= Math.sin(1.5 * Math.PI - (elapsed / breatheCycle) * 2) / 20 + 1;

  if (elapsed < 2000) scale *= easeOutExpo(elapsed / 2000);

  if (elapsed < 500) opacity = 0;
  else if (elapsed < 1000) opacity *= (elapsed - 500) / 500;

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

  const activeDuration = Math.max(0, totalDuration - 750);
  const newOpacities: [string, string, string] = [
    String(clamp(0, opacity * clamp(0.25, ((elapsed * 3) / activeDuration) * 0.75, 1), 1)),
    String(
      clamp(
        0,
        opacity * clamp(0.25, (((elapsed - activeDuration / 3) * 3) / activeDuration) * 0.75, 1),
        1,
      ),
    ),
    String(
      clamp(
        0,
        opacity *
          clamp(0.25, (((elapsed - (activeDuration / 3) * 2) * 3) / activeDuration) * 0.75, 1),
        1,
      ),
    ),
  ];

  for (let i = 0; i < 3; i++) {
    if (cache.dotOpacities[i] !== newOpacities[i]) {
      cache.dotOpacities[i] = newOpacities[i];
      dotElements[i].style.opacity = newOpacities[i];
    }
  }
};
