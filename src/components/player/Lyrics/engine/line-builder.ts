/**
 * Lyric rendering engine — Lyric line DOM construction
 */

import type { LyricLine } from "@shared/types/lyrics";
import { getLineText } from "@shared/utils/lyrics";
import {
  buildWordSpans,
  type WordAnimTarget,
  type WordBuildOptions,
  type WordMeasurement,
} from "./word-builder";

/** Line DOM build options */
export interface LineBuildOptions extends WordBuildOptions {
  /** Whether to display translation lyrics */
  showTranslation: boolean;
  /** Whether to display romanized lyrics */
  showRomanization: boolean;
  /** Whether background lines are always placed below the main line */
  bgAlwaysBelow: boolean;
}

/** Line DOM build output result */
export interface LineBuildResult {
  /** Line DOM elements */
  lineElements: HTMLDivElement[];
  wordMeasurements: WordMeasurement[][];
  lineAnimTargets: WordAnimTarget[][];
  /** Whether the background line is placed above the main line */
  isBgAbove: boolean[];
  fragment: DocumentFragment;
}

/**
 * Construct DOM elements and associated metadata for all lyric lines
 * @param lines - Lyric lines array
 * @param options - Build options
 * @returns Built line elements, measurements, animation targets, and placement flags
 */
export const buildLineElements = (
  lines: LyricLine[],
  options: LineBuildOptions,
): LineBuildResult => {
  const lineCount = lines.length;
  const lineElements: HTMLDivElement[] = new Array(lineCount);
  const wordMeasurements: WordMeasurement[][] = new Array(lineCount);
  const lineAnimTargets: WordAnimTarget[][] = new Array(lineCount);
  const isBgAbove: boolean[] = new Array(lineCount).fill(false);
  const singerLanes = new Map<string, number>();

  const hasMultiWordLine = lines.some((line) => line.words.length > 1);

  // Background vocal lines: placed above if starting earlier than main, unless bgAlwaysBelow is set
  for (let i = 1; i < lineCount; i++) {
    const bg = lines[i];
    if (!bg?.isBG) continue;
    if (options.bgAlwaysBelow) {
      isBgAbove[i] = false;
      continue;
    }
    let mainIdx = i - 1;
    while (mainIdx >= 0 && lines[mainIdx].isBG) mainIdx--;
    const main = lines[mainIdx];
    if (!main) continue;
    const bgStart = bg.words[0]?.startTime ?? bg.startTime;
    const mainStart = main.words[0]?.startTime ?? main.startTime;
    isBgAbove[i] = bgStart < mainStart;
  }

  const fragment = document.createDocumentFragment();

  for (let i = 0; i < lineCount; i++) {
    const line = lines[i];
    if (!line) continue;

    const lineEl = document.createElement("div");
    const alignment = line.alignment ?? (line.isDuet ? "end" : "start");
    lineEl.className = [
      "lp-line",
      line.isDuet ? "duet" : "",
      line.isBG ? "bg" : "",
      `align-${alignment}`,
      line.singerRole ? `role-${line.singerRole}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    if (line.singerId) {
      let lane = singerLanes.get(line.singerId);
      if (lane === undefined) {
        lane = singerLanes.size;
        singerLanes.set(line.singerId, lane);
      }
      lineEl.style.setProperty("--lp-singer-color", `rgb(var(--s-cover-singer-${lane % 6}))`);
      lineEl.dataset.singer = line.singerName || line.singerId;
    }

    const mainDiv = document.createElement("div");
    mainDiv.className = "lp-main";
    if (line.language) mainDiv.lang = line.language;

    const isStatic =
      (line.words.length === 0 || (line.words.length === 1 && !hasMultiWordLine)) &&
      !(options.showRuby && line.words[0]?.ruby?.length);

    if (isStatic) {
      mainDiv.appendChild(document.createTextNode(getLineText(line)));
      mainDiv.style.setProperty(
        "mask-image",
        "linear-gradient(rgba(0,0,0,var(--ba)),rgba(0,0,0,var(--ba)))",
      );
      wordMeasurements[i] = [];
      lineAnimTargets[i] = [];
    } else {
      const result = buildWordSpans(line.words, mainDiv, {
        enableEmphasizeEffect: options.enableEmphasizeEffect,
        emphasizeMinDuration: options.emphasizeMinDuration ?? 1000,
        showRuby: options.showRuby,
      });
      wordMeasurements[i] = result.measurements;
      lineAnimTargets[i] = result.animTargets;
    }

    const contentDiv = document.createElement("div");
    contentDiv.className = "lp-content";
    contentDiv.appendChild(mainDiv);

    if (options.showTranslation && line.translatedLyric) {
      const subDiv = document.createElement("div");
      subDiv.className = "lp-sub";
      subDiv.textContent = line.translatedLyric;
      contentDiv.appendChild(subDiv);
    }
    if (options.showRomanization && line.romanLyric) {
      const subDiv = document.createElement("div");
      subDiv.className = "lp-sub";
      subDiv.textContent = line.romanLyric;
      contentDiv.appendChild(subDiv);
    }

    lineEl.appendChild(contentDiv);
    lineElements[i] = lineEl;
    fragment.appendChild(lineEl);
  }

  return { lineElements, wordMeasurements, lineAnimTargets, isBgAbove, fragment };
};
