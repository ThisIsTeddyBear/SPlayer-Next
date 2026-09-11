/**
 * SPlayer-Next romanization service.
 *
 * Drop-in replacement for the module that currently owns:
 *   - requestRomanization()
 *   - romanizeText()
 *   - romanizeLines()
 *
 * Goals:
 *   1. Never send parallel Google romanization requests.
 *   2. Deduplicate duplicate renderer/window requests.
 *   3. Deduplicate repeated lyric lines (choruses).
 *   4. Open a process-wide circuit breaker after HTTP 429.
 *   5. Honor Retry-After and use exponential cooldowns.
 *   6. Avoid retry storms and fixed synchronized retries.
 *   7. Preserve the existing simple Promise<string/string[]> API.
 *
 * This module intentionally uses no third-party dependencies.
 */

const GOOGLE_ROMANIZATION_ENDPOINT =
  "https://translate.googleapis.com/translate_a/single";

const MIN_REQUEST_INTERVAL_MS = 1_250;
const REQUEST_TIMEOUT_MS = 15_000;

const INITIAL_RATE_LIMIT_COOLDOWN_MS = 60_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 15 * 60_000;
const RATE_LIMIT_JITTER_MS = 10_000;

const MAX_LINE_CACHE_ENTRIES = 512;

type GoogleSentence = {
  src?: string;
  trans?: string;
  src_translit?: string;
  translit?: string;
};

type GoogleDjResponse = {
  sentences?: GoogleSentence[];
  src?: string;
};

export class RomanizationRateLimitError extends Error {
  readonly retryAt: number;
  readonly retryAfterMs: number;

  constructor(retryAt: number) {
    const retryAfterMs = Math.max(0, retryAt - Date.now());
    super(`Google romanization is rate limited; retry after ${retryAfterMs}ms`);
    this.name = "RomanizationRateLimitError";
    this.retryAt = retryAt;
    this.retryAfterMs = retryAfterMs;
  }
}

export class RomanizationHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Google romanization request failed: HTTP ${status}`);
    this.name = "RomanizationHttpError";
    this.status = status;
  }
}

export class RomanizationTimeoutError extends Error {
  constructor() {
    super(`Google romanization request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    this.name = "RomanizationTimeoutError";
  }
}

/**
 * Small bounded LRU cache.
 *
 * We cache individual lyric lines rather than whole TrackDetail-sized payloads,
 * keeping memory bounded while still eliminating repeated chorus requests.
 */
const lineCache = new Map<string, string>();

function getCachedLine(key: string): string | undefined {
  const value = lineCache.get(key);
  if (value === undefined) return undefined;

  // Refresh LRU position.
  lineCache.delete(key);
  lineCache.set(key, value);

  return value;
}

function setCachedLine(key: string, value: string): void {
  lineCache.delete(key);
  lineCache.set(key, value);

  while (lineCache.size > MAX_LINE_CACHE_ENTRIES) {
    const oldest = lineCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    lineCache.delete(oldest);
  }
}

/**
 * Single-flight maps.
 *
 * - inFlightLines: same lyric text requested by multiple callers -> one HTTP call.
 * - inFlightSongs: same full lyric array requested simultaneously -> one job.
 */
const inFlightLines = new Map<string, Promise<string>>();
const inFlightSongs = new Map<string, Promise<string[]>>();

/**
 * Process-wide request state.
 *
 * Every remote request in this Electron main process shares this state.
 * Do NOT move these variables inside romanizeLines(), an IPC callback, or a
 * per-window object. Doing that recreates the duplicate-limiter bug.
 */
let requestQueueTail: Promise<void> = Promise.resolve();
let lastRequestStartedAt = 0;
let blockedUntil = 0;
let rateLimitStrikes = 0;

function createAbortError(): Error {
  const error = new Error("Romanization request aborted");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    throwIfAborted(signal);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(createAbortError());
    };

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A tiny async mutex. This is the most important part of the fix:
 * there can be only ONE Google romanization request active at a time.
 */
async function withRequestLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = requestQueueTail;

  let release!: () => void;
  requestQueueTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    return await task();
  } finally {
    release();
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const absoluteTime = Date.parse(value);
  if (!Number.isNaN(absoluteTime)) {
    return Math.max(0, absoluteTime - Date.now());
  }

  return null;
}

function registerRateLimit(retryAfterHeader: string | null): number {
  rateLimitStrikes += 1;

  const exponentialCooldown = Math.min(
    INITIAL_RATE_LIMIT_COOLDOWN_MS * 2 ** (rateLimitStrikes - 1),
    MAX_RATE_LIMIT_COOLDOWN_MS,
  );

  const retryAfterMs = parseRetryAfter(retryAfterHeader) ?? 0;
  const jitterMs = Math.floor(Math.random() * RATE_LIMIT_JITTER_MS);

  const cooldownMs = Math.min(
    Math.max(exponentialCooldown, retryAfterMs) + jitterMs,
    MAX_RATE_LIMIT_COOLDOWN_MS,
  );

  blockedUntil = Math.max(blockedUntil, Date.now() + cooldownMs);
  return blockedUntil;
}

function resetRateLimitStateAfterSuccess(): void {
  blockedUntil = 0;
  rateLimitStrikes = 0;
}

/**
 * Don't waste Google calls on English / already-Latin lyric lines.
 *
 * This deliberately checks letters character-by-character so accented Latin
 * text (é, ñ, ü, etc.) also remains local.
 */
function containsNonLatinLetters(text: string): boolean {
  for (const char of text) {
    if (/\p{Letter}/u.test(char) && !/\p{Script=Latin}/u.test(char)) {
      return true;
    }
  }
  return false;
}

function buildRequestUrl(text: string): string {
  const url = new URL(GOOGLE_ROMANIZATION_ENDPOINT);

  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", "en");

  // dj=1 gives a stable object-shaped response on the endpoint when available.
  url.searchParams.set("dj", "1");
  url.searchParams.append("dt", "t");
  url.searchParams.append("dt", "rm");

  url.searchParams.set("source", "input");
  url.searchParams.set("q", text);

  return url.toString();
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Supports both Google response shapes seen from translate_a/single:
 *
 * dj=1:
 *   { sentences: [{ src_translit: "..." }, ...] }
 *
 * legacy array:
 *   [[ [...], [null, null, null, "romanized text"] ], ...]
 */
function extractRomanization(payload: unknown): string | null {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const response = payload as GoogleDjResponse;

    if (Array.isArray(response.sentences)) {
      const pieces = response.sentences
        .map((sentence) => sentence?.src_translit ?? sentence?.translit)
        .filter(nonEmptyString)
        .map((piece) => piece.trim());

      if (pieces.length > 0) {
        return pieces.join(" ").replace(/\s+/g, " ").trim();
      }
    }
  }

  if (Array.isArray(payload) && Array.isArray(payload[0])) {
    const segments = payload[0] as unknown[];
    const pieces: string[] = [];

    for (const segment of segments) {
      if (!Array.isArray(segment)) continue;

      // Common legacy response:
      // [null, null, null, "romanized text"]
      if (nonEmptyString(segment[3])) {
        pieces.push(segment[3].trim());
        continue;
      }

      // Older client variants sometimes put romanization in index 1 on a
      // metadata-style row whose translated text (index 0) is empty.
      if (
        (segment[0] === null || segment[0] === undefined) &&
        nonEmptyString(segment[1])
      ) {
        pieces.push(segment[1].trim());
      }
    }

    if (pieces.length > 0) {
      return pieces.join(" ").replace(/\s+/g, " ").trim();
    }
  }

  return null;
}

async function fetchWithTimeout(
  url: string,
  externalSignal?: AbortSignal,
): Promise<Response> {
  throwIfAborted(externalSignal);

  const controller = new AbortController();
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  const onExternalAbort = () => {
    controller.abort();
  };

  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    return await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch (error) {
    if (externalSignal?.aborted) {
      throw createAbortError();
    }

    if (timedOut) {
      throw new RomanizationTimeoutError();
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * The actual network request.
 *
 * Compatibility note:
 * The name is exported intentionally because your recent SPlayer build uses
 * requestRomanization() in its stack trace.
 */
export async function requestRomanization(
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  const normalized = text.trim();

  if (!normalized) return text;
  if (!containsNonLatinLetters(normalized)) return text;

  const cached = getCachedLine(normalized);
  if (cached !== undefined) {
    return cached;
  }

  const existing = inFlightLines.get(normalized);
  if (existing) {
    return existing;
  }

  const promise = withRequestLock(async () => {
    throwIfAborted(signal);

    // Re-check after waiting for the mutex; another queued request may have
    // completed and cached this same text in the meantime.
    const queuedCached = getCachedLine(normalized);
    if (queuedCached !== undefined) {
      return queuedCached;
    }

    const now = Date.now();

    // Circuit breaker: while blocked, make ZERO requests to Google.
    if (blockedUntil > now) {
      throw new RomanizationRateLimitError(blockedUntil);
    }

    // Space request starts even if different callers are feeding this service.
    const earliestNextStart = lastRequestStartedAt + MIN_REQUEST_INTERVAL_MS;
    if (earliestNextStart > now) {
      await sleep(earliestNextStart - now, signal);
    }

    // Check again in case the caller was queued for a while.
    if (blockedUntil > Date.now()) {
      throw new RomanizationRateLimitError(blockedUntil);
    }

    lastRequestStartedAt = Date.now();

    const response = await fetchWithTimeout(buildRequestUrl(normalized), signal);

    if (response.status === 429) {
      const retryAt = registerRateLimit(response.headers.get("retry-after"));

      // Consume/cancel the body so the underlying connection can be released.
      try {
        await response.body?.cancel();
      } catch {
        // Ignore body cancellation failures.
      }

      throw new RomanizationRateLimitError(retryAt);
    }

    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        // Ignore body cancellation failures.
      }

      throw new RomanizationHttpError(response.status);
    }

    const raw = await response.text();

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error("Google romanization returned invalid JSON");
    }

    resetRateLimitStateAfterSuccess();

    // If Google has no romanization for this line, keep the original rather
    // than repeatedly requesting the same no-op line.
    const romanized = extractRomanization(payload) ?? text;

    setCachedLine(normalized, romanized);
    return romanized;
  });

  inFlightLines.set(normalized, promise);

  try {
    return await promise;
  } finally {
    if (inFlightLines.get(normalized) === promise) {
      inFlightLines.delete(normalized);
    }
  }
}

/**
 * Backward-compatible single-line alias.
 */
export async function romanizeText(
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  return requestRomanization(text, signal);
}

async function runRomanizeLines(
  lines: readonly string[],
  signal?: AbortSignal,
): Promise<string[]> {
  const result = Array.from(lines);

  for (let index = 0; index < lines.length; index += 1) {
    throwIfAborted(signal);

    const line = lines[index];
    if (!line?.trim()) continue;

    try {
      result[index] = await requestRomanization(line, signal);
    } catch (error) {
      if (error instanceof RomanizationRateLimitError) {
        // Critical behavior:
        // stop the whole song immediately. Do NOT send the remaining lyric
        // lines while Google has already told us to stop.
        break;
      }

      if (error instanceof RomanizationHttpError) {
        // Don't turn an upstream outage/denial into one request per lyric line.
        break;
      }

      if (error instanceof RomanizationTimeoutError) {
        // Same principle for network stalls.
        break;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }

      // Unknown network/parsing failure: stop remote work for this song.
      // Existing original lines remain intact.
      break;
    }
  }

  return result;
}

/**
 * Romanize a lyric array without parallel Google workers.
 *
 * Simultaneous identical song requests share one Promise. This handles the
 * SPlayer case where multiple windows/surfaces ask for the same romanization.
 */
export function romanizeLines(
  lines: readonly string[],
  signal?: AbortSignal,
): Promise<string[]> {
  // Avoid sharing an abortable job between callers with independent signals.
  if (signal) {
    return runRomanizeLines(lines, signal);
  }

  const songKey = JSON.stringify(lines);
  const existing = inFlightSongs.get(songKey);

  if (existing) {
    return existing;
  }

  const promise = runRomanizeLines(lines).finally(() => {
    if (inFlightSongs.get(songKey) === promise) {
      inFlightSongs.delete(songKey);
    }
  });

  inFlightSongs.set(songKey, promise);
  return promise;
}

/**
 * Useful when logging/debugging the limiter state from your existing system IPC.
 */
export function getRomanizationRateLimitState(): {
  blocked: boolean;
  blockedUntil: number;
  retryAfterMs: number;
  strikeCount: number;
  cachedLines: number;
  inFlightLines: number;
  inFlightSongs: number;
} {
  return {
    blocked: blockedUntil > Date.now(),
    blockedUntil,
    retryAfterMs: Math.max(0, blockedUntil - Date.now()),
    strikeCount: rateLimitStrikes,
    cachedLines: lineCache.size,
    inFlightLines: inFlightLines.size,
    inFlightSongs: inFlightSongs.size,
  };
}

/**
 * Primarily for tests or an explicit "clear caches" action.
 * Do not call this after every track; that would defeat duplicate suppression.
 */
export function clearRomanizationCache(): void {
  lineCache.clear();
}
