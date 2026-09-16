/**
 * Lyric rendering engine — Lyric line DOM construction
 * Main lines are the primary layout unit; background lines are nested inside their
 * host main line's `.lp-line` container as absolute floats, forming a single geometric unit.
 */

import type { LyricLine } from "@shared/types/lyrics";
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
  /** Whether to display per-word romanization */
  showWordRomanization: boolean;
  /** Whether background lines are always placed below the main line */
  bgAlwaysBelow: boolean;
}

/** Line DOM build output result */
export interface LineBuildResult {
  /** Line DOM elements: main lines are `.lp-line`, background lines are `.lp-line-bg` floats inside */
  lineElements: HTMLDivElement[];
  wordMeasurements: WordMeasurement[][];
  lineAnimTargets: WordAnimTarget[][];
  /** Whether the background line is placed above the main line */
  isBgAbove: boolean[];
  fragment: DocumentFragment;
}

/** Build a single `.lp-main` word layer and populate measurement and animation targets */
const buildMainLayer = (
  line: LyricLine,
  mainDiv: HTMLDivElement,
  options: LineBuildOptions,
  isStatic: boolean,
  showWordRoman: boolean,
): { measurements: WordMeasurement[]; animTargets: WordAnimTarget[] } => {
  if (isStatic) {
    mainDiv.appendChild(document.createTextNode(line.words.map((w) => w.word).join("")));
    // Add uniform mask to static lines so --ba affects opacity identically to word-by-word lines
    mainDiv.style.setProperty(
      "mask-image",
      "linear-gradient(rgba(0,0,0,var(--ba)),rgba(0,0,0,var(--ba)))",
    );
    return { measurements: [], animTargets: [] };
  }
  const result = buildWordSpans(line.words, mainDiv, {
    enableEmphasizeEffect: options.enableEmphasizeEffect,
    emphasizeMinDuration: options.emphasizeMinDuration ?? 1000,
    showRuby: options.showRuby,
    showWordRoman,
  });
  return { measurements: result.measurements, animTargets: result.animTargets };
};

/** Append `.lp-sub` secondary text (translation / romanization) */
const appendSubs = (
  container: HTMLElement,
  line: LyricLine,
  options: LineBuildOptions,
  showLineRoman: boolean,
) => {
  if (options.showTranslation && line.translatedLyric) {
    const subDiv = document.createElement("div");
    subDiv.className = "lp-sub";
    subDiv.textContent = line.translatedLyric;
    container.appendChild(subDiv);
  }
  if (showLineRoman) {
    const subDiv = document.createElement("div");
    subDiv.className = "lp-sub";
    subDiv.textContent = line.romanLyric;
    container.appendChild(subDiv);
  }
};

/**
 * Construct DOM elements and associated metadata for all lyric lines
 * @param lines - Lyric lines array (background lines follow their main line)
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
    const main = lines[i - 1];
    if (!bg?.isBG || main?.isBG) continue;
    const bgStart = bg.words[0]?.startTime ?? bg.startTime;
    const mainStart = main.words[0]?.startTime ?? main.startTime;
    isBgAbove[i] = !options.bgAlwaysBelow && bgStart < mainStart;
  }

  const fragment = document.createDocumentFragment();
  // Most recent main line element for hosting subsequent background lines
  let hostingMain: HTMLDivElement | null = null;

  for (let i = 0; i < lineCount; i++) {
    const line = lines[i];
    if (!line) continue;

    const hasWordRoman = line.words.some((w) => Boolean(w.romanWord?.trim()));
    const showWordRomanForLine = options.showWordRomanization && hasWordRoman;
    const showLineRomanForLine =
      options.showRomanization && Boolean(line.romanLyric) && !showWordRomanForLine;
    const isStatic =
      (line.words.length === 0 || (line.words.length === 1 && !hasMultiWordLine)) &&
      !showWordRomanForLine &&
      !(options.showRuby && line.words[0]?.ruby?.length);

    // Main line (or background line degraded to main when no hosting main line exists)
    if (!line.isBG || !hostingMain) {
      const lineEl = document.createElement("div");
      const alignment = line.alignment ?? (line.isDuet ? "end" : "start");
      lineEl.className = [
        "lp-line",
        line.isDuet ? "duet" : "",
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

      const built = buildMainLayer(line, mainDiv, options, isStatic, showWordRomanForLine);
      wordMeasurements[i] = built.measurements;
      lineAnimTargets[i] = built.animTargets;

      const contentDiv = document.createElement("div");
      contentDiv.className = "lp-content";
      contentDiv.appendChild(mainDiv);
      appendSubs(contentDiv, line, options, showLineRomanForLine);

      lineEl.appendChild(contentDiv);
      lineElements[i] = lineEl;
      fragment.appendChild(lineEl);
      hostingMain = lineEl;
      continue;
    }

    // Background line nested inside host main line
    const bgEl = document.createElement("div");
    const bgAlignment = line.alignment ?? (line.isDuet ? "end" : "start");
    bgEl.className = [
      "lp-line-bg",
      isBgAbove[i] ? "above" : "",
      line.isDuet ? "duet" : "",
      `align-${bgAlignment}`,
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
      bgEl.style.setProperty("--lp-singer-color", `rgb(var(--s-cover-singer-${lane % 6}))`);
      bgEl.dataset.singer = line.singerName || line.singerId;
    }

    const bgMainDiv = document.createElement("div");
    bgMainDiv.className = "lp-main";
    if (line.language) bgMainDiv.lang = line.language;

    const built = buildMainLayer(line, bgMainDiv, options, isStatic, showWordRomanForLine);
    wordMeasurements[i] = built.measurements;
    lineAnimTargets[i] = built.animTargets;
    bgEl.appendChild(bgMainDiv);
    appendSubs(bgEl, line, options, showLineRomanForLine);

    hostingMain.classList.add("has-bg");
    hostingMain.appendChild(bgEl);
    lineElements[i] = bgEl;
  }

  return { lineElements, wordMeasurements, lineAnimTargets, isBgAbove, fragment };
};
