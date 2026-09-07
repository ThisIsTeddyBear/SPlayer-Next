import type { LyricFormat } from "./lyrics";
import type { Platform } from "./platform";

export type PlayerState = "idle" | "loading" | "playing" | "paused" | "stopped";

export type RepeatMode = "list" | "one";

export type ShuffleMode = "off" | "on";

export type TrackSource = "local" | "streaming" | Platform;

export type PlaybackOriginType = "track" | "playlist" | "album" | "artist" | "radio" | "page";

export interface PlaybackContext {
  provider?: TrackSource;
  originId: string;
  originType: PlaybackOriginType;
  originName?: string;
}

export interface Artist {
  id?: string;
  name: string;
  avatar?: string;
  albumCount?: number;
}

export interface Album {
  id?: string;
  name: string;
  cover?: string;
  artist?: string;
  trackCount?: number;
  year?: number;
}

export interface Playlist {
  id?: string;
  name: string;
  cover?: string;
  description?: string;
  trackCount?: number;
  owner?: string;
}

export interface AudioQuality {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  bitRate: number;
  codec: string;
}

/**
 */
export type TrackFee = 0 | 1 | 4 | 8;

export interface Track {
  id: string;
  extId?: string;
  mediaId?: string;
  source: TrackSource;
  path?: string;
  cuePath?: string;
  cueAudioPath?: string;
  cueStartMs?: number;
  cueEndMs?: number;
  serverId?: string;
  originalId?: string;
  title: string;
  comment?: string;
  artists: Artist[];
  album?: Album;
  track?: number;
  duration: number;
  cover?: string;
  coverOriginal?: string;
  fileSize?: number;
  mtime?: number;
  ctime?: number;
  quality?: AudioQuality;
  fee?: TrackFee;
  cloud?: boolean;
}

export interface PlaybackQueueItem {
  track: Track;
  context?: PlaybackContext;
}

export interface TrackDetail {
  quality: AudioQuality;
  embeddedLyric?: string;
  externalLyrics: { format: LyricFormat; path: string }[];
}

export interface MediaInfo {
  title?: string;
  artists?: Artist[];
  album?: Album;
  duration: number;
  cover?: string;
  quality?: AudioQuality;
}

export interface LoadResult {
  detail: TrackDetail;
  mediaInfo: MediaInfo;
}

export interface LoadOptions {
  autoPlay?: boolean;
  /**
   */
  meta?: Track;
  context?: PlaybackContext;
}

export interface PlayerStatus {
  state: PlayerState;
  position: number;
  duration: number;
  volume: number;
  speed: number;
  isFinished: boolean;
}

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export type PlayerEvent =
  | { type: "status"; data: PlayerStatus }
  | { type: "position"; data: { position: number; duration: number } }
  | { type: "seek"; data: { position: number } }
  | { type: "ended" }
  | { type: "sourceError" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "playTrack"; data: { track: Track } }
  | { type: "setShuffle"; data: { mode: ShuffleMode } }
  | { type: "setRepeat"; data: { mode: RepeatMode } }
  | { type: "addToQueue"; data: { tracks: Track[]; position: "next" | "end" } }
  | { type: "toggleLike" }
  | { type: "fftData"; data: FftData }
  | { type: "error"; error: string }
  | { type: "deviceChanged"; data: { defaultDevice: string | null } };

export interface FftData {
  ldata: number[];
  rdata: number[];
}

export interface IpcResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PlayerApi {
  load: (source: string, options?: LoadOptions) => Promise<IpcResponse<LoadResult>>;
  play: () => Promise<IpcResponse>;
  pause: () => Promise<IpcResponse>;
  stop: () => Promise<IpcResponse>;
  seek: (positionMs: number) => Promise<IpcResponse>;
  setVolume: (volume: number) => Promise<IpcResponse>;
  setPauseOnDeviceSwitch: (enabled: boolean) => Promise<IpcResponse>;
  getVolume: () => Promise<IpcResponse<number>>;
  getStatus: () => Promise<IpcResponse<PlayerStatus>>;
  setFftEnabled: (enabled: boolean) => Promise<IpcResponse>;
  getFftData: () => Promise<IpcResponse<FftData>>;
  setFadeDuration: (ms: number) => Promise<IpcResponse>;
  getFadeDuration: () => Promise<IpcResponse<number>>;
  getCoverRaw: () => Promise<IpcResponse<string | null>>;
  readLyricFile: (filePath: string) => Promise<IpcResponse<string>>;
  reinit: () => Promise<IpcResponse>;
  setNormalizationEnabled: (enabled: boolean) => Promise<IpcResponse>;
  setEqualizerEnabled: (enabled: boolean) => Promise<IpcResponse>;
  setEqualizerBands: (gainsDb: number[]) => Promise<IpcResponse>;
  setPreampGain: (preampDb: number) => Promise<IpcResponse>;
  setSpeed: (speed: number) => Promise<IpcResponse>;
  setPitch: (semitones: number) => Promise<IpcResponse>;
  setPitchSync: (sync: boolean) => Promise<IpcResponse>;
  getOutputDevices: () => Promise<IpcResponse<AudioDevice[]>>;
  getDefaultDeviceName: () => Promise<IpcResponse<string | null>>;
  setOutputDevice: (deviceId: string | null, pauseBeforeSwitch?: boolean) => Promise<IpcResponse>;
  setExclusiveAudio: (enabled: boolean) => Promise<IpcResponse>;
  getSelectedDeviceName: () => Promise<IpcResponse<string | null>>;
  syncPlayMode: (repeatMode: string, shuffleMode: string) => void;
  syncLikeState: (liked: boolean) => void;
  dispatch: (type: string) => void;
  onEvent: (callback: (event: PlayerEvent) => void) => () => void;
}
