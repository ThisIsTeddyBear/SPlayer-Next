/** Format a file size in bytes as a readable string. */
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

/**
 * Format a number compactly for the requested locale.
 * @param value - Source number; non-finite values return an empty string.
 * @param locale - BCP-47 locale, such as "en-US".
 */
export const formatCompact = (value: number | undefined | null, locale: string): string => {
  if (value == null || !Number.isFinite(value)) return "";
  try {
    return new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(value);
  }
};
