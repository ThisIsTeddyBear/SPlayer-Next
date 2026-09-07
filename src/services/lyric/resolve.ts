import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput, LyricMatchResult } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import { isPlatform } from "@shared/types/platform";
import { detectFormat } from "@/utils/lyric/parse";
import { useSettingsStore } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import { DEFAULT_LYRIC_FORMAT_ORDER, DEFAULT_LYRIC_SOURCE_ORDER } from "@/types/settings";
import { requestPlatformLyric, requestStreamingLyric, requestTTMLOverlay } from "./request";

const TTML_PLATFORMS = ["netease", "qqmusic"] as const;

export interface OnlineResult {
  source: { source: "online"; format: LyricFormat; platform: Platform };
  input: LyricInput;
}

export interface ResolvedLyric {
  source: NonNullable<LyricData>;
  input: LyricInput;
}

export type LocalLyric = { source: NonNullable<LyricData>; content: string };

const toOnlineResult = (data: LyricMatchResult): OnlineResult => ({
  source: { source: "online", format: data.format, platform: data.platform },
  input: {
    content: data.content,
    translation: data.translation,
    translationFormat: data.translationFormat,
    romaji: data.romaji,
    romajiFormat: data.romajiFormat,
  },
});

const resolvePlatformLyric = async (
  platform: Platform,
  track: Track,
): Promise<OnlineResult | null> => {
  const result = await requestPlatformLyric(platform, track);
  return result ? toOnlineResult(result) : null;
};

/**
 */
export const resolveStreamingLyric = async (track: Track): Promise<ResolvedLyric | null> => {
  const text = await requestStreamingLyric(track);
  if (!text?.trim()) return null;
  return { source: { source: "external", format: detectFormat(text) }, input: { content: text } };
};

export const embeddedLyricFromDetail = (detail: TrackDetail | null): LocalLyric | null => {
  if (!detail?.embeddedLyric) return null;
  return {
    source: { source: "embedded", format: detectFormat(detail.embeddedLyric) },
    content: detail.embeddedLyric,
  };
};

const PLATFORM_MAIN_FORMATS: Record<Platform, LyricFormat[]> = {
  netease: ["yrc", "lrc"],
  qqmusic: ["qrc", "lrc"],
  kugou: ["krc", "lrc"],
};

/**
 */
const platformCanUpgrade = (
  platform: Platform,
  localFormat: LyricFormat,
  formatOrder: readonly LyricFormat[],
): boolean => {
  const localIdx = formatOrder.indexOf(localFormat);
  if (localIdx === -1) return true;
  for (const format of PLATFORM_MAIN_FORMATS[platform] ?? []) {
    const idx = formatOrder.indexOf(format);
    if (idx !== -1 && idx < localIdx) return true;
  }
  return false;
};

/**
 */
export const isBetterFormat = (
  candidateFormat: LyricFormat,
  currentFormat: LyricFormat | null,
): boolean => {
  if (!currentFormat) return true;
  const order = useSettingsStore().lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const currIdx = order.indexOf(currentFormat);
  const candIdx = order.indexOf(candidateFormat);
  const currRank = currIdx === -1 ? order.length : currIdx;
  const candRank = candIdx === -1 ? order.length : candIdx;
  return candRank < currRank;
};

const isOnlineResultUpgrade = (result: OnlineResult, localFormat: LyricFormat): boolean =>
  isBetterFormat(result.source.format, localFormat);

interface OnlinePreferenceOptions {
  hasLocal: boolean;
  localFormat: LyricFormat | null;
  onCandidate?: (result: OnlineResult) => void;
  shouldContinue?: () => boolean;
}

/**
 */
export const resolveOnlineByPreference = async (
  track: Track,
  options: OnlinePreferenceOptions,
): Promise<OnlineResult | null> => {
  const settings = useSettingsStore();
  const preference = settings.lyric.lyricSourcePreference;
  const isCurrent = options.shouldContinue ?? (() => true);
  if (preference === "self") {
    return isPlatform(track.source) ? resolvePlatformLyric(track.source, track) : null;
  }
  if (preference !== "auto") return resolvePlatformLyric(preference, track);

  const order = settings.lyric.lyricSourceOrder ?? DEFAULT_LYRIC_SOURCE_ORDER;
  const formatOrder = settings.lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  let candidates: Platform[] = [...order];
  if (options.hasLocal) {
    if (!settings.lyric.smartPreferOnline || !options.localFormat) return null;
    candidates = order.filter((platform) =>
      platformCanUpgrade(platform, options.localFormat!, formatOrder),
    );
    if (candidates.length === 0) return null;
  }

  if (settings.lyric.smartPreferOnline) {
    let best: OnlineResult | null = null;
    const localIdx =
      options.hasLocal && options.localFormat ? formatOrder.indexOf(options.localFormat) : -1;
    let bestRank = localIdx === -1 ? Infinity : localIdx;
    await Promise.all(
      candidates.map(async (platform) => {
        const result = await resolvePlatformLyric(platform, track);
        if (!isCurrent() || !result) return;
        const idx = formatOrder.indexOf(result.source.format);
        const rank = idx === -1 ? Infinity : idx;
        if (rank < bestRank) {
          best = result;
          bestRank = rank;
          options.onCandidate?.(result);
        }
      }),
    );
    return isCurrent() ? best : null;
  }

  for (const platform of candidates) {
    const result = await resolvePlatformLyric(platform, track);
    if (!isCurrent()) return null;
    if (!result) continue;
    if (
      options.hasLocal &&
      options.localFormat &&
      !isOnlineResultUpgrade(result, options.localFormat)
    ) {
      continue;
    }
    return result;
  }
  return null;
};

const shouldTryTTMLByFormat = (mainFormat: LyricFormat): boolean => {
  const settings = useSettingsStore();
  if (!settings.system.lyric.enableOnlineTTMLLyric) return false;
  if (settings.lyric.lyricSourcePreference === "self") return false;
  const order = settings.lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const ttmlIdx = order.indexOf("ttml");
  if (ttmlIdx === -1) return false;
  const mainIdx = order.indexOf(mainFormat);
  return mainIdx === -1 || ttmlIdx < mainIdx;
};

/**
 */
export const resolveTTMLOverlay = async (
  track: Track,
  online: OnlineResult,
): Promise<ResolvedLyric | null> => {
  if (!shouldTryTTMLByFormat(online.source.format)) return null;
  const candidates = await Promise.all(
    TTML_PLATFORMS.map(async (platform) => ({
      platform,
      response: await requestTTMLOverlay(track, platform),
    })),
  );
  const match = candidates.find(
    (candidate): candidate is typeof candidate & { response: { ok: true; data: string } } =>
      candidate.response.ok && !!candidate.response.data,
  );
  if (!match) return null;
  return {
    source: { source: "online", format: "ttml", platform: match.platform },
    input: { content: match.response.data },
  };
};

/**
 */
export const resolveStreamingByPreference = async (
  track: Track,
): Promise<ResolvedLyric | null> => resolveStreamingLyric(track);

/**
 */
export const resolveLocalRepoLyric = async (track: Track): Promise<ResolvedLyric | null> => {
  const settings = useSettingsStore();
  if (
    !settings.system.localLyric?.enableLocalTTMLOverride ||
    !settings.system.localLyric?.repoDir
  ) {
    return null;
  }
  const resp = await window.api.lyrics.matchLocalTTML(track);
  if (!resp.ok || !resp.data) return null;
  return { source: { source: "external", format: "ttml" }, input: { content: resp.data } };
};

/**
 */
export const resolvePluginLyric = async (track: Track): Promise<ResolvedLyric | null> => {
  const plugins = usePluginsStore();
  for (const info of plugins.list) {
    if (!info.enabled || info.status.state !== "ready") continue;
    for (const [source, cap] of Object.entries(info.status.sources)) {
      if (!cap.actions.includes("musicLyric")) continue;
      const resp = await window.api.plugins.matchLyric({
        pluginId: info.manifest.id,
        source,
        track,
      });
      if (!resp.ok || !resp.data) continue;
      const content = resp.data.awlyric ?? resp.data.lyric;
      if (!content?.trim()) continue;
      return {
        source: { source: "online", format: detectFormat(content) },
        input: { content, translation: resp.data.tlyric, romaji: resp.data.rlyric },
      };
    }
  }
  return null;
};

export const isPluginLyricPreferred = (): boolean =>
  useSettingsStore().lyric.preferPluginLyric === true;

/**
 */
export const resolveLyricForPreload = async (
  track: Track,
  shouldContinue: () => boolean,
): Promise<ResolvedLyric | null> => {
  if (track.source === "local") return null;

  const localRepo = await resolveLocalRepoLyric(track);
  if (!shouldContinue()) return null;
  if (localRepo) return localRepo;

  const pluginTask = isPluginLyricPreferred() ? resolvePluginLyric(track) : null;

  if (track.source === "streaming") {
    const streaming = await resolveStreamingByPreference(track);
    if (!shouldContinue()) return null;
    if (pluginTask) {
      const plugin = await pluginTask;
      if (!shouldContinue()) return null;
      if (plugin && isBetterFormat(plugin.source.format, streaming?.source.format ?? null)) {
        return plugin;
      }
      return streaming ?? plugin ?? null;
    }
    if (streaming) return streaming;
    const plugin = await resolvePluginLyric(track);
    return shouldContinue() ? plugin : null;
  }

  const online = await resolveOnlineByPreference(track, {
    hasLocal: false,
    localFormat: null,
    shouldContinue,
  });
  if (!shouldContinue()) return null;
  let normal: ResolvedLyric | null = null;
  if (online) {
    const ttml = await resolveTTMLOverlay(track, online);
    if (!shouldContinue()) return null;
    normal = ttml ?? { source: online.source, input: online.input };
  }
  if (pluginTask) {
    const plugin = await pluginTask;
    if (!shouldContinue()) return null;
    if (plugin && isBetterFormat(plugin.source.format, normal?.source.format ?? null)) {
      return plugin;
    }
    return normal ?? plugin ?? null;
  }
  if (normal) return normal;

  const plugin = await resolvePluginLyric(track);
  return shouldContinue() ? plugin : null;
};
