import { systemLog } from "@main/utils/logger";
import { fetchWithProxy } from "@main/utils/proxy";
import { ipcMain } from "./trusted";

const GOOGLE_TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MAX_LINE_LENGTH = 1_500;
const MAX_CACHE_ENTRIES = 512;
const MIN_REQUEST_INTERVAL_MS = 800;
const REQUEST_TIMEOUT_MS = 15_000;

type GoogleSentence = {
  src_translit?: unknown;
  translit?: unknown;
};

type GoogleResponse = {
  sentences?: GoogleSentence[];
};

class GoogleRomanizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleRomanizationError";
  }
}

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | undefined>>();
let requestTail: Promise<void> = Promise.resolve();
let lastRequestStartedAt = 0;

/** 判断文本是否包含需要罗马化的非拉丁文字。 */
const needsRomanization = (text: string): boolean =>
  [...text].some((char) => /\p{Letter}/u.test(char) && !/\p{Script=Latin}/u.test(char));

const getCached = (text: string): string | undefined => {
  const value = cache.get(text);
  if (!value) return undefined;

  cache.delete(text);
  cache.set(text, value);
  return value;
};

const setCached = (text: string, reading: string): void => {
  cache.delete(text);
  cache.set(text, reading);

  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) return;
    cache.delete(oldest);
  }
};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** 从 Google Translate 响应中读取原文的拉丁转写。 */
const extractRomanization = (payload: unknown): string | undefined => {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const response = payload as GoogleResponse;
    const reading = response.sentences
      ?.map((sentence) => readString(sentence.src_translit) ?? readString(sentence.translit))
      .filter((value): value is string => Boolean(value))
      .join(" ");
    if (reading) return reading.replace(/\s+/g, " ").trim();
  }

  if (Array.isArray(payload) && Array.isArray(payload[0])) {
    const reading = (payload[0] as unknown[])
      .filter(Array.isArray)
      .map((segment) => readString(segment[3]))
      .filter((value): value is string => Boolean(value))
      .join(" ");
    if (reading) return reading.replace(/\s+/g, " ").trim();
  }

  return undefined;
};

/** 串行调用 Google Translate，避免歌词加载时触发突发请求。 */
const withRequestSlot = async <T>(task: () => Promise<T>): Promise<T> => {
  const previous = requestTail.catch(() => {});
  let release!: () => void;
  requestTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  const delay = lastRequestStartedAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

  lastRequestStartedAt = Date.now();
  try {
    return await task();
  } finally {
    release();
  }
};

const requestRomanization = async (text: string): Promise<string | undefined> => {
  const url = new URL(GOOGLE_TRANSLATE_ENDPOINT);
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", "en");
  url.searchParams.set("dj", "1");
  url.searchParams.append("dt", "t");
  url.searchParams.append("dt", "rm");
  url.searchParams.set("q", text);

  const response = await withRequestSlot(() =>
    fetchWithProxy(url, { method: "GET", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
  );
  if (!response.ok) {
    throw new GoogleRomanizationError(`Google Translate returned HTTP ${response.status}`);
  }

  const reading = extractRomanization((await response.json()) as unknown);
  return reading && !needsRomanization(reading) ? reading : undefined;
};

const romanizeLine = async (text: string): Promise<string | undefined> => {
  const cached = getCached(text);
  if (cached) return cached;

  const current = inFlight.get(text);
  if (current) return current;

  const request = requestRomanization(text)
    .then((reading) => {
      if (reading) setCached(text, reading);
      return reading;
    })
    .finally(() => {
      inFlight.delete(text);
    });
  inFlight.set(text, request);
  return request;
};

/**
 * 将缺少转写的歌词行转换为罗马音。
 * @param input - 原文歌词行
 * @returns 以原文为键的罗马音结果
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
  const result: Record<string, string> = {};

  if (lines.length > 0) {
    systemLog.info(`[romanization] requesting ${lines.length} lines from Google Translate`);
  }

  for (const line of lines) {
    try {
      const reading = await romanizeLine(line);
      if (reading) result[line] = reading;
    } catch (error) {
      systemLog.warn("[romanization] Google Translate request failed", error);
      break;
    }
  }

  if (lines.length > 0) {
    systemLog.info(`[romanization] generated ${Object.keys(result).length}/${lines.length} lines`);
  }
  return result;
};

/** 注册 Google Translate 罗马音转换 IPC。 */
export const registerRomanizationIpc = (): void => {
  ipcMain.handle("lyrics:romanize", (_event, input: unknown) => romanizeLines(input));
};
