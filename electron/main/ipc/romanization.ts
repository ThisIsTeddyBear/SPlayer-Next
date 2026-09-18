import { systemLog } from "@main/utils/logger";
import {
  getCachedRomanizations,
  setCachedRomanizations,
} from "@main/database/lyricRomanizationCache";
import { simplifyGoogleRomanization } from "@shared/utils/lyrics";
import { ipcMain } from "./trusted";

const GOOGLE_TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const MAX_LINE_LENGTH = 1_500;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_000;
const FETCH_TIMEOUT_MS = 6_000;

class GoogleTranslateResponseError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GoogleTranslateResponseError";
  }
}

/** 判断文本是否完全由拉丁字符、数字和常见标点组成。 */
const isPurelyLatinScript = (text: string): boolean =>
  // 需要涵盖 ASCII 控制字符以保持既有拉丁文本判断不变。
  // eslint-disable-next-line no-control-regex
  /^[\u0000-\u007f\u0080-\u00ff\u0100-\u017f\u0180-\u024f]*$/.test(text);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 使用带有浏览器标识和超时控制的 fetch 调用 Google Translate。 */
const fetchWithTimeout = (url: string): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, {
    signal: controller.signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
  }).finally(() => clearTimeout(timeoutId));
};

/** 读取 Google Translate 响应，并将 HTML 错误页与 JSON 负载区分开。 */
const readGoogleTranslateResponse = async (response: Response): Promise<unknown[][][]> => {
  const contentType = response.headers.get("content-type") || "unknown content type";
  const body = await response.text();
  const responseInfo = `HTTP ${response.status} (${contentType})`;

  if (!response.ok) {
    throw new GoogleTranslateResponseError(
      `Google Translate returned ${responseInfo}`,
      response.status === 429 || response.status >= 500,
    );
  }

  if (body.trimStart().startsWith("<")) {
    throw new GoogleTranslateResponseError(
      `Google Translate returned HTML instead of JSON (${responseInfo})`,
      false,
    );
  }

  try {
    return JSON.parse(body) as unknown[][][];
  } catch {
    throw new GoogleTranslateResponseError(
      `Google Translate returned invalid JSON (${responseInfo})`,
      false,
    );
  }
};

const romanizeLine = async (text: string): Promise<string | undefined> => {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const url = `${GOOGLE_TRANSLATE_ENDPOINT}?client=dict-chrome-ex&sl=auto&tl=en&dt=rm&q=${encodeURIComponent(text)}`;
      const response = await fetchWithTimeout(url);
      const data = await readGoogleTranslateResponse(response);
      const reading = data?.[0]?.[0]?.[3];
      return typeof reading === "string" && reading.trim()
        ? simplifyGoogleRomanization(reading.trim(), text)
        : undefined;
    } catch (error) {
      if (error instanceof GoogleTranslateResponseError && !error.retryable) throw error;
      if (attempt + 1 === MAX_RETRIES) throw error;
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
    ? [
        ...new Set(
          input.filter(
            (line): line is string =>
              typeof line === "string" &&
              line.length <= MAX_LINE_LENGTH &&
              !isPurelyLatinScript(line),
          ),
        ),
      ]
    : [];
  const cached = getCachedRomanizations(lines);
  const pending = lines.filter((line) => !cached[line]);
  const result = { ...cached };
  const generated: Record<string, string> = {};

  if (pending.length > 0) {
    systemLog.info(
      `[romanization] cache hit ${lines.length - pending.length}/${lines.length}, requesting ${pending.length} lines from Google Translate`,
    );
  }

  for (const [index, line] of pending.entries()) {
    try {
      const reading = await romanizeLine(line);
      if (reading) {
        result[line] = reading;
        generated[line] = reading;
      }
    } catch (error) {
      systemLog.warn(
        `[romanization] Google Translate unavailable; stopped after a failed request (additional requests avoided: ${pending.length - index - 1})`,
        error,
      );
      break;
    }
  }

  setCachedRomanizations(generated);

  if (lines.length > 0) {
    systemLog.info(
      `[romanization] returned ${Object.keys(result).length}/${lines.length} lines (${Object.keys(generated).length} newly cached)`,
    );
  }
  return result;
};

/** 注册 Google Translate 罗马音转换 IPC。 */
export const registerRomanizationIpc = (): void => {
  ipcMain.handle("lyrics:romanize", (_event, input: unknown) => romanizeLines(input));
};
