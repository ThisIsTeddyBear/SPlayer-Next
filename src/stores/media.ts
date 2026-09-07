import type { MediaInfo, PlaybackContext, Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricFormat, LyricInput, LyricLine } from "@shared/types/lyrics";
import { findLyricIndex } from "@shared/utils/lyric";
import { useSettingsStore } from "@/stores/settings";
import { watchLyricPreference } from "@/services/lyric/loader";
import { parseLyric } from "@/utils/lyric/parse";
import { applyLyricLanguages } from "@/utils/lyric/language";
import { extractLyricAuthors } from "@/utils/lyric/author";
import { applyLyricExclude } from "@/utils/lyric/lyricStripper";
import { normalizeLyricLines } from "@/utils/lyric/normalize";
import { applyProfanityUncensor } from "@/utils/preset/profanity";
import { applyLyricCjkTransform } from "@/utils/lyric/cjkTransform";

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

  const resetLyricState = (): void => {
    activeLyric.value = null;
    lyricContent.value = null;
    parsedLyric.value = [];
    lyricAuthors.value = [];
    lyricIndex.value = -1;
    romanizationLoading.value = false;
    lyricSyncPicking.value = false;
    lyricLoading.value = true;
    syncToMain();
  };

  let transformToken = 0;

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
      const token = ++transformToken;
      applyLyricCjkTransform(nextLines, cjkMode).then((transformed) => {
        if (token !== transformToken) return;
        parsedLyric.value = transformed;
        syncToMain();
      });
    }
  };

  const canRomanize = computed(() =>
    parsedLyric.value.some(
      (line) =>
        Boolean(line.romanLyric) ||
        /[^\u0020-\u024f\u2000-\u206f]/u.test(line.words.map((word) => word.word).join("")),
    ),
  );

  const toggleRomanization = async (): Promise<void> => {
    if (!canRomanize.value) return;
    romanizationVisible.value = !romanizationVisible.value;
    if (!romanizationVisible.value || romanizationLoading.value) return;
    const lines = parsedLyric.value;
    const missing = [
      ...new Set(
        lines
          .filter((line) => !line.romanLyric)
          .map((line) => line.words.map((word) => word.word).join(""))
          .filter((text) => /[^\u0020-\u024f\u2000-\u206f]/u.test(text)),
      ),
    ];
    if (!missing.length) return;
    romanizationLoading.value = true;
    try {
      const readings = await window.api.lyrics.romanize(missing);
      if (parsedLyric.value !== lines) return;
      parsedLyric.value = lines.map((line) => {
        if (line.romanLyric) return line;
        const text = line.words.map((word) => word.word).join("");
        const romanLyric = readings[text];
        return romanLyric ? { ...line, romanLyric } : line;
      });
      syncToMain();
    } finally {
      romanizationLoading.value = false;
    }
  };

  /**
   */
  const updateLyricIndex = (time: number): void => {
    lyricIndex.value = findLyricIndex(parsedLyric.value, time, lyricIndex.value);
  };

  const clear = (): void => {
    track.value = null;
    playbackContext.value = undefined;
    detail.value = null;
    activeLyric.value = null;
    lyricContent.value = null;
    parsedLyric.value = [];
    romanizationVisible.value = true;
    romanizationLoading.value = false;
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
