/** Shazam 匹配服务适配。 */

import { randomUUID } from "node:crypto";
import { app } from "electron";
import { fetchWithProxy } from "@main/utils/proxy";
import { recognitionLog } from "@main/utils/logger";

const MATCH_URL = "https://www.shazam.com/services/webrec/match_extensionv2";
const installationId = randomUUID();

interface ShazamAttributes {
  title?: string;
  name?: string;
  primaryArtist?: string;
  subtitle?: string;
  artist?: string;
  artistName?: string;
  webUrl?: string;
  url?: string;
  trackUrl?: string;
  appleMusicUrl?: string;
  streaming?: { deeplink?: string };
  images?: { coverArtHq?: string; coverart?: string };
}

interface ShazamMatch extends ShazamAttributes {
  trackId?: string | number;
  tagCount?: number;
  attributes?: ShazamAttributes;
}

interface MatchResponse {
  results?: { matches?: ShazamMatch[] };
}

export interface ShazamCandidate {
  songId: string;
  title: string;
  artists: string[];
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
    const attributes = match?.attributes ?? match;
    const title = attributes?.title ?? attributes?.name;
    if (!trackId || !title) return { ok: true, candidates: [] };
    const primaryArtist =
      attributes?.primaryArtist ??
      attributes?.subtitle ??
      attributes?.artistName ??
      attributes?.artist;
    const appleMusicUrl = attributes?.appleMusicUrl ?? attributes?.streaming?.deeplink;
    recognitionLog.info(
      `Shazam metadata: track=${trackId}, artist=${Boolean(primaryArtist)}, apple=${Boolean(appleMusicUrl)}`,
    );
    return {
      ok: true,
      candidates: [
        {
          songId: String(trackId),
          title,
          artists: primaryArtist ? [primaryArtist] : [],
          cover: attributes?.images?.coverArtHq ?? attributes?.images?.coverart,
          shazamUrl: attributes?.webUrl ?? attributes?.trackUrl ?? attributes?.url,
          appleMusicUrl,
          tagCount: match.tagCount,
        },
      ],
    };
  } catch (error) {
    recognitionLog.error("Shazam 匹配请求失败:", error);
    return { ok: false, code: "network" };
  }
};
