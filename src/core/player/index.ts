import type { PlaybackContext, Track } from "@shared/types/player";
import type { TagEditRequest, TagWriteOutcome } from "@shared/types/tagEditor";
import type { PersonalFmOptions } from "@/types/netease";
import { handleEvent } from "./events";
import type { RepeatMode, ShuffleMode } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { useStreamingStore } from "@/stores/streaming";
import { usePluginsStore } from "@/stores/plugins";
import { useHistoryStore } from "@/stores/history";
import { useLibraryStore } from "@/stores/library";
import * as queue from "@/stores/queue";
import * as fm from "./fm";
import * as playback from "@/services/playback";
import * as lyricLoader from "@/services/lyric/loader";
import * as coverLoader from "@/services/coverLoader";
import * as abLoop from "@/services/abLoop";
import * as cacheScheduler from "@/services/cacheScheduler";
import { resolveTrackSource, type ResolvedTrackSource } from "@/services/audioSource";
import {
  consumePreloadedTrack,
  disposeNextTrackPreload,
  installNextTrackPreloadWatchers,
  scheduleNextTrackPreload,
} from "@/services/nextTrackPreloader";
import { installPlayStats } from "./stats";
import { useFavorite } from "@/composables/useFavorite";
import { extractColorFromUrl } from "@/utils/color";
import { handleError, isSkippableError } from "@/utils/errors";
import { ErrorCode } from "@shared/types/errors";
import { shouldSkipDjTrack } from "@/utils/preset/djMode";
import { toast } from "@/composables/useToast";
import i18n from "@/i18n";

interface LoadRuntimeOptions {
  suppressErrorToast?: boolean;
  context?: PlaybackContext;
}

interface SourceRetryState {
  skipOfficialOnline: boolean;
  skippedPluginIds: Set<string>;
}

/**
 */
type LoadSourceResult =
  | { status: "loaded"; result: LoadOutcome; resolved: ResolvedTrackSource }
  | { status: "unresolved" }
  | { status: "cancelled" };

let loadToken = 0;
let trackToken = 0;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;
const SKIP_ON_ERROR_DELAY_MS = 1000;

/**
 */
const skipOnFailure = async (myToken: number, getCurrentToken: () => number): Promise<void> => {
  consecutiveFailures++;
  if (
    consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ||
    consecutiveFailures >= queue.queueLength.value
  ) {
    const reachedMax = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
    consecutiveFailures = 0;
    await onQueueEnded();
    if (reachedMax) {
      handleError(ErrorCode.MAX_CONSECUTIVE_FAILURES);
    }
    return;
  }
  setTimeout(() => {
    if (myToken === getCurrentToken()) nextTrack();
  }, SKIP_ON_ERROR_DELAY_MS);
};

export type LoadOutcome = { ok: true; track: Track | null } | { ok: false; error?: string };

/**
 */
const resetForLoad = (duration: number): void => {
  const status = useStatusStore();
  status.trackLoading = true;
  status.position = 0;
  status.duration = duration;
  playback.setCurrentTime(0, { force: true });
  playback.setDuration(duration);
  playback.setPlaying(false);
  cacheScheduler.cancel();
};

/**
 */
export const load = async (
  source: string,
  autoPlay = true,
  meta?: Track,
  options: LoadRuntimeOptions = {},
): Promise<LoadOutcome> => {
  const status = useStatusStore();
  const token = ++loadToken;
  abLoop.reset();
  seekTarget = null;
  playback.setSeeking(false);
  resetForLoad(meta?.duration ?? 0);
  const isOnline = meta?.source !== "local";
  if (isOnline) {
    void lyricLoader.loadForTrack(null);
    extractColorFromUrl(meta?.cover ?? meta?.coverOriginal ?? null);
    if (meta) void coverLoader.loadCoverForTrack(meta);
  }
  try {
    const result = await window.api.player.load(source, {
      autoPlay,
      meta,
      context: options.context,
    });
    if (token !== loadToken) return { ok: false };
    if (result.success && result.data) {
      const { detail, mediaInfo } = result.data;
      consecutiveFailures = 0;
      const media = useMediaStore();
      media.enrichTrack(mediaInfo, detail);
      const enriched = media.track;
      if (enriched) {
        queue.updateQueueTracks([enriched]);
      }
      if (!isOnline) {
        lyricLoader.loadForTrack(detail);
        extractColorFromUrl(enriched?.cover ?? null);
        if (enriched) void coverLoader.loadCoverForTrack(enriched);
      }
      const dur = enriched?.duration ?? mediaInfo.duration;
      status.duration = dur;
      status.state = autoPlay ? "playing" : "paused";
      status.currentSource = source;
      playback.setDuration(dur);
      playback.setPlaying(autoPlay);
      return { ok: true, track: enriched };
    }
    status.state = "idle";
    lyricLoader.loadForTrack(null);
    if (result.error && !options.suppressErrorToast) handleError(result.error);
    return { ok: false, error: result.error };
  } finally {
    if (token === loadToken) status.trackLoading = false;
  }
};

const createSourceRetryState = (): SourceRetryState => ({
  skipOfficialOnline: false,
  skippedPluginIds: new Set<string>(),
});

/**
 */
const resolveTrackSourceWithRetry = (
  track: Track,
  retry: SourceRetryState,
): Promise<ResolvedTrackSource | null> =>
  resolveTrackSource(track, {
    skipOfficialOnline: retry.skipOfficialOnline,
    skipPluginIds: [...retry.skippedPluginIds],
  });

/**
 */
const markRetryableSourceFailure = (
  resolved: ResolvedTrackSource,
  retry: SourceRetryState,
): boolean => {
  if (resolved.provider === "official" && !retry.skipOfficialOnline) {
    retry.skipOfficialOnline = true;
    return true;
  }
  if (resolved.provider === "plugin" && resolved.pluginId) {
    retry.skippedPluginIds.add(resolved.pluginId);
    return true;
  }
  return false;
};

const shouldSuppressLoadError = (resolved: ResolvedTrackSource): boolean =>
  resolved.provider === "official" || resolved.provider === "plugin";

/**
 */
const loadTrackSourceWithFallback = async (
  track: Track,
  context: PlaybackContext | undefined,
  autoPlay: boolean,
  shouldContinue: () => boolean,
  retryOnAnyFailure = false,
  initialResolved?: ResolvedTrackSource | null,
): Promise<LoadSourceResult> => {
  const retry = createSourceRetryState();
  let firstTry = initialResolved ?? null;
  while (true) {
    const usingInitial = firstTry !== null;
    const resolved = firstTry ?? (await resolveTrackSourceWithRetry(track, retry));
    firstTry = null;
    if (!shouldContinue()) return { status: "cancelled" };
    if (!resolved) return { status: "unresolved" };
    const result = await load(resolved.source, autoPlay, track, {
      suppressErrorToast: usingInitial || shouldSuppressLoadError(resolved),
      context,
    });
    if (!shouldContinue()) return { status: "cancelled" };
    if (
      usingInitial &&
      !result.ok &&
      resolved.provider !== "local" &&
      resolved.provider !== "cache"
    ) {
      continue;
    }
    const canRetry =
      !result.ok &&
      (retryOnAnyFailure || Boolean(result.error && isSkippableError(result.error))) &&
      markRetryableSourceFailure(resolved, retry);
    if (canRetry) continue;
    return { status: "loaded", result, resolved };
  }
};

/**
 */
const loadTrack = async (track: Track | null, context?: PlaybackContext): Promise<void> => {
  if (!track) return;
  // Fuck DJ Mode
  const settings = useSettingsStore();
  if (settings.preset.fuckDjMode && shouldSkipDjTrack(track)) {
    await nextTrack();
    return;
  }
  const myToken = ++trackToken;
  const preloaded = consumePreloadedTrack(track);
  const media = useMediaStore();
  media.setTrack(track);
  media.setPlaybackContext(context);
  lyricLoader.beginLoad();
  resetForLoad(track.duration ?? 0);
  void window.api.player.stop();
  let shouldSkip = false;
  try {
    const loaded = await loadTrackSourceWithFallback(
      track,
      context,
      true,
      () => myToken === trackToken,
      false,
      preloaded?.source,
    );
    if (loaded.status === "cancelled") return;
    if (loaded.status === "unresolved") {
      const status = useStatusStore();
      status.currentSource = null;
      status.state = "idle";
      void window.api.player.stop();
      useMediaStore().setLyric(null, null);
      shouldSkip = true;
    } else {
      const { result, resolved } = loaded;
      if (!result.ok && result.error && isSkippableError(result.error)) {
        handleError(result.error);
        shouldSkip = true;
      } else if (result.ok) {
        void useHistoryStore().record(track);
        if (resolved.cacheRequest) {
          cacheScheduler.schedule(track.id, resolved.cacheRequest);
        }
        scheduleNextTrackPreload();
      } else if (result.error) {
        handleError(result.error);
      }
    }
  } finally {
    if (myToken === trackToken) {
      const status = useStatusStore();
      if (shouldSkip || status.state !== "playing") {
        status.trackLoading = false;
      }
    }
  }
  if (shouldSkip) await skipOnFailure(myToken, () => trackToken);
};

/**
 */
export const reloadCurrentTrack = async (forcePlay?: boolean): Promise<boolean> => {
  const media = useMediaStore();
  const track = media.track;
  if (!track || track.source === "local") return false;
  const status = useStatusStore();
  const shouldPlay = forcePlay ?? status.isPlaying;
  const resumePosition = Math.round(playback.getCurrentTime());
  const myToken = ++trackToken;
  status.trackLoading = true;
  const loaded = await loadTrackSourceWithFallback(
    track,
    media.playbackContext,
    false,
    () => myToken === trackToken,
    true,
  );
  if (loaded.status === "cancelled") return true;
  if (loaded.status === "unresolved") {
    status.trackLoading = false;
    return false;
  }
  if (!loaded.result.ok) return false;
  if (resumePosition > 0) await seek(resumePosition);
  if (shouldPlay) await play();
  if (loaded.resolved.cacheRequest) {
    cacheScheduler.schedule(track.id, loaded.resolved.cacheRequest);
  }
  return true;
};

let sourceRecoveryCount = 0;
let sourceRecoveryTrackId: string | null = null;

/**
 */
export const recoverFromSourceFailure = async (): Promise<void> => {
  const track = useMediaStore().track;
  if (!track) return;
  if (track.source === "local") {
    await nextTrack();
    return;
  }
  if (sourceRecoveryTrackId !== track.id) {
    sourceRecoveryTrackId = track.id;
    sourceRecoveryCount = 0;
  }
  if (sourceRecoveryCount >= 1) {
    sourceRecoveryCount = 0;
    await nextTrack();
    return;
  }
  sourceRecoveryCount++;
  const ok = await reloadCurrentTrack(true);
  if (!ok) {
    sourceRecoveryCount = 0;
    await nextTrack();
  }
};

export const play = async (): Promise<void> => {
  const status = useStatusStore();
  if (status.state === "stopped" && status.currentTrack) {
    await loadTrack(status.currentTrack, status.currentPlaybackContext);
    return;
  }
  const prev = status.state;
  status.state = "playing";
  playback.setPlaying(true);
  const result = await window.api.player.play();
  if (!result.success) {
    status.state = prev;
    playback.setPlaying(false);
    handleError(result.error ?? "UNKNOWN");
  }
};

export const togglePlay = (): void => {
  const status = useStatusStore();
  if (status.isPlaying) {
    pause();
  } else {
    play();
  }
};

export const pause = async (): Promise<void> => {
  const status = useStatusStore();
  const prev = status.state;
  status.state = "paused";
  playback.setPlaying(false);
  const result = await window.api.player.pause();
  if (!result.success) {
    status.state = prev;
    playback.setPlaying(true);
  }
};

export const stop = async (): Promise<void> => {
  const status = useStatusStore();
  status.trackLoading = false;
  const result = await window.api.player.stop();
  if (result.success) {
    status.state = "stopped";
    status.position = 0;
    playback.reset();
  }
};

/**
 */
let seekTarget: number | null = null;

/**
 */
export const hasReachedSeekTarget = (position: number): boolean => {
  if (seekTarget === null) return true;
  if (Math.abs(position - seekTarget) < 1000) {
    seekTarget = null;
    playback.setSeeking(false);
    return true;
  }
  return false;
};

export const isSeeking = (): boolean => seekTarget !== null;

/**
 */
export const seek = async (posMs: number): Promise<void> => {
  const status = useStatusStore();
  if (status.trackLoading) return;
  playback.setSeeking(true);
  status.position = posMs;
  playback.setCurrentTime(posMs);

  seekTarget = posMs;

  const result = await window.api.player.seek(posMs);
  if (result.success) {
    status.position = posMs;
    playback.setCurrentTime(posMs);
  }
};

/**
 */
export const markSeek = (posMs: number): void => {
  const status = useStatusStore();
  if (status.trackLoading) return;
  playback.setSeeking(true);
  status.position = posMs;
  playback.setCurrentTime(posMs);
  seekTarget = posMs;
};

/**
 */
export const setVolume = async (vol: number): Promise<void> => {
  const result = await window.api.player.setVolume(vol);
  if (result.success) {
    useStatusStore().volume = result.data ?? vol;
  }
};

/**
 */
export const setSpeed = async (v: number): Promise<void> => {
  const safe = Number.isFinite(v) ? Math.max(0.5, Math.min(2.0, v)) : 1.0;
  const result = await window.api.player.setSpeed(safe);
  if (result.success) {
    useStatusStore().speed = safe;
    playback.setSpeed(safe);
  }
};

/**
 */
export const setPitch = async (n: number): Promise<void> => {
  const safe = Number.isFinite(n) ? Math.max(-12, Math.min(12, Math.round(n))) : 0;
  const result = await window.api.player.setPitch(safe);
  if (result.success) useStatusStore().pitch = safe;
};

/**
 */
export const setPitchSync = async (on: boolean): Promise<void> => {
  const result = await window.api.player.setPitchSync(on);
  if (result.success) useStatusStore().pitchSync = on;
};

export const refreshDevices = async (): Promise<void> => {
  const result = await window.api.player.getOutputDevices();
  if (result.success && result.data) useStatusStore().outputDevices = result.data;
};

/**
 */
export const switchDevice = async (deviceId: string | null): Promise<void> => {
  const settings = useSettingsStore();
  const pauseBeforeSwitch =
    settings.player.pauseOnDeviceSwitch && useStatusStore().state === "playing";
  const result = await window.api.player.setOutputDevice(deviceId, pauseBeforeSwitch);
  if (result.success) settings.player.outputDevice = deviceId;
};

/**
 */
export const playFrom = async (
  items: readonly Track[],
  startIndex = 0,
  context?: PlaybackContext,
): Promise<void> => {
  if (items.length === 0) return;
  const status = useStatusStore();
  const media = useMediaStore();
  status.heartMode = false;
  status.fmMode = false;
  const idx = Math.max(0, Math.min(startIndex, items.length - 1));
  const isSameTrack = media.track?.id === items[idx]?.id;
  queue.setQueue(items, context);
  status.playIndex = idx;
  if (status.shuffleMode === "on") {
    queue.shuffleQueue(status.playIndex);
    status.playIndex = 0;
  }
  if (isSameTrack) {
    if (!status.isPlaying) play();
  } else {
    await loadTrack(status.currentTrack, status.currentPlaybackContext);
  }
};

const resumeAfterTagWrite = async (
  track: Track,
  resumeMs: number,
  wasPlaying: boolean,
): Promise<void> => {
  if (!track.path) return;
  const myToken = ++trackToken;
  useMediaStore().setTrack(track);
  lyricLoader.beginLoad();
  const result = await load(track.path, false, track);
  if (myToken !== trackToken || !result.ok) return;
  if (resumeMs > 0) await seek(resumeMs);
  if (wasPlaying) await play();
};

/**
 */
export const saveTrackTags = async (edits: TagEditRequest[]): Promise<TagWriteOutcome[] | null> => {
  if (edits.length === 0) return [];
  const media = useMediaStore();
  const status = useStatusStore();
  const current = media.track;
  const currentPath = current?.source === "local" ? current.path : undefined;
  const touchesCurrent = !!currentPath && edits.some((edit) => edit.path === currentPath);

  let resumeMs = 0;
  let wasPlaying = false;
  if (touchesCurrent) {
    resumeMs = Math.round(playback.getCurrentTime());
    wasPlaying = status.isPlaying;
    await window.api.player.stop();
  }

  const result = await window.api.library.writeTags(edits);
  if (!result.success || !result.data) {
    if (result.error) handleError(result.error);
    if (touchesCurrent && current) await resumeAfterTagWrite(current, resumeMs, wasPlaying);
    return null;
  }

  const updated = result.data
    .filter((outcome) => outcome.success && outcome.track)
    .map((outcome) => outcome.track!);
  if (updated.length > 0) {
    useLibraryStore().applyTrackUpdates(updated);
    queue.updateQueueTracks(updated);
  }

  if (touchesCurrent && current) {
    const newTrack = updated.find((track) => track.path === currentPath) ?? current;
    await resumeAfterTagWrite(newTrack, resumeMs, wasPlaying);
  }
  return result.data;
};

/**
 */
export const playHeartMode = async (tracks: readonly Track[]): Promise<void> => {
  if (tracks.length === 0) return;
  const status = useStatusStore();
  queue.setQueue(tracks);
  status.playIndex = 0;
  status.shuffleMode = "off";
  status.heartMode = true;
  status.fmMode = false;
  syncPlayMode();
  await loadTrack(status.currentTrack, status.currentPlaybackContext);
};

export const exitHeartMode = (): void => {
  useStatusStore().heartMode = false;
};

/**
 */
export const playPersonalFm = async (options?: PersonalFmOptions): Promise<boolean> => {
  const status = useStatusStore();
  const track = await fm.start(options);
  if (!track) return false;
  status.fmMode = true;
  status.heartMode = false;
  await loadTrack(track);
  return true;
};

/**
 */
export const dislikeFmTrack = async (): Promise<void> => {
  if (!useStatusStore().fmMode) return;
  const playedSec = Math.max(0, Math.round(playback.getCurrentTime() / 1000));
  const next = await fm.dislikeCurrent(playedSec);
  if (next) await loadTrack(next);
};

/**
 */
export const nextTrack = async (): Promise<void> => {
  const status = useStatusStore();
  if (status.fmMode) {
    const next = await fm.next();
    if (next) await loadTrack(next);
    return;
  }
  if (queue.queueLength.value === 0) return;
  if (status.playIndex >= queue.queueLength.value - 1) {
    if (status.shuffleMode === "on" && queue.queueLength.value > 1) {
      queue.shuffleQueue(status.playIndex);
      status.playIndex = 1;
    } else {
      status.playIndex = 0;
    }
  } else {
    status.playIndex++;
  }
  await loadTrack(status.currentTrack, status.currentPlaybackContext);
};

/**
 */
export const playAtIndex = async (index: number): Promise<void> => {
  const status = useStatusStore();
  if (index < 0 || index >= queue.queueLength.value) return;
  if (index === status.playIndex) {
    if (!status.isPlaying && useMediaStore().track) play();
    return;
  }
  status.fmMode = false;
  status.playIndex = index;
  await loadTrack(status.currentTrack, status.currentPlaybackContext);
};

export const prevTrack = async (): Promise<void> => {
  const status = useStatusStore();
  if (status.fmMode) return;
  if (queue.queueLength.value === 0) return;
  status.playIndex = status.playIndex > 0 ? status.playIndex - 1 : queue.queueLength.value - 1;
  await loadTrack(status.currentTrack, status.currentPlaybackContext);
};

const onQueueEnded = async (): Promise<void> => {
  const status = useStatusStore();
  status.trackLoading = false;
  playback.setPlaying(false);
  playback.reset();
  await window.api.player.stop();
  status.state = "stopped";
  status.position = status.duration;
};

const syncPlayMode = (): void => {
  const status = useStatusStore();
  window.api.player.syncPlayMode(status.repeatMode, status.shuffleMode);
};

/**
 */
export const setRepeatMode = (mode: RepeatMode): void => {
  const status = useStatusStore();
  if (status.repeatMode === mode) return;
  status.repeatMode = mode;
  syncPlayMode();
  toast.info(i18n.global.t(`player.repeatMode.${mode}`), { icon: false });
};

export const cycleRepeatMode = (): void => {
  const status = useStatusStore();
  const cycle: RepeatMode[] = ["list", "one"];
  const nextIndex = (cycle.indexOf(status.repeatMode) + 1) % cycle.length;
  setRepeatMode(cycle[nextIndex]);
};

export const toggleShuffleMode = (): void => {
  const status = useStatusStore();
  setShuffleMode(status.shuffleMode === "on" ? "off" : "on");
};

/**
 */
export const setShuffleMode = (mode: ShuffleMode): void => {
  const status = useStatusStore();
  if (status.heartMode) return;
  if (status.shuffleMode === mode) return;
  status.shuffleMode = mode;
  if (mode === "on") {
    queue.shuffleQueue(status.playIndex);
    status.playIndex = 0;
  } else {
    const track = status.currentTrack;
    if (track) {
      status.playIndex = queue.unshuffleQueue(track.id);
    } else {
      queue.unshuffleQueue("");
    }
  }
  syncPlayMode();
  toast.info(i18n.global.t(`player.shuffleMode.${mode}`), { icon: false });
};

/**
 */
export const removeFromQueue = async (index: number): Promise<void> => {
  const status = useStatusStore();
  if (index < 0 || index >= queue.queueLength.value) return;
  const isCurrentPlaying = index === status.playIndex;
  queue.removeFromQueue(index);
  if (index < status.playIndex) {
    status.playIndex--;
  } else if (isCurrentPlaying) {
    if (queue.queueLength.value === 0) {
      status.playIndex = -1;
      await onQueueEnded();
      return;
    }
    if (status.playIndex >= queue.queueLength.value) status.playIndex = 0;
    await loadTrack(status.currentTrack, status.currentPlaybackContext);
  }
};

/**
 */
export const purgeDeletedTracks = async (ids: readonly string[]): Promise<void> => {
  const currentId = useMediaStore().track?.id;
  for (const id of ids) {
    if (id === currentId) continue;
    const index = queue.findTrackIndex(id);
    if (index !== -1) await removeFromQueue(index);
  }
  if (currentId && ids.includes(currentId)) {
    const index = queue.findTrackIndex(currentId);
    if (index !== -1) await removeFromQueue(index);
  }
};

/**
 */
export const insertToQueue = (
  item: Track,
  afterIndex?: number,
  context?: PlaybackContext,
): number => {
  const status = useStatusStore();
  const len = queue.queue.value.length;
  const raw = afterIndex ?? status.playIndex + 1;
  const existingIdx = queue.findTrackIndex(item.id);
  if (existingIdx !== -1) {
    queue.updateQueueItem(existingIdx, item, context);
    const safeAt = Math.max(0, Math.min(raw, len - 1));
    if (existingIdx === safeAt) return existingIdx;
    moveInQueue(existingIdx, safeAt);
    return safeAt;
  }
  const safeAt = Math.max(0, Math.min(raw, len));
  queue.insertToQueue(item, safeAt, context);
  if (safeAt <= status.playIndex) status.playIndex++;
  return safeAt;
};

/**
 */
export const insertManyToQueue = (
  items: readonly Track[],
  position: "next" | "end" = "next",
  context?: PlaybackContext,
): number => {
  if (items.length === 0) return 0;
  const status = useStatusStore();
  const seen = new Set(queue.queue.value.map((track) => track.id));
  const fresh: Track[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    fresh.push(item);
  }
  if (fresh.length === 0) return 0;
  const insertAt = position === "end" ? queue.queue.value.length : status.playIndex + 1;
  queue.insertManyToQueue(fresh, insertAt, context);
  return fresh.length;
};

/**
 */
export const playNow = async (item: Track, context?: PlaybackContext): Promise<void> => {
  const status = useStatusStore();
  const media = useMediaStore();
  if (media.track?.id === item.id && status.currentSource) {
    if (!status.isPlaying) play();
    return;
  }
  status.fmMode = false;
  status.playIndex = insertToQueue(item, undefined, context);
  await loadTrack(item, context);
};

/**
 */
export const createLocalTrack = (filePath: string): Track => {
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const title = fileName.replace(/\.[^/.]+$/, "");
  return {
    id: `local:${filePath}`,
    title,
    artists: [],
    source: "local",
    path: filePath,
    duration: 0,
  };
};

/**
 */
export const playFile = async (filePath: string): Promise<void> => {
  const item = createLocalTrack(filePath);
  await playNow(item, {
    originId: "local-file",
    originType: "track",
    originName: "Local Files",
  });
};

/**
 */
export const playFiles = async (filePaths: string[]): Promise<void> => {
  if (filePaths.length === 0) return;
  const tracks = filePaths.map(createLocalTrack);
  await playFrom(tracks, 0, {
    originId: "local-files",
    originType: "track",
    originName: "Local Files",
  });
};

/**
 */
export const moveInQueue = (fromIndex: number, toIndex: number): void => {
  const status = useStatusStore();
  queue.moveInQueue(fromIndex, toIndex);
  if (status.playIndex === fromIndex) {
    status.playIndex = toIndex;
  } else if (fromIndex < status.playIndex && toIndex >= status.playIndex) {
    status.playIndex--;
  } else if (fromIndex > status.playIndex && toIndex <= status.playIndex) {
    status.playIndex++;
  }
};

let unsubscribe: (() => void) | null = null;
let initialized = false;

export const initPlayer = async (): Promise<void> => {
  if (initialized) return;
  initialized = true;
  console.log("[player] init");
  const settings = useSettingsStore();
  await settings.syncSystem();
  await useStreamingStore().init();
  void usePluginsStore().load();
  await queue.restoreQueue();
  const status = useStatusStore();
  if ((status.repeatMode as string) === "off") status.repeatMode = "list";
  await window.api.player.setVolume(status.volume);
  syncPlayMode();
  const { fadeEnabled, fadeDuration, loudnessNormalization, equalizer } = settings.system.player;
  await window.api.player.setFadeDuration(fadeEnabled ? fadeDuration : 0);
  await window.api.player.setNormalizationEnabled(loudnessNormalization ?? false);
  if (equalizer) {
    await window.api.player.setEqualizerBands([...equalizer.bands]);
    await window.api.player.setPreampGain(equalizer.preamp);
    await window.api.player.setEqualizerEnabled(equalizer.enabled);
  }
  await refreshDevices();
  await window.api.player.setPauseOnDeviceSwitch(settings.player.pauseOnDeviceSwitch);
  if (window.api.system.platform === "win32") {
    const exclusiveResult = await window.api.player.setExclusiveAudio(
      settings.player.exclusiveAudio,
    );
    if (!exclusiveResult.success) {
      settings.player.exclusiveAudio = false;
      handleError(exclusiveResult.error ?? ErrorCode.EXCLUSIVE_AUDIO_UNAVAILABLE);
    }
  }
  if (settings.player.outputDevice) {
    const legacy = useStatusStore().outputDevices.find(
      (device) => device.name === settings.player.outputDevice,
    );
    if (legacy) settings.player.outputDevice = legacy.id;
    await window.api.player.setOutputDevice(settings.player.outputDevice);
  }
  if (unsubscribe) unsubscribe();
  unsubscribe = window.api.player.onEvent(handleEvent);
  installPlayStats();
  const media = useMediaStore();
  const fav = useFavorite();
  watch(
    () => fav.isLiked(media.track),
    (liked) => window.api.player.syncLikeState(liked),
    { immediate: true },
  );
  window.api.nowPlaying.onLyricOffsetChange(({ offsetMs }) => {
    status.lyricOffsetMs = offsetMs;
    media.updateLyricIndex(playback.getCurrentTime() + offsetMs);
  });
  try {
    const snap = await window.api.nowPlaying.requestSnapshot();
    status.lyricOffsetMs = snap.lyricOffsetMs;
  } catch (error) {
    console.error("[player] requestSnapshot failed", error);
  }
  installNextTrackPreloadWatchers();
  scheduleNextTrackPreload();
};

export const restoreLastTrack = async (): Promise<void> => {
  const status = useStatusStore();
  const settings = useSettingsStore();
  const media = useMediaStore();
  const lastTrack = status.currentTrack;
  if (!lastTrack) {
    status.state = "idle";
    return;
  }
  const lastPosition = status.position;
  media.setTrack(lastTrack);
  media.setPlaybackContext(status.currentPlaybackContext);
  lyricLoader.beginLoad();
  const loaded = await loadTrackSourceWithFallback(
    lastTrack,
    status.currentPlaybackContext,
    settings.system.player.autoPlay,
    () => true,
  );
  if (loaded.status === "loaded" && loaded.result.ok) {
    if (settings.system.player.rememberLastTrack && lastPosition > 0) {
      await seek(lastPosition);
    }
    if (loaded.resolved.cacheRequest) {
      cacheScheduler.schedule(lastTrack.id, loaded.resolved.cacheRequest);
    }
  } else {
    status.state = "idle";
  }
};

export const disposePlayer = (): void => {
  disposeNextTrackPreload();
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
};
