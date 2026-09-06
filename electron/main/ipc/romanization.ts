import { ipcMain } from "electron";
import { fetchWithProxy } from "@main/utils/proxy";

const TIMEOUT_MS = 6_000;
const RETRIES = 3;
const CONCURRENCY = 4;
const MAX_LINE_LENGTH = 1_500;
const CACHE_LIMIT = 1_800;
const cache = new Map<string, string>();

const hasNativeScript = (value: string): boolean => /[^\u0000-\u024f\u2000-\u206f]/u.test(value);

const normalizeReading = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019`´]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const romanizeLine = async (text: string): Promise<string | undefined> => {
  const cached = cache.get(text);
  if (cached) return cached;
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
      const response = await fetchWithProxy(url.toString(), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Google romanization HTTP ${response.status}`);
      const payload = (await response.json()) as unknown;
      const segments = Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0] : [];
      const reading = normalizeReading(
        segments
          .map((segment) => (Array.isArray(segment) ? segment[3] : ""))
          .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
          .join(""),
      );
      if (reading && !hasNativeScript(reading)) {
        cache.set(text, reading);
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
        return reading;
      }
    } catch {
      if (attempt + 1 < RETRIES)
        await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    }
  }
  return undefined;
};

/** 注册按需 Google 罗马音转换 IPC */
export const registerRomanizationIpc = (): void => {
  ipcMain.handle(
    "lyrics:romanize",
    async (_event, input: unknown): Promise<Record<string, string>> => {
      const lines = Array.isArray(input)
        ? [
            ...new Set(
              input.filter(
                (line): line is string =>
                  typeof line === "string" && line.length <= MAX_LINE_LENGTH,
              ),
            ),
          ]
        : [];
      const results: Record<string, string> = {};
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (cursor < lines.length) {
          const line = lines[cursor++];
          const reading = await romanizeLine(line);
          if (reading) results[line] = reading;
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, lines.length) }, worker));
      return results;
    },
  );
};
