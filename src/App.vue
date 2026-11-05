<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { useThemeStore } from "@/stores/theme";
import { extractColorFromUrl } from "@/utils/color";

const settings = useSettingsStore();
const media = useMediaStore();
const theme = useThemeStore();

// 只监听曲目和缩略图，暂停保留色板；清空与晚到封面都通过同一取色入口处理。
watch(
  [
    () => media.track?.cover ?? null,
    () => !!media.track,
    () => settings.player.followCoverColor,
    () => theme.songThemeEnabled,
  ] as const,
  ([cover, loaded]) => {
    theme.songLoaded = loaded;
    extractColorFromUrl(cover);
  },
  { immediate: true },
);

watchEffect(() => {
  const v = settings.appearance.fontFamily;
  const root = document.documentElement.style;
  if (v) root.setProperty("--user-font", `${v}, var(--app-font)`);
  else root.removeProperty("--user-font");
});
</script>

<template>
  <AppBackground />
  <RouterView />
</template>
