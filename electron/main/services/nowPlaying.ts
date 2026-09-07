import { EventEmitter } from "node:events";
import type { Track, PlayerState } from "@shared/types/player";
import type { LyricLine, LyricData } from "@shared/types/lyrics";
import type {
  NowPlayingSnapshot,
  NowPlayingPositionSync,
  NowPlayingLyricOffsetSync,
} from "@shared/types/nowPlaying";
import { store } from "@main/store";

type NowPlayingEvents = {
  "track-change": [{ track: Track | null }];
  "lyric-change": [NowPlayingSnapshot];
  "position-sync": [NowPlayingPositionSync];
  "lyric-offset-change": [NowPlayingLyricOffsetSync];
};

let currentTrack: Track | null = null;
let currentLyric: LyricLine[] = [];
let currentSource: LyricData = null;
let lastPosition = 0;
let lastPositionAt = 0;
let playing = false;
let playState: PlayerState = "idle";
let playSpeed = 1.0;
let currentLyricOffsetMs = 0;

const emitter = new EventEmitter<NowPlayingEvents>();

/**
 */
const offsetKey = (trackId: string, source: LyricData): string => {
  if (!source) return trackId;
  const src =
    source.source === "online" && source.platform ? `online:${source.platform}` : source.source;
  return `${trackId}|${src}`;
};

/**
 */
const readOffset = (trackId: string | null | undefined, source: LyricData): number => {
  if (!trackId) return 0;
  return store.get("player.lyricOffsets")?.[offsetKey(trackId, source)] ?? 0;
};

let currentOffsetKey = "";

/**
 */
export const update = (track: Track | null, lyric: LyricLine[], source: LyricData): void => {
  const trackChanged = (currentTrack?.id ?? null) !== (track?.id ?? null);
  currentTrack = track;
  currentLyric = lyric;
  currentSource = source;
  if (trackChanged) {
    lastPosition = 0;
    lastPositionAt = Date.now();
    emitter.emit("track-change", { track });
  }
  const key = track?.id ? offsetKey(track.id, source) : "";
  if (trackChanged || key !== currentOffsetKey) {
    currentOffsetKey = key;
    currentLyricOffsetMs = readOffset(track?.id, source);
    emitter.emit("lyric-offset-change", {
      trackId: track?.id ?? null,
      offsetMs: currentLyricOffsetMs,
    });
  }
  emitter.emit("lyric-change", snapshot());
};

/**
 */
export const onPosition = (positionMs: number, isPlaying: boolean): void => {
  lastPosition = positionMs;
  lastPositionAt = Date.now();
  playing = isPlaying;
  if (isPlaying) playState = "playing";
  emitter.emit("position-sync", {
    position: positionMs,
    playing: isPlaying,
    state: playState,
    speed: playSpeed,
    sendTimestamp: lastPositionAt,
  });
};

/**
 */
export const onPlayStateChange = (state: PlayerState): void => {
  playState = state;
  playing = state === "playing";
  emitter.emit("position-sync", {
    position: lastPosition,
    playing,
    state,
    speed: playSpeed,
    sendTimestamp: Date.now(),
  });
};

/**
 *
 */
export const onSpeedChange = (speed: number): void => {
  playSpeed = Number.isFinite(speed) ? speed : 1.0;
  emitter.emit("position-sync", {
    position: lastPosition,
    playing,
    state: playState,
    speed: playSpeed,
    sendTimestamp: lastPositionAt || Date.now(),
  });
};

/**
 */
const LYRIC_OFFSET_LIMIT_MS = 60_000;

/**
 */
export const setLyricOffset = (trackId: string, offsetMs: number): void => {
  if (!trackId) return;
  const normalized = Number.isFinite(offsetMs) ? Math.trunc(offsetMs) : 0;
  const value = Math.max(-LYRIC_OFFSET_LIMIT_MS, Math.min(LYRIC_OFFSET_LIMIT_MS, normalized));
  const key = offsetKey(trackId, currentSource);
  const map = { ...(store.get("player.lyricOffsets") ?? {}) };
  if (value === 0) delete map[key];
  else map[key] = value;
  store.set("player.lyricOffsets", map);
  if (currentTrack && currentTrack.id === trackId) {
    currentLyricOffsetMs = value;
    emitter.emit("lyric-offset-change", { trackId, offsetMs: value });
  }
};

export const snapshot = (): NowPlayingSnapshot => ({
  track: currentTrack,
  lyric: currentLyric,
  source: currentSource,
  position: lastPosition,
  playing,
  state: playState,
  speed: playSpeed,
  lyricOffsetMs: currentLyricOffsetMs,
  sendTimestamp: lastPositionAt || Date.now(),
});

export const lightSnapshot = () => ({
  track: currentTrack,
  position: lastPosition,
  playing,
  state: playState,
  speed: playSpeed,
  lyricOffsetMs: currentLyricOffsetMs,
  lyricAvailable: currentLyric.length > 0,
  lyricLineCount: currentLyric.length,
  sendTimestamp: lastPositionAt || Date.now(),
});

export const lyricSnapshot = () => ({
  trackId: currentTrack?.id ?? null,
  lyric: currentLyric,
  source: currentSource,
  lyricOffsetMs: currentLyricOffsetMs,
});

export const clear = (): void => {
  currentTrack = null;
  currentLyric = [];
  currentSource = null;
  currentLyricOffsetMs = 0;
  currentOffsetKey = "";
  emitter.emit("lyric-change", snapshot());
  emitter.emit("lyric-offset-change", { trackId: null, offsetMs: 0 });
};

export const onTrackChange = (listener: (data: { track: Track | null }) => void): (() => void) => {
  emitter.on("track-change", listener);
  return () => emitter.off("track-change", listener);
};

export const onLyricChange = (listener: (snap: NowPlayingSnapshot) => void): (() => void) => {
  emitter.on("lyric-change", listener);
  return () => emitter.off("lyric-change", listener);
};

export const onPositionSync = (listener: (data: NowPlayingPositionSync) => void): (() => void) => {
  emitter.on("position-sync", listener);
  return () => emitter.off("position-sync", listener);
};

export const onLyricOffsetChange = (
  listener: (data: NowPlayingLyricOffsetSync) => void,
): (() => void) => {
  emitter.on("lyric-offset-change", listener);
  return () => emitter.off("lyric-offset-change", listener);
};
