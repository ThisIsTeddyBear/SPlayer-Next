import type { SpringParams } from "./spring";
import { DEFAULT_SCROLL_PREROLL_OPTIONS, type ScrollPrerollOptions } from "../utils/scroll-preroll";

export type { ScrollPrerollOptions } from "../utils/scroll-preroll";

/**
 * Lyric rendering engine default configuration constants
 */
export const DEFAULTS = {
  /** Delay before auto-resetting scroll position to active line (ms) */
  scrollResetDelay: 5000,
  /** Minimum duration to trigger instrumental interlude breathing dots (ms) */
  minInterludeGap: 4000,
  /** Target cycle duration for interlude breathing dots animation (ms) */
  breatheCycleTarget: 1500,
  /** Opacity increase rate on line activation */
  alphaAttackSpeed: 16,
  /** Opacity decrease rate on line deactivation */
  alphaReleaseSpeed: 7,
  /** Base opacity for inactive lines */
  inactiveAlpha: 0.2,
  /** Vertical anchor alignment position of active line in container (0-1) */
  alignPosition: 0.35,
  /** Proportional width of the word gradient fade mask */
  wordFadeWidth: 0.5,
  /** Whether to hide passed lyric lines */
  hidePassedLines: false,
  /** Whether to enable dynamic per-line blur effect */
  enableBlur: false,
  /** Whether to enable word-by-word karaoke highlight */
  enableWordHighlight: true,
  /** Whether to enable word floating upward animation */
  enableFloatAnimation: false,
  /** Whether to enable line scaling (inactive lines scaled down slightly) */
  enableScale: true,
  /** Whether to enable long syllable emphasis (scale + glow + sine float) */
  enableEmphasizeEffect: false,
  /** Minimum duration threshold for long syllable emphasis in ms */
  emphasizeMinDuration: 1000,
  /** Whether to display translation lyrics */
  showTranslation: true,
  /** Whether to display romanized lyrics */
  showRomanization: true,
  /** Whether to display ruby pronunciation annotations */
  showRuby: false,
  /** Whether background lines are always placed below the main line */
  bgAlwaysBelow: false,
  /** Whether to enable scroll pre-roll optimization */
  enableScrollPreroll: true,
  /** Fine-tuning options for scroll pre-roll */
  scrollPrerollOptions: DEFAULT_SCROLL_PREROLL_OPTIONS,
  /** Backward seek detection threshold in ms */
  seekBackwardThreshold: 100,
  /** Forward seek detection threshold in ms */
  seekForwardThreshold: 2000,
};

/** Lyric renderer configuration options */
export interface RendererConfig {
  /** Vertical anchor alignment position of active line in container (0-1) */
  alignPosition: number;
  /** Whether playback is active */
  playing: boolean;
  /** Spring physics parameters */
  springConfig: Partial<SpringParams>;
  /** Proportional width of the word gradient fade mask */
  wordFadeWidth: number;
  /** Delay before auto-resetting scroll position to active line in ms */
  scrollResetDelay: number;
  /** Minimum duration to trigger instrumental interlude animation in ms */
  minInterludeGap: number;
  /** Target cycle duration for interlude breathing dots animation in ms */
  breatheCycleTarget: number;
  /** Opacity increase rate on line activation */
  alphaAttackSpeed: number;
  /** Opacity decrease rate on line deactivation */
  alphaReleaseSpeed: number;
  /** Base opacity for inactive lines */
  inactiveAlpha: number;
  /** Whether to hide passed lyric lines */
  hidePassedLines: boolean;
  /** Whether to enable per-line distance blur */
  enableBlur: boolean;
  /** Whether to enable word-by-word karaoke highlight */
  enableWordHighlight: boolean;
  /** Whether to enable word floating upward animation */
  enableFloatAnimation: boolean;
  /** Whether to enable line scaling */
  enableScale: boolean;
  /** Whether to enable long syllable emphasis */
  enableEmphasizeEffect: boolean;
  /** Minimum duration threshold for long syllable emphasis in ms */
  emphasizeMinDuration: number;
  /** Whether to display translation lyrics */
  showTranslation: boolean;
  /** Whether to display romanized lyrics */
  showRomanization: boolean;
  /** Whether to display ruby pronunciation annotations */
  showRuby: boolean;
  /** Whether background lines are always placed below the main line */
  bgAlwaysBelow: boolean;
  /** Whether to enable scroll pre-roll */
  enableScrollPreroll: boolean;
  /** Scroll pre-roll parameters */
  scrollPrerollOptions: Partial<ScrollPrerollOptions>;
  /** Backward seek detection threshold in ms */
  seekBackwardThreshold: number;
  /** Forward seek detection threshold in ms */
  seekForwardThreshold: number;
  /** Line click callback handler */
  onLineClick?: (timeMs: number) => void;
}
