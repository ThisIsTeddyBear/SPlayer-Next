import { Spring, type SpringParams } from "./spring";
import type { LyricLine } from "@shared/types/lyrics";
import { setMin } from "../utils/math";
import { DEFAULTS } from "./constants";
import {
  measureAndApplyWordMasks,
  type WordMeasurement,
  type WordAnimTarget,
} from "./word-builder";
import { buildLineElements } from "./line-builder";
import { LineAnimationController } from "./line-animations";
import {
  createInterludeDots,
  detectInterlude,
  renderInterludeDots,
  type InterludeState,
  type InterludeCache,
} from "./interlude";

export type { RendererConfig } from "./constants";
import type { RendererConfig } from "./constants";

export class LyricRenderer {
  private container: HTMLElement;
  private innerElement: HTMLDivElement;
  private dotsContainer!: HTMLDivElement;
  private dotElements!: [HTMLSpanElement, HTMLSpanElement, HTMLSpanElement];

  private lines: LyricLine[] = [];
  private lineElements: HTMLDivElement[] = [];
  private wordMeasurements: WordMeasurement[][] = [];
  private lineAnimTargets: WordAnimTarget[][] = [];
  private lineAnimations = new LineAnimationController((lineIndex) =>
    this.activeLineSet.has(lineIndex),
  );
  private isBgAbove: boolean[] = [];

  private activeLineIndex = -1;
  private activeLineSet = new Set<number>();
  private lastProcessedTime = -1;

  private positionSprings: Spring[] = [];
  private scaleSprings: Spring[] = [];

  private lineHeights: Float64Array = new Float64Array(0);
  private containerWidth = 0;
  private containerHeight = 0;

  private alphaValues: Float64Array = new Float64Array(0);
  private blurValues: Float64Array = new Float64Array(0);
  private passValues: Float64Array = new Float64Array(0);
  private cachedPassKeys: string[] = [];

  private entranceComplete = true;

  private userScrollOffset = 0;
  private isUserScrolling = false;
  private isHovering = false;
  private scrollResetTimerId = 0;
  private lastTouchY = 0;

  private interludeState: InterludeState = {
    isActive: false,
    startTime: 0,
    endTime: 0,
    x: 0,
    y: 0,
    alignRight: false,
    anchorIndex: 0,
    anchorOffset: 0,
  };
  private interludeCache: InterludeCache = {
    containerStyle: "",
    dotOpacities: ["", "", ""],
  };
  private dotsContainerWidth = 0;
  private dotsContainerHeight = 0;

  private animationFrameId = 0;
  private maskRafId = 0;
  private lastFrameTimestamp = 0;
  private isPageVisible = true;
  private needsFullSync = false;
  private snapNextSeek = false;
  private pendingHiddenLyrics: LyricLine[] | null = null;
  private pendingPlayTime = -1;

  private cachedTransforms: string[] = [];
  private lineWillChange: boolean[] = [];
  private lineCulled: boolean[] = [];
  private bottomWillChange = false;
  private bottomCulled = false;
  private cachedAlphaKeys: string[] = [];
  private cachedBlurKeys: string[] = [];
  private cachedTimeString = "";

  private alignPosition = DEFAULTS.alignPosition;
  private isPlaying = true;
  private wordFadeWidth = DEFAULTS.wordFadeWidth;
  private springParams: Partial<SpringParams> = {};
  private lineClickCallback: ((timeMs: number) => void) | null = null;
  private scrollResetDelay = DEFAULTS.scrollResetDelay;
  private minInterludeGap = DEFAULTS.minInterludeGap;
  private breatheCycleTarget = DEFAULTS.breatheCycleTarget;
  private alphaAttackSpeed = DEFAULTS.alphaAttackSpeed;
  private alphaReleaseSpeed = DEFAULTS.alphaReleaseSpeed;
  private inactiveAlpha = DEFAULTS.inactiveAlpha;
  private hidePassedLines = DEFAULTS.hidePassedLines;
  private enableBlur = DEFAULTS.enableBlur;
  private enableWordHighlight = DEFAULTS.enableWordHighlight;
  private enableFloatAnimation = DEFAULTS.enableFloatAnimation;
  private enableEmphasizeEffect = DEFAULTS.enableEmphasizeEffect;
  private showTranslation = DEFAULTS.showTranslation;
  private showRomanization = DEFAULTS.showRomanization;

  private containerResizeObserver: ResizeObserver;
  private sentinelResizeObserver: ResizeObserver;
  private sentinelElement: HTMLDivElement | null = null;

  private bottomLineEl!: HTMLDivElement;
  private bottomLineSpring = new Spring(2000);
  private cachedBottomTransform = "";

  /**
   */
  constructor(container: HTMLElement, config?: Partial<RendererConfig>) {
    this.container = container;
    for (const stale of Array.from(container.querySelectorAll(":scope > .lp-inner"))) {
      stale.remove();
    }
    container.classList.add("lp-root");
    this.innerElement = document.createElement("div");
    this.innerElement.className = "lp-inner";
    container.appendChild(this.innerElement);
    [this.dotsContainer, this.dotElements] = createInterludeDots(this.innerElement);
    this.bottomLineEl = document.createElement("div");
    this.bottomLineEl.className = "lp-line lp-credit";
    this.innerElement.appendChild(this.bottomLineEl);
    if (config) this.applyConfig(config);
    this.containerWidth = container.clientWidth;
    this.containerHeight = container.clientHeight;
    this.containerResizeObserver = new ResizeObserver(this.handleContainerResize);
    this.containerResizeObserver.observe(container);
    this.sentinelResizeObserver = new ResizeObserver(this.handleSentinelResize);
    container.addEventListener("wheel", this.handleWheel, { passive: false });
    container.addEventListener("touchstart", this.handleTouchStart, {
      passive: true,
    });
    container.addEventListener("touchmove", this.handleTouchMove, {
      passive: false,
    });
    container.addEventListener("touchend", this.handleTouchEnd, {
      passive: true,
    });
    container.addEventListener("click", this.handleLineClick);
    container.addEventListener("mouseenter", this.handleMouseEnter);
    container.addEventListener("mouseleave", this.handleMouseLeave);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.animationFrameId = requestAnimationFrame(this.onAnimationFrame);
  }

  freeze = () => {
    cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = 0;
    this.containerResizeObserver.disconnect();
    this.sentinelResizeObserver.disconnect();
    this.lineAnimations.cleanupInactive();
    this.lineAnimations.pauseAll();
  };

  resume = () => {
    if (this.animationFrameId !== 0) return;
    this.containerResizeObserver.observe(this.container);
    if (this.sentinelElement) {
      this.sentinelResizeObserver.observe(this.sentinelElement);
    }
    this.lastFrameTimestamp = 0;
    this.needsFullSync = true;
    this.snapNextSeek = true;
    if (this.isPlaying) {
      this.lineAnimations.realignActive(this.lines, this.lastProcessedTime);
    }
    this.animationFrameId = requestAnimationFrame(this.onAnimationFrame);
  };

  dispose = () => {
    cancelAnimationFrame(this.animationFrameId);
    cancelAnimationFrame(this.maskRafId);
    clearTimeout(this.scrollResetTimerId);
    this.lineAnimations.cancelAll();
    this.containerResizeObserver.disconnect();
    this.sentinelResizeObserver.disconnect();
    this.container.removeEventListener("wheel", this.handleWheel);
    this.container.removeEventListener("touchstart", this.handleTouchStart);
    this.container.removeEventListener("touchmove", this.handleTouchMove);
    this.container.removeEventListener("touchend", this.handleTouchEnd);
    this.container.removeEventListener("click", this.handleLineClick);
    this.container.removeEventListener("mouseenter", this.handleMouseEnter);
    this.container.removeEventListener("mouseleave", this.handleMouseLeave);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.innerElement.remove();
    this.container.classList.remove("lp-root", "lp-has-duet");
  };

  /**
   */
  setLyrics = (lines: LyricLine[]) => {
    if (!this.isPageVisible) {
      this.pendingHiddenLyrics = lines;
      return;
    }
    const seekTime = this.pendingPlayTime >= 0 ? this.pendingPlayTime : 0;
    this.lineAnimations.cancelAll();
    for (const element of this.lineElements) element.remove();
    this.lines = lines;
    this.activeLineIndex = -1;
    this.activeLineSet.clear();
    this.lastProcessedTime = -1;
    this.userScrollOffset = 0;
    this.interludeState.isActive = false;
    this.container.classList.toggle(
      "lp-has-duet",
      lines.some((line) => line.isDuet),
    );

    const lineCount = lines.length;

    const offScreen = Math.max(this.containerHeight * 2, 2000);
    this.bottomLineSpring.setPosition(offScreen);
    this.cachedBottomTransform = "";
    this.positionSprings = new Array(lineCount);
    this.scaleSprings = new Array(lineCount);
    for (let i = 0; i < lineCount; i++) {
      this.positionSprings[i] = new Spring(offScreen);
      const scaleSpring = new Spring(97);
      scaleSpring.updateParams(
        lines[i].isBG
          ? { mass: 1, damping: 20, stiffness: 50 }
          : { mass: 2, damping: 25, stiffness: 100 },
      );
      this.scaleSprings[i] = scaleSpring;
    }
    this.applySpringParams();

    this.alphaValues = new Float64Array(lineCount * 2);
    for (let i = 0; i < lineCount; i++) {
      this.alphaValues[i * 2] = this.inactiveAlpha;
      this.alphaValues[i * 2 + 1] = this.inactiveAlpha;
    }

    this.lineHeights = new Float64Array(lineCount);
    this.cachedTransforms = new Array(lineCount).fill("");
    this.lineWillChange = new Array(lineCount).fill(false);
    this.lineCulled = new Array(lineCount).fill(false);
    this.cachedAlphaKeys = new Array(lineCount).fill("");
    this.cachedBlurKeys = new Array(lineCount).fill("");
    this.blurValues = new Float64Array(lineCount);
    this.passValues = new Float64Array(lineCount).fill(1);
    this.cachedPassKeys = new Array(lineCount).fill("");

    this.entranceComplete = false;

    const built = buildLineElements(lines, {
      enableEmphasizeEffect: this.enableEmphasizeEffect,
      showTranslation: this.showTranslation,
      showRomanization: this.showRomanization,
    });
    this.lineElements = built.lineElements;
    this.wordMeasurements = built.wordMeasurements;
    this.lineAnimTargets = built.lineAnimTargets;
    this.isBgAbove = built.isBgAbove;
    this.innerElement.appendChild(built.fragment);

    this.sentinelResizeObserver.disconnect();
    this.sentinelElement = null;
    if (lineCount > 0) {
      this.sentinelElement = this.lineElements[0];
      this.sentinelResizeObserver.observe(this.sentinelElement);
    }

    this.dotsContainerWidth = this.dotsContainer.offsetWidth || 60;
    this.dotsContainerHeight = this.dotsContainer.offsetHeight || 20;
    this.measureLineHeights();
    this.maskRafId = requestAnimationFrame(() => {
      measureAndApplyWordMasks(this.wordMeasurements, this.wordFadeWidth, this.lines);
    });

    this.pendingPlayTime = -1;
    this.lastProcessedTime = -1;
    this.lastFrameTimestamp = 0;

    this.handleSeek(seekTime);
    this.calculateLayout(true);
    this.playEntranceAnimation(this.containerHeight * 0.6);
    this.needsFullSync = true;
  };

  /**
   */
  setCurrentTime = (timeMs: number) => {
    this.pendingPlayTime = timeMs;
  };

  /**
   */
  setPlaying = (playing: boolean) => {
    if (this.isPlaying === playing) return;
    this.isPlaying = playing;

    if (playing) this.lineAnimations.realignActive(this.lines, this.lastProcessedTime);
    else this.lineAnimations.pauseActive();

    this.calculateLayout(false);
    this.needsFullSync = true;
  };

  /**
   */
  setConfig = (config: Partial<RendererConfig>) => {
    this.applyConfig(config);
  };

  /**
   */
  private applyConfig = (config: Partial<RendererConfig>) => {
    let layoutDirty = false;
    if (config.alignPosition != null && config.alignPosition !== this.alignPosition) {
      this.alignPosition = config.alignPosition;
      layoutDirty = true;
    }
    if (config.playing != null && config.playing !== this.isPlaying) {
      this.isPlaying = config.playing;
      layoutDirty = true;
    }
    if (config.wordFadeWidth != null && config.wordFadeWidth !== this.wordFadeWidth) {
      this.wordFadeWidth = config.wordFadeWidth;
      if (this.lineElements.length > 0)
        measureAndApplyWordMasks(this.wordMeasurements, this.wordFadeWidth, this.lines);
    }
    if (config.onLineClick !== undefined) this.lineClickCallback = config.onLineClick ?? null;
    if (config.springConfig) {
      this.springParams = config.springConfig;
      this.applySpringParams();
    }
    if (config.scrollResetDelay != null) this.scrollResetDelay = config.scrollResetDelay;
    if (config.minInterludeGap != null) this.minInterludeGap = config.minInterludeGap;
    if (config.breatheCycleTarget != null) this.breatheCycleTarget = config.breatheCycleTarget;
    if (config.alphaAttackSpeed != null) this.alphaAttackSpeed = config.alphaAttackSpeed;
    if (config.alphaReleaseSpeed != null) this.alphaReleaseSpeed = config.alphaReleaseSpeed;
    if (config.inactiveAlpha != null) this.inactiveAlpha = config.inactiveAlpha;
    if (config.hidePassedLines != null) this.hidePassedLines = config.hidePassedLines;
    if (config.enableBlur != null) this.enableBlur = config.enableBlur;
    if (config.enableWordHighlight != null) this.enableWordHighlight = config.enableWordHighlight;
    if (config.enableFloatAnimation != null)
      this.enableFloatAnimation = config.enableFloatAnimation;
    if (config.enableEmphasizeEffect != null)
      this.enableEmphasizeEffect = config.enableEmphasizeEffect;
    if (config.showTranslation != null) this.showTranslation = config.showTranslation;
    if (config.showRomanization != null) this.showRomanization = config.showRomanization;

    if (layoutDirty && this.lineElements.length > 0) {
      this.measureLineHeights();
      this.calculateLayout(false);
      this.needsFullSync = true;
    }
  };

  private measureLineHeights = () => {
    for (let i = 0; i < this.lineElements.length; i++) {
      this.lineHeights[i] = this.lineElements[i]?.offsetHeight || 40;
    }
  };

  /**
   */
  private processTime = (currentTime: number): boolean => {
    const isFirst = this.lastProcessedTime < 0;
    const isSeeked =
      !isFirst &&
      (currentTime < this.lastProcessedTime - 100 || currentTime > this.lastProcessedTime + 2000);
    this.lastProcessedTime = currentTime;

    if (isFirst || isSeeked) {
      const snap = this.snapNextSeek;
      this.snapNextSeek = false;
      this.handleSeek(currentTime, snap);
      return true;
    }
    this.snapNextSeek = false;

    const lines = this.lines;
    const activated: number[] = [];
    const deactivated = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (
        line.startTime <= currentTime &&
        line.endTime > currentTime &&
        !this.activeLineSet.has(i)
      ) {
        activated.push(i);
      }
    }

    for (const lineIdx of this.activeLineSet) {
      const line = lines[lineIdx];
      if (!line) {
        deactivated.add(lineIdx);
        continue;
      }
      if (line.singerRole) {
        if (line.startTime > currentTime || line.endTime <= currentTime) deactivated.add(lineIdx);
        continue;
      }
      const nextLine = lines[lineIdx + 1];
      if (nextLine?.isBG) {
        const nextMainLine = lines[lineIdx + 2];
        const pairStart = Math.min(line.startTime, nextLine.startTime);
        const pairEnd = Math.min(
          Math.max(line.endTime, nextMainLine?.startTime ?? Number.MAX_VALUE),
          Math.max(line.endTime, nextLine.endTime),
        );
        if (pairStart > currentTime || pairEnd <= currentTime) deactivated.add(lineIdx);
      } else {
        if (line.startTime > currentTime || line.endTime <= currentTime) deactivated.add(lineIdx);
      }
    }

    if (activated.length === 0 && deactivated.size === 0) return false;

    for (const lineIdx of deactivated) {
      this.activeLineSet.delete(lineIdx);
      this.lineElements[lineIdx]?.classList.remove("active");
      this.lineAnimations.deactivate(lineIdx);
    }
    for (const lineIdx of activated) {
      this.activeLineSet.add(lineIdx);
      this.lineElements[lineIdx]?.classList.add("active");
      this.activateLineAnimations(lineIdx, currentTime);
    }

    if (this.activeLineSet.size > 0) this.activeLineIndex = setMin(this.activeLineSet);
    this.calculateLayout(false);
    return true;
  };

  /**
   */
  private handleSeek = (targetTime: number, snap = false) => {
    this.userScrollOffset = 0;
    this.isUserScrolling = false;
    clearTimeout(this.scrollResetTimerId);

    for (const lineIdx of this.activeLineSet) {
      this.lineElements[lineIdx]?.classList.remove("active");
      this.lineAnimations.deactivate(lineIdx);
    }
    this.activeLineSet.clear();

    const lines = this.lines;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startTime <= targetTime && lines[i].endTime > targetTime) {
        this.activeLineSet.add(i);
        this.lineElements[i]?.classList.add("active");
        this.activateLineAnimations(i, targetTime);
      }
    }

    if (this.activeLineSet.size > 0) {
      this.activeLineIndex = setMin(this.activeLineSet);
    } else {
      const futureIdx = lines.findIndex((line) => line.startTime >= targetTime);
      this.activeLineIndex = futureIdx === -1 ? lines.length : futureIdx;
    }

    this.calculateLayout(snap, true);
    if (snap) this.snapVisualState();
  };

  /**
   *
   */
  private snapVisualState = () => {
    const doPass = this.hidePassedLines && this.isPlaying;
    const activeIdx = this.activeLineIndex;
    for (let i = 0; i < this.lines.length; i++) {
      const lineEl = this.lineElements[i];
      if (!lineEl) continue;
      const isActive = this.activeLineSet.has(i);
      const isPassed = doPass && (this.lines[i].isBG ? i - 1 < activeIdx : i < activeIdx);
      const bright = isPassed ? 0.0001 : isActive ? 1.0 : this.inactiveAlpha;
      const dark = isPassed ? 0.0001 : this.enableWordHighlight ? this.inactiveAlpha : bright;
      this.alphaValues[i * 2] = bright;
      this.alphaValues[i * 2 + 1] = dark;
      const brightStr = bright.toFixed(3);
      const darkStr = dark.toFixed(3);
      const alphaKey = brightStr + darkStr;
      if (this.cachedAlphaKeys[i] !== alphaKey) {
        this.cachedAlphaKeys[i] = alphaKey;
        lineEl.style.setProperty("--ba", brightStr);
        lineEl.style.setProperty("--da", darkStr);
      }
      const pass = isPassed ? 0.0001 : 1;
      this.passValues[i] = pass;
      const passKey = pass.toFixed(3);
      if (this.cachedPassKeys[i] !== passKey) {
        this.cachedPassKeys[i] = passKey;
        lineEl.style.setProperty("--pass", passKey);
      }
    }
  };

  /**
   */
  private calculateLayout = (syncImmediate: boolean, noCascade = false) => {
    const viewHeight = this.containerHeight;
    const viewWidth = this.containerWidth;
    const currentTime = this.lastProcessedTime;
    const targetIdx = this.activeLineIndex;
    const lines = this.lines;
    const lineCount = this.positionSprings.length;
    if (lineCount === 0) return;

    const interlude = detectInterlude(currentTime, targetIdx, lines, this.minInterludeGap);
    const dotsGap = 10;
    if (interlude) {
      this.interludeState.startTime = interlude[0];
      this.interludeState.endTime = interlude[1];
      this.interludeState.isActive = true;
    } else {
      this.interludeState.isActive = false;
    }

    let position = -this.userScrollOffset;
    let heightAccum = 0;
    for (let i = 0; i < targetIdx; i++) {
      if (lines[i]?.isBG && !this.activeLineSet.has(i)) continue;
      heightAccum += this.lineHeights[i] || 40;
    }
    position -= heightAccum;
    position += viewHeight * this.alignPosition - (this.lineHeights[targetIdx] || 40) / 2;
    if (this.isBgAbove[targetIdx + 1] && this.activeLineSet.has(targetIdx + 1)) {
      position -= this.lineHeights[targetIdx + 1] || 40;
    }

    let cascadeDelay = 0;
    let baseDelay = syncImmediate || noCascade ? 0 : 50;
    let dotsInserted = false;
    let pendingBgIdx = -1;
    let pendingBgY = 0;

    for (let i = 0; i < lineCount; i++) {
      const posSpring = this.positionSprings[i];
      const scaleSpring = this.scaleSprings[i];
      const line = lines[i];
      if (!line) continue;

      if (!dotsInserted && interlude && i === interlude[2] + 1) {
        dotsInserted = true;
        position += dotsGap;
        const isDuet = interlude[3];
        this.interludeState.x = isDuet ? viewWidth - this.dotsContainerWidth : 0;
        this.interludeState.y = position;
        this.interludeState.alignRight = isDuet;
        this.interludeState.anchorIndex = i;
        this.interludeState.anchorOffset = -(this.dotsContainerHeight + dotsGap);
        position += this.dotsContainerHeight + dotsGap;
      }

      const isActive = this.activeLineSet.has(i);
      const targetScale = !isActive && this.isPlaying ? (line.isBG ? 75 : 97) : 100;
      const collapsedBG = line.isBG && !isActive;

      let lineY = position;
      let advance = collapsedBG ? 0 : this.lineHeights[i] || 40;
      if (i === pendingBgIdx) {
        lineY = pendingBgY;
        advance = 0;
        pendingBgIdx = -1;
      } else if (this.isBgAbove[i + 1]) {
        const bgIdx = i + 1;
        const bgH = this.lineHeights[bgIdx] || 40;
        const bgSpace = this.activeLineSet.has(bgIdx) ? bgH : 0;
        lineY = position + bgSpace;
        pendingBgY = lineY - bgH;
        pendingBgIdx = bgIdx;
        advance = bgSpace + (this.lineHeights[i] || 40);
      }

      if (syncImmediate) {
        posSpring.setPosition(lineY);
        scaleSpring.setPosition(targetScale);
      } else {
        posSpring.setTargetPosition(lineY, cascadeDelay);
        scaleSpring.setTargetPosition(targetScale, cascadeDelay);
      }

      position += advance;

      if (position >= 0 && !this.isUserScrolling) {
        if (!line.isBG) cascadeDelay += baseDelay;
        if (i >= targetIdx) baseDelay /= 1.05;
      }
    }

    const bottomY = position + dotsGap;
    if (syncImmediate) this.bottomLineSpring.setPosition(bottomY);
    else this.bottomLineSpring.setTargetPosition(bottomY, cascadeDelay);
  };

  /**
   */
  private playEntranceAnimation = (offset: number) => {
    for (let i = 0; i < this.positionSprings.length; i++) {
      const posSpring = this.positionSprings[i];
      const scaleSpring = this.scaleSprings[i];
      const targetY = posSpring.getCurrentPosition();
      const targetScale = scaleSpring.getCurrentPosition();
      posSpring.setPosition(targetY + offset);
      posSpring.setTargetPosition(targetY, i * 40);
      scaleSpring.setPosition(targetScale * 0.9);
      scaleSpring.setTargetPosition(targetScale, i * 40);
    }
    const bottomTarget = this.bottomLineSpring.getCurrentPosition();
    this.bottomLineSpring.setPosition(bottomTarget + offset);
    this.bottomLineSpring.setTargetPosition(bottomTarget, this.positionSprings.length * 40);
  };

  /**
   */
  private onAnimationFrame = (timestamp: number) => {
    this.animationFrameId = requestAnimationFrame(this.onAnimationFrame);
    if (!this.isPageVisible) return;

    const rawDelta = this.lastFrameTimestamp ? timestamp - this.lastFrameTimestamp : 16;
    const deltaTime = rawDelta > 100 ? 100 : rawDelta;
    this.lastFrameTimestamp = timestamp;

    const lineCount = this.positionSprings.length;
    if (lineCount === 0) return;

    const playTime = this.pendingPlayTime;
    if (playTime >= 0 && playTime !== this.lastProcessedTime) {
      if (this.processTime(playTime)) this.needsFullSync = true;
    }

    if (this.enableWordHighlight && playTime >= 0) {
      const timeStr = String(playTime);
      if (timeStr !== this.cachedTimeString) {
        this.cachedTimeString = timeStr;
        for (const lineIdx of this.activeLineSet) {
          this.lineElements[lineIdx]?.style.setProperty("--t", timeStr);
        }
      }
    }

    const viewHeight = this.containerHeight;
    const isFullSync = this.needsFullSync;
    this.needsFullSync = false;

    for (let i = 0; i < lineCount; i++) {
      const posSpring = this.positionSprings[i];
      const scaleSpring = this.scaleSprings[i];
      posSpring.update(deltaTime);
      scaleSpring.update(deltaTime);

      const yPos = posSpring.getCurrentPosition();
      const scale = scaleSpring.getCurrentPosition() / 100;
      const inView = yPos >= -500 && yPos <= viewHeight + 500;
      if (this.lineWillChange[i] !== inView) {
        this.lineWillChange[i] = inView;
        this.lineElements[i].style.willChange = inView ? "transform, filter" : "";
      }
      if (!isFullSync && !inView) {
        if (!this.lineCulled[i]) {
          this.lineCulled[i] = true;
          const culledTransform = `translateY(${yPos.toFixed(1)}px) scale(${scale.toFixed(4)})`;
          this.cachedTransforms[i] = culledTransform;
          this.lineElements[i].style.transform = culledTransform;
        }
        continue;
      }
      this.lineCulled[i] = false;
      const transformStr = `translateY(${yPos.toFixed(1)}px) scale(${scale.toFixed(4)})`;
      if (this.cachedTransforms[i] !== transformStr) {
        this.cachedTransforms[i] = transformStr;
        this.lineElements[i].style.transform = transformStr;
      }
    }

    this.bottomLineSpring.update(deltaTime);
    if (this.bottomLineEl.childElementCount > 0) {
      const bottomY = this.bottomLineSpring.getCurrentPosition();
      const bottomInView = bottomY >= -500 && bottomY <= viewHeight + 500;
      if (this.bottomWillChange !== bottomInView) {
        this.bottomWillChange = bottomInView;
        this.bottomLineEl.style.willChange = bottomInView ? "transform, filter" : "";
      }
      if (!isFullSync && !bottomInView) {
        if (!this.bottomCulled) {
          this.bottomCulled = true;
          const culledTransform = `translateY(${bottomY.toFixed(1)}px)`;
          this.cachedBottomTransform = culledTransform;
          this.bottomLineEl.style.transform = culledTransform;
        }
      } else {
        this.bottomCulled = false;
        const bottomTransform = `translateY(${bottomY.toFixed(1)}px)`;
        if (this.cachedBottomTransform !== bottomTransform) {
          this.cachedBottomTransform = bottomTransform;
          this.bottomLineEl.style.transform = bottomTransform;
        }
      }
    }

    if (!this.entranceComplete) {
      let allSettled = true;
      for (let i = 0; i < lineCount; i++) {
        if (!this.positionSprings[i].arrived()) {
          allSettled = false;
          break;
        }
      }
      this.entranceComplete = allSettled;
    }

    const frameDeltaSec = (deltaTime || 16) / 1000;
    const attackFactor = 1 - Math.exp(-this.alphaAttackSpeed * frameDeltaSec);
    const releaseFactor = 1 - Math.exp(-this.alphaReleaseSpeed * frameDeltaSec);
    const blurFactor = 1 - Math.exp(-12 * frameDeltaSec);
    const halfInactive = this.inactiveAlpha * 0.5;
    const doPass = this.hidePassedLines && this.isPlaying;
    const doBlur = this.enableBlur;
    const blurSuppressed = this.isUserScrolling || this.isHovering;
    const activeIdx = this.activeLineIndex;

    for (let i = 0; i < lineCount; i++) {
      const yPos = this.positionSprings[i].getCurrentPosition();
      if (!isFullSync && (yPos < -500 || yPos > viewHeight + 500)) continue;

      const isActive = this.activeLineSet.has(i);
      const isPassed =
        doPass && !this.isUserScrolling && (this.lines[i].isBG ? i - 1 < activeIdx : i < activeIdx);

      const alphaIdx = i * 2;
      const targetBright = isPassed ? 0.0001 : isActive ? 1.0 : this.inactiveAlpha;
      let brightValue = this.alphaValues[alphaIdx];
      if (Math.abs(targetBright - brightValue) < 0.001) {
        brightValue = targetBright;
      } else {
        const factor =
          !isPassed && brightValue < halfInactive
            ? releaseFactor
            : targetBright > brightValue
              ? attackFactor
              : releaseFactor;
        brightValue += (targetBright - brightValue) * factor;
      }
      this.alphaValues[alphaIdx] = brightValue;

      const targetDark = isPassed
        ? 0.0001
        : this.enableWordHighlight
          ? this.inactiveAlpha
          : targetBright;
      let darkValue = this.alphaValues[alphaIdx + 1];
      if (Math.abs(targetDark - darkValue) < 0.001) {
        darkValue = targetDark;
      } else {
        const factor =
          !isPassed && darkValue < halfInactive
            ? releaseFactor
            : targetDark > darkValue
              ? attackFactor
              : releaseFactor;
        darkValue += (targetDark - darkValue) * factor;
      }
      this.alphaValues[alphaIdx + 1] = darkValue;

      const brightStr = brightValue.toFixed(3);
      const darkStr = darkValue.toFixed(3);
      const alphaKey = brightStr + darkStr;
      if (this.cachedAlphaKeys[i] !== alphaKey) {
        this.cachedAlphaKeys[i] = alphaKey;
        const lineEl = this.lineElements[i];
        lineEl.style.setProperty("--ba", brightStr);
        lineEl.style.setProperty("--da", darkStr);
      }

      if (doPass || this.passValues[i] < 0.999) {
        const targetPass = isPassed ? 0.0001 : 1;
        let passValue = this.passValues[i];
        if (Math.abs(targetPass - passValue) < 0.001) passValue = targetPass;
        else passValue += (targetPass - passValue) * releaseFactor;
        this.passValues[i] = passValue;
        const passKey = passValue.toFixed(3);
        if (this.cachedPassKeys[i] !== passKey) {
          this.cachedPassKeys[i] = passKey;
          this.lineElements[i].style.setProperty("--pass", passKey);
        }
      }

      if (doBlur || this.blurValues[i] > 0.01) {
        let targetBlur = 0;
        if (doBlur && !blurSuppressed && !isActive) {
          targetBlur = Math.min(4, 1 + Math.abs(i - Math.max(activeIdx, 0)));
        }
        let blurCurrent = this.blurValues[i];
        if (Math.abs(targetBlur - blurCurrent) < 0.01) blurCurrent = targetBlur;
        else blurCurrent += (targetBlur - blurCurrent) * blurFactor;
        this.blurValues[i] = blurCurrent;
        const blurKey = blurCurrent.toFixed(2);
        if (this.cachedBlurKeys[i] !== blurKey) {
          this.cachedBlurKeys[i] = blurKey;
          const lineStyle = this.lineElements[i].style;
          if (blurCurrent > 0.01) lineStyle.filter = `blur(${(blurCurrent * 1.5).toFixed(2)}px)`;
          else lineStyle.removeProperty("filter");
        }
      }
    }

    if (this.interludeState.isActive) {
      const anchorSpring = this.positionSprings[this.interludeState.anchorIndex];
      if (anchorSpring) {
        this.interludeState.y =
          anchorSpring.getCurrentPosition() + this.interludeState.anchorOffset;
      }
    }
    renderInterludeDots(
      playTime,
      this.interludeState,
      this.dotsContainer,
      this.dotElements,
      this.interludeCache,
      this.breatheCycleTarget,
    );
  };

  /**
   */
  private activateLineAnimations = (lineIndex: number, currentTime: number) => {
    this.lineAnimations.activate(
      lineIndex,
      this.lines[lineIndex],
      this.lineAnimTargets[lineIndex],
      currentTime,
      {
        playing: this.isPlaying,
        float: this.enableFloatAnimation,
        emphasize: this.enableEmphasizeEffect,
      },
    );
  };

  /**
   */
  private handleLineClick = (event: MouseEvent) => {
    if (!this.lineClickCallback) return;
    const lineEl = (event.target as HTMLElement).closest(".lp-line") as HTMLDivElement | null;
    if (!lineEl) return;
    const lineIdx = this.lineElements.indexOf(lineEl);
    if (lineIdx !== -1 && this.lines[lineIdx])
      this.lineClickCallback(this.lines[lineIdx].startTime);
  };

  /**
   */
  private applyUserScroll = (deltaY: number) => {
    if (!this.isUserScrolling) this.lineAnimations.cleanupInactive();
    this.userScrollOffset += deltaY;
    this.isUserScrolling = true;
    this.calculateLayout(false);
    clearTimeout(this.scrollResetTimerId);
    this.scrollResetTimerId = window.setTimeout(() => {
      this.isUserScrolling = false;
      this.userScrollOffset = 0;
      this.calculateLayout(false);
    }, this.scrollResetDelay);
  };

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.applyUserScroll(event.deltaY);
  };

  private handleTouchStart = (event: TouchEvent) => {
    this.lastTouchY = event.touches[0].clientY;
  };

  private handleTouchMove = (event: TouchEvent) => {
    event.preventDefault();
    const currentY = event.touches[0].clientY;
    this.applyUserScroll(this.lastTouchY - currentY);
    this.lastTouchY = currentY;
  };

  private handleTouchEnd = () => {
    if (!this.isUserScrolling) return;
    clearTimeout(this.scrollResetTimerId);
    this.scrollResetTimerId = window.setTimeout(() => {
      this.isUserScrolling = false;
      this.userScrollOffset = 0;
      this.calculateLayout(false);
    }, this.scrollResetDelay);
  };

  private handleMouseEnter = () => {
    this.isHovering = true;
  };

  private handleMouseLeave = () => {
    this.isHovering = false;
    if (this.isUserScrolling) {
      clearTimeout(this.scrollResetTimerId);
      this.isUserScrolling = false;
      this.userScrollOffset = 0;
      this.calculateLayout(false, true);
    }
  };

  private handleContainerResize = () => {
    const newWidth = this.container.clientWidth;
    const newHeight = this.container.clientHeight;
    if (newWidth === this.containerWidth && newHeight === this.containerHeight) return;
    this.containerWidth = newWidth;
    this.containerHeight = newHeight;
    this.measureLineHeights();
    measureAndApplyWordMasks(this.wordMeasurements, this.wordFadeWidth, this.lines);
    if (!this.entranceComplete) {
      this.needsFullSync = true;
      return;
    }
    this.calculateLayout(true);
    this.needsFullSync = true;
  };

  private handleSentinelResize = () => {
    if (this.lineElements.length === 0) return;
    this.dotsContainerWidth = this.dotsContainer.offsetWidth || 60;
    this.dotsContainerHeight = this.dotsContainer.offsetHeight || 20;
    this.measureLineHeights();
    measureAndApplyWordMasks(this.wordMeasurements, this.wordFadeWidth, this.lines);
    if (!this.entranceComplete) {
      this.needsFullSync = true;
      return;
    }
    this.calculateLayout(true);
    this.needsFullSync = true;
  };

  getBottomLineElement = (): HTMLElement => this.bottomLineEl;

  private handleVisibilityChange = () => {
    this.isPageVisible = !document.hidden;
    if (!this.isPageVisible) return;
    if (this.animationFrameId === 0) return;
    this.lastFrameTimestamp = 0;
    if (this.pendingHiddenLyrics) {
      const pendingLines = this.pendingHiddenLyrics;
      this.pendingHiddenLyrics = null;
      this.setLyrics(pendingLines);
      this.snapNextSeek = true;
      return;
    }
    this.lineAnimations.cleanupInactive();
    this.measureLineHeights();
    if (this.entranceComplete) this.calculateLayout(true);
    this.snapNextSeek = true;
    this.needsFullSync = true;
  };

  private applySpringParams = () => {
    const config = this.springParams;
    for (const spring of this.positionSprings) spring.updateParams(config);
    this.bottomLineSpring.updateParams(config);
    for (const spring of this.scaleSprings)
      spring.updateParams({ mass: 2, damping: 25, stiffness: 100 });
  };
}
