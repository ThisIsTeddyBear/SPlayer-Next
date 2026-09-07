/**
 *
 */

import type { LyricLine } from "@shared/types/lyrics";
import type { WordAnimTarget } from "./word-builder";
import { createFloatAnimation, createEmphasizeAnimations } from "./emphasize";

export interface ActivateOptions {
  playing: boolean;
  float: boolean;
  emphasize: boolean;
}

/**
 */
const animEndTime = (anim: Animation): number => {
  const timing = anim.effect?.getComputedTiming();
  return ((timing?.delay as number) || 0) + ((timing?.duration as number) || 0);
};

/**
 */
const realignAndPlay = (anim: Animation, relativeTime: number) => {
  if (anim.playbackRate >= 0 && relativeTime < animEndTime(anim)) {
    anim.currentTime = relativeTime;
    anim.play();
  }
};

export class LineAnimationController {
  private animations = new Map<number, Animation[]>();

  /**
   */
  constructor(private isLineActive: (lineIndex: number) => boolean) {}

  /**
   */
  activate = (
    lineIndex: number,
    line: LyricLine,
    targets: WordAnimTarget[] | undefined,
    currentTime: number,
    options: ActivateOptions,
  ) => {
    const oldAnims = this.animations.get(lineIndex);
    if (oldAnims)
      for (const anim of oldAnims) {
        anim.onfinish = null;
        anim.cancel();
      }

    if (!targets?.length || (!options.float && !options.emphasize)) return;

    const relativeTime = Math.max(0, currentTime - line.startTime);
    const anims: Animation[] = [];

    for (const target of targets) {
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

  pauseActive = () => {
    for (const [lineIdx, anims] of this.animations) {
      if (!this.isLineActive(lineIdx)) continue;
      for (const anim of anims) anim.pause();
    }
  };

  pauseAll = () => {
    for (const anims of this.animations.values()) {
      for (const anim of anims) anim.pause();
    }
  };

  cleanupInactive = () => {
    for (const [lineIdx, anims] of this.animations) {
      if (this.isLineActive(lineIdx)) continue;
      for (const anim of anims) anim.cancel();
      this.animations.delete(lineIdx);
    }
  };

  cancelAll = () => {
    for (const anims of this.animations.values()) for (const anim of anims) anim.cancel();
    this.animations.clear();
  };
}
