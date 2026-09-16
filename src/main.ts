import "virtual:uno.css";
import "@/styles/global.css";

import piniaPersistedstate from "pinia-plugin-persistedstate";
import App from "./App.vue";
import router from "./router";
import i18n from "./i18n";

import { useThemeStore } from "./stores/theme";
import { useSettingsStore } from "./stores/settings";
import { useHotkeyStore } from "./stores/hotkey";
import { initPlayer, playFiles, restoreLastTrack } from "./core/player";
import { handleOrpheus } from "./services/orpheus";
import { installHotkeyManager } from "./core/hotkey/manager";
import { vRipple } from "./directives/ripple";

const pinia = createPinia();
pinia.use(piniaPersistedstate);

const app = createApp(App);
app.directive("ripple", vRipple);
app.use(pinia);
app.use(router);
app.use(i18n);

// 初始化主题
useThemeStore().init();
const settings = useSettingsStore();

watch(
  () => settings.locale,
  (locale) => {
    if (locale !== "en-US") {
      settings.locale = "en-US";
      return;
    }
    i18n.global.locale.value = "en-US";
    window.api.system.setLocale("en-US");
  },
  { immediate: true },
);

/** splash 最短展示时长（ms） */
const SPLASH_MIN_MS = 1100;

/** splash 淡出时长（ms） */
const SPLASH_FADE_MS = 300;

/** 最短展示计时 */
const splashMinElapsed = new Promise<void>((resolve) => setTimeout(resolve, SPLASH_MIN_MS));

/** 等待首帧绘制完成 */
const nextPaintedFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** 淡出并移除 splash 层 */
const removeSplash = (): void => {
  const el = document.getElementById("app-loading");
  if (!el) return;
  el.classList.add("hidden");
  setTimeout(() => el.remove(), SPLASH_FADE_MS + 50);
};

/**
 * 启动播放服务并分发冷启动任务
 */
const bootstrapPlayback = async (): Promise<void> => {
  await initPlayer();

  const pendingAudioFiles = await window.api.system.consumePendingAudioFiles();
  const pendingOrpheusUrl = await window.api.system.consumePendingProtocolUrl();

  if (pendingAudioFiles && pendingAudioFiles.length > 0) {
    await playFiles(pendingAudioFiles);
  } else if (pendingOrpheusUrl) {
    await handleOrpheus(pendingOrpheusUrl);
  } else {
    await restoreLastTrack();
  }
};

// Initialize application
router.isReady().then(async () => {
  // Mount application
  app.mount("#app");
  // Start playback bootstrap service immediately
  void bootstrapPlayback().catch(console.error);
  // Fade out splash screen
  await Promise.all([splashMinElapsed, nextPaintedFrame()]);
  removeSplash();
  // Initialize hotkeys
  useHotkeyStore()
    .init()
    .then(installHotkeyManager)
    .catch((err) => console.error("[hotkey] init failed", err));
});
