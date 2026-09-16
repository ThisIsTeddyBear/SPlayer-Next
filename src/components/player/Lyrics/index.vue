<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import { LyricRenderer } from "./engine";
import type { SpringParams } from "./engine/spring";
import { DEFAULTS } from "./engine/constants";
import "./renderer.css";

const props = withDefaults(
  defineProps<{
    /** Array of lyric lines */
    lyricLines: LyricLine[];
    /** Whether audio is currently playing */
    playing?: boolean;
    /**
     * Viewport alignment position of active line
     * @range 0 ~ 1 (0 = top, 1 = bottom)
     * @default 0.35
     */
    alignPosition?: number;
    /**
     * Word mask fade width ratio (relative to character height)
     * @range 0 ~ 1
     * @default 0.5
     */
    wordFadeWidth?: number;
    /** Spring physics parameters */
    springConfig?: Partial<SpringParams>;
    /**
     * User scroll reset delay in ms
     * @default 5000
     */
    scrollResetDelay?: number;
    /**
     * Minimum gap in ms to trigger interlude dots
     * @default 4000
     */
    minInterludeGap?: number;
    /**
     * Interlude breathing cycle in ms
     * @default 1500
     */
    breatheCycleTarget?: number;
    /**
     * Alpha attack speed on line activation
     * @default 16
     */
    alphaAttackSpeed?: number;
    /**
     * Alpha release speed on line deactivation
     * @default 7
     */
    alphaReleaseSpeed?: number;
    /**
     * Inactive line base alpha
     * @default 0.2
     */
    inactiveAlpha?: number;
    /** Whether to hide passed lines */
    hidePassedLines?: boolean;
    /** Whether to enable per-line blur */
    enableBlur?: boolean;
    /** Whether to enable word-level highlight */
    enableWordHighlight?: boolean;
    /** Whether to enable character float animation */
    enableFloatAnimation?: boolean;
    /** Whether to enable line scale effect */
    enableScale?: boolean;
    /**
     * Whether to enable syllable emphasis effect
     * @default false
     */
    enableEmphasizeEffect?: boolean;
    /** Whether to show translation lyrics */
    showTranslation?: boolean;
    /** Whether to show romanization lyrics */
    showRomanization?: boolean;
    /** Whether to show ruby annotations */
    showRuby?: boolean;
    /** Whether to always position background vocals below main line */
    bgAlwaysBelow?: boolean;
    /** Whether to enable scroll preroll */
    enableScrollPreroll?: boolean;
    /** Minimum duration in ms to trigger syllable emphasis */
    emphasizeMinDuration?: number;
    /** Seek backward threshold in ms */
    seekBackwardThreshold?: number;
    /** Seek forward threshold in ms */
    seekForwardThreshold?: number;
    /** Initial playback time in ms upon mounting */
    initialTime?: number;
  }>(),
  {
    playing: false,
    alignPosition: DEFAULTS.alignPosition,
    wordFadeWidth: DEFAULTS.wordFadeWidth,
    scrollResetDelay: DEFAULTS.scrollResetDelay,
    minInterludeGap: DEFAULTS.minInterludeGap,
    breatheCycleTarget: DEFAULTS.breatheCycleTarget,
    alphaAttackSpeed: DEFAULTS.alphaAttackSpeed,
    alphaReleaseSpeed: DEFAULTS.alphaReleaseSpeed,
    inactiveAlpha: DEFAULTS.inactiveAlpha,
    hidePassedLines: DEFAULTS.hidePassedLines,
    enableBlur: DEFAULTS.enableBlur,
    enableWordHighlight: DEFAULTS.enableWordHighlight,
    enableFloatAnimation: DEFAULTS.enableFloatAnimation,
    enableScale: DEFAULTS.enableScale,
    enableEmphasizeEffect: DEFAULTS.enableEmphasizeEffect,
    showTranslation: true,
    showRomanization: true,
    showRuby: DEFAULTS.showRuby,
    bgAlwaysBelow: DEFAULTS.bgAlwaysBelow,
    enableScrollPreroll: DEFAULTS.enableScrollPreroll,
    emphasizeMinDuration: DEFAULTS.emphasizeMinDuration,
    seekBackwardThreshold: DEFAULTS.seekBackwardThreshold,
    seekForwardThreshold: DEFAULTS.seekForwardThreshold,
    initialTime: 0,
  },
);

interface Emits {
  /** Triggered when user clicks on a lyric line, returns line start time in ms */
  (e: "seek", timeMs: number): void;
}

const emit = defineEmits<Emits>();

const containerRef = ref<HTMLElement>();
const bottomLineEl = ref<HTMLElement>();
let renderer: LyricRenderer | null = null;
let isFrozen = false;
let pendingLyrics: LyricLine[] | null = null;

/**
 * Push current playback time in milliseconds.
 *
 * @param time - Current playback time in ms
 */
const setCurrentTime = (time: number) => {
  renderer?.setCurrentTime(time);
};

const freeze = () => {
  isFrozen = true;
  renderer?.freeze();
};

const resume = () => {
  isFrozen = false;
  if (pendingLyrics) {
    renderer?.setLyrics(pendingLyrics);
    pendingLyrics = null;
  }
  renderer?.resume();
};

defineExpose({ setCurrentTime, freeze, resume });

const handleLineClick = (timeMs: number) => {
  emit("seek", timeMs);
};

onMounted(() => {
  if (!containerRef.value) return;
  const { lyricLines: _lyricLines, initialTime: _initialTime, ...config } = props;
  renderer = new LyricRenderer(containerRef.value, {
    ...config,
    springConfig: props.springConfig ?? {},
    onLineClick: handleLineClick,
  });
  if (props.initialTime > 0) {
    renderer.setCurrentTime(props.initialTime);
  }
  if (props.lyricLines.length > 0) {
    renderer.setLyrics(props.lyricLines);
  }
  bottomLineEl.value = renderer.getBottomLineElement();
});

onUnmounted(() => {
  renderer?.dispose();
  renderer = null;
});

const rebuildLyrics = (): void => {
  if (isFrozen) {
    pendingLyrics = props.lyricLines;
  } else {
    renderer?.setLyrics(props.lyricLines);
  }
};

watch(() => props.lyricLines, rebuildLyrics);

watch(
  () => props.playing,
  (v) => renderer?.setPlaying(v),
);

watch(
  () => props.alignPosition,
  (v) => renderer?.setConfig({ alignPosition: v }),
);

watch(
  () => props.wordFadeWidth,
  (v) => renderer?.setConfig({ wordFadeWidth: v }),
);

watch(
  () => props.springConfig,
  (v) => {
    if (v) renderer?.setConfig({ springConfig: v });
  },
  { deep: true },
);

watch(
  () => props.scrollResetDelay,
  (v) => renderer?.setConfig({ scrollResetDelay: v }),
);

watch(
  () => props.minInterludeGap,
  (v) => renderer?.setConfig({ minInterludeGap: v }),
);

watch(
  () => props.breatheCycleTarget,
  (v) => renderer?.setConfig({ breatheCycleTarget: v }),
);

watch(
  () => props.alphaAttackSpeed,
  (v) => renderer?.setConfig({ alphaAttackSpeed: v }),
);

watch(
  () => props.alphaReleaseSpeed,
  (v) => renderer?.setConfig({ alphaReleaseSpeed: v }),
);

watch(
  () => props.inactiveAlpha,
  (v) => renderer?.setConfig({ inactiveAlpha: v }),
);

watch(
  () => props.hidePassedLines,
  (v) => renderer?.setConfig({ hidePassedLines: v }),
);

watch(
  () => props.enableBlur,
  (v) => renderer?.setConfig({ enableBlur: v }),
);

watch(
  () => props.enableWordHighlight,
  (v) => renderer?.setConfig({ enableWordHighlight: v }),
);

watch(
  () => props.enableFloatAnimation,
  (v) => renderer?.setConfig({ enableFloatAnimation: v }),
);

watch(
  () => props.enableScale,
  (v) => renderer?.setConfig({ enableScale: v }),
);

watch(
  () => props.enableEmphasizeEffect,
  (v) => renderer?.setConfig({ enableEmphasizeEffect: v }),
);

watch(
  () => props.showTranslation,
  (v) => renderer?.setConfig({ showTranslation: v }),
);

watch(
  () => props.showRomanization,
  (v) => renderer?.setConfig({ showRomanization: v }),
);

watch(
  () => props.showRuby,
  (v) => renderer?.setConfig({ showRuby: v }),
);

watch(
  () => props.bgAlwaysBelow,
  (v) => renderer?.setConfig({ bgAlwaysBelow: v }),
);

watch(
  () => props.enableScrollPreroll,
  (v) => renderer?.setConfig({ enableScrollPreroll: v }),
);

watch(
  () => props.emphasizeMinDuration,
  (v) => renderer?.setConfig({ emphasizeMinDuration: v }),
);

watch(
  () => props.seekBackwardThreshold,
  (v) => renderer?.setConfig({ seekBackwardThreshold: v }),
);

watch(
  () => props.seekForwardThreshold,
  (v) => renderer?.setConfig({ seekForwardThreshold: v }),
);
</script>

<template>
  <div ref="containerRef">
    <Teleport v-if="bottomLineEl" :to="bottomLineEl">
      <slot name="bottom" />
    </Teleport>
  </div>
</template>
