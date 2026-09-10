import type { MediaInfo, PlaybackContext, Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput, LyricLine } from "@shared/types/lyrics";
import { findLyricIndex } from "@shared/utils/lyric";
import { needsRomanization } from "@shared/utils/romanization";
import { useSettingsStore } from "@/stores/settings";
import { watchLyricPreference } from "@/services/lyric/loader";
import { parseLyric } from "@/utils/lyric/parse";
import { applyLyricLanguages } from "@/utils/lyric/language";
import { extractLyricAuthors } from "@/utils/lyric/author";
import { applyLyricExclude } from "@/utils/lyric/lyricStripper";
import { normalizeLyricLines } from "@/utils/lyric/normalize";
import { applyProfanityUncensor } from "@/utils/preset/profanity";
import { applyLyricCjkTransform } from "@/utils/lyric/cjkTransform";
import {
  applyGeneratedRomanization,
  collectMissingRomanization,
  getLyricLineText,
} from "@/utils/lyric/romanization";

export const useMediaStore = defineStore("media", () => {
  watchLyricPreference();

  const track = shallowRef<Track | null>(null);

  const playbackContext = shallowRef<PlaybackContext>();

  const detail = shallowRef<TrackDetail | null>(null);

  const activeLyric = ref<LyricData>(null);

  const lyricContent = ref<LyricInput | null>(null);

  const lyricLoading = ref(false);

  const lyricIndex = ref(-1);

  const lyricFormat = computed((): LyricFormat | null => activeLyric.value?.format ?? null);
  const parsedLyric = shallowRef<LyricLine[]>([]);

  const romanizationVisible = ref(true);
  const romanizationLoading = ref(false);
  const romanizationError = ref(false);

  const lyricSyncPicking = ref(false);

  const lyricAuthors = ref<string[]>([]);
  const syncToMain = (): void => {
    try {
      const payload = {
        track: track.value ? toRaw(track.value) : null,
        lyric: toRaw(parsedLyric.value),
        source: activeLyric.value ? toRaw(activeLyric.value) : null,
      };
      window.api.nowPlaying.update(payload);
    } catch (error) {
      console.error("[media] syncToMain failed", error);
    }
  };
  /**
   */
  const setTrack = (newTrack: Track, newDetail?: TrackDetail): void => {
    track.value = newTrack;
    if (newDetail) detail.value = newDetail;
  };

  /**
   */
  const setPlaybackContext = (context?: PlaybackContext): void => {
    playbackContext.value = context;
  };
  /**
   */
  const enrichTrack = (info: MediaInfo, newDetail?: TrackDetail): void => {
    if (!track.value) return;
    const isStreaming = track.value.source === "streaming";
    const fileName = track.value.path?.split(/[\\/]/).pop() ?? "";
    const stem = fileName.replace(/\.[^.]+$/, "");
    const hasExplicitTitle = !!track.value.title && track.value.title !== stem;
    const hasExplicitArtists = track.value.artists && track.value.artists.length > 0;
    track.value = {
      ...track.value,
      title: hasExplicitTitle ? track.value.title : info.title || track.value.title,
      artists: hasExplicitArtists
        ? track.value.artists
        : info.artists && info.artists.length > 0
          ? info.artists
          : track.value.artists,
      album: track.value.album ?? info.album,
      duration: track.value.duration > 0 ? track.value.duration : info.duration,
      cover: isStreaming ? track.value.cover : (track.value.cover ?? info.cover),
      quality: info.quality ?? track.value.quality,
    };
    if (newDetail) detail.value = newDetail;
  };
  /**
   */
  const patchCover = (url: string): void => {
    if (!track.value) return;
    if (track.value.cover && track.value.coverOriginal) return;
    track.value = {
      ...track.value,
      cover: track.value.cover || url,
      coverOriginal: track.value.coverOriginal || url,
    };
  };

  let transformToken = 0;
  let cjkTransformPromise: Promise<void> = Promise.resolve();
  let romanizationRequestId = 0;
  let romanizationResult: LyricLine[] | null = null;

  /**
   * 为缺少提供方音译的当前歌词补全罗马音
   * @param lines - 发起请求时的歌词
   * @param requestId - 当前请求编号
   */
  const fillMissingRomanization = async (lines: LyricLine[], requestId: number): Promise<void> => {
    await cjkTransformPromise;

    if (
      requestId !== romanizationRequestId ||
      parsedLyric.value !== lines ||
      !romanizationVisible.value
    ) {
      return;
    }

    const missing = collectMissingRomanization(lines);
    if (!missing.length) return;

    romanizationLoading.value = true;
    try {
      const readings = await window.api.lyrics.romanize(missing);
      if (
        requestId !== romanizationRequestId ||
        parsedLyric.value !== lines ||
        !romanizationVisible.value
      ) {
        return;
      }

      const enriched = applyGeneratedRomanization(lines, readings);
      romanizationError.value = missing.some((text) => !readings[text]);
      if (enriched !== lines) {
        romanizationResult = enriched;
        parsedLyric.value = enriched;
        syncToMain();
      }
    } catch (error) {
      if (requestId === romanizationRequestId) romanizationError.value = true;
      console.warn("[media] lyric romanization failed", error);
    } finally {
      if (requestId === romanizationRequestId) romanizationLoading.value = false;
    }
  };

  watch(
    [parsedLyric, romanizationVisible],
    ([lines, visible], [, wasVisible]) => {
      // 自己写入的部分成功结果不能触发新一轮网络请求。
      const ownResult = lines === romanizationResult;
      romanizationResult = null;
      if (ownResult && visible === wasVisible) return;
      const requestId = ++romanizationRequestId;
      romanizationLoading.value = false;
      romanizationError.value = false;
      if (visible && lines.length) void fillMissingRomanization(lines, requestId);
    },
    { flush: "post" },
  );

  watch(
    () => useSettingsStore().lyric.showRomanization,
    (visible) => {
      romanizationVisible.value = visible;
    },
  );

  const resetLyricState = (): void => {
    ++transformToken;
    ++romanizationRequestId;
    cjkTransformPromise = Promise.resolve();

    activeLyric.value = null;
    lyricContent.value = null;
    parsedLyric.value = [];
    lyricAuthors.value = [];
    lyricIndex.value = -1;
    romanizationLoading.value = false;
    romanizationError.value = false;
    lyricSyncPicking.value = false;
    lyricLoading.value = true;
    syncToMain();
  };

  watch(
    () => [useSettingsStore().lyric.cjkTransform, useSettingsStore().preset.uncensorProfanity],
    () => {
      if (activeLyric.value && lyricContent.value) {
        setLyric(activeLyric.value, lyricContent.value);
      }
    },
  );
  /**
   */
  const setLyric = (source: LyricData, input: LyricInput | null): void => {
    const cjkToken = ++transformToken;
    ++romanizationRequestId;
    cjkTransformPromise = Promise.resolve();
    romanizationLoading.value = false;
    romanizationError.value = false;

    let nextLines: LyricLine[] = [];
    const settings = useSettingsStore();
    if (source && input) {
      try {
        const lines = parseLyric(input, source.format, settings.locale, {
          detectBackground: settings.lyric.detectBackgroundLyrics,
        });
        nextLines = applyLyricExclude(lines, track.value);
        normalizeLyricLines(nextLines);
        // Fuck Mode
        if (settings.preset.uncensorProfanity) {
          applyProfanityUncensor(nextLines);
        }
        applyLyricLanguages(nextLines);
      } catch (e) {
        console.error("[media] parse lyric failed:", e);
        nextLines = [];
      }
    }
    const hasContent = nextLines.length > 0;
    activeLyric.value = hasContent ? source : null;
    lyricContent.value = hasContent ? input : null;
    parsedLyric.value = nextLines;
    romanizationVisible.value = settings.lyric.showRomanization;
    lyricSyncPicking.value = false;
    lyricAuthors.value =
      hasContent && source && input ? extractLyricAuthors(input.content, source.format) : [];
    lyricIndex.value = -1;
    lyricLoading.value = false;
    syncToMain();

    const cjkMode = settings.lyric.cjkTransform;
    if (hasContent && cjkMode && cjkMode !== "none") {
      cjkTransformPromise = applyLyricCjkTransform(nextLines, cjkMode)
        .then((transformed) => {
          if (cjkToken !== transformToken) return;

          parsedLyric.value = transformed;
          syncToMain();
        })
        .catch((error) => {
          console.error("[media] CJK transform failed", error);
        });
    }
  };

  const canRomanize = computed(() =>
    parsedLyric.value.some(
      (line) => Boolean(line.romanLyric) || needsRomanization(getLyricLineText(line)),
    ),
  );

  const toggleRomanization = (): void => {
    if (!canRomanize.value) return;

    if (romanizationError.value && romanizationVisible.value) {
      romanizationError.value = false;
      void fillMissingRomanization(parsedLyric.value, ++romanizationRequestId);
      return;
    }

    romanizationVisible.value = !romanizationVisible.value;
  };
  /**
   */
  const updateLyricIndex = (time: number): void => {
    lyricIndex.value = findLyricIndex(parsedLyric.value, time, lyricIndex.value);
  };

  const clear = (): void => {
    ++transformToken;
    ++romanizationRequestId;
    cjkTransformPromise = Promise.resolve();

    track.value = null;
    playbackContext.value = undefined;
    detail.value = null;
    activeLyric.value = null;
    lyricContent.value = null;
    parsedLyric.value = [];
    romanizationVisible.value = true;
    romanizationLoading.value = false;
    romanizationError.value = false;
    lyricSyncPicking.value = false;
    lyricAuthors.value = [];
    lyricLoading.value = false;
    lyricIndex.value = -1;
    syncToMain();
  };
  return {
    track,
    playbackContext,
    detail,
    activeLyric,
    lyricContent,
    lyricFormat,
    parsedLyric,
    romanizationVisible,
    romanizationLoading,
    romanizationError,
    lyricSyncPicking,
    canRomanize,
    lyricAuthors,
    lyricLoading,
    lyricIndex,
    setTrack,
    setPlaybackContext,
    enrichTrack,
    patchCover,
    resetLyricState,
    setLyric,
    toggleRomanization,
    updateLyricIndex,
    clear,
  };
});
