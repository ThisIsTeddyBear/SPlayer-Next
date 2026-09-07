import { createHash } from "node:crypto";

/**
 */

const API_URL = "https://ws.audioscrobbler.com/2.0/";

const LASTFM_API_KEY = "79fa364d995b13c2b21bdd65b7e7054f";
const LASTFM_API_SECRET = "6d2ecc338d0a0802669e529f14b8034f";

interface LastfmResponse {
  error?: number;
  message?: string;
  token?: string;
  session?: { name: string; key: string };
}

/**
 */
export const getAuthUrl = (token: string): string =>
  `https://www.last.fm/api/auth/?api_key=${LASTFM_API_KEY}&token=${token}`;

/**
 */
const sign = (params: Record<string, string>): string => {
  const base = Object.keys(params)
    .filter((key) => key !== "format")
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");
  return createHash("md5")
    .update(base + LASTFM_API_SECRET, "utf-8")
    .digest("hex");
};

/**
 * @returns URLSearchParams
 */
const buildParams = (
  method: string,
  params: Record<string, string>,
  signed: boolean,
): URLSearchParams => {
  const base: Record<string, string> = { method, api_key: LASTFM_API_KEY, ...params };
  if (signed) base.api_sig = sign(base);
  base.format = "json";
  return new URLSearchParams(base);
};

const get = async (
  method: string,
  params: Record<string, string> = {},
  signed = false,
): Promise<LastfmResponse> => {
  const qs = buildParams(method, params, signed);
  const res = await fetch(`${API_URL}?${qs.toString()}`);
  const data = (await res.json()) as LastfmResponse;
  if (data.error) throw new Error(`Last.fm ${data.error}: ${data.message ?? "未知错误"}`);
  return data;
};

const post = async (
  method: string,
  params: Record<string, string> = {},
): Promise<LastfmResponse> => {
  const body = buildParams(method, params, true);
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json()) as LastfmResponse;
  if (data.error) throw new Error(`Last.fm ${data.error}: ${data.message ?? "未知错误"}`);
  return data;
};

export interface LastfmSession {
  name: string;
  key: string;
}

/**
 */
export const getToken = async (): Promise<string> => {
  const data = await get("auth.getToken", {}, true);
  if (!data.token) throw new Error("无法获取 Last.fm token");
  return data.token;
};

/**
 */
export const getSession = async (token: string): Promise<LastfmSession> => {
  const data = await get("auth.getSession", { token }, true);
  if (!data.session?.key) throw new Error("尚未授权");
  return { name: data.session.name, key: data.session.key };
};

/**
 */
export const updateNowPlaying = async (
  sessionKey: string,
  track: string,
  artist: string,
  album?: string,
  durationSec?: number,
): Promise<void> => {
  const params: Record<string, string> = { sk: sessionKey, track, artist };
  if (album) params.album = album;
  if (durationSec) params.duration = String(durationSec);
  await post("track.updateNowPlaying", params);
};

/**
 */
export const scrobble = async (
  sessionKey: string,
  track: string,
  artist: string,
  timestamp: number,
  album?: string,
  durationSec?: number,
): Promise<void> => {
  const params: Record<string, string> = {
    sk: sessionKey,
    track,
    artist,
    timestamp: String(timestamp),
  };
  if (album) params.album = album;
  if (durationSec) params.duration = String(durationSec);
  await post("track.scrobble", params);
};

/**
 */
export const love = async (
  sessionKey: string,
  track: string,
  artist: string,
  loved: boolean,
): Promise<void> => {
  await post(loved ? "track.love" : "track.unlove", { sk: sessionKey, track, artist });
};
