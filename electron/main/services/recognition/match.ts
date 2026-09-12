/** Shazam 匹配服务适配。 */

import { randomUUID } from "node:crypto";
import { app } from "electron";
import { fetchWithProxy } from "@main/utils/proxy";
import { recognitionLog } from "@main/utils/logger";

const MATCH_URL = "https://www.shazam.com/services/webrec/match_extensionv2";
const COUNT_URL = "https://amp.shazam.com/count/v2/web/track";
const installationId = randomUUID();

interface ShazamMatch {
  trackId?: string | number;
  attributes?: {
    title?: string;
    subtitle?: string;
    album?: string;
    releaseDate?: string;
    webUrl?: string;
    appleMusicUrl?: string;
    images?: { coverArtHq?: string; coverart?: string };
  };
}

interface MatchResponse {
  results?: { matches?: ShazamMatch[] };
}

export interface ShazamCandidate {
  songId: string;
  title: string;
  artists: string[];
  album?: string;
  releaseYear?: string;
  cover?: string;
  shazamUrl?: string;
  appleMusicUrl?: string;
  tagCount?: number;
}

type MatchResult = { ok: true; candidates: ShazamCandidate[] } | { ok: false; code: "network" };

/** 根据系统区域生成 Shazam 请求参数 */
const getLocale = (): { language: string; country: string } => {
  const locale = app.getLocale() || "en-US";
  const [language = "en", country = "US"] = locale.split("-");
  return { language, country: country.toUpperCase() };
};

/** 读取歌曲的 Shazam 识别次数；该副请求失败不影响匹配结果 */
const getTagCount = async (trackId: string): Promise<number | undefined> => {
  try {
    const response = await fetchWithProxy(`${COUNT_URL}/${encodeURIComponent(trackId)}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { total?: unknown };
    return typeof body.total === "number" ? body.total : undefined;
  } catch {
    return undefined;
  }
};

/**
 * 将 Shazam 二进制签名提交给匹配服务
 * @param signature - sigx 生成的二进制签名
 * @returns 第一个匹配候选，失败时返回网络错误
 */
export const matchAudio = async (signature: Uint8Array): Promise<MatchResult> => {
  try {
    const { language, country } = getLocale();
    const response = await fetchWithProxy(MATCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: Buffer.from(signature).toString("base64"),
        sessionId: randomUUID(),
        inid: installationId,
        lang: language,
        country,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as MatchResponse;
    if (!response.ok) {
      recognitionLog.error(`Shazam 匹配接口错误: HTTP ${response.status}`);
      return { ok: false, code: "network" };
    }
    const match = body.results?.matches?.[0];
    const trackId = match?.trackId;
    const title = match?.attributes?.title;
    if (!trackId || !title) return { ok: true, candidates: [] };
    const normalizedId = String(trackId);
    const releaseYear = match.attributes?.releaseDate?.match(/^\d{4}/)?.[0];
    return {
      ok: true,
      candidates: [
        {
          songId: normalizedId,
          title,
          artists: match.attributes?.subtitle ? [match.attributes.subtitle] : [],
          album: match.attributes?.album,
          releaseYear,
          cover: match.attributes?.images?.coverArtHq ?? match.attributes?.images?.coverart,
          shazamUrl: match.attributes?.webUrl,
          appleMusicUrl: match.attributes?.appleMusicUrl,
          tagCount: await getTagCount(normalizedId),
        },
      ],
    };
  } catch (error) {
    recognitionLog.error("Shazam 匹配请求失败:", error);
    return { ok: false, code: "network" };
  }
};
