/**
 * 长音节强调动画与歌词浮动动画
 * 分层辉光的视觉设计参考 Jellyfin-LyricMotion（MPL-2.0）。
 */

import type { LyricWord } from "@shared/types/lyrics";
import { splitGraphemes } from "@shared/utils/lyrics";
import { isCJK } from "../utils/split-words";

const smoothstep = (x: number): number => x * x * (3 - 2 * x);

const normalize = (min: number, max: number, x: number) =>
  Math.min(1, Math.max(0, (x - min) / (max - min)));

const glowPulse = (t: number, start: number, peak: number, release: number, end: number) =>
  smoothstep(normalize(start, peak, t)) * (1 - smoothstep(normalize(release, end, t)));

const LETTER_OR_DIGIT_RE = /[\p{L}\p{N}]/u;

/**
 * Determine whether a word satisfies the duration threshold for emphasis
 * @param word - Lyric word
 * @param minDuration - Minimum duration threshold in milliseconds
 */
export const shouldEmphasize = (word: LyricWord, minDuration = 1000): boolean => {
  const duration = word.endTime - word.startTime;
  if (duration < minDuration) return false;
  if (isCJK(word.word)) return true;
  const trimmed = word.word.trim();
  if (!trimmed || !LETTER_OR_DIGIT_RE.test(trimmed)) return false;
  const len = splitGraphemes(trimmed).length;
  return len >= 1 && len <= 7;
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
 * 为强调词的每个字符创建抬升、放大和分层辉光动画
 * @param charElements - 字符元素
 * @param duration - 合并后的词时长，单位毫秒
 * @param delay - 相对歌词行起点的延迟，单位毫秒
 * @param isLastWord - 是否为歌词行的最后一个词
 * @param isBG - 是否为背景人声
 * @returns 动画实例数组
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
  amount *= 0.6;

  if (isLastWord) {
    amount *= 1.6;
    du *= 1.2;
  }
  amount = Math.min(1.2, Math.max(isLastWord ? 0.7 : 0.55, amount));
  const animDu = Number.isFinite(du) ? du * 1.5 : 0;
  const glowStrength = Math.min(1, Math.max(0.55, duration / 2000)) * (isLastWord ? 1.1 : 1);
  const glowOffsets = [
    0, 0.025, 0.1, 0.11, 0.19, 0.28, 0.32, 0.44, 0.56, 0.6, 0.75, 0.8, 0.98, 1,
  ];

  for (let i = 0; i < charElements.length; i++) {
    const el = charElements[i];
    const wordDe = de + du * 0.09 * i;
    const position = (i + 0.5) / charCount - 0.5;
    const peakScale = 1 + amount * 0.12;
    const peakX = position * amount * 0.08;
    const peakY = -amount * (isBG ? 0.09 : 0.065);
    const transformFrames: Keyframe[] = [
      { offset: 0, transform: "translate3d(0, 0, 0) scale3d(1, 1, 1)" },
      {
        offset: 0.25,
        transform: `translate3d(${peakX}em, ${peakY}em, 0) scale3d(${peakScale}, ${peakScale}, 1)`,
      },
      {
        offset: 0.3,
        transform: `translate3d(${peakX}em, ${peakY}em, 0) scale3d(${peakScale}, ${peakScale}, 1)`,
      },
      {
        offset: 0.75,
        transform: `translate3d(0, ${-amount * 0.035}em, 0) scale3d(1, 1, 1)`,
      },
      { offset: 1, transform: `translate3d(0, ${-amount * 0.035}em, 0) scale3d(1, 1, 1)` },
    ];

    const motion = el.animate(transformFrames, {
      duration: animDu,
      delay: Number.isFinite(wordDe) ? wordDe : 0,
      id: `emphasize-motion-${i}`,
      fill: "both",
      easing: "ease-in-out",
    });
    motion.pause();
    result.push(motion);

    const layers = el.querySelectorAll<HTMLElement>(".lp-emp-glow");
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
      const isCore = layerIndex === 0;
      const frames: Keyframe[] = glowOffsets.map((offset) => {
        const spark = glowPulse(offset, 0, 0.1, 0.28, 0.56);
        const bloom = glowPulse(offset, 0.025, 0.19, 0.44, 0.8);
        const afterglow = glowPulse(offset, 0.11, 0.32, 0.6, 0.98);
        const energy = isCore
          ? 0.78 * spark + 0.22 * bloom
          : 0.72 * bloom + 0.28 * afterglow;
        return { offset, opacity: Math.min(0.9, energy * glowStrength) };
      });
      const glow = layers[layerIndex].animate(frames, {
        duration: animDu,
        delay: Number.isFinite(wordDe) ? wordDe : 0,
        id: `emphasize-${isCore ? "core" : "halo"}-${i}`,
        fill: "both",
      });
      glow.pause();
      result.push(glow);
    }
  }

  return result;
};
