import type { AudioQuality } from "@shared/types/player";

/** 音质等级 */
export type QualityLevel = "hi-res" | "lossless" | "hq" | "sq" | "lq";

/** 检测结果包含未知状态，未知状态不能作为请求音质 */
export type QualityClassification = QualityLevel | "unknown";

/** 无损编解码器 */
const LOSSLESS_CODECS = new Set([
  "flac",
  "alac",
  "ape",
  "wavpack",
  "wv",
  "tta",
  "tak",
  "als",
  "mp4als",
  "shorten",
  "shn",
  "mlp",
  "truehd",
  "wmalossless",
  "lpcm",
]);

/** 只识别线性整数或浮点 PCM，避免将 A-law、μ-law 等有损编码当作无损 */
const LINEAR_PCM_CODEC = /^pcm_(?:[su](?:8|16|24|32|64)|f(?:16|24|32|64))(?:le|be)?(?:_planar)?$/;

/** 仅对已知有损编码按码率分档，容器名不能证明其内部编码 */
const LOSSY_CODECS = new Set([
  "mp1",
  "mp2",
  "mp2float",
  "mp3",
  "mp3float",
  "aac",
  "aac_latm",
  "vorbis",
  "opus",
  "wmav1",
  "wmav2",
  "wmapro",
  "wmavoice",
  "ac3",
  "eac3",
  "dca",
  "amr_nb",
  "amr_wb",
  "speex",
  "mpc7",
  "mpc8",
  "musepack7",
  "musepack8",
  "atrac1",
  "atrac3",
  "atrac3p",
  "atrac9",
  "pcm_alaw",
  "pcm_mulaw",
]);

/**
 * 判断编解码器是否为无损格式
 * @param codec - 编解码器名称
 * @returns 是否为无损格式
 */
export const isLosslessCodec = (codec: string): boolean => {
  const name = codec.trim().toLowerCase();
  return LOSSLESS_CODECS.has(name) || LINEAR_PCM_CODEC.test(name);
};

/** 等级短码文案 */
export const QUALITY_LABELS: Record<QualityClassification, string> = {
  "hi-res": "Hi-Res",
  lossless: "Lossless",
  hq: "HQ",
  sq: "SQ",
  lq: "LQ",
  unknown: "Unknown",
};

/** 等级完整文案 */
const QUALITY_FULL_LABELS: Record<QualityClassification, string> = {
  "hi-res": "Hi-Res",
  lossless: "Lossless",
  hq: "High Quality",
  sq: "Standard Quality",
  lq: "Low Quality",
  unknown: "Unknown Quality",
};

/**
 * 根据源编码分档；线性音频按 JEITA 的采样率和位深边界识别高解析度
 * @param quality - 音源信息，不足以判断时保留未知状态
 * @returns 检测到的音质等级或未知状态
 */
export const getQualityLevel = (quality: AudioQuality | undefined): QualityClassification => {
  if (!quality?.codec) return "unknown";
  if (isLosslessCodec(quality.codec)) {
    const { sampleRate, bitsPerSample } = quality;
    if (
      Number.isFinite(sampleRate) &&
      Number.isFinite(bitsPerSample) &&
      sampleRate >= 44100 &&
      bitsPerSample >= 16 &&
      (sampleRate > 48000 || bitsPerSample > 16)
    ) {
      return "hi-res";
    }
    return "lossless";
  }
  if (
    !LOSSY_CODECS.has(quality.codec.trim().toLowerCase()) ||
    !Number.isFinite(quality.bitRate) ||
    quality.bitRate <= 0
  ) {
    return "unknown";
  }
  const kbps = quality.bitRate / 1000;
  if (kbps >= 320) return "hq";
  if (kbps >= 192) return "sq";
  return "lq";
};

/**
 * 取音质等级短码文案
 * @param quality - 音源信息
 * @returns 等级短码或未知文案
 */
export const getQualityLabel = (quality: AudioQuality | undefined): string =>
  QUALITY_LABELS[getQualityLevel(quality)];

/**
 * 取音质等级完整文案
 * @param quality - 音源信息
 * @returns 等级完整文案或未知文案
 */
export const getQualityFullLabel = (quality: AudioQuality | undefined): string =>
  QUALITY_FULL_LABELS[getQualityLevel(quality)];

/**
 * 生成标签提示中的源音频参数，缺失字段不冒充有效数值
 * @param quality - 音源信息
 * @returns 编码、位深、采样率和码率摘要
 */
export const getQualityDescription = (quality: AudioQuality | undefined): string => {
  if (!quality) return QUALITY_FULL_LABELS.unknown;
  const parts: string[] = [];
  const codec = quality.codec.trim();
  if (codec && codec.toLowerCase() !== "unknown") parts.push(codec.toUpperCase());
  if (Number.isFinite(quality.bitsPerSample) && quality.bitsPerSample > 0) {
    parts.push(`${quality.bitsPerSample}-bit`);
  }
  if (Number.isFinite(quality.sampleRate) && quality.sampleRate > 0) {
    parts.push(`${quality.sampleRate / 1000} kHz`);
  }
  if (Number.isFinite(quality.bitRate) && quality.bitRate > 0) {
    parts.push(`${Math.round(quality.bitRate / 1000)} kbps`);
  }
  return parts.length > 0 ? parts.join(" · ") : QUALITY_FULL_LABELS.unknown;
};

/** 是否为无损级别（hi-res 或 lossless） */
export const isLosslessQuality = (quality: AudioQuality | undefined): boolean => {
  const level = getQualityLevel(quality);
  return level === "hi-res" || level === "lossless";
};
