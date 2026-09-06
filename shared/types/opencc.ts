/**
 * OpenCC Chinese text conversion options.
 *
 * - none: No conversion.
 * - s2t: Simplified Chinese to Traditional Chinese.
 * - t2s: Traditional Chinese to Simplified Chinese.
 * - s2tw: Simplified Chinese to Taiwan Traditional Chinese.
 * - tw2s: Taiwan Traditional Chinese to Simplified Chinese.
 * - s2hk: Simplified Chinese to Hong Kong Traditional Chinese.
 * - hk2s: Hong Kong Traditional Chinese to Simplified Chinese.
 * - s2twp: Simplified Chinese to Taiwan Traditional Chinese, including common terms.
 * - tw2sp: Taiwan Traditional Chinese to Simplified Chinese, including common terms.
 * - t2tw: OpenCC Traditional Chinese to Taiwan Traditional Chinese.
 * - tw2t: Taiwan Traditional Chinese to OpenCC Traditional Chinese.
 * - t2hk: OpenCC Traditional Chinese to Hong Kong Traditional Chinese.
 * - hk2t: Hong Kong Traditional Chinese to OpenCC Traditional Chinese.
 * - jp2t: Japanese Shinjitai to Traditional Chinese.
 * - t2jp: Traditional Chinese to Japanese Shinjitai.
 */
export type CjkTransformMode =
  | "none"
  | "s2t"
  | "t2s"
  | "s2tw"
  | "tw2s"
  | "s2hk"
  | "hk2s"
  | "s2twp"
  | "tw2sp"
  | "t2tw"
  | "tw2t"
  | "t2hk"
  | "hk2t"
  | "jp2t"
  | "t2jp";

export interface OpenccApi {
  /** Convert one text value. */
  convert: (text: string, config: CjkTransformMode) => Promise<string>;
  /** Convert a list of text values. */
  convertBatch: (texts: string[], config: CjkTransformMode) => Promise<string[]>;
}
