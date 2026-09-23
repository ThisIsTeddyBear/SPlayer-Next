import type { Track } from "@shared/types/player";

/** 默认跳过关键词列表 */
export const DEFAULT_SKIP_TRACK_KEYWORDS: readonly string[] = [
  "DJ",
  "抖音",
  "0.9",
  "0.8",
  "网红",
  "车载",
  "热歌",
  "慢摇",
];

/**
 * 检查歌曲是否命中跳过关键词
 * @param track - 歌曲信息
 * @param keywords - 跳过关键词列表
 * @returns 是否应跳过
 */
export const shouldSkipKeywordTrack = (
  track: Track,
  keywords: readonly string[] = DEFAULT_SKIP_TRACK_KEYWORDS,
): boolean => {
  const fullText = `${track.title} ${track.artists.map((artist) => artist.name).join(" ")}`;
  return keywords.some((keyword) => {
    const value = keyword.trim();
    return value !== "" && fullText.toLocaleLowerCase().includes(value.toLocaleLowerCase());
  });
};
