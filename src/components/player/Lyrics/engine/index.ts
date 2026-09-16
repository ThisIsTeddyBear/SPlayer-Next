import type { LyricLine } from "@shared/types/lyrics";
import { setMin } from "../utils/math";
import { syncMainAndBackgroundLines } from "../utils/normalize";
import { applyScrollPreroll } from "../utils/scroll-preroll";
import { DEFAULTS, type RendererConfig, type ScrollPrerollOptions } from "./constants";
import {
  createInterludeDots,
  detectInterlude,
  type InterludeCache,
  type InterludeState,
  renderInterludeDots,
} from "./interlude";
import { LineAnimationController } from "./line-animations";
import { buildLineElements } from "./line-builder";
import { Spring, type SpringParams } from "./spring";
import {
  measureAndApplyWordMasks,
  type WordAnimTarget,
  type WordMeasurement,
} from "./word-builder";

export type { RendererConfig } from "./constants";

export class LyricRenderer {
  /** Outer container */
  private container: HTMLElement;
  /** Inner wrapper holding all lyric lines and interlude dots */
  private innerElement: HTMLDivElement;
  /** Container for breathing interlude dots */
  private dotsContainer!: HTMLDivElement;
  /** Three interlude dot elements */
  private dotElements!: [HTMLSpanElement, HTMLSpanElement, HTMLSpanElement];

  /** Lyric line data */
  private lines: LyricLine[] = [];
  /** Corresponding DOM elements for each line */
  private lineElements: HTMLDivElement[] = [];
  /** Word measurement data per line */
  private wordMeasurements: WordMeasurement[][] = [];
  /** Word animation targets per line */
  private lineAnimTargets: WordAnimTarget[][] = [];
  /** Whether the current lyrics have word-level timestamps */
  private hasWordTiming = false;
  /** Line-level Web Animations lifecycle manager */
  private lineAnimations = new LineAnimationController((lineIndex) =>
    this.activeLineSet.has(lineIndex),
  );

  /** Primary active line index (smallest if multiple lines active) */
  private activeLineIndex = -1;
  /** Set of all active line indices */
  private activeLineSet = new Set<number>();
  /** Last processed playback time in ms (seek detection baseline) */
  private lastProcessedTime = -1;
  /** Reused buffer for processTime to avoid per-frame allocations */
  private activatedBuffer: number[] = [];
  private deactivatedBuffer = new Set<number>();

  /** Y-axis position spring per line */
  private positionSprings: Spring[] = [];
  /** Scale spring per line (value range 0~100 maps to 0~1 scale) */
  private scaleSprings: Spring[] = [];

  /** Cached line heights */
  private lineHeights: Float64Array = new Float64Array(0);
  /** Whether background line is positioned above host main line */
  private isBgAbove: boolean[] = [];
  /** Container dimensions */
  private containerWidth = 0;
  private containerHeight = 0;

  /** Alpha interpolation values driving --ba / --da */
  private alphaValues: Float64Array = new Float64Array(0);
  /** Blur interpolation values driving --blur */
  private blurValues: Float64Array = new Float64Array(0);
  /** Passed line fadeout values driving --pass */
  private passValues: Float64Array = new Float64Array(0);
  /** Write cache for --pass */
  private cachedPassKeys: string[] = [];

  /** Skipped once entrance animation settles */
  private entranceComplete = true;

  /** User manual scroll offset in px */
  private userScrollOffset = 0;
  /** Whether user is actively scrolling */
  private isUserScrolling = false;
  /** Whether mouse is hovering over container (suppresses blur) */
  private isHovering = false;
  /** Scroll snap-back timer ID */
  private scrollResetTimerId = 0;
  /** Last touch Y coordinate */
  private lastTouchY = 0;

  /** Interlude state */
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
  /** Interlude render cache */
  private interludeCache: InterludeCache = {
    containerStyle: "",
    dotOpacities: ["", "", ""],
  };
  /** Interlude container dimensions */
  private dotsContainerWidth = 0;
  private dotsContainerHeight = 0;

  /** rAF request ID (0 when inactive) */
  private animationFrameId = 0;
  /** Mask calculation delayed rAF handle */
  private maskRafId = 0;
  /** Last frame timestamp in ms */
  private lastFrameTimestamp = 0;
  /** Whether the page is currently visible */
  private isPageVisible = true;
  /** Whether full sync is needed on next frame */
  private needsFullSync = false;
  /** Snap layout immediately on next seek (after resume/unfreeze) */
  private snapNextSeek = false;
  /** Buffered lyrics while page was hidden */
  private pendingHiddenLyrics: LyricLine[] | null = null;
  /** Pending playback time from external push */
  private pendingPlayTime = -1;

  /** Write cache for transform */
  private cachedTransforms: string[] = [];
  private lineWillChange: boolean[] = [];
  /** Viewport culling state per line */
  private lineCulled: boolean[] = [];
  /** Whether credit/bottom-line has will-change applied */
  private bottomWillChange = false;
  /** Whether credit/bottom-line is culled */
  private bottomCulled = false;
  /** Alpha cache keys */
  private cachedAlphaKeys: string[] = [];
  /** Blur cache keys */
  private cachedBlurKeys: string[] = [];
  /** --t CSS variable string cache */
  private cachedTimeString = "";

  /** Active line align position in viewport (0~1) */
  private alignPosition = DEFAULTS.alignPosition;
  /** Whether currently playing */
  private isPlaying = true;
  /** Word mask gradient fade width ratio */
  private wordFadeWidth = DEFAULTS.wordFadeWidth;
  /** Spring physics parameters */
  private springParams: Partial<SpringParams> = {};
  /** Line click callback */
  private lineClickCallback: ((timeMs: number) => void) | null = null;
  /** Scroll reset delay in ms */
  private scrollResetDelay = DEFAULTS.scrollResetDelay;
  /** Minimum gap in ms to trigger interlude */
  private minInterludeGap = DEFAULTS.minInterludeGap;
  /** Interlude dots breathing cycle in ms */
  private breatheCycleTarget = DEFAULTS.breatheCycleTarget;
  /** Alpha attack speed */
  private alphaAttackSpeed = DEFAULTS.alphaAttackSpeed;
  /** Alpha release speed */
  private alphaReleaseSpeed = DEFAULTS.alphaReleaseSpeed;
  /** Inactive line alpha */
  private inactiveAlpha = DEFAULTS.inactiveAlpha;
  /** Hide passed lines */
  private hidePassedLines = DEFAULTS.hidePassedLines;
  /** Enable blur effect */
  private enableBlur = DEFAULTS.enableBlur;
  /** Enable word-by-word highlight */
  private enableWordHighlight = DEFAULTS.enableWordHighlight;
  /** Enable character float animation */
  private enableFloatAnimation = DEFAULTS.enableFloatAnimation;
  /** Enable line scale effect */
  private enableScale = DEFAULTS.enableScale;
  /** Enable syllable emphasis effect */
  private enableEmphasizeEffect = DEFAULTS.enableEmphasizeEffect;
  /** Show translation */
  private showTranslation = DEFAULTS.showTranslation;
  /** Show romanization */
  private showRomanization = DEFAULTS.showRomanization;
  /** Show ruby annotations */
  private showRuby = DEFAULTS.showRuby;
  /** Always keep background vocal below main line */
  private bgAlwaysBelow = DEFAULTS.bgAlwaysBelow;
  /** Raw lyrics before preroll */
  private rawLines: LyricLine[] = [];
  /** Enable scroll preroll */
  private enableScrollPreroll = DEFAULTS.enableScrollPreroll;
  /** Scroll preroll options */
  private scrollPrerollOptions: Partial<ScrollPrerollOptions> = {
    ...DEFAULTS.scrollPrerollOptions,
  };
  /** Seek backward threshold in ms */
  private seekBackwardThreshold = DEFAULTS.seekBackwardThreshold;
  /** Seek forward threshold in ms */
  private seekForwardThreshold = DEFAULTS.seekForwardThreshold;
  /** Minimum duration in ms to trigger syllable emphasis */
  private emphasizeMinDuration = DEFAULTS.emphasizeMinDuration;

  /** Container resize observer */
  private containerResizeObserver: ResizeObserver;
  /** Sentinel resize observer to detect font/style changes */
  private sentinelResizeObserver: ResizeObserver;
  /** Sentinel element */
  private sentinelElement: HTMLDivElement | null = null;

  /** Bottom line / credit container */
  private bottomLineEl!: HTMLDivElement;
  /** Bottom line position spring */
  private bottomLineSpring = new Spring(2000);
  /** Bottom line transform cache */
  private cachedBottomTransform = "";

  /**
   * Create a new LyricRenderer instance.
   *
   * @param container - Outer HTML container element
   * @param config - Optional initial configuration
   */
  constructor(container: HTMLElement, config?: Partial<RendererConfig>) {
    this.container = container;
    // Remove stale inner containers from previous instances
    for (const stale of Array.from(container.querySelectorAll(":scope > .lp-inner"))) {
      stale.remove();
    }
    container.classList.add("lp-root");

    // Create inner wrapper
    this.innerElement = document.createElement("div");
    this.innerElement.className = "lp-inner";
    container.appendChild(this.innerElement);

    // Create interlude dots
    [this.dotsContainer, this.dotElements] = createInterludeDots(this.innerElement);

    // Create bottom credit container
    this.bottomLineEl = document.createElement("div");
    this.bottomLineEl.className = "lp-credit";
    this.innerElement.appendChild(this.bottomLineEl);

    if (config) this.applyConfig(config);

    // Cache container dimensions
    this.containerWidth = container.clientWidth;
    this.containerHeight = container.clientHeight;

    // Resize observers
    this.containerResizeObserver = new ResizeObserver(this.handleContainerResize);
    this.containerResizeObserver.observe(container);
    this.sentinelResizeObserver = new ResizeObserver(this.handleSentinelResize);

    // Event listeners
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

    // Start animation loop
    this.animationFrameId = requestAnimationFrame(this.onAnimationFrame);
  }

  /** Freeze rendering and pause animations */
  freeze = () => {
    cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = 0;
    this.containerResizeObserver.disconnect();
    this.sentinelResizeObserver.disconnect();
    this.lineAnimations.cleanupInactive();
    this.lineAnimations.pauseAll();
  };

  /** Resume rendering and unpause animations */
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

  /** Dispose renderer and tear down observers and listeners */
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
   * Set new lyric lines and rebuild elements.
   *
   * @param lines - Array of lyric lines
   */
  setLyrics = (lines: LyricLine[]) => {
    if (!this.isPageVisible) {
      this.pendingHiddenLyrics = lines;
      return;
    }
    const clonedLines = lines.map((line) => ({
      ...line,
      words: line.words ? line.words.map((w) => ({ ...w })) : [],
    }));

    // Demote orphaned background lines without a preceding main line
    let consecutiveBgCount = 0;
    for (let i = 0; i < clonedLines.length; i++) {
      const line = clonedLines[i];
      if (!line.isBG) {
        consecutiveBgCount = 0;
        continue;
      }
      consecutiveBgCount++;
      if (i === 0 || (consecutiveBgCount > 1 && line.singerRole !== "background")) {
        line.isBG = false;
      }
    }

    syncMainAndBackgroundLines(clonedLines);
    this.rawLines = clonedLines;
    const processedLines = this.enableScrollPreroll
      ? applyScrollPreroll(clonedLines, this.scrollPrerollOptions)
      : clonedLines.map((line) => ({ ...line }));

    const seekTime = this.pendingPlayTime >= 0 ? this.pendingPlayTime : 0;
    this.lineAnimations.cancelAll();
    for (const element of this.lineElements) element.remove();

    // Reset internal state
    this.lines = processedLines;
    this.hasWordTiming = processedLines.some((line) => line.words.length > 1);
    this.activeLineIndex = -1;
    this.activeLineSet.clear();
    this.lastProcessedTime = -1;
    this.userScrollOffset = 0;
    this.interludeState.isActive = false;

    // Toggle duet styling if any duet line exists
    this.container.classList.toggle(
      "lp-has-duet",
      processedLines.some((line) => line.isDuet),
    );

    const lineCount = processedLines.length;

    // Initialize springs
    const offScreen = Math.max(this.containerHeight * 2, 2000);
    this.bottomLineSpring.setPosition(offScreen);
    this.cachedBottomTransform = "";
    this.positionSprings = new Array(lineCount);
    this.scaleSprings = new Array(lineCount);
    for (let i = 0; i < lineCount; i++) {
      this.positionSprings[i] = new Spring(offScreen);
      const scaleSpring = new Spring(97);
      scaleSpring.updateParams(
        processedLines[i].isBG
          ? { mass: 1, damping: 20, stiffness: 50 }
          : { mass: 2, damping: 25, stiffness: 100 },
      );
      this.scaleSprings[i] = scaleSpring;
    }
    this.applySpringParams();

    // Initialize alpha values
    this.alphaValues = new Float64Array(lineCount * 2);
    for (let i = 0; i < lineCount; i++) {
      this.alphaValues[i * 2] = this.inactiveAlpha;
      this.alphaValues[i * 2 + 1] = this.inactiveAlpha;
    }

    // Initialize caches
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

    // Build DOM elements
    const built = buildLineElements(this.lines, {
      enableEmphasizeEffect: this.enableEmphasizeEffect,
      emphasizeMinDuration: this.emphasizeMinDuration,
      showTranslation: this.showTranslation,
      showRomanization: this.showRomanization,
      showRuby: this.showRuby,
      bgAlwaysBelow: this.bgAlwaysBelow,
    });
    this.lineElements = built.lineElements;
    this.wordMeasurements = built.wordMeasurements;
    this.lineAnimTargets = built.lineAnimTargets;
    this.isBgAbove = built.isBgAbove;
    this.innerElement.appendChild(built.fragment);
    this.innerElement.appendChild(this.bottomLineEl);

    // Sentinel observer for font and style changes
    this.sentinelResizeObserver.disconnect();
    this.sentinelElement = null;
    if (lineCount > 0) {
      this.sentinelElement = this.lineElements[0];
      this.sentinelResizeObserver.observe(this.sentinelElement);
    }

    // Measure sizes and compute masks
    this.dotsContainerWidth = this.dotsContainer.offsetWidth || 60;
    this.dotsContainerHeight = this.dotsContainer.offsetHeight || 20;
    this.measureLineHeights();

    // Defer word mask calculation to next frame to prevent dropped frames during initial mount
    this.maskRafId = requestAnimationFrame(() => {
      measureAndApplyWordMasks(this.wordMeasurements, this.wordFadeWidth, this.lines);
    });

    this.pendingPlayTime = -1;
    this.lastProcessedTime = -1;
    this.lastFrameTimestamp = 0;

    // Initial layout and entrance animation
    this.handleSeek(seekTime);
    this.calculateLayout(true);
    this.playEntranceAnimation(this.containerHeight * 0.6);
    this.needsFullSync = true;
  };

  /**
   * Push current playback time.
   *
   * @param timeMs - Playback time in milliseconds
   */
  setCurrentTime = (timeMs: number) => {
    this.pendingPlayTime = timeMs;
  };

  /**
   * Set playback state.
   *
   * @param playing - Whether audio is playing
   */
  setPlaying = (playing: boolean) => {
    if (this.isPlaying === playing) return;
    this.isPlaying = playing;

    if (playing) this.lineAnimations.realignActive(this.lines, this.lastProcessedTime);
    else this.lineAnimations.pauseActive();

    this.calculateLayout(false, true);
    this.needsFullSync = true;
  };

  /**
   * Update renderer configuration.
   *
   * @param config - Partial renderer config
   */
  setConfig = (config: Partial<RendererConfig>) => {
    this.applyConfig(config);
  };

  /**
   * Apply configuration options.
   *
   * @param config - Partial renderer config
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
      if (this.lineElements.length > 0) {
        measureAndApplyWordMasks(this.wordMeasurements, this.wordFadeWidth, this.lines);
      }
    }
    if (config.onLineClick !== undefined) this.lineClickCallback = config.onLineClick ?? null;
    if (config.springConfig) {
      this.springParams = config.springConfig;
      this.applySpringParams();
    }
    if (config.scrollResetDelay != null) this.scrollResetDelay = config.scrollResetDelay;
    if (config.minInterludeGap != null) this.minInterludeGap = config.minInterludeGap;
    if (config.breatheCycleTarget != null) this.breatheCycleTarget = config.breatheCycleTarget;
    if (config.inactiveAlpha != null) this.inactiveAlpha = config.inactiveAlpha;
    if (config.hidePassedLines != null) this.hidePassedLines = config.hidePassedLines;
    if (config.enableBlur != null) this.enableBlur = config.enableBlur;
    let domRebuildNeeded = false;
    let needPrerollUpdate = false;

    if (config.enableWordHighlight != null) this.enableWordHighlight = config.enableWordHighlight;
    if (config.enableFloatAnimation != null) {
      this.enableFloatAnimation = config.enableFloatAnimation;
    }
    if (config.enableScale != null && config.enableScale !== this.enableScale) {
      this.enableScale = config.enableScale;
      layoutDirty = true;
    }
    if (
      config.enableEmphasizeEffect != null &&
      config.enableEmphasizeEffect !== this.enableEmphasizeEffect
    ) {
      this.enableEmphasizeEffect = config.enableEmphasizeEffect;
      domRebuildNeeded = true;
    }
    if (config.showTranslation != null && config.showTranslation !== this.showTranslation) {
      this.showTranslation = config.showTranslation;
      domRebuildNeeded = true;
    }
    if (config.showRomanization != null && config.showRomanization !== this.showRomanization) {
      this.showRomanization = config.showRomanization;
      domRebuildNeeded = true;
    }
    if (config.showRuby != null && config.showRuby !== this.showRuby) {
      this.showRuby = config.showRuby;
      domRebuildNeeded = true;
    }
    if (config.bgAlwaysBelow != null && config.bgAlwaysBelow !== this.bgAlwaysBelow) {
      this.bgAlwaysBelow = config.bgAlwaysBelow;
      domRebuildNeeded = true;
    }
    if (
      config.enableScrollPreroll != null &&
      config.enableScrollPreroll !== this.enableScrollPreroll
    ) {
      this.enableScrollPreroll = config.enableScrollPreroll;
      needPrerollUpdate = true;
    }
    if (config.scrollPrerollOptions != null) {
      this.scrollPrerollOptions = {
        ...this.scrollPrerollOptions,
        ...config.scrollPrerollOptions,
      };
      if (this.enableScrollPreroll) needPrerollUpdate = true;
    }
    if (needPrerollUpdate && this.rawLines.length > 0) {
      this.lines = this.enableScrollPreroll
        ? applyScrollPreroll(this.rawLines, this.scrollPrerollOptions)
        : this.rawLines.map((line) => ({ ...line }));
      domRebuildNeeded = true;
    }
    if (config.seekBackwardThreshold != null) {
      this.seekBackwardThreshold = config.seekBackwardThreshold;
    }
    if (config.seekForwardThreshold != null) {
      this.seekForwardThreshold = config.seekForwardThreshold;
    }
    if (
      config.emphasizeMinDuration != null &&
      config.emphasizeMinDuration !== this.emphasizeMinDuration
    ) {
      this.emphasizeMinDuration = config.emphasizeMinDuration;
      domRebuildNeeded = true;
    }

    if (domRebuildNeeded && this.lines.length > 0) {
      this.rebuildDomInPlace();
      return;
    }

    if (layoutDirty && this.lineElements.length > 0) {
      this.measureLineHeights();
      this.calculateLayout(false);
      this.needsFullSync = true;
    }
  };

  /** Rebuild DOM in place preserving animation state and spring positions */
  private rebuildDomInPlace = () => {
    if (this.lines.length === 0) return;
    this.lineAnimations.cancelAll();
    for (const element of this.lineElements) element.remove();

    const built = buildLineElements(this.lines, {
      enableEmphasizeEffect: this.enableEmphasizeEffect,
      emphasizeMinDuration: this.emphasizeMinDuration,
      showTranslation: this.showTranslation,
      showRomanization: this.showRomanization,
      showRuby: this.showRuby,
      bgAlwaysBelow: this.bgAlwaysBelow,
    });
    this.lineElements = built.lineElements;
    this.wordMeasurements = built.wordMeasurements;
    this.lineAnimTargets = built.lineAnimTargets;
    this.isBgAbove = built.isBgAbove;
    this.innerElement.appendChild(built.fragment);

    this.container.classList.toggle(
      "lp-has-duet",
      this.lines.some((line) => line.isDuet),
    );
    for (const lineIdx of this.activeLineSet) {
      this.lineElements[lineIdx]?.classList.add("active");
    }
    if (this.isPlaying && this.lastProcessedTime >= 0) {
      this.lineAnimations.realignActive(this.lines, this.lastProcessedTime);
    }

    this.sentinelResizeObserver.disconnect();
    this.sentinelElement = null;
    if (this.lineElements.length > 0) {
      this.sentinelElement = this.lineElements[0];
      this.sentinelResizeObserver.observe(this.sentinelElement);
    }

    this.measureLineHeights();
    measureAndApplyWordMasks(this.wordMeasurements, this.wordFadeWidth, this.lines);

    // Clear caches and sync transforms to avoid layout jumps
    this.cachedTransforms.fill("");
    this.cachedAlphaKeys.fill("");
    this.cachedBlurKeys.fill("");
    this.cachedPassKeys.fill("");
    this.cachedTimeString = "";

    const lineCount = this.lines.length;
    for (let i = 0; i < lineCount; i++) {
      const lineEl = this.lineElements[i];
      if (!lineEl) continue;
      const y = this.positionSprings[i]?.getCurrentPosition() ?? 0;
      const s = (this.scaleSprings[i]?.getCurrentPosition() ?? 100) / 100;
      const tf = `translateY(${y.toFixed(2)}px) scale(${s.toFixed(4)})`;
      this.cachedTransforms[i] = tf;
      lineEl.style.transform = tf;

      const blur = this.blurValues[i] || 0;
      if (blur > 0.01) {
        lineEl.style.filter = `blur(${(blur * 1.5).toFixed(2)}px)`;
        this.cachedBlurKeys[i] = blur.toFixed(2);
      }
    }

    if (this.enableWordHighlight && this.lastProcessedTime >= 0) {
      const timeStr = String(this.lastProcessedTime);
      this.cachedTimeString = timeStr;
      for (const lineIdx of this.activeLineSet) {
        this.lineElements[lineIdx]?.style.setProperty("--t", timeStr);
      }
    }

    this.snapVisualState();
    this.calculateLayout(false);
    this.needsFullSync = true;
  };

  /** Measure offsetHeight for all lines and cache in lineHeights */
  private measureLineHeights = () => {
    for (let i = 0; i < this.lineElements.length; i++) {
      this.lineHeights[i] = this.lineElements[i]?.offsetHeight || 40;
    }
  };

  /**
   * Process playback time and detect active line changes.
   *
   * @param currentTime - Current playback time in milliseconds
   * @returns Whether active lines changed
   */
  private processTime = (currentTime: number): boolean => {
    const isFirst = this.lastProcessedTime < 0;
    const isSeeked =
      !isFirst &&
      (currentTime < this.lastProcessedTime - this.seekBackwardThreshold ||
        currentTime > this.lastProcessedTime + this.seekForwardThreshold);
    this.lastProcessedTime = currentTime;

    if (isFirst || isSeeked) {
      const snap = this.snapNextSeek;
      this.snapNextSeek = false;
      this.handleSeek(currentTime, snap);
      return true;
    }
    this.snapNextSeek = false;

    const lines = this.lines;
    const activated = this.activatedBuffer;
    const deactivated = this.deactivatedBuffer;
    activated.length = 0;
    deactivated.clear();
    let bgTransition = false;

    // Check newly activated lines (background lines follow host line)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.isBG || this.activeLineSet.has(i)) continue;

      if (line.startTime <= currentTime && line.endTime > currentTime) {
        activated.push(i);
        for (let bgIdx = i + 1; lines[bgIdx]?.isBG; bgIdx++) {
          activated.push(bgIdx);
          bgTransition = true;
        }
      }
    }

    // Check lines that should be deactivated
    for (const lineIdx of this.activeLineSet) {
      const line = lines[lineIdx];
      if (!line) {
        deactivated.add(lineIdx);
        continue;
      }
      if (line.isBG) continue;

      if (line.startTime > currentTime || line.endTime <= currentTime) {
        deactivated.add(lineIdx);
        for (let bgIdx = lineIdx + 1; lines[bgIdx]?.isBG; bgIdx++) {
          deactivated.add(bgIdx);
          bgTransition = true;
        }
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
    this.calculateLayout(false, bgTransition);
    return true;
  };

  /**
   * Handle seek event.
   *
   * @param targetTime - Target playback time in milliseconds
   * @param snap - Whether to snap visual state immediately
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
      const line = lines[i];
      if (line.isBG) continue;

      if (line.startTime <= targetTime && targetTime < line.endTime) {
        this.activeLineSet.add(i);
        this.lineElements[i]?.classList.add("active");
        this.activateLineAnimations(i, targetTime);
        for (let bgIdx = i + 1; lines[bgIdx]?.isBG; bgIdx++) {
          this.activeLineSet.add(bgIdx);
          this.lineElements[bgIdx]?.classList.add("active");
          this.activateLineAnimations(bgIdx, targetTime);
        }
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

  /** Snap alpha and pass values immediately to targets */
  private snapVisualState = () => {
    const doPass = this.hidePassedLines && this.isPlaying;
    const activeIdx = this.activeLineIndex;
    for (let i = 0; i < this.lines.length; i++) {
      const lineEl = this.lineElements[i];
      if (!lineEl) continue;
      const isActive = this.activeLineSet.has(i);
      const isPassed =
        doPass && !isActive && (this.lines[i].isBG ? i - 1 < activeIdx : i < activeIdx);
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
   * Compute target positions and scales for all lines.
   *
   * @param syncImmediate - Whether to snap positions immediately
   * @param noCascade - Whether to skip cascading delay
   */
  private calculateLayout = (syncImmediate: boolean, noCascade = false) => {
    const viewHeight = this.containerHeight;
    const viewWidth = this.containerWidth;
    const currentTime = this.lastProcessedTime;
    const targetIdx = this.activeLineIndex;
    const lines = this.lines;
    const lineCount = this.positionSprings.length;
    if (lineCount === 0) return;

    // Detect interlude
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
      const targetScale =
        !isActive && this.isPlaying ? (line.isBG ? 75 : this.enableScale ? 97 : 100) : 100;
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
   * Play initial entrance animation.
   *
   * @param offset - Initial vertical offset in px
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
   * RequestAnimationFrame render loop callback.
   *
   * @param timestamp - High resolution frame timestamp
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
    if (this.bottomLineEl.childNodes.length > 0) {
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
    const brightenFactor = this.hasWordTiming ? attackFactor : releaseFactor;
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
        doPass &&
        !this.isUserScrolling &&
        !isActive &&
        (this.lines[i].isBG ? i - 1 < activeIdx : i < activeIdx);

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
              ? brightenFactor
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
   * Lazily activate line animations.
   *
   * @param lineIndex - Line index
   * @param currentTime - Current playback time in milliseconds
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
   * Handle line click event.
   *
   * @param event - Mouse click event
   */
  private handleLineClick = (event: MouseEvent) => {
    if (!this.lineClickCallback) return;
    const lineEl = (event.target as HTMLElement).closest(".lp-line") as HTMLDivElement | null;
    if (!lineEl) return;
    const lineIdx = this.lineElements.indexOf(lineEl);
    if (lineIdx !== -1 && this.lines[lineIdx]) {
      this.lineClickCallback(this.lines[lineIdx].startTime);
    }
  };

  /**
   * Apply user scrolling offset and set reset timer.
   *
   * @param deltaY - Scroll delta in px
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

  /** Get bottom credit line HTML container */
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
  };
}
