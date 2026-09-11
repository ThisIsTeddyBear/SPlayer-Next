import { ipcMain } from "./trusted";
import { systemLog } from "@main/utils/logger";
import {
  getCachedRomanization,
  setCachedRomanization,
} from "@main/database/lyricRomanizationCache";
import { extractGoogleRomanization, needsRomanization } from "@shared/utils/romanization";

const TIMEOUT_MS = 6_000;
const RETRIES = 3;
const CONCURRENCY = 4;
const MAX_LINE_LENGTH = 1_500;
const CACHE_LIMIT = 1_800;

const cache = new Map<string, string>();

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

const romanizeText = async (text: string): Promise<string | undefined> => {
  const cached = cache.get(text);
  if (cached) return cached;

  const persisted = getPersistedReading(text);
  if (persisted) {
    storeReading(text, persisted);
    return persisted;
  }

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
      const response = await fetch(url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

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

      await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    }
  }

  return undefined;
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
