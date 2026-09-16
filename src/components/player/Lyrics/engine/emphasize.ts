/**
 * Word floating and long syllable emphasis animations
 *
 * Uses the Web Animations API to add:
 * 1. Base float (all words): subtle upward translation (0.05em) while singing.
 * 2. Emphasis effect (sustained syllables): scale + glow + sine floating + per-character stagger.
 */

import type { LyricWord } from "@shared/types/lyrics";
import { isCJK } from "../utils/split-words";

const FRAME_COUNT = 32;
const EMP_MID = 0.5;

/** Smoothstep easing curve */
const smoothstep = (x: number): number => x * x * (3 - 2 * x);

const normalize = (min: number, max: number, x: number) =>
  Math.min(1, Math.max(0, (x - min) / (max - min)));

/** Symmetric 0 -> peak -> 0 emphasis easing */
const empEasing = (x: number): number =>
  x < EMP_MID ? smoothstep(normalize(0, EMP_MID, x)) : 1 - smoothstep(normalize(EMP_MID, 1, x));

const scaleMatrix3dCSS = (s: number): string =>
  `matrix3d(${s},0,0,0,0,${s},0,0,0,0,${s},0,0,0,0,1)`;

/**
 * Determine whether a word satisfies the duration threshold for emphasis
 * @param word - Lyric word
 * @param minDuration - Minimum duration threshold in milliseconds
 */
export const shouldEmphasize = (word: LyricWord, minDuration = 1000): boolean => {
  const duration = word.endTime - word.startTime;
  if (duration < minDuration) return false;
  if (isCJK(word.word)) return true;
  const len = word.word.trim().length;
  return len > 1 && len <= 7;
};

/**
 * Determine whether a word chunk should have emphasis applied
 * @param chunk - Lyric words array in the chunk
 * @param minDuration - Minimum duration threshold in milliseconds
 */
export const shouldChunkEmphasize = (chunk: LyricWord[], minDuration = 1000): boolean => {
  if (chunk.some((w) => shouldEmphasize(w, minDuration))) return true;
  if (chunk.length > 1) {
    const merged: LyricWord = {
      word: chunk.map((w) => w.word).join(""),
      startTime: Math.min(...chunk.map((w) => w.startTime)),
      endTime: Math.max(...chunk.map((w) => w.endTime)),
    };
    if (!isCJK(merged.word)) return shouldEmphasize(merged, minDuration);
  }
  return false;
};

/**
 * Create base upward floating animation for a word span
 * @param wordEl - Word span element
 * @param delay - Delay relative to line start (ms)
 * @param duration - Animation duration (ms)
 * @param isBG - Whether this is a background vocal line
 * @returns Animation instance
 */
export const createFloatAnimation = (
  wordEl: HTMLElement,
  delay: number,
  duration: number,
  isBG: boolean,
): Animation => {
  let up = 0.05;
  if (isBG) up *= 2;
  const dur = Math.max(1000, duration);
  const del = Math.max(0, delay);

  const anim = wordEl.animate(
    [{ transform: "translateY(0px)" }, { transform: `translateY(${-up}em)` }],
    {
      duration: Number.isFinite(dur) ? dur : 0,
      delay: Number.isFinite(del) ? del : 0,
      id: "float-word",
      composite: "add",
      fill: "both",
      easing: "ease-out",
    },
  );
  anim.pause();
  return anim;
};

/**
 * Create glow, scale, and sine float animations for each character of an emphasized word
 * @param charElements - Character span elements array
 * @param duration - Total merged word duration (ms)
 * @param delay - Delay relative to line start (ms)
 * @param isLastWord - Whether this is the final word of the line
 * @param isBG - Whether this is a background vocal line
 * @returns Array of Animation instances
 */
export const createEmphasizeAnimations = (
  charElements: HTMLElement[],
  duration: number,
  delay: number,
  isLastWord: boolean,
  isBG: boolean,
): Animation[] => {
  const de = Math.max(0, delay);
  let du = Math.max(1000, duration);
  const charCount = Math.max(1, charElements.length);
  const result: Animation[] = [];

  let amount = du / 2000;
  amount = amount > 1 ? Math.sqrt(amount) : amount ** 3;
  let blur = du / 3000;
  blur = blur > 1 ? Math.sqrt(blur) : blur ** 3;
  amount *= 0.6;
  blur *= 0.5;

  if (isLastWord) {
    amount *= 1.6;
    blur *= 1.5;
    du *= 1.2;
  }
  amount = Math.min(1.2, amount);
  blur = Math.min(0.8, blur);

  const animDu = Number.isFinite(du) ? du : 0;

  for (let i = 0; i < charElements.length; i++) {
    const el = charElements[i];
    const wordDe = de + (du / 2.5 / charCount) * i;

    // 1. Glow + Scale + Translate keyframes
    const glowFrames: Keyframe[] = new Array(FRAME_COUNT).fill(0).map((_, j) => {
      const x = (j + 1) / FRAME_COUNT;
      const transX = empEasing(x);
      const glowLevel = empEasing(x) * blur;

      const scale = 1 + transX * 0.1 * amount;
      const offsetX = -transX * 0.03 * amount * (charElements.length / 2 - i);
      const offsetY = -transX * 0.025 * amount;

      return {
        offset: x,
        transform: `${scaleMatrix3dCSS(scale)} translate(${offsetX}em, ${offsetY}em)`,
        textShadow: `0 0 ${Math.min(0.3, blur * 0.3)}em rgba(255, 255, 255, ${glowLevel})`,
      };
    });

    const glow = el.animate(glowFrames, {
      duration: animDu,
      delay: Number.isFinite(wordDe) ? wordDe : 0,
      id: `emphasize-glow-${i}`,
      iterations: 1,
      composite: "replace",
      fill: "both",
    });
    glow.onfinish = () => glow.pause();
    glow.pause();
    result.push(glow);

    // 2. Sine floating keyframes
    const floatFrames: Keyframe[] = new Array(FRAME_COUNT).fill(0).map((_, j) => {
      const x = (j + 1) / FRAME_COUNT;
      let y = Math.sin(x * Math.PI);
      if (isBG) y *= 2;
      return {
        offset: x,
        transform: `translateY(${-y * 0.05}em)`,
      };
    });

    const float = el.animate(floatFrames, {
      duration: animDu * 1.4,
      delay: Number.isFinite(wordDe) ? wordDe - 400 : 0,
      id: "emphasize-float",
      iterations: 1,
      composite: "add",
      fill: "both",
    });
    float.onfinish = () => float.pause();
    float.pause();
    result.push(float);
  }

  return result;
};
