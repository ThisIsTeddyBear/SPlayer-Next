import { systemLog } from "@main/utils/logger";
import { ipcMain } from "./trusted";

const GOOGLE_TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MAX_LINE_LENGTH = 1_500;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_000;
const FETCH_TIMEOUT_MS = 6_000;

/** 判断文本是否完全由拉丁字符、数字和常见标点组成。 */
const isPurelyLatinScript = (text: string): boolean =>
  /^[\u0000-\u007f\u0080-\u00ff\u0100-\u017f\u0180-\u024f]*$/.test(text);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 使用 am-lyrics 相同的超时控制调用 Google Translate。 */
const fetchWithTimeout = (url: string): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
};

const romanizeLine = async (text: string): Promise<string | undefined> => {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const url = `${GOOGLE_TRANSLATE_ENDPOINT}?client=gtx&sl=auto&tl=en&dt=rm&q=${encodeURIComponent(text)}`;
      const response = await fetchWithTimeout(url);
      const data = (await response.json()) as unknown[][][];
      const reading = data?.[0]?.[0]?.[3];
      return typeof reading === "string" && reading.trim() ? reading.trim() : undefined;
    } catch (error) {
      if (attempt + 1 === MAX_RETRIES) {
        systemLog.warn("[romanization] Google Translate request failed", error);
        return undefined;
      }
      await delay(RETRY_DELAY_MS * 2 ** attempt);
    }
  }

  return undefined;
};

/**
 * 将缺少转写的歌词行转换为罗马音。
 * @param input - 原文歌词行
 * @returns 以原文为键的罗马音结果
 */
export const romanizeLines = async (input: unknown): Promise<Record<string, string>> => {
  const lines = Array.isArray(input)
    ? input.filter(
        (line): line is string =>
          typeof line === "string" && line.length <= MAX_LINE_LENGTH && !isPurelyLatinScript(line),
      )
    : [];
  const result: Record<string, string> = {};

  if (lines.length > 0) {
    systemLog.info(`[romanization] requesting ${lines.length} lines from Google Translate`);
  }

  for (const line of lines) {
    const reading = await romanizeLine(line);
    if (reading) result[line] = reading;
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
