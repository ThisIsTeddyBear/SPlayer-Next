export const hasNonLatinLetter = (value: string): boolean =>
  [...value].some((char) => /\p{L}/u.test(char) && !/\p{Script=Latin}/u.test(char));

export const normalizeRomanization = (value: string): string =>
  value
    .normalize("NFC")
    .replace(/[\u2018\u2019`\u00b4]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const isRomanization = (value: string): boolean =>
  Boolean(value) && !hasNonLatinLetter(value);

const extractObjectRomanization = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;

  const sentences = (payload as { sentences?: unknown }).sentences;
  if (!Array.isArray(sentences)) return undefined;

  const reading = normalizeRomanization(
    sentences
      .map((sentence) => {
        if (!sentence || typeof sentence !== "object") return "";
        const srcTranslit = (sentence as { src_translit?: unknown }).src_translit;
        return typeof srcTranslit === "string" ? srcTranslit : "";
      })
      .filter(Boolean)
      .join(" "),
  );

  return isRomanization(reading) ? reading : undefined;
};

const extractLegacyRomanization = (payload: unknown): string | undefined => {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return undefined;

  const segments = (payload[0] as unknown[]).filter(
    (segment): segment is unknown[] => Array.isArray(segment),
  );
  if (!segments.length) return undefined;

  const primary = segments[0]?.[3];
  if (typeof primary === "string") {
    const reading = normalizeRomanization(primary);
    if (isRomanization(reading)) return reading;
  }

  const reading = normalizeRomanization(
    segments
      .map((segment) => (typeof segment[3] === "string" ? segment[3] : ""))
      .filter(Boolean)
      .join(" "),
  );

  return isRomanization(reading) ? reading : undefined;
};

export const extractGoogleRomanization = (payload: unknown): string | undefined =>
  extractObjectRomanization(payload) ?? extractLegacyRomanization(payload);
