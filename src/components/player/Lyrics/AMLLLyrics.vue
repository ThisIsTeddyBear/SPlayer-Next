<script setup lang="ts">
import type { LyricLine } from "@shared/types/lyrics";
import {
  LyricPlayer as CoreLyricPlayer,
  type LyricLineMouseEvent,
} from "@applemusic-like-lyrics/core";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { getCurrentTime } from "@/services/playback";
import "@applemusic-like-lyrics/core/style.css";
import "./renderer.css";

const props = withDefaults(
  defineProps<{
    /** Array of lyric lines */
    lyricLines: LyricLine[];
    /** Whether audio is currently playing */
    playing?: boolean;
    /** Viewport alignment position of active line [0 ~ 1] */
    alignPosition?: number;
    /** Word mask gradient fade width ratio */
    wordFadeWidth?: number;
    /** Whether to hide passed lines */
    hidePassedLines?: boolean;
    /** Whether to enable per-line blur effect */
    enableBlur?: boolean;
    /** Whether to display translation lyrics */
    showTranslation?: boolean;
    /** Whether to display line-level romanization */
    showLineRomanization?: boolean;
    /** Whether to display word-level romanization */
    showWordRomanization?: boolean;
    /** Initial playback time in milliseconds */
    initialTime?: number;
    /** Whether user is currently selecting a line for timing sync */
    syncPicking?: boolean;
  }>(),
  {
    playing: false,
    alignPosition: 0.35,
    wordFadeWidth: 0.5,
    hidePassedLines: false,
    enableBlur: false,
    showTranslation: true,
    showLineRomanization: true,
    showWordRomanization: true,
    initialTime: 0,
    syncPicking: false,
  },
);

interface Emits {
  /** Triggered on lyric line click for playback seek */
  (e: "seek", timeMs: number): void;
}

const emit = defineEmits<Emits>();

const settings = useSettingsStore();
const status = useStatusStore();

const wrapperRef = ref<HTMLDivElement | null>(null);
const playerRef = ref<CoreLyricPlayer>();
const bottomLineEl = ref<HTMLElement>();
const clockInitialized = ref(false);
// Whether player has finished initialization
const initialized = ref(false);
const contentVisible = ref(false);
// Parent component freeze flag
const isFrozen = ref(false);
// Buffered lyrics during freeze
let pendingLyrics: LyricLine[] | null = null;
// Page visibility tracking
const isPageHidden = ref(false);
// Previous hidden flag to detect resume moment
const isPreviousHidden = ref(false);

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

// Clean lyrics based on translation and romanization preferences
const processedLyrics = computed(() => {
  if (!props.lyricLines) return [];
  return props.lyricLines.map((line) => {
    const hasWordRoman = line.words?.some((word) => Boolean(word.romanWord?.trim())) ?? false;
    const showWordRomanForLine = props.showWordRomanization && hasWordRoman;
    const newLine = {
      ...line,
      translatedLyric: props.showTranslation ? line.translatedLyric : "",
      romanLyric: props.showLineRomanization && !showWordRomanForLine ? line.romanLyric : "",
    };
    if (line.words) {
      newLine.words = line.words.map((word) => {
        const newWord = { ...word };
        if (word.endsWithSpace && !word.word.endsWith(" ")) {
          newWord.word = word.word + " ";
        }
        if (!props.showWordRomanization) {
          delete newWord.romanWord;
        }
        return newWord;
      });
    }
    return newLine;
  });
});

// Line click event handler
const handleLineClick = (event: Event) => {
  const amllEvent = event as LyricLineMouseEvent;
  const lineData = amllEvent.line?.getLine();
  if (lineData && typeof lineData.startTime === "number") {
    emit("seek", lineData.startTime);
    if (!props.syncPicking) playerRef.value?.setCurrentTime(lineData.startTime, true);
  }
};

// Set html lang attribute on all main lyric lines
const processLyricLanguage = (player = playerRef.value) => {
  const lyricGroups = player?.currentLyricGroups;
  if (!Array.isArray(lyricGroups) || lyricGroups.length === 0) return;

  for (const group of lyricGroups) {
    for (const line of [group.mainLine, group.bgLine]) {
      const lyricLine = line?.getLine();
      const lyricLineElement = line?.getElement();
      if (!lyricLine || !lyricLineElement) continue;

      const lyricMainLineElement = lyricLineElement.firstChild;
      if (lyricMainLineElement instanceof HTMLElement) {
        const language = (lyricLine as LyricLine).language;
        if (language) lyricMainLineElement.lang = language;
        else lyricMainLineElement.removeAttribute("lang");
      }
    }
  }
};

/** Synchronize player configuration options */
const syncPlayerOptions = (player = playerRef.value): void => {
  if (!player) return;
  player.setAlignPosition(props.alignPosition);
  player.setAlignAnchor(props.alignPosition > 0.4 ? "center" : "top");
  player.setWordFadeWidth(props.wordFadeWidth);
  player.setHidePassedLines(props.hidePassedLines);
  player.setEnableBlur(props.enableBlur);

  const useSpring = settings.lyric.useAMSpring;
  player.setEnableSpring(useSpring);
  player.setEnableScale(useSpring);
  player.setLinePosYSpringParams({
    mass: settings.lyric.amllVerticalSpringMass,
    damping: settings.lyric.amllVerticalSpringDamping,
    stiffness: settings.lyric.amllVerticalSpringStiffness,
    soft: settings.lyric.amllVerticalSpringSoft,
  });
  player.setLineScaleSpringParams({
    mass: settings.lyric.amllScaleSpringMass,
    damping: settings.lyric.amllScaleSpringDamping,
    stiffness: settings.lyric.amllScaleSpringStiffness,
    soft: settings.lyric.amllScaleSpringSoft,
  });
};

const { resume: resumeRaf, pause: pauseRaf } = useRafFn(
  ({ delta }) => {
    playerRef.value?.update(delta);
  },
  { immediate: false },
);

// Stop render loop on page hide and calibrate timeline on restore
const handleVisibility = () => {
  const hidden = document.hidden;
  isPageHidden.value = hidden;
  if (hidden) {
    pauseRaf();
    playerRef.value?.pause();
    isPreviousHidden.value = true;
  } else if (isPreviousHidden.value && !isFrozen.value && playerRef.value) {
    const currentTime = getCurrentTime() + status.lyricOffsetMs;
    playerRef.value.setCurrentTime(currentTime, true);
    isPreviousHidden.value = false;
  }
};

onMounted(async () => {
  if (!wrapperRef.value) return;
  const player = new CoreLyricPlayer();
  playerRef.value = player;

  const el = player.getElement();
  el.style.width = "100%";
  el.style.height = "100%";
  wrapperRef.value.appendChild(el);

  const bottomEl = player.getBottomLineElement();
  if (bottomEl) {
    bottomEl.classList.add("lp-line", "lp-credit");
    bottomLineEl.value = bottomEl;
  }

  player.addEventListener("line-click", handleLineClick);

  player.setOptimizeOptions({
    cleanUnintentionalOverlaps: settings.lyric.amllCleanUnintentionalOverlaps,
    tryAdvanceStartTime: settings.lyric.amllTryAdvanceStartTime,
    convertExcessiveBackgroundLines: settings.lyric.amllConvertExcessiveBackgroundLines,
    syncMainAndBackgroundLines: settings.lyric.amllSyncMainAndBackgroundLines,
    normalizeSpaces: settings.lyric.amllNormalizeSpaces,
    resetLineTimestamps: settings.lyric.amllResetLineTimestamps,
  });
  syncPlayerOptions(player);
  document.addEventListener("visibilitychange", handleVisibility);

  await nextTick();
  await nextFrame();
  if (playerRef.value !== player) return;

  if (processedLyrics.value.length > 0) {
    player.setLyricLines(processedLyrics.value, props.initialTime);
    processLyricLanguage(player);
  } else if (Number.isFinite(props.initialTime) && props.initialTime >= 0) {
    player.setCurrentTime(props.initialTime, true);
  }

  await nextFrame();
  if (playerRef.value !== player) return;
  if (pendingLyrics) {
    player.setLyricLines(pendingLyrics, getCurrentTime() + status.lyricOffsetMs);
    pendingLyrics = null;
    processLyricLanguage(player);
    await nextFrame();
    if (playerRef.value !== player) return;
  }
  player.setCurrentTime(getCurrentTime() + status.lyricOffsetMs, true);
  player.update(0);
  initialized.value = true;
  contentVisible.value = true;
});

onUnmounted(() => {
  document.removeEventListener("visibilitychange", handleVisibility);
  pauseRaf();
  initialized.value = false;
  contentVisible.value = false;
  if (playerRef.value) {
    playerRef.value.removeEventListener("line-click", handleLineClick);
    playerRef.value.dispose();
    playerRef.value = undefined;
    bottomLineEl.value = undefined;
  }
});

// Synchronize play and freeze state with Core and render loop
watchEffect(() => {
  const player = playerRef.value;
  if (!player || !initialized.value) return;

  if (!clockInitialized.value) {
    player.update(0);
    clockInitialized.value = true;
  }

  const playing = props.playing;
  const frozen = isFrozen.value;
  const hidden = isPageHidden.value;

  if (!frozen && !hidden) {
    resumeRaf();
    if (playing) {
      player.resume();
    } else {
      player.pause();
    }
  } else {
    pauseRaf();
    player.pause();
  }
});

watch(
  () => [
    props.alignPosition,
    props.wordFadeWidth,
    props.hidePassedLines,
    props.enableBlur,
    settings.lyric.useAMSpring,
    settings.lyric.amllVerticalSpringMass,
    settings.lyric.amllVerticalSpringDamping,
    settings.lyric.amllVerticalSpringStiffness,
    settings.lyric.amllVerticalSpringSoft,
    settings.lyric.amllScaleSpringMass,
    settings.lyric.amllScaleSpringDamping,
    settings.lyric.amllScaleSpringStiffness,
    settings.lyric.amllScaleSpringSoft,
  ],
  () => syncPlayerOptions(),
);

watch(processedLyrics, (newLyrics) => {
  if (!playerRef.value) return;
  if (!initialized.value || isFrozen.value) {
    pendingLyrics = newLyrics;
  } else {
    const currentTime = getCurrentTime() + status.lyricOffsetMs;
    playerRef.value.setLyricLines(newLyrics, currentTime);
    processLyricLanguage();
  }
});

watch(
  () => ({
    cleanUnintentionalOverlaps: settings.lyric.amllCleanUnintentionalOverlaps,
    tryAdvanceStartTime: settings.lyric.amllTryAdvanceStartTime,
    convertExcessiveBackgroundLines: settings.lyric.amllConvertExcessiveBackgroundLines,
    syncMainAndBackgroundLines: settings.lyric.amllSyncMainAndBackgroundLines,
    normalizeSpaces: settings.lyric.amllNormalizeSpaces,
    resetLineTimestamps: settings.lyric.amllResetLineTimestamps,
  }),
  (options) => {
    if (!playerRef.value) return;
    playerRef.value.setOptimizeOptions(options);
    if (processedLyrics.value.length > 0 && !isFrozen.value) {
      const currentTime = getCurrentTime() + status.lyricOffsetMs;
      playerRef.value.setLyricLines(processedLyrics.value, currentTime);
      processLyricLanguage();
    }
  },
  { deep: true },
);

const setCurrentTime = (time: number, isSeek?: boolean) => {
  playerRef.value?.setCurrentTime(time, isSeek);
};

const freeze = () => {
  isFrozen.value = true;
};

const resume = () => {
  if (!initialized.value) {
    isFrozen.value = false;
    return;
  }
  if (pendingLyrics) {
    const currentTime = getCurrentTime() + status.lyricOffsetMs;
    playerRef.value?.setLyricLines(pendingLyrics, currentTime);
    processLyricLanguage();
    pendingLyrics = null;
  }
  isFrozen.value = false;
};

defineExpose({
  setCurrentTime,
  freeze,
  resume,
  lyricPlayer: playerRef,
});
</script>

<template>
  <div ref="wrapperRef" class="amll-lyrics-container" :class="contentVisible ? 'is-visible' : ''" />
  <Teleport v-if="bottomLineEl" :to="bottomLineEl">
    <slot name="bottom" />
  </Teleport>
</template>

<style scoped>
.amll-lyrics-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  user-select: none;
  opacity: 0;
  transition: opacity 120ms cubic-bezier(0.2, 0, 0, 1);
}

.amll-lyrics-container.is-visible {
  opacity: 1;
}

:deep(.amll-lyric-player) {
  --amll-lp-font-size: 1em;
  --amll-lp-color: var(--lp-color, #fff);
  width: 100%;
  height: 100%;
}

:deep(:lang(zh)) {
  font-family: var(--lyric-font-zh, inherit);
}

:deep(:lang(ja)) {
  font-family: var(--lyric-font-ja, inherit);
}

:deep(:lang(ko)) {
  font-family: var(--lyric-font-ko, inherit);
}

:deep(:lang(und-Latn)) {
  font-family: var(--lyric-font-latin, inherit);
}

:deep(.lp-line.lp-credit) {
  position: absolute !important;
  left: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  padding-top: 0.5em !important;
  padding-left: var(--lyric-line-padding-x, 1em) !important;
  padding-right: var(--lyric-line-padding-x, 1em) !important;
  text-align: left !important;
  display: flex !important;
  align-items: center !important;
  justify-content: flex-start !important;
  font-size: inherit !important;
  line-height: 1.4 !important;
  pointer-events: auto !important;
  z-index: 10 !important;
  background: none !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
  outline: none !important;
  contain: none !important;
  overflow: visible !important;
}

:deep(.lp-line.lp-credit:hover),
:deep(.lp-line.lp-credit:active),
:deep([class*="bottomLine"]),
:deep([class*="bottomLine"]:hover),
:deep([class*="bottomLine"]:active) {
  background: none !important;
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
  outline: none !important;
}

@media (max-width: 990px) {
  :deep(.lp-line.lp-credit) {
    padding-left: var(--lyric-line-padding-x, 1em) !important;
    padding-right: var(--lyric-line-padding-x, 1em) !important;
  }
}
</style>
