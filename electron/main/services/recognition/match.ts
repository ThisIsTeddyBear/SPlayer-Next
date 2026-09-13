/** Shazam 匹配服务适配。 */

import { randomUUID } from "node:crypto";
import { app } from "electron";
import { fetchWithProxy } from "@main/utils/proxy";
import { recognitionLog } from "@main/utils/logger";

const MATCH_URL = "https://www.shazam.com/services/webrec/match_extensionv2";
const COUNT_URL = "https://amp.shazam.com/count/v2/web/track";
const TRACK_URL = "https://www.shazam.com/song";
const installationId = randomUUID();

interface ShazamArtist {
  name?: string;
}

interface ShazamAttributes {
  title?: string;
  name?: string;
  subtitle?: string;
  artist?: string;
  artistName?: string;
  artistNames?: string[];
  artists?: Array<string | ShazamArtist>;
  album?: string;
  albumName?: string;
  releaseDate?: string;
  releaseYear?: string | number;
  webUrl?: string;
  appleMusicUrl?: string;
  images?: { coverArtHq?: string; coverart?: string };
}

interface ShazamMatch extends ShazamAttributes {
  trackId?: string | number;
  attributes?: ShazamAttributes;
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

interface ShazamTrackPage {
  "@id"?: string;
  url?: string;
  byArtist?: string;
  creator?: { name?: string };
  inAlbum?: { name?: string };
  datePublished?: string;
}

interface ShazamTrackDetails {
  artist?: string;
  album?: string;
  releaseYear?: string;
}

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

/** 读取 Shazam 曲目页中同一首歌的补充元数据 */
const getTrackDetails = async (trackId: string, webUrl?: string): Promise<ShazamTrackDetails> => {
  const url = webUrl?.startsWith("https://www.shazam.com/")
    ? webUrl
    : `${TRACK_URL}/${encodeURIComponent(trackId)}`;
  try {
    const response = await fetchWithProxy(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return {};
    const html = await response.text();
    const jsonLd = html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
    )?.[1];
    if (!jsonLd) return {};
    const page = JSON.parse(jsonLd) as ShazamTrackPage;
    const canonicalUrl = page["@id"] ?? page.url;
    if (!canonicalUrl?.includes(`/${trackId}/`)) return {};
    return {
      artist: page.byArtist ?? page.creator?.name,
      album: page.inAlbum?.name,
      releaseYear: page.datePublished?.match(/^\d{4}/)?.[0],
    };
  } catch {
    return {};
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
    const attributes = match?.attributes ?? match;
    const title = attributes?.title ?? attributes?.name;
    if (!trackId || !title) return { ok: true, candidates: [] };
    const normalizedId = String(trackId);
    const artistNames = Array.isArray(attributes?.artistNames)
      ? attributes.artistNames.filter((artist) => artist.trim())
      : [];
    const artists = Array.isArray(attributes?.artists)
      ? attributes.artists
          .map((artist) => (typeof artist === "string" ? artist : artist.name))
          .filter((artist): artist is string => Boolean(artist?.trim()))
      : [];
    const fallbackArtist = attributes?.subtitle ?? attributes?.artistName ?? attributes?.artist;
    const releaseYear = String(attributes?.releaseDate ?? attributes?.releaseYear ?? "").match(
      /^\d{4}/,
    )?.[0];
    const resolvedArtists = artistNames.length
      ? artistNames
      : artists.length
        ? artists
        : fallbackArtist
          ? [fallbackArtist]
          : [];
    const resolvedAlbum = attributes?.album ?? attributes?.albumName;
    const [tagCount, details] = await Promise.all([
      getTagCount(normalizedId),
      resolvedArtists.length && resolvedAlbum && releaseYear
        ? Promise.resolve<ShazamTrackDetails>({})
        : getTrackDetails(normalizedId, attributes?.webUrl),
    ]);
    return {
      ok: true,
      candidates: [
        {
          songId: normalizedId,
          title,
          artists: resolvedArtists.length
            ? resolvedArtists
            : details.artist
              ? [details.artist]
              : [],
          album: resolvedAlbum ?? details.album,
          releaseYear: releaseYear ?? details.releaseYear,
          cover: attributes?.images?.coverArtHq ?? attributes?.images?.coverart,
          shazamUrl: attributes?.webUrl,
          appleMusicUrl: attributes?.appleMusicUrl,
          tagCount,
        },
      ],
    };
  } catch (error) {
    recognitionLog.error("Shazam 匹配请求失败:", error);
    return { ok: false, code: "network" };
  }
};
