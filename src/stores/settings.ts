import type {
  PlayerSettings,
  LyricSettings,
  AppearanceSettings,
  SidebarNavGroup,
  SidebarPlaylistOrder,
  SpringPreset,
  PresetSettings,
} from "@/types/settings";
import {
  DEFAULT_LYRIC_FORMAT_ORDER,
  DEFAULT_LYRIC_SOURCE_ORDER,
  DEFAULT_SIDEBAR_NAV_GROUPS,
  SIDEBAR_GROUP_MY_PLAYLISTS,
  SIDEBAR_GROUP_SUBSCRIBED,
  SPRING_PRESETS,
} from "@/types/settings";
import type { SystemConfig, LocaleCode } from "@shared/types/settings";
import { ALL_PLATFORMS } from "@shared/types/platform";
import { defaultSystemConfig } from "@shared/defaults/settings";
import { setByPath } from "@shared/utils/path";

/**
 */
const reconcileOrder = <T>(stored: T[], all: readonly T[]): T[] => {
  const known = stored.filter((item) => all.includes(item));
  const missing = all.filter((item) => !known.includes(item));
  return [...known, ...missing];
};

/**
 */
const reconcileNavGroups = (stored: unknown): SidebarNavGroup[] => {
  const all = DEFAULT_SIDEBAR_NAV_GROUPS.flatMap((group) => group.keys);
  const seen = new Set<string>();
  const groups: SidebarNavGroup[] = [];
  for (const raw of Array.isArray(stored) ? stored : []) {
    const record = raw as Partial<SidebarNavGroup> | null;
    if (!Array.isArray(record?.keys)) continue;
    const keys: string[] = [];
    for (const key of record.keys) {
      if (!all.includes(key) || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
    groups.push({
      name: typeof record.name === "string" ? record.name : "",
      showName: record.showName === true,
      keys,
    });
  }
  if (groups.length === 0)
    return DEFAULT_SIDEBAR_NAV_GROUPS.map((group) => ({ ...group, keys: [...group.keys] }));
  const missing = all.filter((key) => !seen.has(key));
  if (missing.length > 0) groups[groups.length - 1].keys.push(...missing);
  return groups;
};

/**
 */
const reconcileHiddenKeys = (stored: string[]): string[] => {
  const valid = new Set([
    ...DEFAULT_SIDEBAR_NAV_GROUPS.flatMap((group) => group.keys),
    SIDEBAR_GROUP_MY_PLAYLISTS,
    SIDEBAR_GROUP_SUBSCRIBED,
  ]);
  return stored.filter((key) => key !== "/" && (valid.has(key) || key.startsWith("/collection/")));
};

/**
 */
const reconcilePlaylistOrder = (stored: unknown): SidebarPlaylistOrder => {
  const record = (stored ?? {}) as Partial<Record<keyof SidebarPlaylistOrder, unknown>>;
  const orderOf = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((key) => typeof key === "string") : [];
  return {
    myLocal: orderOf(record.myLocal),
    myOnline: orderOf(record.myOnline),
    subscribed: orderOf(record.subscribed),
  };
};

export const useSettingsStore = defineStore(
  "settings",
  () => {
    const locale = ref<LocaleCode>("en-US");

    const appearance = reactive<AppearanceSettings>({
      layoutMode: "default",
      routeTransition: "fade",
      sidebarCollapsed: false,
      sidebarPlaylistCover: false,
      sidebarNavGroups: DEFAULT_SIDEBAR_NAV_GROUPS.map((group) => ({
        ...group,
        keys: [...group.keys],
      })),
      sidebarHiddenKeys: [],
      sidebarKeepEmptyDivider: false,
      sidebarNameWithDivider: false,
      sidebarPlaylistOrder: { myLocal: [], myOnline: [], subscribed: [] },
      showStatsInSidebar: true,
      showQualitySwitch: false,
      closeAction: "hide",
      rememberCloseChoice: false,
      fontFamily: "",
      showPerformanceMonitor: false,
    });

    const player = reactive<PlayerSettings>({
      playerBgType: "blur",
      playerBgFps: 30,
      playerBgFlowSpeed: 4,
      playerBgRenderScale: 0.5,
      playerBgFreezeOnPause: false,
      playerBgBeat: false,
      coverLayout: "default",
      coverLyricRatio: 0.45,
      autoCenterCover: true,
      showPlaybackSource: false,
      followCoverColor: true,
      autoImmersive: true,
      outputDevice: null,
      pauseOnDeviceSwitch: false,
      exclusiveAudio: false,
      enableSpectrum: false,
      spectrumBarWidth: 4,
      reverseSpectrum: false,
      songLevel: "hq",
      allowTrialPlay: false,
      timeFormat: "current-total",
      showProgressTooltip: true,
      showProgressLyric: false,
      snapToLyric: false,
      showLyricInBar: true,
      preloadNextTrack: false,
    });

    const preset = reactive<PresetSettings>({
      fuckDjMode: false,
      uncensorProfanity: false,
      hideVipTag: false,
      hideQualityTag: false,
      showSubtitle: true,
    });

    const lyric = reactive<LyricSettings>({
      lyricSourcePreference: "auto",
      lyricSourceOrder: [...DEFAULT_LYRIC_SOURCE_ORDER],
      lyricFormatOrder: [...DEFAULT_LYRIC_FORMAT_ORDER],
      smartPreferOnline: false,
      preferPluginLyric: false,
      detectBackgroundLyrics: true,
      cjkTransform: "none",
      adaptiveFontSize: true,
      fontSize: 48,
      fontWeight: 700,
      lyricBlendMode: "normal",
      fontFamily: "",
      fontFamilyLatin: "",
      fontFamilyJapanese: "",
      fontFamilyKorean: "",
      fontFamilyChinese: "",
      showTranslation: true,
      showRomanization: true,
      amllShowLineRomanization: true,
      amllShowWordRomanization: true,
      enableWordHighlight: true,
      enableFloatAnimation: false,
      enableEmphasizeEffect: false,
      enableBlur: false,
      hidePassedLines: false,
      springPreset: "default",
      springMass: 0.9,
      springDamping: 15,
      springStiffness: 90,
      alignPosition: 0.35,
      wordFadeWidth: 0.5,
      inactiveAlpha: 0.2,
      enableExcludeLyrics: true,
      excludeLyricsUserKeywords: [],
      excludeLyricsUserRegexes: [],
      engine: "physics",
      useAMSpring: true,
      amllVerticalSpringMass: 1,
      amllVerticalSpringDamping: 15,
      amllVerticalSpringStiffness: 100,
      amllVerticalSpringSoft: false,
      amllScaleSpringMass: 1,
      amllScaleSpringDamping: 20,
      amllScaleSpringStiffness: 100,
      amllScaleSpringSoft: false,
      amllCleanUnintentionalOverlaps: true,
      amllTryAdvanceStartTime: true,
      amllConvertExcessiveBackgroundLines: true,
      amllSyncMainAndBackgroundLines: true,
      amllNormalizeSpaces: true,
      amllResetLineTimestamps: true,
    });

    const system = reactive<SystemConfig>(structuredClone(defaultSystemConfig));

    const isDesktopLyricOpen = ref(false);

    const isDynamicIslandOpen = ref(false);

    const isTaskbarLyricOpen = ref(false);

    /**
     */
    const deepAssign = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
      for (const key of Object.keys(source)) {
        const next = source[key];
        const cur = target[key];
        if (
          next &&
          typeof next === "object" &&
          !Array.isArray(next) &&
          cur &&
          typeof cur === "object" &&
          !Array.isArray(cur)
        ) {
          deepAssign(cur as Record<string, unknown>, next as Record<string, unknown>);
        } else if (cur !== next) {
          target[key] = next;
        }
      }
    };

    const syncSystem = async (): Promise<void> => {
      try {
        deepAssign(
          system as unknown as Record<string, unknown>,
          (await window.api.config.getAll()) as unknown as Record<string, unknown>,
        );
      } catch {}
    };

    const unsubscribers: Array<() => void> = [
      window.api.desktopLyric.onConfigChange((next) => {
        Object.assign(system.desktopLyric, next as object);
      }),
      window.api.window.onDesktopLyricVisibilityChange((open) => {
        isDesktopLyricOpen.value = open;
      }),
      window.api.dynamicIsland.onConfigChange((next) => {
        Object.assign(system.dynamicIsland, next as object);
      }),
      window.api.window.onDynamicIslandVisibilityChange((open) => {
        isDynamicIslandOpen.value = open;
      }),
      window.api.window.onTaskbarLyricVisibilityChange((open) => {
        isTaskbarLyricOpen.value = open;
      }),
    ];

    onScopeDispose(() => {
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
    });

    window.api.window
      .isDesktopLyricOpen()
      .then((open) => {
        isDesktopLyricOpen.value = open;
      })
      .catch(() => {});
    window.api.window
      .isDynamicIslandOpen()
      .then((open) => {
        isDynamicIslandOpen.value = open;
      })
      .catch(() => {});
    window.api.window
      .isTaskbarLyricOpen()
      .then((open) => {
        isTaskbarLyricOpen.value = open;
      })
      .catch(() => {});

    /**
     */
    const setSystem = async (keyPath: string, value: unknown): Promise<void> => {
      setByPath(system, keyPath, value);
      try {
        await window.api.config.set(keyPath, value);
      } catch (err) {
        console.error("[settings] config.set failed", keyPath, err);
      }
      if (keyPath === "player.fadeEnabled" || keyPath === "player.fadeDuration") {
        await window.api.player.setFadeDuration(
          system.player.fadeEnabled ? system.player.fadeDuration : 0,
        );
      }
    };

    const afterLocalChange = (path: string, value: unknown): void => {
      if (path === "lyric.springPreset" && value !== "custom") {
        const params = SPRING_PRESETS[value as Exclude<SpringPreset, "custom">];
        lyric.springMass = params.mass;
        lyric.springDamping = params.damping;
        lyric.springStiffness = params.stiffness;
      }
    };

    return {
      locale,
      appearance,
      player,
      preset,
      lyric,
      system,
      isDesktopLyricOpen,
      isDynamicIslandOpen,
      isTaskbarLyricOpen,
      syncSystem,
      setSystem,
      afterLocalChange,
    };
  },
  {
    persist: {
      storage: localStorage,
      omit: ["system"],
      afterHydrate: ({ store }) => {
        const { lyric, appearance } = store as unknown as {
          lyric: LyricSettings;
          appearance: AppearanceSettings;
        };
        if (typeof lyric.detectBackgroundLyrics !== "boolean") {
          lyric.detectBackgroundLyrics = true;
        }
        lyric.lyricSourceOrder = reconcileOrder(lyric.lyricSourceOrder, ALL_PLATFORMS);
        lyric.lyricFormatOrder = reconcileOrder(lyric.lyricFormatOrder, DEFAULT_LYRIC_FORMAT_ORDER);
        appearance.sidebarNavGroups = reconcileNavGroups(appearance.sidebarNavGroups ?? []);
        appearance.sidebarHiddenKeys = reconcileHiddenKeys(appearance.sidebarHiddenKeys ?? []);
        appearance.sidebarPlaylistOrder = reconcilePlaylistOrder(appearance.sidebarPlaylistOrder);
      },
    },
  },
);
