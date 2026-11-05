<script setup lang="ts">
import { argbFromHex, Hct } from "@material/material-color-utilities";
import { useThemeStore } from "@/stores/theme";
import { useStatusStore } from "@/stores/status";

const theme = useThemeStore();
const status = useStatusStore();
const visibility = useDocumentVisibility();
const reducedMotion = usePreferredReducedMotion();
const backgroundRef = ref<HTMLElement | null>(null);
const layers = ref<[string, string]>(["", ""]);
const activeLayer = ref(0);
let transitionToken = 0;

const canAnimate = computed(
  () =>
    visibility.value === "visible" && !status.isPlayerExpanded && reducedMotion.value !== "reduce",
);

const background = computed(() => {
  const colors = theme.songColors.map((hex) => {
    const color = Hct.fromInt(argbFromHex(hex));
    const argb = Hct.from(color.hue, Math.min(56, color.chroma), theme.isDark ? 38 : 72).toInt();
    return `${(argb >> 16) & 255} ${(argb >> 8) & 255} ${argb & 255}`;
  });
  const first = colors[0];
  const second = colors[1] ?? first;
  const third = colors[2] ?? second;
  const alpha = theme.isDark ? [0.72, 0.5, 0.35] : [0.36, 0.28, 0.2];
  return [
    `radial-gradient(ellipse at 6% 0%, rgb(${first} / ${alpha[0]}), transparent 66%)`,
    `radial-gradient(ellipse at 100% 24%, rgb(${second} / ${alpha[1]}), transparent 64%)`,
    `radial-gradient(ellipse at 45% 100%, rgb(${third} / ${alpha[2]}), transparent 70%)`,
  ].join(", ");
});

watch(
  background,
  async (value) => {
    const token = ++transitionToken;
    if (!layers.value[activeLayer.value] || !canAnimate.value) {
      layers.value = [value, ""];
      activeLayer.value = 0;
      return;
    }
    const next = activeLayer.value === 0 ? 1 : 0;
    layers.value[next] = value;
    await nextTick();
    if (token !== transitionToken) return;
    if (!canAnimate.value) {
      layers.value = [value, ""];
      activeLayer.value = 0;
      return;
    }
    // 先提交透明层的颜色，再切换透明度；始终只保留两层，无持续绘制循环。
    void backgroundRef.value?.offsetWidth;
    activeLayer.value = next;
  },
  { immediate: true },
);

watch(canAnimate, (animate) => {
  if (!animate) layers.value[activeLayer.value === 0 ? 1 : 0] = "";
});

onBeforeUnmount(() => ++transitionToken);
</script>

<template>
  <div
    ref="backgroundRef"
    class="song-background"
    :class="{ 'with-wallpaper': theme.effectiveStyle === 'image', 'without-motion': !canAnimate }"
    aria-hidden="true"
  >
    <div
      v-for="(layer, index) in layers"
      :key="index"
      class="song-background-layer"
      :class="{ active: activeLayer === index }"
      :style="{ backgroundImage: layer || undefined }"
      @transitionend.self="index !== activeLayer && (layers[index] = '')"
    />
  </div>
</template>

<style scoped>
.song-background {
  position: absolute;
  z-index: -1;
  inset: 0;
  overflow: hidden;
  background: rgb(var(--s-surface));
  pointer-events: none;
  transition: background-color 700ms ease;
}

.song-background-layer {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 700ms ease;
}

.song-background-layer.active {
  opacity: 1;
}

.with-wallpaper {
  background: transparent;
}

.with-wallpaper .song-background-layer.active {
  opacity: 0.55;
}

.without-motion,
.without-motion .song-background-layer {
  transition: none;
}
</style>
