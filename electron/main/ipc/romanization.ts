import { ipcMain } from "./trusted";
import { fetchWithProxy } from "@main/utils/proxy";
import { systemLog } from "@main/utils/logger";

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

const hasNonLatinLetter = (value: string): boolean =>
  [...value].some((char) => /\p{L}/u.test(char) && !/\p{Script=Latin}/u.test(char));

const normalizeReading = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019`´]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

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

const extractObjectRomanization = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;

  const sentences = (payload as { sentences?: unknown }).sentences;
  if (!Array.isArray(sentences)) return undefined;

  const reading = normalizeReading(
    sentences
      .map((sentence) => {
        if (!sentence || typeof sentence !== "object") return "";
        const srcTranslit = (sentence as { src_translit?: unknown }).src_translit;
        return typeof srcTranslit === "string" ? srcTranslit : "";
      })
      .filter(Boolean)
      .join(" "),
  );

  return reading && !hasNonLatinLetter(reading) ? reading : undefined;
};

const extractLegacyRomanization = (payload: unknown): string | undefined => {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return undefined;

  const segments = (payload[0] as unknown[]).filter(
    (segment): segment is unknown[] => Array.isArray(segment),
  );
  if (!segments.length) return undefined;

  const trailing = segments[segments.length - 1];
  if (trailing && trailing[0] == null && trailing[1] == null) {
    const candidate = trailing.find(
      (value): value is string => typeof value === "string" && Boolean(value.trim()),
    );

    if (candidate) {
      const reading = normalizeReading(candidate);
      if (reading && !hasNonLatinLetter(reading)) return reading;
    }
  }

  const reading = normalizeReading(
    segments
      .map((segment) => (typeof segment[3] === "string" ? segment[3] : ""))
      .filter(Boolean)
      .join(" "),
  );

  return reading && !hasNonLatinLetter(reading) ? reading : undefined;
};

const extractRomanization = (payload: unknown): string | undefined =>
  extractObjectRomanization(payload) ?? extractLegacyRomanization(payload);

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
    dj: "1",
    q: text,
  });
  params.append("dt", "t");
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

      const reading = extractRomanization(payload);
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

/** 将多行原文转换为罗马音 */
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
