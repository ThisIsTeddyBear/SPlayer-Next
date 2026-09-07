<script setup lang="ts">
import type { DynamicIslandSettings } from "@shared/types/settings";
import type { LyricLine } from "@shared/types/lyrics";
import { DYNAMIC_ISLAND_BASE_HEIGHT } from "@shared/defaults/settings";
import DEFAULT_COVER from "@/assets/images/song.jpg";
import IslandLyricLine from "./components/IslandLyricLine.vue";
import { pickAdvanceOnEndIndex } from "@shared/utils/lyricSync";
import { useNowPlayingSync } from "@windows/shared/composables/useNowPlayingSync";
import { useDragWindow } from "./composables/useDragWindow";
import { isMac } from "@/utils/config";
import { formatArtists } from "@shared/utils/track";

const config = reactive<DynamicIslandSettings>({
  scale: 1,
  fontWeight: 500,
  fontFamily: "",
  wordByWord: true,
  transition: "bounce",
  playedColor: "rgba(255, 255, 255, 1)",
  unplayedColor: "rgba(255, 255, 255, 0.5)",
  backgroundColor: "rgba(0, 0, 0, 1)",
  alwaysOnTop: true,
  snapCentered: true,
  notchFusion: false,
  nonOcclusive: false,
  doubleLine: false,
  showTranslation: false,
  useCSSDrag: false,
});

const NOTCH_WIDTH = 181;
const NOTCH_HEIGHT = 29;
const NOTCH_TOP_FILL = 3;
const SHAPE_SIDE_OVERHANG = 5;
const MIN_SHAPE_WIDTH = NOTCH_WIDTH + SHAPE_SIDE_OVERHANG * 2;
const MAX_WINDOW_WIDTH = 620;
const MAX_WINDOW_WIDTH_RATIO = 0.55;
const MIN_LYRIC_SCALE = 0.78;

const hovering = ref(false);

const mainRowHeight = computed(() => Math.round(DYNAMIC_ISLAND_BASE_HEIGHT * config.scale));

const padX = computed(() => Math.round(mainRowHeight.value * 0.4));
const gap = computed(() => Math.round(mainRowHeight.value * 0.25));
const coverSize = computed(() => Math.round(mainRowHeight.value * 0.65));
const coverRadius = computed(() => Math.max(6, Math.round(coverSize.value * 0.35)));
const fontSize = computed(() => Math.max(13, Math.round(mainRowHeight.value * 0.5)));
const snapRadius = computed(() => Math.round(mainRowHeight.value * 0.6));
const shapeBottomRadius = computed(() => Math.max(14, Math.round(coverRadius.value * 2)));

const subFontSize = computed(() => Math.max(11, Math.round(fontSize.value * 0.65)));
const subRowHeight = computed(() => Math.round(subFontSize.value * 1.2));

const { track, lyric, primaryIndex } = useNowPlayingSync({
  pickIndex: pickAdvanceOnEndIndex,
  logTag: "dynamic-island",
});
const { onRootPointerDown } = useDragWindow();

const mode = ref<"snapped" | "floating">("snapped");
const viewportWidth = ref(Math.max(MIN_SHAPE_WIDTH, window.innerWidth || MIN_SHAPE_WIDTH));
const viewportHeight = ref(Math.max(NOTCH_HEIGHT, window.innerHeight || NOTCH_HEIGHT));
const animatedShapeWidth = ref(viewportWidth.value);
let smoothShapeWidth = viewportWidth.value;
const notchFusionEnabled = computed(() => isMac && config.notchFusion && mode.value === "snapped");

const measureCtx = document.createElement("canvas").getContext("2d")!;
const measureTextWidth = (text: string, sizePx: number = fontSize.value): number => {
  const family = config.fontFamily || getComputedStyle(document.documentElement).fontFamily;
  measureCtx.font = `${config.fontWeight} ${sizePx}px ${family}`;
  return Math.ceil(measureCtx.measureText(text).width);
};

const artistsText = computed<string>(() => formatArtists(track.value?.artists) || "Unknown Artist");

const currentLine = computed<LyricLine | null>(() => {
  const idx = primaryIndex.value;
  if (idx < 0) return null;
  return lyric.value[idx] ?? null;
});

const fallbackText = computed<string>(() => {
  const t = track.value;
  if (!t) return "SPlayer Next";
  return artistsText.value ? `${t.title} - ${artistsText.value}` : t.title;
});

const displayLine = shallowRef<LyricLine | null>(null);
const displayFallback = ref("SPlayer Next");
const displayIndex = ref(-1);
const displaySubText = ref("");

const showSubLine = computed(() => config.doubleLine || displaySubText.value !== "");

const contentHeight = computed(
  () => mainRowHeight.value + (showSubLine.value ? subRowHeight.value : 0),
);

const windowHeight = computed(
  () => contentHeight.value + (notchFusionEnabled.value ? NOTCH_HEIGHT + NOTCH_TOP_FILL : 0),
);

const BOUNCE_OVERSHOOT = 0.15;
const SMOOTH_OVERSHOOT = 0.15;

const rawLyricWidth = ref(measureTextWidth(displayFallback.value));
const lyricWidth = ref(rawLyricWidth.value);
const lyricOpacity = ref(1);

const shrinking = ref(false);
let phase: "idle" | "shrinking" | "expanding" = "idle";

let hasPainted = false;

const lineText = (line: LyricLine): string => line.words.map((w) => w.word).join("");

const computeSubText = (idx: number, line: LyricLine | null): string => {
  if (config.showTranslation && line?.translatedLyric) return line.translatedLyric;
  if (!config.doubleLine || idx < 0) return "";
  const next = lyric.value[idx + 1];
  return next ? lineText(next) : "";
};

const measureTarget = (): number => {
  const line = currentLine.value;
  const mainText = line ? lineText(line) : fallbackText.value;
  const mainPx = Math.max(1, measureTextWidth(mainText));
  const subText = computeSubText(primaryIndex.value, line);
  const subPx = subText ? measureTextWidth(subText, subFontSize.value) : 0;
  return Math.max(mainPx, subPx);
};

const getRendererWindowLimit = (): number =>
  Math.max(
    MIN_SHAPE_WIDTH,
    Math.min(MAX_WINDOW_WIDTH, Math.floor(window.screen.width * MAX_WINDOW_WIDTH_RATIO)),
  );

const fixedContentWidth = computed(() => padX.value * 2 + coverSize.value + gap.value);
const shapeExtraWidth = computed(() => (notchFusionEnabled.value ? SHAPE_SIDE_OVERHANG * 2 : 0));

const maxLyricSlotWidth = computed(() => {
  const windowLimit = getRendererWindowLimit();
  const currentWindowWidth = Math.max(MIN_SHAPE_WIDTH, viewportWidth.value);
  return Math.max(
    1,
    Math.min(windowLimit, currentWindowWidth) - fixedContentWidth.value - shapeExtraWidth.value,
  );
});

const getLyricSlotWidth = (lyricPx: number): number =>
  notchFusionEnabled.value
    ? Math.min(Math.max(1, Math.round(lyricPx)), maxLyricSlotWidth.value)
    : Math.max(1, Math.round(lyricPx));

const computeWindowWidth = (lyricPx: number): number => {
  const overshoot =
    config.transition === "bounce"
      ? BOUNCE_OVERSHOOT
      : config.transition === "smooth" && !notchFusionEnabled.value
        ? SMOOTH_OVERSHOOT
        : 0;
  const overshootExtra = Math.ceil(lyricPx * overshoot);
  return Math.max(
    notchFusionEnabled.value ? MIN_SHAPE_WIDTH : 1,
    fixedContentWidth.value + lyricPx + overshootExtra + shapeExtraWidth.value,
  );
};

const resizeWindow = (lyricPx: number): void => {
  const targetWidth = computeWindowWidth(lyricPx);
  if (config.transition === "smooth" && !notchFusionEnabled.value) {
    if (pendingWindowShrinkTimer !== null) {
      window.clearTimeout(pendingWindowShrinkTimer);
      pendingWindowShrinkTimer = null;
    }
    const currentWidth = Math.max(1, viewportWidth.value);
    if (targetWidth >= currentWidth) {
      window.api.dynamicIsland.resize(targetWidth);
    }
    if (targetWidth >= smoothShapeWidth) {
      smoothShapeWidth = targetWidth;
      window.api.dynamicIsland.setShape(targetWidth);
    } else {
      pendingWindowShrinkTimer = window.setTimeout(() => {
        pendingWindowShrinkTimer = null;
        if (config.transition === "smooth" && !notchFusionEnabled.value) {
          smoothShapeWidth = targetWidth;
          window.api.dynamicIsland.setShape(targetWidth);
        }
      }, 520);
    }
    return;
  }
  smoothShapeWidth = viewportWidth.value;
  window.api.dynamicIsland.setShape(null);
  if (!notchFusionEnabled.value) {
    if (pendingWindowShrinkTimer !== null) {
      window.clearTimeout(pendingWindowShrinkTimer);
      pendingWindowShrinkTimer = null;
    }
    window.api.dynamicIsland.resize(targetWidth);
    return;
  }

  const currentWidth = Math.max(MIN_SHAPE_WIDTH, viewportWidth.value);
  if (targetWidth >= currentWidth) {
    if (pendingWindowShrinkTimer !== null) {
      window.clearTimeout(pendingWindowShrinkTimer);
      pendingWindowShrinkTimer = null;
    }
    window.api.dynamicIsland.resize(targetWidth);
    requestAnimationFrame(() => {
      animatedShapeWidth.value = targetWidth;
    });
    return;
  }

  animatedShapeWidth.value = targetWidth;
  if (pendingWindowShrinkTimer !== null) {
    window.clearTimeout(pendingWindowShrinkTimer);
  }
  pendingWindowShrinkTimer = window.setTimeout(() => {
    pendingWindowShrinkTimer = null;
    if (notchFusionEnabled.value) {
      window.api.dynamicIsland.resize(targetWidth);
    }
  }, 520);
};

const applyMeasuredWidth = (targetPx: number): void => {
  rawLyricWidth.value = targetPx;
  lyricWidth.value = getLyricSlotWidth(targetPx);
  resizeWindow(targetPx);
};

const truncateTextToWidth = (text: string, maxWidth: number, sizePx: number): string => {
  if (!text || measureTextWidth(text, sizePx) <= maxWidth) return text;
  const ellipsis = "...";
  const ellipsisWidth = measureTextWidth(ellipsis, sizePx);
  if (maxWidth <= ellipsisWidth) return ellipsis;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measureTextWidth(`${text.slice(0, mid)}${ellipsis}`, sizePx) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${text.slice(0, low)}${ellipsis}`;
};

const applyImmediate = (): void => {
  displayLine.value = currentLine.value;
  displayFallback.value = fallbackText.value;
  displayIndex.value = primaryIndex.value;
  displaySubText.value = computeSubText(primaryIndex.value, currentLine.value);
  const targetPx = measureTarget();
  shrinking.value = false;
  lyricOpacity.value = 1;
  applyMeasuredWidth(targetPx);
  phase = "expanding";
};

const startSwapAnimation = (): void => {
  phase = "shrinking";
  shrinking.value = true;
  lyricWidth.value = 0;
  lyricOpacity.value = 0;
};

const startSmoothAnimation = (): void => {
  displayLine.value = currentLine.value;
  displayFallback.value = fallbackText.value;
  displayIndex.value = primaryIndex.value;
  displaySubText.value = computeSubText(primaryIndex.value, currentLine.value);
  applyMeasuredWidth(measureTarget());
  phase = "idle";
};

const onLyricTransitionEnd = (event: TransitionEvent): void => {
  if (event.propertyName !== "width") return;
  if (phase === "shrinking") {
    displayLine.value = currentLine.value;
    displayFallback.value = fallbackText.value;
    displayIndex.value = primaryIndex.value;
    displaySubText.value = computeSubText(primaryIndex.value, currentLine.value);
    const targetPx = measureTarget();
    rawLyricWidth.value = targetPx;
    resizeWindow(targetPx);
    requestAnimationFrame(() => {
      if (phase !== "shrinking") return;
      shrinking.value = false;
      requestAnimationFrame(() => {
        if (phase !== "shrinking") return;
        phase = "expanding";
        lyricOpacity.value = 1;
        lyricWidth.value = getLyricSlotWidth(targetPx);
      });
    });
  } else if (phase === "expanding") {
    phase = "idle";
  }
};

watch([() => config.doubleLine, () => config.showTranslation], () => {
  displaySubText.value = computeSubText(displayIndex.value, displayLine.value);
  if (phase !== "idle") return;
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
});

watch([() => config.scale, () => config.fontWeight, () => config.fontFamily], () => {
  if (phase !== "idle") return;
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
});

watch(notchFusionEnabled, () => {
  if (phase !== "idle") return;
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
});

watch([currentLine, fallbackText], () => {
  const newLine = currentLine.value;
  const changed = newLine
    ? displayIndex.value !== primaryIndex.value
    : displayFallback.value !== fallbackText.value;
  if (!changed) return;
  if (config.transition === "smooth") {
    startSmoothAnimation();
    return;
  }
  if (phase === "shrinking") return;
  if (!hasPainted || lyricWidth.value === 0) {
    applyImmediate();
    return;
  }
  startSwapAnimation();
});

watch(
  () => config.transition,
  () => {
    shrinking.value = false;
    lyricOpacity.value = 1;
    phase = "idle";
    startSmoothAnimation();
  },
);

const lyricScale = computed(() => {
  if (!notchFusionEnabled.value) return 1;
  const rawWidth = Math.max(1, rawLyricWidth.value);
  const slotWidth = Math.max(1, lyricWidth.value);
  return Math.max(MIN_LYRIC_SCALE, Math.min(1, slotWidth / rawWidth));
});

const lyricLayoutWidth = computed(() =>
  Math.max(1, Math.floor(Math.max(1, lyricWidth.value) / lyricScale.value)),
);

const displayMainText = computed(() =>
  displayLine.value ? lineText(displayLine.value) : displayFallback.value,
);

const lyricContentKey = computed(() =>
  displayLine.value ? `line-${displayIndex.value}` : `fallback-${displayFallback.value}`,
);

const fittedMainText = computed(() =>
  notchFusionEnabled.value
    ? truncateTextToWidth(displayMainText.value, lyricLayoutWidth.value, fontSize.value)
    : displayMainText.value,
);

const mainTextTruncated = computed(() => fittedMainText.value !== displayMainText.value);

const fittedDisplayLine = computed<LyricLine | null>(() => {
  const line = displayLine.value;
  if (!line || !mainTextTruncated.value) return line;
  return {
    ...line,
    words: [
      {
        startTime: line.startTime,
        endTime: line.endTime,
        word: fittedMainText.value,
      },
    ],
  };
});

const fittedSubText = computed(() =>
  notchFusionEnabled.value
    ? truncateTextToWidth(displaySubText.value, lyricLayoutWidth.value, subFontSize.value)
    : displaySubText.value,
);

const shapeWidth = computed(() =>
  Math.max(
    MIN_SHAPE_WIDTH,
    Math.round(notchFusionEnabled.value ? animatedShapeWidth.value : viewportWidth.value),
  ),
);
const shapeHeight = computed(() => Math.max(windowHeight.value, Math.round(viewportHeight.value)));

const notchPath = computed(() => {
  const width = shapeWidth.value;
  const height = shapeHeight.value;
  const overhang = Math.min(SHAPE_SIDE_OVERHANG, width / 4);
  const bodyLeft = overhang;
  const bodyRight = width - overhang;
  const topArc = Math.min(overhang, height / 4);
  const bottomRadius = Math.min(shapeBottomRadius.value, width / 2, height / 2);

  return [
    "M 0 0",
    `L ${width} 0`,
    `Q ${bodyRight} 0 ${bodyRight} ${topArc}`,
    `L ${bodyRight} ${height - bottomRadius}`,
    `Q ${bodyRight} ${height} ${bodyRight - bottomRadius} ${height}`,
    `L ${bodyLeft + bottomRadius} ${height}`,
    `Q ${bodyLeft} ${height} ${bodyLeft} ${height - bottomRadius}`,
    `L ${bodyLeft} ${topArc}`,
    `Q ${bodyLeft} 0 0 0`,
    "Z",
  ].join(" ");
});

const rootStyle = computed(() => ({
  "--di-played": config.playedColor,
  "--di-unplayed": config.unplayedColor,
  "--di-bg": config.backgroundColor,
  "--di-padx": `${padX.value}px`,
  "--di-gap": `${gap.value}px`,
  "--di-cover": `${coverSize.value}px`,
  "--di-cover-radius": `${coverRadius.value}px`,
  "--di-side-overhang": `${notchFusionEnabled.value ? SHAPE_SIDE_OVERHANG : 0}px`,
  "--di-row": `${mainRowHeight.value}px`,
  "--di-content-height": `${contentHeight.value}px`,
  "--di-notch": `${NOTCH_HEIGHT}px`,
  "--di-shape-width": `${shapeWidth.value}px`,
  "--di-fusion-content-width": `${Math.max(1, shapeWidth.value - SHAPE_SIDE_OVERHANG * 2)}px`,
  "--di-snap-radius": `${snapRadius.value}px`,
  "--di-lyric-scale": lyricScale.value,
  fontFamily: config.fontFamily || undefined,
  "-webkit-app-region": config.useCSSDrag ? "drag" : "no-drag",
}));

const syncViewportSize = (): void => {
  viewportWidth.value = Math.max(MIN_SHAPE_WIDTH, window.innerWidth || MIN_SHAPE_WIDTH);
  viewportHeight.value = Math.max(NOTCH_HEIGHT, window.innerHeight || NOTCH_HEIGHT);
  if (!notchFusionEnabled.value) {
    animatedShapeWidth.value = viewportWidth.value;
  }
};

watch(
  maxLyricSlotWidth,
  () => {
    if (phase === "shrinking") return;
    lyricWidth.value = getLyricSlotWidth(rawLyricWidth.value);
  },
  { flush: "post" },
);

let unsubConfig: (() => void) | null = null;
let unsubMode: (() => void) | null = null;
let unsubCursor: (() => void) | null = null;
let pendingWindowShrinkTimer: number | null = null;

watch(
  windowHeight,
  (h) => {
    window.api.dynamicIsland.setHeight(h);
  },
  { flush: "post" },
);

onMounted(async () => {
  syncViewportSize();
  window.addEventListener("resize", syncViewportSize);
  resizeWindow(rawLyricWidth.value);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      hasPainted = true;
    });
  });
  try {
    const [saved, currentMode] = await Promise.all([
      window.api.config.get("dynamicIsland") as Promise<DynamicIslandSettings>,
      window.api.dynamicIsland.getMode(),
    ]);
    Object.assign(config, saved);
    mode.value = currentMode;
  } catch (error) {
    console.error("[dynamic-island] load state failed", error);
  }
  unsubConfig = window.api.dynamicIsland.onConfigChange((next) =>
    Object.assign(config, next as DynamicIslandSettings),
  );
  unsubMode = window.api.dynamicIsland.onModeChange((next) => {
    mode.value = next;
  });
  unsubCursor = window.api.dynamicIsland.onCursorInside((inside) => {
    hovering.value = inside;
  });
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", syncViewportSize);
  if (pendingWindowShrinkTimer !== null) {
    window.clearTimeout(pendingWindowShrinkTimer);
    pendingWindowShrinkTimer = null;
  }
  unsubConfig?.();
  unsubConfig = null;
  unsubMode?.();
  unsubMode = null;
  unsubCursor?.();
  unsubCursor = null;
});
</script>

<template>
  <div
    class="root"
    :class="[
      mode === 'snapped' ? 'is-snapped' : 'is-floating',
      {
        'is-hidden': config.nonOcclusive && hovering,
        'is-notch-fusion': notchFusionEnabled,
        'is-smooth': config.transition === 'smooth',
      },
    ]"
    :style="rootStyle"
    @pointerdown="onRootPointerDown"
  >
    <svg
      v-if="notchFusionEnabled"
      class="notch-shape"
      :viewBox="`0 0 ${shapeWidth} ${shapeHeight}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path :d="notchPath" fill="var(--di-bg)" />
    </svg>
    <div class="content">
      <div class="cover">
        <img
          :src="track?.cover || DEFAULT_COVER"
          alt="cover"
          draggable="false"
          decoding="async"
          @error="($event.target as HTMLImageElement).src = DEFAULT_COVER"
        />
      </div>
      <div
        class="lyric"
        :class="{ 'is-shrinking': shrinking }"
        :style="{ width: `${lyricWidth}px`, opacity: lyricOpacity }"
        @transitionend="onLyricTransitionEnd"
      >
        <div
          class="lyric-scale"
          :style="
            notchFusionEnabled
              ? { width: `${lyricLayoutWidth}px`, transform: `scale(${lyricScale})` }
              : {}
          "
        >
          <Transition name="lyric-roll">
            <div :key="lyricContentKey" class="lyric-content">
              <div class="main-line">
                <IslandLyricLine
                  v-if="fittedDisplayLine"
                  :line="fittedDisplayLine"
                  :font-size="fontSize"
                  :font-weight="config.fontWeight"
                  :word-by-word="config.wordByWord && !mainTextTruncated"
                />
                <div v-else class="fallback" :style="{ fontSize: `${fontSize}px` }">
                  {{ fittedMainText }}
                </div>
              </div>
              <div v-if="showSubLine" class="sub-line" :style="{ fontSize: `${subFontSize}px` }">
                {{ fittedSubText }}
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.root {
  position: relative;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
  cursor: move;
  color: var(--di-played);
  transition:
    border-radius 0.3s cubic-bezier(0.22, 0.61, 0.36, 1),
    opacity 0.2s ease-out;
}
.root.is-hidden {
  opacity: 0;
}
.root.is-notch-fusion {
  width: 100%;
}
.root:not(.is-notch-fusion) {
  width: fit-content;
  background: var(--di-bg);
}
.root.is-snapped {
  border-radius: 0 0 var(--di-snap-radius) var(--di-snap-radius);
}
.root.is-snapped.is-notch-fusion {
  background: transparent;
  border-radius: 0;
}
.root.is-floating {
  background: var(--di-bg);
  border-radius: 999px;
}
.root.is-smooth:not(.is-notch-fusion) {
  display: flex;
  justify-content: center;
  width: 100%;
  background: transparent;
}
.root.is-smooth:not(.is-notch-fusion) .content {
  flex: 0 0 auto;
  width: fit-content;
  background: var(--di-bg);
}
.root.is-smooth.is-snapped:not(.is-notch-fusion) .content {
  border-radius: 0 0 var(--di-snap-radius) var(--di-snap-radius);
}
.root.is-smooth.is-floating:not(.is-notch-fusion) .content {
  border-radius: 999px;
}
.notch-shape {
  position: absolute;
  top: 0;
  left: 50%;
  width: var(--di-shape-width);
  height: 100%;
  transform: translateX(-50%);
  pointer-events: none;
  transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.root.is-smooth .notch-shape {
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
}
.content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--di-gap);
  min-width: 0;
  height: 100%;
  padding: 0 var(--di-padx);
  box-sizing: border-box;
}
.root:not(.is-notch-fusion) .content {
  width: fit-content;
}
.root.is-notch-fusion .content {
  width: 100%;
}
.root.is-snapped.is-notch-fusion .content {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: var(--di-fusion-content-width);
  height: var(--di-content-height);
  transform: translateX(-50%);
  transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.root.is-smooth.is-snapped.is-notch-fusion .content {
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
}
.cover {
  flex: 0 0 auto;
  width: var(--di-cover);
  height: var(--di-cover);
  border-radius: var(--di-cover-radius);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  pointer-events: none;
}
.lyric {
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  white-space: nowrap;
  transition:
    width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.25s ease-out;
}
.lyric.is-shrinking {
  transition:
    width 0.25s ease-in,
    opacity 0.25s ease-in;
}
.root.is-smooth .lyric {
  transition:
    width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
    opacity 0.25s ease-out;
}
.lyric-scale {
  position: relative;
  flex: 0 0 auto;
  min-width: 0;
  transform-origin: center center;
}
.lyric-content {
  width: 100%;
  transform: translateY(0);
}
.root.is-smooth .lyric-roll-enter-active,
.root.is-smooth .lyric-roll-leave-active {
  will-change: transform, opacity;
  transition:
    transform 0.5s cubic-bezier(0.33, 1, 0.68, 1),
    opacity 0.25s ease-out;
}
.root.is-smooth .lyric-roll-leave-active {
  position: absolute;
  inset: 0;
}
.root.is-smooth .lyric-roll-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.root.is-smooth .lyric-roll-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
.main-line {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  width: 100%;
  overflow: hidden;
}
.fallback {
  max-width: 100%;
  overflow: hidden;
  color: var(--di-played);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub-line {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  color: var(--di-played);
  opacity: 0.65;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
