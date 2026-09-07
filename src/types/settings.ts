import type { LyricFormat } from "@shared/types/lyrics";
import { DEFAULT_LYRIC_FORMAT_ORDER as DEFAULT_LYRIC_FORMAT_ORDER_SHARED } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import { ALL_PLATFORMS } from "@shared/types/platform";
import type { CjkTransformMode } from "@shared/types/opencc";
import type { QualityLevel } from "@/utils/quality";

export type PlayerBgType = "blur" | "solid" | "animation";
export type CoverLayout = "default" | "fullscreen";

/**
 */
export type TimeFormat = "current-total" | "remaining-total" | "current-remaining";

/**
 */
export type LyricSourcePreference = Platform | "auto" | "self";

export type LayoutMode = "default" | "sidebar-full" | "floating";

export type RouteTransition = "none" | "fade" | "slide" | "zoom";

export type SpringPreset =
  "default" | "smooth" | "responsive" | "jello" | "heavy" | "noBounce" | "custom";

export type LyricBlendMode = "normal" | "screen" | "plus-lighter";

export const SPRING_PRESETS: Record<
  Exclude<SpringPreset, "custom">,
  { mass: number; damping: number; stiffness: number }
> = {
  default: { mass: 0.9, damping: 15, stiffness: 90 },
  smooth: { mass: 1.2, damping: 22, stiffness: 80 },
  responsive: { mass: 0.5, damping: 18, stiffness: 150 },
  jello: { mass: 0.6, damping: 8, stiffness: 120 },
  heavy: { mass: 2.0, damping: 25, stiffness: 60 },
  noBounce: { mass: 1.0, damping: 30, stiffness: 100 },
};

export type LyricSourceOrder = Platform[];

export type LyricFormatOrder = LyricFormat[];

export const DEFAULT_LYRIC_SOURCE_ORDER: LyricSourceOrder = [...ALL_PLATFORMS];

export const DEFAULT_LYRIC_FORMAT_ORDER: LyricFormatOrder = [...DEFAULT_LYRIC_FORMAT_ORDER_SHARED];

export const SIDEBAR_GROUP_MY_PLAYLISTS = "group-my-playlists";

export const SIDEBAR_GROUP_SUBSCRIBED = "group-subscribed";

export interface SidebarNavGroup {
  name: string;
  showName: boolean;
  keys: string[];
}

export interface SidebarPlaylistOrder {
  myLocal: string[];
  myOnline: string[];
  subscribed: string[];
}

export const DEFAULT_SIDEBAR_NAV_GROUPS: SidebarNavGroup[] = [
  {
    name: "",
    showName: false,
    keys: ["/", "/library", "/artists/local", "/albums/local", "/folders", "/stats"],
  },
  {
    name: "",
    showName: false,
    keys: ["/liked", "/favorites", "/cloud", "/download", "/streaming", "/history"],
  },
];

export interface LyricSettings {
  lyricSourcePreference: LyricSourcePreference;
  lyricSourceOrder: LyricSourceOrder;
  lyricFormatOrder: LyricFormatOrder;
  smartPreferOnline: boolean;
  preferPluginLyric: boolean;
  detectBackgroundLyrics: boolean;
  cjkTransform: CjkTransformMode;
  adaptiveFontSize: boolean;
  fontSize: number;
  fontWeight: number;
  lyricBlendMode: LyricBlendMode;
  fontFamily: string;
  fontFamilyLatin: string;
  fontFamilyJapanese: string;
  fontFamilyKorean: string;
  fontFamilyChinese: string;
  showTranslation: boolean;
  showRomanization: boolean;
  amllShowLineRomanization: boolean;
  amllShowWordRomanization: boolean;
  enableWordHighlight: boolean;
  enableFloatAnimation: boolean;
  enableEmphasizeEffect: boolean;
  enableBlur: boolean;
  hidePassedLines: boolean;
  springPreset: SpringPreset;
  springMass: number;
  springDamping: number;
  springStiffness: number;
  alignPosition: number;
  wordFadeWidth: number;
  inactiveAlpha: number;
  enableExcludeLyrics: boolean;
  excludeLyricsUserKeywords: string[];
  excludeLyricsUserRegexes: string[];
  engine: "physics" | "amll";
  useAMSpring: boolean;
  amllVerticalSpringMass: number;
  amllVerticalSpringDamping: number;
  amllVerticalSpringStiffness: number;
  amllVerticalSpringSoft: boolean;
  amllScaleSpringMass: number;
  amllScaleSpringDamping: number;
  amllScaleSpringStiffness: number;
  amllScaleSpringSoft: boolean;
  amllCleanUnintentionalOverlaps: boolean;
  amllTryAdvanceStartTime: boolean;
  amllConvertExcessiveBackgroundLines: boolean;
  amllSyncMainAndBackgroundLines: boolean;
  amllNormalizeSpaces: boolean;
  amllResetLineTimestamps: boolean;
}

export interface PlayerSettings {
  playerBgType: PlayerBgType;
  playerBgFps: number;
  playerBgFlowSpeed: number;
  playerBgRenderScale: number;
  playerBgFreezeOnPause: boolean;
  playerBgBeat: boolean;
  coverLayout: CoverLayout;
  coverLyricRatio: number;
  autoCenterCover: boolean;
  showPlaybackSource: boolean;
  followCoverColor: boolean;
  autoImmersive: boolean;
  outputDevice: string | null;
  pauseOnDeviceSwitch: boolean;
  exclusiveAudio: boolean;
  enableSpectrum: boolean;
  spectrumBarWidth: number;
  reverseSpectrum: boolean;
  songLevel: QualityLevel;
  allowTrialPlay: boolean;
  timeFormat: TimeFormat;
  showProgressTooltip: boolean;
  showProgressLyric: boolean;
  snapToLyric: boolean;
  showLyricInBar: boolean;
  preloadNextTrack: boolean;
}

export interface AppearanceSettings {
  layoutMode: LayoutMode;
  routeTransition: RouteTransition;
  sidebarCollapsed: boolean;
  sidebarPlaylistCover: boolean;
  sidebarNavGroups: SidebarNavGroup[];
  sidebarHiddenKeys: string[];
  sidebarKeepEmptyDivider: boolean;
  sidebarNameWithDivider: boolean;
  sidebarPlaylistOrder: SidebarPlaylistOrder;
  showStatsInSidebar: boolean;
  showQualitySwitch: boolean;
  closeAction: "quit" | "hide";
  rememberCloseChoice: boolean;
  fontFamily: string;
  showPerformanceMonitor: boolean;
}

export interface PresetSettings {
  /** Fuck DJ Mode */
  fuckDjMode: boolean;
  /** Fuck ** Mode */
  uncensorProfanity: boolean;
  hideVipTag: boolean;
  hideQualityTag: boolean;
  showSubtitle: boolean;
}
