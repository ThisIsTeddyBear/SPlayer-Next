export const needsRomanization = (value: string): boolean =>
  [...value].some((char) => /\p{L}/u.test(char) && !/\p{Script=Latin}/u.test(char));

/**
 * 将 Google 的学术转写转换为便于直接朗读的 ASCII 文本
 * @param reading - Google 返回的转写
 * @param sourceText - 原始歌词，用于识别 Indic 文字
 * @returns 易读的转写
 */
export const simplifyGoogleRomanization = (reading: string, sourceText = ""): string => {
  let value = reading.normalize("NFKD");
  value = value
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/[‐‑–—]/g, "-")
    .replace(/\s*'\s*/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (/[\u0900-\u0d7f]/u.test(sourceText)) {
    value = value.replace(/c/g, "ch");
    if (/[’']\s*ਚ/u.test(sourceText)) value = value.replace(/'cha\b/gi, "'ch");
  }

  return value;
};

/**
 * 从 Google `dt=rm` 响应中提取并简化完整行转写
 * @param payload - Google 响应
 * @param sourceText - 原始歌词
 * @returns 易读的转写；无效响应时返回 undefined
 */
export const extractGoogleRomanization = (
  payload: unknown,
  sourceText = "",
): string | undefined => {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return undefined;

  const segments = payload[0] as unknown[];
  const reading = segments
    .map((segment) => (Array.isArray(segment) ? segment[3] : ""))
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join("");

  const simplified = simplifyGoogleRomanization(reading, sourceText);
  return simplified && !needsRomanization(simplified) ? simplified : undefined;
};
