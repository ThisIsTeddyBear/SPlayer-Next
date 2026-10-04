import type { RecognitionCandidate, RecognitionHistoryEntry } from "@shared/types/recognition";
import { getDb } from "./index";

export const MAX_RECOGNITION_HISTORY = 500;

interface RecognitionHistoryRow {
  candidate_json: string;
  recognized_at: number;
}

/**
 * 保存成功识别的歌曲，重复识别置顶，并在同一事务内裁掉最旧记录
 * @param candidate - 成功匹配的歌曲元数据
 */
export const recordRecognition = (candidate: RecognitionCandidate): void => {
  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO recognition_history (song_id, candidate_json, recognized_at)
       VALUES (?, ?, ?)
       ON CONFLICT(song_id) DO UPDATE SET
         candidate_json = excluded.candidate_json,
         recognized_at = excluded.recognized_at`,
    ).run(candidate.songId, JSON.stringify(candidate), Date.now());
    db.prepare(
      `DELETE FROM recognition_history WHERE song_id IN (
         SELECT song_id FROM recognition_history
         ORDER BY recognized_at DESC, rowid DESC LIMIT -1 OFFSET ?
       )`,
    ).run(MAX_RECOGNITION_HISTORY);
  })();
};

/**
 * 获取按最近识别时间倒序排列的歌曲历史
 * @param limit - 返回条数上限，首页只读取少量最近记录
 */
export const getRecognitionHistory = (limit = MAX_RECOGNITION_HISTORY): RecognitionHistoryEntry[] => {
  const rows = getDb()
    .prepare(
      `SELECT candidate_json, recognized_at FROM recognition_history
       ORDER BY recognized_at DESC, rowid DESC LIMIT ?`,
    )
    .all(limit) as RecognitionHistoryRow[];
  return rows.map((row) => ({
    candidate: JSON.parse(row.candidate_json) as RecognitionCandidate,
    recognizedAt: row.recognized_at,
  }));
};

/**
 * 删除单首歌曲的识别历史
 * @param songId - Shazam 歌曲 ID
 */
export const removeRecognitionHistory = (songId: string): void => {
  getDb().prepare("DELETE FROM recognition_history WHERE song_id = ?").run(songId);
};

/** 清空识别历史 */
export const clearRecognitionHistory = (): void => {
  getDb().prepare("DELETE FROM recognition_history").run();
};
