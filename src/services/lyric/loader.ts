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

const readLocal = async function* (detail: TrackDetail): AsyncGenerator<LocalLyric> {
  const order = useSettingsStore().lyric.lyricFormatOrder ?? DEFAULT_LYRIC_FORMAT_ORDER;
  const remaining = [...detail.externalLyrics];
  while (remaining.length > 0) {
    const [lyric] = remaining.splice(bestExternalIndex(remaining, order), 1);
    try {
      const result = await window.api.player.readLyricFile(lyric.path);
      if (result.success && result.data?.trim()) {
        yield { source: { source: "external", format: lyric.format }, content: result.data };
      }
    } catch (error) {
      console.warn("[lyricLoader] sidecar read failed", lyric.path, error);
    }
  }
  const embedded = embeddedLyricFromDetail(detail);
  if (embedded) yield embedded;
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

/** 加载内嵌、外置、本地仓库或已连接服务器的歌词。 */
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
      if (detail) {
        for await (const lyric of readLocal(detail)) {
          if (token !== currentToken) return;
          if (commitResolved(token, { source: lyric.source, input: { content: lyric.content } }))
            return;
        }
      }
      commit(token, null, null);
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
