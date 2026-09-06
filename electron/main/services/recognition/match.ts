/**
 * 听歌识曲结果适配
 */

import { randomBytes } from "node:crypto";
import { fetchWithProxy } from "@main/utils/proxy";
import { recognitionLog } from "@main/utils/logger";

const MATCH_URL = "https://interface.music.163.com/api/music/audio/match";

/** 匹配接口返回的原始歌曲信息 */
export interface MatchedSong {
  id: number;
  name: string;
  artists: { name: string }[];
  album?: { name: string; picUrl?: string };
}

interface MatchResponse {
  code?: number;
  data?: {
    result?: { startTime?: number; song?: MatchedSong }[];
  };
}

type MatchResult =
  { ok: true; songs: { song: MatchedSong; startTime?: number }[] } | { ok: false; code: "network" };

/**
 * 将音频指纹交给网易云模块匹配
 * @param fingerprint - AFP 生成的指纹字符串
 * @param durationSec - 音频片段时长，单位为秒
 * @returns 最多三个候选，失败时返回网络错误
 */
export const matchAudio = async (
  fingerprint: string,
  durationSec: number,
): Promise<MatchResult> => {
  try {
    const params = new URLSearchParams({
      sessionId: randomBytes(8).toString("hex"),
      algorithmCode: "shazam_v2",
      duration: String(durationSec),
      rawdata: fingerprint,
      times: "1",
      decrypt: "1",
    });
    const response = await fetchWithProxy(`${MATCH_URL}?${params}`, {
      headers: {
        Accept: "application/json",
        Referer: "https://music.163.com/",
        "User-Agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await response.json()) as MatchResponse;
    if (!response.ok || body.code !== 200) {
      recognitionLog.error(`音频匹配接口错误: HTTP ${response.status}, code=${body.code}`);
      return { ok: false, code: "network" };
    }
    const songs = (body.data?.result ?? [])
      .filter((item): item is { startTime?: number; song: MatchedSong } => !!item.song)
      .slice(0, 3)
      .map((item) => ({ song: item.song, startTime: item.startTime }));
    return { ok: true, songs };
  } catch (error) {
    recognitionLog.error("音频匹配请求失败:", error);
    return { ok: false, code: "network" };
  }
};
