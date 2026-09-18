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

/** 使用 am-lyrics 相同的超时控制调用 Google Translate。 */
const fetchWithTimeout = (url: string): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeoutId));
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

const BATCH_SIZE = 15;
const BATCH_DELIMITER = " | ";
const BATCH_DELIMITER_REGEX = /\s*\|\s*/;

const romanizeText = async (text: string): Promise<string | undefined> => {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const url = `${GOOGLE_TRANSLATE_ENDPOINT}?client=gtx&sl=auto&tl=en&dt=rm&q=${encodeURIComponent(text)}`;
      const response = await fetchWithTimeout(url);
      const data = await readGoogleTranslateResponse(response);
      const reading = data?.[0]?.[0]?.[3];
      return typeof reading === "string" && reading.trim() ? reading.trim() : undefined;
    } catch (error) {
      if (error instanceof GoogleTranslateResponseError && !error.retryable) throw error;
      if (attempt + 1 === MAX_RETRIES) throw error;
      await delay(RETRY_DELAY_MS * 2 ** attempt);
    }
  }

  return undefined;
};

const romanizeLine = async (text: string): Promise<string | undefined> => {
  const reading = await romanizeText(text);
  return reading ? simplifyGoogleRomanization(reading, text) : undefined;
};

/**
 * 批量将多行歌词拼合并请求罗马音
 * @param lines - 待转换的行数组
 * @returns 成功返回映射字典；解析数量不匹配时返回 null 以便触发逐行降级
 */
const romanizeBatch = async (lines: string[]): Promise<Record<string, string> | null> => {
  if (lines.length === 0) return {};
  if (lines.length === 1) {
    const reading = await romanizeLine(lines[0]);
    return reading ? { [lines[0]]: reading } : {};
  }
  const queryText = lines.map((line) => line.replace(/\|/g, " ")).join(BATCH_DELIMITER);
  const reading = await romanizeText(queryText);
  if (!reading) return null;
  const parts = reading.split(BATCH_DELIMITER_REGEX);
  if (parts.length !== lines.length) return null;
  const map: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const part = parts[i]?.trim();
    if (part) map[lines[i]] = simplifyGoogleRomanization(part, lines[i]);
  }
  return map;
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

  let index = 0;
  while (index < pending.length) {
    const batch = pending.slice(index, index + BATCH_SIZE);
    try {
      const batchResult = await romanizeBatch(batch);
      if (batchResult) {
        for (const [line, reading] of Object.entries(batchResult)) {
          result[line] = reading;
          generated[line] = reading;
        }
        index += batch.length;
      } else {
        // 分割数量不匹配时降级为单行处理
        for (const line of batch) {
          const reading = await romanizeLine(line);
          if (reading) {
            result[line] = reading;
            generated[line] = reading;
          }
          index += 1;
        }
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
