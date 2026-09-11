import { ipcMain } from "./trusted";
import { systemLog } from "@main/utils/logger";
import {
  getCachedRomanization,
  setCachedRomanization,
} from "@main/database/lyricRomanizationCache";
import { extractGoogleRomanization, needsRomanization } from "@shared/utils/romanization";

const TIMEOUT_MS = 6_000;
const RETRIES = 3;
const CONCURRENCY = 2;
const REQUEST_INTERVAL_MS = 120;
const RATE_LIMIT_COOLDOWN_MS = 10_000;
const MAX_LINE_LENGTH = 1_500;
const CACHE_LIMIT = 1_800;

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | undefined>>();
let nextRequestAt = 0;
let rateLimitUntil = 0;

class GoogleRomanizationError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs = 0,
  ) {
    super(`HTTP ${status}`);
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const retryAfterMs = (value: string | null): number => {
  if (!value) return RATE_LIMIT_COOLDOWN_MS;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : RATE_LIMIT_COOLDOWN_MS;
};

/** Google 公共端点会在突发请求后返回 429；所有歌词批次共用节流窗口。 */
const waitForGoogleRequestSlot = async (): Promise<void> => {
  const now = Date.now();
  const requestAt = Math.max(now, nextRequestAt, rateLimitUntil);
  nextRequestAt = requestAt + REQUEST_INTERVAL_MS;
  if (requestAt > now) await delay(requestAt - now);
};

const storeReading = (text: string, reading: string): void => {
  cache.delete(text);
  cache.set(text, reading);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
};

const getPersistedReading = (text: string): string | undefined => {
  try {
    return getCachedRomanization(text);
  } catch (error) {
    systemLog.warn("[romanization] Persistent lyric cache read failed", error);
    return undefined;
  }
};

const persistReading = (text: string, reading: string): void => {
  try {
    setCachedRomanization(text, reading);
  } catch (error) {
    systemLog.warn("[romanization] Persistent lyric cache write failed", error);
  }
};

const requestRomanization = async (text: string): Promise<string | undefined> => {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.search = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: "en",
    dt: "rm",
    q: text,
  }).toString();

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      await waitForGoogleRequestSlot();
      const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        const cooldown =
          response.status === 429 ? retryAfterMs(response.headers.get("retry-after")) : 0;
        if (cooldown) rateLimitUntil = Math.max(rateLimitUntil, Date.now() + cooldown);
        throw new GoogleRomanizationError(response.status, cooldown);
      }

      const reading = extractGoogleRomanization((await response.json()) as unknown, text);
      if (!reading) return undefined;

      storeReading(text, reading);
      persistReading(text, reading);
      return reading;
    } catch (error) {
      if (attempt + 1 === RETRIES) {
        systemLog.warn("[romanization] Google request failed", error);
        return undefined;
      }

      const backoff = 1_000 * 2 ** attempt;
      const cooldown = error instanceof GoogleRomanizationError ? error.retryAfterMs : 0;
      await delay(Math.max(backoff, cooldown));
    }
  }

  return undefined;
};

const romanizeText = async (text: string): Promise<string | undefined> => {
  const cached = cache.get(text);
  if (cached) return cached;

  const persisted = getPersistedReading(text);
  if (persisted) {
    storeReading(text, persisted);
    return persisted;
  }

  const active = inFlight.get(text);
  if (active) return active;

  const request = requestRomanization(text);
  inFlight.set(text, request);
  try {
    return await request;
  } finally {
    inFlight.delete(text);
  }
};

/**
 * 将多行原文转换为罗马音
 * @param input - 原文歌词行
 * @returns 按原文索引的罗马音结果
 */
export const romanizeLines = async (input: unknown): Promise<Record<string, string>> => {
  const lines = Array.isArray(input)
    ? [
        ...new Set(
          input.filter(
            (line): line is string =>
              typeof line === "string" && line.length <= MAX_LINE_LENGTH && needsRomanization(line),
          ),
        ),
      ]
    : [];
  const results: Record<string, string> = {};
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < lines.length) {
      const text = lines[cursor++];
      const reading = await romanizeText(text);
      if (reading) results[text] = reading;
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, lines.length) }, worker));
  return results;
};

/** 注册 Google 罗马音转换 IPC */
export const registerRomanizationIpc = (): void => {
  ipcMain.handle("lyrics:romanize", (_event, input: unknown) => romanizeLines(input));
};
