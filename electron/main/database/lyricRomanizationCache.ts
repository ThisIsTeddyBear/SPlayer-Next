import { getDb } from "./index";

const CACHE_LIMIT = 5_000;

/**
 * 读取已缓存的 Google 罗马音，并刷新最近使用时间
 * @param sourceText - 原始歌词行
 * @returns 已缓存的易读罗马音；未命中时返回 undefined
 */
export const getCachedRomanization = (sourceText: string): string | undefined => {
  const row = getDb()
    .prepare("SELECT reading FROM lyric_romanization_cache WHERE source_text = ?")
    .get(sourceText) as { reading: string } | undefined;
  if (!row) return undefined;

  getDb()
    .prepare("UPDATE lyric_romanization_cache SET last_used_at = ? WHERE source_text = ?")
    .run(Date.now(), sourceText);
  return row.reading;
};

/**
 * 保存成功生成的 Google 罗马音，并限制数据库缓存大小
 * @param sourceText - 原始歌词行
 * @param reading - 易读罗马音
 */
export const setCachedRomanization = (sourceText: string, reading: string): void => {
  const now = Date.now();
  const db = getDb();
  db.prepare(
    `INSERT INTO lyric_romanization_cache (source_text, reading, cached_at, last_used_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(source_text) DO UPDATE SET
       reading = excluded.reading,
       cached_at = excluded.cached_at,
       last_used_at = excluded.last_used_at`,
  ).run(sourceText, reading, now, now);

  db.prepare(
    `DELETE FROM lyric_romanization_cache
     WHERE source_text IN (
       SELECT source_text FROM lyric_romanization_cache
       ORDER BY last_used_at ASC
       LIMIT MAX((SELECT COUNT(*) FROM lyric_romanization_cache) - ?, 0)
     )`,
  ).run(CACHE_LIMIT);
};

/** 清空与歌词内容缓存关联的罗马音结果 */
export const clearLyricRomanizationCache = (): void => {
  getDb().prepare("DELETE FROM lyric_romanization_cache").run();
};
