/**
 * 听歌识曲（Recognition）共享类型
 */

/** 识别流程阶段 */
export type RecognitionPhase =
  "idle" | "capturing" | "fingerprinting" | "matching" | "done" | "error";

/** 识别错误码 */
export type RecognitionErrorCode =
  | "unsupported"
  | "no-device"
  | "permission-denied"
  | "capture-failed"
  | "silent-input"
  | "network"
  | "signature-unavailable"
  | "unknown";

/** 识别候选 */
export interface RecognitionCandidate {
  /** Shazam 歌曲 id */
  songId: string;
  title: string;
  artists: string[];
  album?: string;
  cover?: string;
  shazamUrl?: string;
  appleMusicUrl?: string;
  tagCount?: number;
}

/** 识别错误 */
export interface RecognitionError {
  code: RecognitionErrorCode;
  message: string;
}

/** 广播给渲染进程的识别事件 */
export interface RecognitionEvent {
  phase: RecognitionPhase;
  /** capturing 阶段的音量（RMS，0-1） */
  level?: number;
  /** done 阶段的候选列表 */
  candidates?: RecognitionCandidate[];
  /** error 阶段的错误信息 */
  error?: RecognitionError;
}

/** 启动识别会话的配置 */
export interface RecognitionConfig {
  /** 最大采集时长（毫秒） */
  durationMs: number;
}

/** 预加载脚本暴露的识别 API */
export interface RecognitionApi {
  isSupported: () => Promise<boolean>;
  start: (config: RecognitionConfig) => Promise<unknown>;
  cancel: () => Promise<unknown>;
  onEvent: (callback: (event: RecognitionEvent) => void) => () => void;
}
