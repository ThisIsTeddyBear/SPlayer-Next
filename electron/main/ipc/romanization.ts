import { ipcMain } from "./trusted";
import { fetchWithProxy } from "@main/utils/proxy";
import { systemLog } from "@main/utils/logger";
import { extractGoogleRomanization, hasNonLatinLetter } from "@shared/utils/romanization";

const TIMEOUT_MS = 4_000;
const RETRIES = 2;
const CONCURRENCY = 3;
const MAX_LINE_LENGTH = 1_500;
const CACHE_LIMIT = 1_800;
const FAILURE_CACHE_MS = 15_000;
const PROVIDER_COOLDOWN_MS = 30_000;

const cache = new Map<string, string>();
const failureCache = new Map<string, number>();

let providerBlockedUntil = 0;

const rememberFailure = (text: string): void => {
  failureCache.set(text, Date.now());
  while (failureCache.size > CACHE_LIMIT) {
    failureCache.delete(failureCache.keys().next().value!);
  }
};

const isRecentlyFailed = (text: string): boolean => {
  const failedAt = failureCache.get(text);
  if (!failedAt) return false;

  if (Date.now() - failedAt < FAILURE_CACHE_MS) return true;

  failureCache.delete(text);
  return false;
};

const blockProvider = (reason: string, cooldownMs = PROVIDER_COOLDOWN_MS): void => {
  providerBlockedUntil = Math.max(providerBlockedUntil, Date.now() + cooldownMs);
  systemLog.warn(`[romanization] Google fallback temporarily disabled: ${reason}`);
};

const romanizeLine = async (text: string): Promise<string | undefined> => {
  const cached = cache.get(text);
  if (cached) return cached;

  if (Date.now() < providerBlockedUntil || isRecentlyFailed(text)) {
    return undefined;
  }

  const url = new URL("https://translate.googleapis.com/translate_a/single");
  const params = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: "en",
    q: text,
  });
  params.append("dt", "rm");
  url.search = params.toString();

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const response = await fetchWithProxy(url.toString(), {
        headers: {
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (response.status === 403 || response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const cooldownMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1_000, 5 * 60_000)
            : PROVIDER_COOLDOWN_MS;

        rememberFailure(text);
        blockProvider(`HTTP ${response.status}`, cooldownMs);
        return undefined;
      }

      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          rememberFailure(text);
          systemLog.warn(`[romanization] Google request rejected: HTTP ${response.status}`);
          return undefined;
        }

        throw new Error(`Google romanization HTTP ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = (await response.json()) as unknown;
      } catch (error) {
        rememberFailure(text);
        blockProvider("non-JSON response");
        systemLog.warn("[romanization] Google returned invalid JSON", error);
        return undefined;
      }

      const reading = extractGoogleRomanization(payload);
      if (!reading) {
        rememberFailure(text);
        systemLog.warn("[romanization] Google response contained no usable romanization");
        return undefined;
      }

      cache.set(text, reading);
      failureCache.delete(text);

      while (cache.size > CACHE_LIMIT) {
        cache.delete(cache.keys().next().value!);
      }

      return reading;
    } catch (error) {
      if (attempt + 1 >= RETRIES) {
        rememberFailure(text);
        blockProvider("network error or timeout", 15_000);
        systemLog.warn("[romanization] Google request failed", error);
        return undefined;
      }

      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }

  return undefined;
};

/**
 * 将多行原文转换为罗马音
 * @param input - 原文歌词行
 * @returns 按原文索引的罗马音结果
 */
export const romanizeLines = async (input: string[]): Promise<Record<string, string>> => {
  const lines = [
    ...new Set(
      input.filter(
        (line): line is string =>
          typeof line === "string" &&
          line.length <= MAX_LINE_LENGTH &&
          hasNonLatinLetter(line),
      ),
    ),
  ];

  const results: Record<string, string> = {};
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < lines.length) {
      if (Date.now() < providerBlockedUntil) return;

      const line = lines[cursor++];
      const reading = await romanizeLine(line);
      if (reading) results[line] = reading;
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, lines.length) }, worker));

  return results;
};

/** 注册按需 Google 罗马音转换 IPC */
export const registerRomanizationIpc = (): void => {
  ipcMain.handle(
    "lyrics:romanize",
    async (_event, input: unknown): Promise<Record<string, string>> => {
      return romanizeLines(Array.isArray(input) ? input : []);
    },
  );
};
