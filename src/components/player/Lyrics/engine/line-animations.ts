/**
 * Lyric rendering engine — Line-level Web Animations lifecycle management.
 * Lazily creates animations when a line is activated, plays them in reverse on deactivation,
 * and cleans them up after completion to prevent accumulating compositor layer animations.
 */

import type { LyricLine } from "@shared/types/lyrics";
import type { WordAnimTarget } from "./word-builder";
import { createFloatAnimation, createEmphasizeAnimations } from "./emphasize";

/** Animation options on line activation */
export interface ActivateOptions {
  /** Whether audio is currently playing */
  playing: boolean;
  /** Whether character float animation is enabled */
  float: boolean;
  /** Whether word emphasis animation is enabled */
  emphasize: boolean;
}

/**
 * Calculate the effective end time of an animation (delay + duration in ms).
 *
 * @param anim - Animation instance
 * @returns End time in ms
 */
const animEndTime = (anim: Animation): number => {
  const timing = anim.effect?.getComputedTiming();
  return ((timing?.delay as number) || 0) + ((timing?.duration as number) || 0);
};

/**
 * Align animation to line relative time and resume playing if not yet finished.
 *
 * @param anim - Animation instance
 * @param relativeTime - Relative time from line start in ms
 */
const realignAndPlay = (anim: Animation, relativeTime: number) => {
  if (anim.playbackRate >= 0 && relativeTime < animEndTime(anim)) {
    anim.currentTime = relativeTime;
    anim.play();
  }
};

export class LineAnimationController {
  /** Active/pending line animations map (lineIndex -> Animation[]) */
  private animations = new Map<number, Animation[]>();

  /**
   * @param isLineActive - Callback to check if a line is currently active
   */
  constructor(private isLineActive: (lineIndex: number) => boolean) {}

  /**
   * Activate animations for a line, lazily creating them and aligning to current playback time.
   *
   * @param lineIndex - Line index
   * @param line - Lyric line data
   * @param targets - Word animation targets
   * @param currentTime - Current playback time in ms
   * @param options - Playback state and effect toggles
   */
  activate = (
    lineIndex: number,
    line: LyricLine,
    targets: WordAnimTarget[] | undefined,
    currentTime: number,
    options: ActivateOptions,
  ) => {
    // Clear old animations for this line if any
    const oldAnims = this.animations.get(lineIndex);
    if (oldAnims) {
      for (const anim of oldAnims) {
        anim.onfinish = null;
        anim.cancel();
      }
    }

    if (!targets?.length || (!options.float && !options.emphasize)) return;

    const relativeTime = Math.max(0, currentTime - line.startTime);
    const anims: Animation[] = [];

    for (const target of targets) {
      // Character float animation
      if (options.float) {
        anims.push(
          createFloatAnimation(
            target.element,
            target.word.startTime - line.startTime,
            target.word.endTime - target.word.startTime,
            line.isBG,
          ),
        );
      }
      // Word emphasis animation (scale + glow + sine float)
      if (options.emphasize && target.isEmphasize && target.charElements.length > 0) {
        anims.push(
          ...createEmphasizeAnimations(
            target.charElements,
            target.word.endTime - target.word.startTime,
            target.word.startTime - line.startTime,
            target.isLastWord,
            line.isBG,
          ),
        );
      }
    }

    for (const anim of anims) {
      anim.currentTime = relativeTime;
      anim.playbackRate = 1;
      if (options.playing && relativeTime < animEndTime(anim)) anim.play();
      else anim.pause();
    }

    this.animations.set(lineIndex, anims);
  };

  /**
   * Deactivate line animations with reverse fallback and automatic cleanup.
   *
   * @param lineIndex - Line index
   */
  deactivate = (lineIndex: number) => {
    const anims = this.animations.get(lineIndex);
    if (!anims) return;

    let pendingCount = anims.length;
    const tryCleanup = () => {
      if (--pendingCount > 0) return;
      if (!this.isLineActive(lineIndex)) {
        const currentAnims = this.animations.get(lineIndex);
        if (currentAnims === anims) {
          for (const anim of anims) anim.cancel();
          this.animations.delete(lineIndex);
        }
      }
    };

    for (const anim of anims) {
      if (anim.id === "float-word") {
        anim.playbackRate = -1;
        anim.play();
      }
      anim.onfinish = tryCleanup;
    }
    for (const anim of anims) {
      if (anim.playState === "finished" || anim.playState === "paused") tryCleanup();
    }
  };

  /**
   * Realign and resume playing animations for all active lines.
   *
   * @param lines - Array of lyric lines
   * @param currentTime - Current playback time in ms
   */
  realignActive = (lines: LyricLine[], currentTime: number) => {
    for (const [lineIdx, anims] of this.animations) {
      if (!this.isLineActive(lineIdx)) continue;
      const line = lines[lineIdx];
      if (!line) continue;
      const relativeTime = Math.max(0, currentTime - line.startTime);
      for (const anim of anims) realignAndPlay(anim, relativeTime);
    }
  };

  /** Pause animations for currently active lines */
  pauseActive = () => {
    for (const [lineIdx, anims] of this.animations) {
      if (!this.isLineActive(lineIdx)) continue;
      for (const anim of anims) anim.pause();
    }
  };

  /** Pause all animations (used when freezing rendering) */
  pauseAll = () => {
    for (const anims of this.animations.values()) {
      for (const anim of anims) anim.pause();
    }
  };

  /** Cancel animations on inactive lines to release compositor resources */
  cleanupInactive = () => {
    for (const [lineIdx, anims] of this.animations) {
      if (this.isLineActive(lineIdx)) continue;
      for (const anim of anims) anim.cancel();
      this.animations.delete(lineIdx);
    }
  };

  /** Cancel all animations and clear map */
  cancelAll = () => {
    for (const anims of this.animations.values()) for (const anim of anims) anim.cancel();
    this.animations.clear();
  };
}
