export const needsRomanization = (value: string): boolean =>
  [...value].some((char) => /\p{L}/u.test(char) && !/\p{Script=Latin}/u.test(char));

export const extractGoogleRomanization = (payload: unknown): string | undefined => {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return undefined;

  const segments = payload[0] as unknown[];
  const firstSegment = segments.find((segment): segment is unknown[] => Array.isArray(segment));
  const value = firstSegment?.[3];
  if (typeof value !== "string") return undefined;

  const reading = value.replace(/\s+/g, " ").trim();
  return reading && !needsRomanization(reading) ? reading : undefined;
};
