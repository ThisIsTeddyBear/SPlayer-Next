import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { searchSpotifyArtistImage } from "@main/services/metadataLookup";
import { getArtistCacheDir } from "@main/utils/config";
import { libraryLog } from "@main/utils/logger";
import { fetchWithProxy } from "@main/utils/proxy";
import { toCacheUrl } from "@main/utils/protocol";

const INDEX_FILE = "spotify-index.json";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PREFETCH_CONCURRENCY = 8;
const SPOTIFY_INTERVAL_MS = 500;
const REQUEST_ATTEMPTS = 3;
const USER_AGENT = "SPlayer-Next/1.0 (https://github.com/ThisIsTeddyBear/SPlayer-Next)";

interface CacheEntry {
  checkedAt: number;
  fileName?: string;
  /** 仅在 Spotify 成功响应且确实没有头像时写入 */
  confirmedMiss?: true;
}

type CacheIndex = Record<string, CacheEntry>;

const inFlight = new Map<string, Promise<string | undefined>>();
let cacheIndex: CacheIndex | undefined;
let cacheIndexLoad: Promise<CacheIndex> | undefined;
let indexWriteQueue = Promise.resolve();
let nextSpotifyRequestAt = 0;

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

const fileId = (value: string): string => createHash("sha256").update(value).digest("hex");

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 限制批量预取时的 Spotify 请求频率 */
const waitForSpotifyTurn = async (): Promise<void> => {
  const now = Date.now();
  const waitMs = Math.max(0, nextSpotifyRequestAt - now);
  nextSpotifyRequestAt = Math.max(now, nextSpotifyRequestAt) + SPOTIFY_INTERVAL_MS;
  if (waitMs > 0) await delay(waitMs);
};

const readIndex = async (): Promise<CacheIndex> => {
  if (cacheIndex) return cacheIndex;
  cacheIndexLoad ??= fs
    .readFile(path.join(getArtistCacheDir(), INDEX_FILE), "utf8")
    .then((contents) => JSON.parse(contents) as CacheIndex)
    .catch(() => ({}));
  cacheIndex = await cacheIndexLoad;
  return cacheIndex;
};

const writeIndex = async (): Promise<void> => {
  const dir = getArtistCacheDir();
  const index = await readIndex();
  indexWriteQueue = indexWriteQueue.then(async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, INDEX_FILE), JSON.stringify(index), "utf8");
  });
  await indexWriteQueue;
};

/** 下载头像；下载异常不能污染“未收录”缓存 */
const downloadImage = async (
  url: string,
  artistName: string,
): Promise<{ ok: true; value: Buffer } | { ok: false }> => {
  let lastError = "unknown error";
  for (let attempt = 0; attempt < REQUEST_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithProxy(url, {
        headers: {
          Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(15_000),
      });
      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
      } else if (!response.body || (!contentType.startsWith("image/") && contentType !== "")) {
        lastError = `invalid content type: ${contentType || "none"}`;
      } else {
        const chunks: Uint8Array[] = [];
        let total = 0;
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > MAX_IMAGE_BYTES) {
            lastError = "image exceeds size limit";
            break;
          }
          chunks.push(value);
        }
        if (total > 0 && total <= MAX_IMAGE_BYTES) {
          return { ok: true, value: Buffer.concat(chunks, total) };
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt + 1 < REQUEST_ATTEMPTS) await delay((attempt + 1) * 500);
  }
  libraryLog.warn(`歌手图片下载失败，将在下次重试: ${artistName} (${lastError})`);
  return { ok: false };
};

const existingCachedImage = async (fileName: string | undefined): Promise<string | undefined> => {
  if (!fileName) return;
  const filePath = path.join(getArtistCacheDir(), fileName);
  try {
    await fs.access(filePath);
    return toCacheUrl(filePath);
  } catch {
    return;
  }
};

const resolve = async (artistName: string): Promise<string | undefined> => {
  const normalizedName = normalizeName(artistName);
  if (!normalizedName) return;
  const index = await readIndex();
  const cached = index[normalizedName];
  const cachedImage = await existingCachedImage(cached?.fileName);
  const age = Date.now() - (cached?.checkedAt ?? 0);
  if (cached?.fileName && cachedImage && age < CACHE_TTL_MS) return cachedImage;
  if (cached?.confirmedMiss && age < MISS_TTL_MS) return;

  // 旧版本会将请求失败写成普通 miss；仅本次升级将其全部重新验证。
  if (cached && !cached.fileName && !cached.confirmedMiss) delete index[normalizedName];

  let imageUrl: string | undefined;
  try {
    await waitForSpotifyTurn();
    imageUrl = await searchSpotifyArtistImage(artistName);
  } catch (error) {
    libraryLog.warn(`Spotify 歌手图片查询失败，将在下次重试: ${artistName}`, error);
    return cachedImage;
  }
  if (!imageUrl) {
    index[normalizedName] = { checkedAt: Date.now(), confirmedMiss: true };
    await writeIndex();
    return;
  }

  const image = await downloadImage(imageUrl, artistName);
  if (!image.ok) return cachedImage;

  const fileName = `${fileId(`spotify:${normalizedName}`)}.jpg`;
  const filePath = path.join(getArtistCacheDir(), fileName);
  await fs.mkdir(getArtistCacheDir(), { recursive: true });
  await fs.writeFile(filePath, image.value);
  index[normalizedName] = { checkedAt: Date.now(), fileName };
  await writeIndex();
  return toCacheUrl(filePath);
};

/** 获取单个歌手头像，重复请求复用同一任务 */
export const getArtistImage = (artistName: string): Promise<string | undefined> => {
  const normalizedName = normalizeName(artistName);
  if (!normalizedName) return Promise.resolve(undefined);
  const existing = inFlight.get(normalizedName);
  if (existing) return existing;
  const task = resolve(artistName)
    .catch((error) => {
      libraryLog.warn(`Spotify 歌手图片获取失败: ${artistName}`, error);
      return undefined;
    })
    .finally(() => inFlight.delete(normalizedName));
  inFlight.set(normalizedName, task);
  return task;
};

/** 并发预取歌手图片 */
export const prefetchArtistImages = async (
  artistNames: string[],
  onResolved?: (artistName: string, image: string) => void,
): Promise<Record<string, string>> => {
  const queue = [...new Set(artistNames.map((name) => name.trim()).filter(Boolean))];
  const results: Record<string, string> = {};
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      const name = queue[cursor++];
      const image = await getArtistImage(name);
      if (image) {
        results[normalizeName(name)] = image;
        onResolved?.(name, image);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, queue.length) }, worker));
  libraryLog.info(`Spotify 歌手图片预取完成: ${Object.keys(results).length}/${queue.length}`);
  return results;
};
