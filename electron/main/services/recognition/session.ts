/** Shazam 听歌识曲会话：驱动系统回环采集、3 / 6 / 9 / 12 秒签名与匹配。 */

import { loadNativeModule } from "@main/utils/nativeLoader";
import { broadcast } from "@main/utils/broadcast";
import { recognitionLog } from "@main/utils/logger";
import type { JsCaptureEvent } from "@splayer/audio-capture";
import { matchAudio } from "./match";
import { createSignature, isSignatureAvailable } from "./signature";
import type {
  RecognitionCandidate,
  RecognitionConfig,
  RecognitionErrorCode,
  RecognitionEvent,
} from "@shared/types/recognition";

type AudioCaptureModule = typeof import("@splayer/audio-capture");
type CaptureSessionInstance = InstanceType<AudioCaptureModule["AudioCaptureSession"]>;

const SILENCE_RMS_THRESHOLD = 0.005;

let audioCapture: AudioCaptureModule | null = null;
let activeSession: CaptureSessionInstance | null = null;
let sessionToken = 0;
let pendingMatches = 0;
let captureFinished = false;

/** 惰性加载 audio-capture 原生模块 */
const getAudioCapture = (): AudioCaptureModule | null => {
  if (audioCapture) return audioCapture;
  audioCapture = loadNativeModule<AudioCaptureModule>("audio-capture.node", "audio-capture");
  return audioCapture;
};

/** 推送识别事件；level 属于高频事件，仅在窗口可见时广播 */
const emit = (event: RecognitionEvent): void => {
  broadcast("recognition:event", event, event.phase === "capturing");
};

/** 将原生错误码映射为共享错误码 */
const mapErrorCode = (code?: string): RecognitionErrorCode => {
  switch (code) {
    case "unsupported":
      return "unsupported";
    case "no-device":
      return "no-device";
    case "permission-denied":
      return "permission-denied";
    case "capture-failed":
      return "capture-failed";
    default:
      return "unknown";
  }
};

/** 计算 PCM 的 RMS 音量 */
const rms = (pcm: Float32Array): number => {
  let energy = 0;
  for (let index = 0; index < pcm.length; index++) {
    energy += pcm[index] * pcm[index];
  }
  return Math.sqrt(energy / Math.max(1, pcm.length));
};

/** 结束会话的内部状态 */
const finishSession = (): void => {
  activeSession = null;
  pendingMatches = 0;
  captureFinished = false;
};

const emitError = (code: RecognitionErrorCode, message: string): void => {
  recognitionLog.warn(`识别失败 [${code}]: ${message}`);
  emit({ phase: "error", error: { code, message } });
  activeSession?.cancel();
  finishSession();
};

/** 当采集与所有匹配尝试结束后输出未匹配结果 */
const finishWithoutMatch = (token: number): void => {
  if (token !== sessionToken || !captureFinished || pendingMatches !== 0) return;
  emit({ phase: "done", candidates: [] });
  finishSession();
};

/**
 * 开始一次系统音频识别
 * @param config - 采集时长
 */
export const startRecognition = (config: RecognitionConfig): void => {
  cancelRecognition();
  const mod = getAudioCapture();
  if (!mod || !mod.AudioCaptureSession) {
    emitError("unsupported", "当前环境不支持本机系统音频采集");
    return;
  }
  const instance = new mod.AudioCaptureSession();
  if (!instance.isSupported()) {
    emitError("unsupported", "当前平台不支持本机系统音频采集");
    return;
  }
  if (!isSignatureAvailable()) {
    emitError("signature-unavailable", "Shazam 音频签名库不可用");
    return;
  }

  activeSession = instance;
  pendingMatches = 0;
  captureFinished = false;
  const token = ++sessionToken;
  emit({ phase: "capturing" });
  try {
    instance.start({ source: "system", durationMs: config.durationMs }, (event: JsCaptureEvent) => {
      if (token !== sessionToken || activeSession !== instance) return;
      void handleCaptureEvent(event, token);
    });
  } catch (error) {
    emitError("capture-failed", error instanceof Error ? error.message : String(error));
  }
};

/** 处理原生采集事件 */
const handleCaptureEvent = async (event: JsCaptureEvent, token: number): Promise<void> => {
  if (event.eventType === "level") {
    emit({ phase: "capturing", level: event.level ?? 0 });
    return;
  }
  if (event.eventType === "error") {
    emitError(mapErrorCode(event.errorCode), event.error ?? "未知采集错误");
    return;
  }
  const snapshot = event as JsCaptureEvent & { sampleRate?: number };
  if (event.eventType === "snapshot" && event.data && snapshot.sampleRate) {
    const pcm = new Float32Array(event.data.buffer, event.data.byteOffset, event.data.length / 4);
    pendingMatches++;
    void recognizeSnapshot(new Float32Array(pcm), snapshot.sampleRate, token);
    return;
  }
  if (event.eventType === "done") {
    captureFinished = true;
    finishWithoutMatch(token);
  }
};

/**
 * 为当前累积采集片段生成签名并匹配
 * @param pcm - 累积的单声道 f32 PCM
 * @param sampleRate - PCM 采样率
 * @param token - 当前会话令牌
 */
const recognizeSnapshot = async (
  pcm: Float32Array,
  sampleRate: number,
  token: number,
): Promise<void> => {
  try {
    if (rms(pcm) < SILENCE_RMS_THRESHOLD) return;
    emit({ phase: "fingerprinting" });
    const signature = await createSignature(pcm, sampleRate);
    if (token !== sessionToken) return;
    if (!signature.ok) {
      emitError("signature-unavailable", signature.error);
      return;
    }
    emit({ phase: "matching" });
    const match = await matchAudio(signature.signature);
    if (token !== sessionToken) return;
    if (!match.ok) {
      emitError("network", "Shazam 匹配服务不可用");
      return;
    }
    if (match.candidates.length === 0) return;
    const candidates: RecognitionCandidate[] = match.candidates;
    recognitionLog.info(`Shazam 识别完成，候选 ${candidates.length} 个`);
    sessionToken++;
    activeSession?.cancel();
    emit({ phase: "done", candidates });
    finishSession();
  } finally {
    if (token === sessionToken) {
      pendingMatches = Math.max(0, pendingMatches - 1);
      finishWithoutMatch(token);
    }
  }
};

/** 取消当前识别 */
export const cancelRecognition = (): void => {
  sessionToken++;
  activeSession?.cancel();
  finishSession();
};

/** 当前平台是否支持系统音频采集 */
export const isRecognitionSupported = (): boolean => {
  const mod = getAudioCapture();
  if (!mod || !mod.AudioCaptureSession) return false;
  return new mod.AudioCaptureSession().isSupported();
};
