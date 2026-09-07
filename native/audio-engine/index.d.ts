export declare class AudioPlayer {
  constructor()
  /**
   *
   */
  reinitOutput(): Promise<void>
  setCoverCacheDir(dir: string): void
  onEvent(callback: (event: JsPlayerEvent) => void): void
  supportsDeviceWatcher(): boolean
  /**
   */
  onDeviceChange(callback: (defaultChanged: boolean) => void): void
  stopDeviceWatcher(): void
  /**
   *
   */
  load(source: string, autoPlay?: boolean): Promise<JsMusicMetadata>
  play(): Promise<void>
  pause(): void
  pauseImmediately(): void
  stop(): void
  /**
   *
   */
  seek(position: number): Promise<void>
  setVolume(volume: number): number
  getVolume(): number
  setFadeDuration(durationMs: number): void
  getFadeDuration(): number
  getPosition(): number
  getDuration(): number
  getStatus(): JsPlayerStatus
  setFftEnabled(enabled: boolean): void
  getFftEnabled(): boolean
  setNormalizationEnabled(enabled: boolean): void
  getNormalizationEnabled(): boolean
  setEqualizerEnabled(enabled: boolean): void
  getEqualizerEnabled(): boolean
  setEqualizerBands(gainsDb: Array<number>): void
  getEqualizerBands(): Array<number>
  setPreampGain(preampDb: number): void
  getPreampGain(): number
  getFftData(): JsFftData
  /**
   */
  getCoverRaw(): Buffer | null
  getOutputDevices(): Array<JsAudioDevice>
  getDefaultDeviceName(): string | null
  getDefaultDeviceId(): string | null
  setOutputDevice(deviceId?: string | undefined | null): Promise<void>
  setExclusiveAudio(enabled: boolean): Promise<void>
  /**
   *
   */
  getSelectedDeviceName(): string | null
  setSpeed(speed: number): void
  setPitch(semitones: number): void
  setPitchSync(sync: boolean): void
  getSpeed(): number
  getPitch(): number
  getPitchSync(): boolean
}

export declare function cancelScan(): void

export interface FileRecord {
  path: string
  mtime: number
  size: number
}

export declare function initLogger(logDir: string, isDev: boolean): void

export interface JsAudioDevice {
  id: string
  name: string
  isDefault: boolean
}

export interface JsExternalLyric {
  format: string
  path: string
}

export interface JsFftData {
  ldata: Array<number>
  rdata: Array<number>
}

export interface JsMusicMetadata {
  title?: string
  artist?: string
  album?: string
  comment?: string
  duration: number
  sampleRate: number
  channels: number
  originalSampleRate: number
  bitsPerSample: number
  bitRate: number
  codec: string
  embeddedLyric?: string
  externalLyrics: Array<JsExternalLyric>
  cover?: string
}

export interface JsPlayerEvent {
  type: string
  state?: string
  position?: number
  duration?: number
  fftData?: JsFftData
}

export interface JsPlayerStatus {
  state: string
  position: number
  duration: number
  volume: number
  isFinished: boolean
  bitPerfectActive: boolean
}

export interface JsScanEvent {
  /** "progress" | "done" */
  eventType: string
  scanned: number
  total: number
  current?: string
  tracks?: Array<JsScannedTrack>
  removedPaths?: Array<string>
  cueFiles?: Array<string>
  unavailableDirs?: Array<string>
}

export interface JsScannedTrack {
  path: string
  title?: string
  artist?: string
  album?: string
  track?: number
  duration: number
  codec: string
  sampleRate: number
  bitRate: number
  channels: number
  bitsPerSample: number
  cover?: string
  fileSize: number
  mtime: number
  ctime: number
}

/**
 */
export interface JsTagWriteRequest {
  path: string
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  year?: number
  genre?: string
  trackNumber?: number
  discNumber?: number
  lyrics?: string
  cover?: Buffer
}

export interface JsTagWriteResult {
  path: string
  success: boolean
  error?: string
  track?: JsScannedTrack
}

export interface JsTrackTags {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  year?: number
  genre?: string
  trackNumber?: number
  discNumber?: number
  lyrics?: string
  hasCover: boolean
}

/**
 */
export declare function makeImageThumbnail(data: Buffer, maxSize: number): Promise<Buffer>

export declare function readTrackTags(path: string): Promise<JsTrackTags>

/**
 *
 */
export declare function scanDirs(dirs: Array<string>, callback: (event: JsScanEvent) => void, coverCacheDir?: string | undefined | null, incrementalData?: Array<FileRecord> | undefined | null): void

/**
 */
export declare function writeTrackTags(requests: Array<JsTagWriteRequest>, coverCacheDir?: string | undefined | null): Promise<Array<JsTagWriteResult>>
