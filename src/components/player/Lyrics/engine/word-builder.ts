/**
 * Word span construction, ruby markup, and CSS mask measurements
 */

import type { LyricLine, LyricSpan, LyricWord } from "@shared/types/lyrics";
import { chunkAndSplitLyricWords, needsSpaceBetween } from "../utils/split-words";
import { shouldChunkEmphasize } from "./emphasize";

/** Measurement data for a single word DOM element */
export interface WordMeasurement {
  /** Target HTML span element */
  element: HTMLSpanElement;
  /** Associated lyric word data */
  word: LyricWord;
  /** Rendered element width (px) */
  width: number;
  /** Fade gradient region width (px) */
  fadeWidth: number;
}

/** Animation target descriptor for line animation manager */
export interface WordAnimTarget {
  element: HTMLElement;
  word: LyricWord;
  isEmphasize: boolean;
  charElements: HTMLElement[];
  isLastWord: boolean;
}

/** Return result of buildWordSpans */
export interface BuildResult {
  measurements: WordMeasurement[];
  animTargets: WordAnimTarget[];
}

/** Word construction options */
export interface WordBuildOptions {
  /** Whether to enable sustained syllable emphasis effect */
  enableEmphasizeEffect: boolean;
  /** Minimum duration threshold for emphasis in ms */
  emphasizeMinDuration: number;
  /** Whether to render ruby pronunciation annotations */
  showRuby: boolean;
}

/**
 * Construct word span elements and append them to the main line container
 * @param words - Raw lyric words array
 * @param mainDiv - Target host element
 * @param options - Build options
 * @returns Measurement data and animation targets
 */
export const buildWordSpans = (
  words: LyricWord[],
  mainDiv: HTMLDivElement,
  options: WordBuildOptions,
): BuildResult => {
  const { enableEmphasizeEffect: enableEmphasize, emphasizeMinDuration, showRuby } = options;
  const chunks = chunkAndSplitLyricWords(words);
  const measurements: WordMeasurement[] = [];
  const animTargets: WordAnimTarget[] = [];

  const hasWhitespaceInfo = chunks.some((chunk) => {
    if (Array.isArray(chunk)) {
      return chunk.some((word) => word.word !== word.word.trim() || word.endsWithSpace);
    }
    return chunk.word !== chunk.word.trim() || chunk.endsWithSpace;
  });

  const nonEmptyChunks: (LyricWord | LyricWord[])[] = chunks.filter((c) =>
    Array.isArray(c) ? c.some((w) => w.word.trim()) : c.word.trim(),
  );
  const lastChunk = nonEmptyChunks[nonEmptyChunks.length - 1];

  if (!hasWhitespaceInfo) {
    let previousText = "";
    for (const chunk of chunks) {
      const atoms = Array.isArray(chunk) ? chunk : [chunk];
      const isEmp =
        enableEmphasize && atoms.length > 0 && shouldChunkEmphasize(atoms, emphasizeMinDuration);
      const isLast = chunk === lastChunk;

      const firstText = atoms[0]?.word.trim();
      if (firstText && needsSpaceBetween(previousText, firstText)) {
        mainDiv.appendChild(document.createTextNode(" "));
      }

      if (isEmp) {
        buildEmphasizedChunk(atoms, mainDiv, measurements, animTargets, isLast);
      } else {
        for (const atom of atoms) {
          const text = atom.word.trim();
          if (!text) continue;
          appendWordSpan(atom, mainDiv, measurements, animTargets, showRuby);
        }
      }
      const lastAtom = atoms[atoms.length - 1];
      if (lastAtom) previousText = lastAtom.word.trim();
    }
    return { measurements, animTargets };
  }

  // Normal path with explicit spaces or endsWithSpace markers
  let previousText = "";

  for (const chunk of chunks) {
    if (Array.isArray(chunk)) {
      const mergedText = chunk.map((word) => word.word).join("");
      const isEmp = enableEmphasize && shouldChunkEmphasize(chunk, emphasizeMinDuration);
      const isLast = chunk === lastChunk;

      if (mergedText.trimStart() !== mergedText) {
        mainDiv.appendChild(document.createTextNode(" "));
      } else if (needsSpaceBetween(previousText, mergedText)) {
        mainDiv.appendChild(document.createTextNode(" "));
      }

      if (isEmp) {
        buildEmphasizedChunk(chunk, mainDiv, measurements, animTargets, isLast);
      } else {
        for (let wIdx = 0; wIdx < chunk.length; wIdx++) {
          const word = chunk[wIdx];
          appendWordSpan(word, mainDiv, measurements, animTargets, showRuby);
          if (word.endsWithSpace && wIdx < chunk.length - 1) {
            mainDiv.appendChild(document.createTextNode(" "));
          }
        }
      }

      const lastWord = chunk[chunk.length - 1];
      if (mergedText.trimEnd() !== mergedText || lastWord?.endsWithSpace) {
        mainDiv.appendChild(document.createTextNode(" "));
        previousText = "";
      } else {
        previousText = mergedText;
      }
    } else if (!chunk.word.trim()) {
      mainDiv.appendChild(document.createTextNode(" "));
      previousText = "";
    } else {
      const text = chunk.word;
      const isEmp = enableEmphasize && shouldChunkEmphasize([chunk], emphasizeMinDuration);
      const isLast = chunk === lastChunk;

      if (text.trimStart() !== text) {
        mainDiv.appendChild(document.createTextNode(" "));
      } else if (needsSpaceBetween(previousText, text)) {
        mainDiv.appendChild(document.createTextNode(" "));
      }

      if (isEmp) {
        buildEmphasizedChunk([chunk], mainDiv, measurements, animTargets, isLast);
      } else {
        appendWordSpan(chunk, mainDiv, measurements, animTargets, showRuby);
      }

      if (text.trimEnd() !== text || chunk.endsWithSpace) {
        mainDiv.appendChild(document.createTextNode(" "));
        previousText = "";
      } else {
        previousText = text.trim();
      }
    }
  }
  return { measurements, animTargets };
};

/**
 * Create a standard word span (with optional ruby annotations)
 * @param word - Word data
 * @param mainDiv - Target container
 * @param measurements - Output measurements array
 * @param animTargets - Output animation targets array
 * @param showRuby - Whether to render ruby markup
 */
const appendWordSpan = (
  word: LyricWord,
  mainDiv: HTMLDivElement,
  measurements: WordMeasurement[],
  animTargets: WordAnimTarget[],
  showRuby: boolean,
) => {
  const span = document.createElement("span");
  const ruby = showRuby ? word.ruby : undefined;

  if (ruby?.length) {
    buildRubyContent(span, word.word, ruby);
  } else {
    span.textContent = word.word;
  }

  mainDiv.appendChild(span);
  measurements.push({ element: span, word, width: 0, fadeWidth: 0 });
  animTargets.push({
    element: span,
    word,
    isEmphasize: false,
    charElements: [],
    isLastWord: false,
  });
};

/**
 * Construct ruby furigana/pronunciation content
 * When ruby spans count matches character count, pair 1:1; otherwise annotate entire word
 * @param span - Host word span
 * @param text - Base text
 * @param ruby - Ruby annotation spans array
 */
const buildRubyContent = (span: HTMLSpanElement, text: string, ruby: LyricSpan[]) => {
  const chars = Array.from(text);
  const validRuby = ruby.filter((r) => r.word.trim());
  if (validRuby.length === chars.length) {
    for (let i = 0; i < chars.length; i++) {
      const rubyEl = document.createElement("ruby");
      rubyEl.textContent = chars[i];
      const rt = document.createElement("rt");
      rt.textContent = validRuby[i].word;
      rubyEl.appendChild(rt);
      span.appendChild(rubyEl);
    }
  } else {
    const rubyEl = document.createElement("ruby");
    rubyEl.textContent = text;
    const rt = document.createElement("rt");
    rt.textContent = validRuby.map((r) => r.word).join("");
    rubyEl.appendChild(rt);
    span.appendChild(rubyEl);
  }
};

/**
 * Construct emphasized word chunk
 * @param atoms - Grouped atoms before merging
 * @param mainDiv - Target host element
 * @param measurements - Output measurements array
 * @param animTargets - Output animation targets array
 * @param isLastWord - Whether this is the last word of the line
 */
const buildEmphasizedChunk = (
  atoms: LyricWord[],
  mainDiv: HTMLDivElement,
  measurements: WordMeasurement[],
  animTargets: WordAnimTarget[],
  isLastWord: boolean,
) => {
  const mergedWord: LyricWord = {
    word: atoms.map((a) => a.word).join(""),
    startTime: Math.min(...atoms.map((a) => a.startTime)),
    endTime: Math.max(...atoms.map((a) => a.endTime)),
    endsWithSpace: atoms[atoms.length - 1]?.endsWithSpace,
  };
  const trimmed = mergedWord.word.trim();

  const wrapper = document.createElement("span");
  wrapper.className = "lp-emp-wrapper";

  const charElements: HTMLElement[] = [];
  for (const char of trimmed) {
    const charSpan = document.createElement("span");
    charSpan.textContent = char;
    wrapper.appendChild(charSpan);
    charElements.push(charSpan);
  }

  mainDiv.appendChild(wrapper);
  measurements.push({ element: wrapper, word: mergedWord, width: 0, fadeWidth: 0 });
  animTargets.push({
    element: wrapper,
    word: mergedWord,
    isEmphasize: true,
    charElements,
    isLastWord,
  });
};

/**
 * Measure all word dimensions and apply CSS masks with read-write separation
 * Batch reads all DOM dimensions in pass 1 (single reflow),
 * then writes all mask CSS properties in pass 2 (zero reflows).
 *
 * @param wordMeasurements - Word measurements per line
 * @param fadeRatio - Mask fade gradient width ratio
 * @param lines - Lyric lines array providing line start timestamps
 */
export const measureAndApplyWordMasks = (
  wordMeasurements: WordMeasurement[][],
  fadeRatio: number,
  lines?: LyricLine[],
) => {
  const paddings: number[][] = new Array(wordMeasurements.length);

  // Batch read DOM dimensions (single reflow)
  for (let i = 0; i < wordMeasurements.length; i++) {
    const lineMeasurements = wordMeasurements[i];
    if (!lineMeasurements) {
      paddings[i] = [];
      continue;
    }
    paddings[i] = new Array(lineMeasurements.length);
    for (let j = 0; j < lineMeasurements.length; j++) {
      const m = lineMeasurements[j];
      const el = m.element;
      const padding = el.classList.contains("lp-emp-wrapper")
        ? Number.parseFloat(getComputedStyle(el).paddingLeft) || 0
        : 0;
      paddings[i][j] = padding;
      m.width = (el.clientWidth || 1) - padding * 2;
      m.fadeWidth = ((el.clientHeight || 16) - padding * 2) * fadeRatio;
    }
  }

  // Batch write CSS mask styles (zero reflows)
  for (let i = 0; i < wordMeasurements.length; i++) {
    const lineMeasurements = wordMeasurements[i];
    const lineStart = lines?.[i]?.startTime ?? 0;
    if (!lineMeasurements) continue;
    for (let j = 0; j < lineMeasurements.length; j++) {
      const measurement = lineMeasurements[j];
      const padding = paddings[i][j];
      const elementWidth = measurement.width;
      const gradientWidth = measurement.fadeWidth;
      const totalAspect = 2 + gradientWidth / elementWidth;
      const gradientRatio = gradientWidth / elementWidth / totalAspect;
      const gradientStart = (1 - gradientRatio) / 2;
      const maskImage = `linear-gradient(to right,rgba(0,0,0,var(--ba)) ${gradientStart * 100}%,rgba(0,0,0,var(--da)) ${(gradientStart + gradientRatio) * 100}%)`;
      const maskPixelWidth = totalAspect * elementWidth;
      const maskSize = `${maskPixelWidth}px 100%`;
      const wordData = measurement.word;
      const totalMaskWidth = elementWidth + gradientWidth;
      const wordDuration = Math.abs(wordData.endTime - wordData.startTime) || 1;
      // Pre-roll: start sweep slightly before startTime so adjacent words connect seamlessly
      const preRoll = Math.min(80, wordDuration * 0.3);
      const adjustedStart = Math.min(
        wordData.startTime,
        Math.max(lineStart, wordData.startTime - preRoll),
      );
      const adjustedDuration = Math.max(1, wordData.endTime - adjustedStart);
      const startPos = padding - totalMaskWidth;
      const endPos = padding;
      const speed = totalMaskWidth / adjustedDuration;
      const maskPosition = Number.isFinite(speed)
        ? `clamp(${startPos}px,calc(${startPos}px + (var(--t,${lineStart}) - ${adjustedStart}) * ${speed}px),${endPos}px) 0px,left top`
        : `${startPos}px 0px,left top`;
      const style = measurement.element.style;
      style.setProperty("-webkit-mask-image", maskImage);
      style.setProperty("-webkit-mask-size", maskSize);
      style.setProperty("-webkit-mask-repeat", "repeat-y");
      style.setProperty("-webkit-mask-position", maskPosition);
      style.setProperty("mask-image", maskImage);
      style.setProperty("mask-size", maskSize);
      style.setProperty("mask-repeat", "repeat-y");
      style.setProperty("mask-position", maskPosition);
    }
  }
};
