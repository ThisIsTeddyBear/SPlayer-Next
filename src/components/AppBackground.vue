<script setup lang="ts">
import { useThemeStore } from "@/stores/theme";

const theme = useThemeStore();

const visible = computed(() => theme.effectiveStyle === "image" && !!theme.imageBackground.src);

const imageStyle = computed<Record<string, string>>(() => ({
  objectFit: "cover",
  filter: theme.imageBackground.blur > 0 ? `blur(${theme.imageBackground.blur}px)` : "none",
  transform: `scale(${theme.imageBackground.scale})`,
}));
</script>

<template>
  <div v-if="visible" class="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
    <img
      :src="theme.imageBackground.src"
      class="w-full h-full select-none"
      :style="imageStyle"
      draggable="false"
      decoding="async"
      alt=""
    />
    <div
      class="absolute inset-0 transition-opacity"
      :style="{
        backgroundColor: theme.isDark ? '#000' : '#fff',
        opacity: theme.isDark
          ? theme.imageBackground.dim
          : Math.max(0.75, theme.imageBackground.dim),
      }"
    />
  </div>
</template>
