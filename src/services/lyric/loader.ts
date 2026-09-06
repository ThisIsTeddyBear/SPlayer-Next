import type { Track, TrackDetail } from "@shared/types/player";
import type { LyricData, LyricInput } from "@shared/types/lyrics";
import { bestExternalIndex } from "@/utils/lyric/parse";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { DEFAULT_LYRIC_FORMAT_ORDER } from "@/types/settings";
import {
  embeddedLyricFromDetail,
  resolveLocalRepoLyric,
  resolveStreamingLyric,
  type LocalLyric,
  type ResolvedLyric,
} from "@/services/lyric/resolve";
import { consumePreloadedLyric } from "@/services/lyric/preload";

let currentToken = 0;

const readLocal = async (
  detail: TrackDetail,
): Promise<{ source: NonNullable<LyricData>; content: string } | null> => {
  const order = useSettingsStore().lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const index = bestExternalIndex(detail.externalLyrics, order);
  if (index !== -1) {
    const lyric = detail.externalLyrics[index];
    const result = await window.api.player.readLyricFile(lyric.path);
    if (!result.success || result.data == null) return null;
    return { source: { source: "external", format: lyric.format }, content: result.data };
  }
  return embeddedLyricFromDetail(detail);
};

const commit = (token: number, source: LyricData, input: LyricInput | null): void => {
  if (token !== currentToken) return;
  useMediaStore().setLyric(source, input);
};

const commitResolved = (token: number, lyric: ResolvedLyric): boolean => {
  commit(token, lyric.source, lyric.input);
  return token === currentToken && useMediaStore().parsedLyric.length > 0;
};

const commitLocal = (token: number, lyric: LocalLyric): void =>
  commit(token, lyric.source, { content: lyric.content });

const tryLocalRepo = async (token: number, track: Track): Promise<boolean> => {
  const lyric = await resolveLocalRepoLyric(track);
  return lyric ? commitResolved(token, lyric) : false;
};

const loadStreamingLyric = async (
  token: number,
  track: Track,
  detail: TrackDetail | null,
): Promise<void> => {
  const lyric = await resolveStreamingLyric(track);
  if (token !== currentToken) return;
  if (lyric && commitResolved(token, lyric)) return;
  const embedded = embeddedLyricFromDetail(detail);
  if (embedded) commitLocal(token, embedded);
  else commit(token, null, null);
};

export const beginLoad = (): number => {
  currentToken++;
  useMediaStore().resetLyricState();
  return currentToken;
};

/** Loads only embedded, sidecar, local-repository, or connected-server lyrics. */
export const loadForTrack = async (detail: TrackDetail | null): Promise<void> => {
  const token = beginLoad();
  try {
    const media = useMediaStore();
    const track = media.track;
    if (!track) {
      commit(token, null, null);
      return;
    }

    const preloaded = await consumePreloadedLyric(track);
    if (token !== currentToken) return;
    if (preloaded.hit && commitResolved(token, preloaded.lyric)) return;
    if (await tryLocalRepo(token, track)) return;
    if (token !== currentToken) return;

    if (track.source === "streaming") {
      await loadStreamingLyric(token, track, detail);
      return;
    }

    if (track.source === "local") {
      const lyric = detail ? await readLocal(detail) : null;
      if (lyric) commitLocal(token, lyric);
      else commit(token, null, null);
      return;
    }

    commit(token, null, null);
  } catch (error) {
    console.error("[lyricLoader] Failed to load local lyrics:", error);
    commit(token, null, null);
  }
};

export const watchLyricPreference = (): void => {
  const settings = useSettingsStore();
  watch(
    () => [
      settings.lyric.lyricFormatOrder,
      settings.lyric.detectBackgroundLyrics,
      settings.system.localLyric.enableLocalTTMLOverride,
      settings.system.localLyric.repoDir,
    ],
    () => {
      void loadForTrack(useMediaStore().detail);
    },
  );
};
