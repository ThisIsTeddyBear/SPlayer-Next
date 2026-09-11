import { getDb } from "./index";

const MAX_CACHE_ENTRIES = 50_000;

/** 获取已缓存的歌词罗马音。 */
export const getCachedRomanizations = (lines: string[]): Record<string, string> => {
  const result: Record<string, string> = {};
  const query = getDb().prepare(
    "SELECT romanization FROM lyric_romanization_cache WHERE lyric_text = ?",
  );
  const touch = getDb().prepare(
    "UPDATE lyric_romanization_cache SET last_used_at = ? WHERE lyric_text = ?",
  );
  const now = Date.now();

  for (const line of lines) {
    const row = query.get(line) as { romanization: string } | undefined;
    if (!row) continue;
    result[line] = row.romanization;
    touch.run(now, line);
  }

  return result;
};

/** 保存 Google Translate 成功生成的歌词罗马音。 */
export const setCachedRomanizations = (readings: Record<string, string>): void => {
  const entries = Object.entries(readings);
  if (entries.length === 0) return;

  const database = getDb();
  const upsert = database.prepare(
    `INSERT INTO lyric_romanization_cache (lyric_text, romanization, cached_at, last_used_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(lyric_text) DO UPDATE SET
       romanization = excluded.romanization,
       cached_at = excluded.cached_at,
       last_used_at = excluded.last_used_at`,
  );
  const now = Date.now();

  database.transaction(() => {
    for (const [line, romanization] of entries) upsert.run(line, romanization, now, now);
    database
      .prepare(
        `DELETE FROM lyric_romanization_cache
         WHERE lyric_text IN (
           SELECT lyric_text FROM lyric_romanization_cache
           ORDER BY last_used_at ASC
           LIMIT MAX((SELECT COUNT(*) FROM lyric_romanization_cache) - ?, 0)
         )`,
      )
      .run(MAX_CACHE_ENTRIES);
  })();
};

/** 清空全部歌词罗马音缓存。 */
export const clearLyricRomanizationCache = (): void => {
  getDb().prepare("DELETE FROM lyric_romanization_cache").run();
};
