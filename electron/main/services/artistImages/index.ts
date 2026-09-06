import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { fetchWithProxy } from "@main/utils/proxy";
import { getArtistCacheDir } from "@main/utils/config";
import { configDir } from "@main/utils/paths";
import { toCacheUrl } from "@main/utils/protocol";
import { libraryLog } from "@main/utils/logger";
import type { ArtistImageProviderStatus } from "@shared/types/artistImages";

const CREDENTIALS_FILE = path.join(configDir, "fanart.json");
const INDEX_FILE = "index.json";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const USER_AGENT = "SPlayer-Next/1.0 (artist artwork lookup)";

interface StoredCredentials {
  encryptedPersonalApiKey: string;
}

interface CacheEntry {
  checkedAt: number;
  fileName?: string;
}

type CacheIndex = Record<string, CacheEntry>;

interface MusicBrainzArtist {
  id: string;
  name: string;
  score?: number;
}

interface FanartImage {
  url?: string;
  likes?: string;
  lang?: string;
}

const inFlight = new Map<string, Promise<string | undefined>>();
let musicBrainzQueue = Promise.resolve();

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

const fileId = (value: string): string => createHash("sha256").update(value).digest("hex");

const encrypt = (value: string): string => {
  if (!value) return "";
  if (!safeStorage.isEncryptionAvailable()) return Buffer.from(value, "utf8").toString("base64");
  return safeStorage.encryptString(value).toString("base64");
};

const decrypt = (value: string): string => {
  if (!value) return "";
  try {
    const buffer = Buffer.from(value, "base64");
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buffer)
      : buffer.toString("utf8");
  } catch {
    return "";
  }
};

const getKey = async (): Promise<string> => {
  try {
    const raw = JSON.parse(await fs.readFile(CREDENTIALS_FILE, "utf8")) as StoredCredentials;
    return decrypt(raw.encryptedPersonalApiKey).trim();
  } catch {
    return "";
  }
};

const readIndex = async (): Promise<CacheIndex> => {
  try {
    return JSON.parse(
      await fs.readFile(path.join(getArtistCacheDir(), INDEX_FILE), "utf8"),
    ) as CacheIndex;
  } catch {
    return {};
  }
};

const writeIndex = async (index: CacheIndex): Promise<void> => {
  const dir = getArtistCacheDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, INDEX_FILE), JSON.stringify(index), "utf8");
};

const requestJson = async <T>(url: string): Promise<T | null> => {
  try {
    const response = await fetchWithProxy(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const downloadImage = async (url: string): Promise<Buffer | null> => {
  try {
    const response = await fetchWithProxy(url, {
      headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!response.ok || !response.body || (!type.startsWith("image/") && type !== "")) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_IMAGE_BYTES) return null;
      chunks.push(value);
    }
    return total ? Buffer.concat(chunks, total) : null;
  } catch {
    return null;
  }
};

const findMusicBrainzArtist = async (name: string): Promise<string | undefined> => {
  const requestTurn = musicBrainzQueue.then(
    () => new Promise<void>((resolve) => setTimeout(resolve, 1_100)),
  );
  musicBrainzQueue = requestTurn.catch(() => {});
  await requestTurn;
  const query = new URLSearchParams({ query: `artist:${name}`, fmt: "json", limit: "5" });
  const result = await requestJson<{ artists?: MusicBrainzArtist[] }>(
    `https://musicbrainz.org/ws/2/artist/?${query.toString()}`,
  );
  const normalized = normalizeName(name);
  const artists = result?.artists ?? [];
  return (artists.find((artist) => normalizeName(artist.name) === normalized) ?? artists[0])?.id;
};

const findFanartImage = async (musicBrainzId: string, key: string): Promise<string | undefined> => {
  const data = await requestJson<{ artistthumb?: FanartImage[] }>(
    `https://webservice.fanart.tv/v3.2/music/${encodeURIComponent(musicBrainzId)}?client_key=${encodeURIComponent(key)}`,
  );
  return (data?.artistthumb ?? [])
    .filter((image): image is FanartImage & { url: string } => Boolean(image.url))
    .sort((a, b) => Number(b.likes ?? 0) - Number(a.likes ?? 0))[0]?.url;
};

const resolve = async (artistName: string): Promise<string | undefined> => {
  const normalized = normalizeName(artistName);
  if (!normalized) return;
  const cachedFileName = `${fileId(normalized)}.jpg`;
  const cachedFilePath = path.join(getArtistCacheDir(), cachedFileName);
  try {
    await fs.access(cachedFilePath);
    return toCacheUrl(cachedFilePath);
  } catch {}
  const key = await getKey();
  if (!key) return;
  const index = await readIndex();
  const cached = index[normalized];
  const age = Date.now() - (cached?.checkedAt ?? 0);
  if (cached && age < (cached.fileName ? CACHE_TTL_MS : MISS_TTL_MS)) {
    if (!cached.fileName) return;
    const filePath = path.join(getArtistCacheDir(), cached.fileName);
    try {
      await fs.access(filePath);
      return toCacheUrl(filePath);
    } catch {}
  }

  const musicBrainzId = await findMusicBrainzArtist(artistName);
  const imageUrl = musicBrainzId ? await findFanartImage(musicBrainzId, key) : undefined;
  const bytes = imageUrl ? await downloadImage(imageUrl) : null;
  if (!bytes) {
    return;
  }
  const fileName = cachedFileName;
  const filePath = cachedFilePath;
  await fs.mkdir(getArtistCacheDir(), { recursive: true });
  await fs.writeFile(filePath, bytes);
  index[normalized] = { checkedAt: Date.now(), fileName };
  await writeIndex(index);
  return toCacheUrl(filePath);
};

/** 获取单个歌手头像，重复请求复用同一任务 */
export const getArtistImage = (artistName: string): Promise<string | undefined> => {
  const normalized = normalizeName(artistName);
  if (!normalized) return Promise.resolve(undefined);
  const existing = inFlight.get(normalized);
  if (existing) return existing;
  const task = resolve(artistName)
    .catch((error) => {
      libraryLog.warn(`Fanart 歌手图片获取失败: ${artistName}`, error);
      return undefined;
    })
    .finally(() => inFlight.delete(normalized));
  inFlight.set(normalized, task);
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
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
  return results;
};

/** 获取不暴露密钥的配置状态 */
export const getArtistImageProviderStatus = async (): Promise<ArtistImageProviderStatus> => ({
  hasPersonalApiKey: Boolean(await getKey()),
});

/** 保存个人密钥并清除旧的失败缓存 */
export const savePersonalApiKey = async (apiKey: string): Promise<ArtistImageProviderStatus> => {
  const value = apiKey.trim();
  if (!value) throw new Error("Fanart.tv personal API key is required");
  await fs.mkdir(configDir, { recursive: true });
  atomicWriteSync(
    CREDENTIALS_FILE,
    JSON.stringify({ encryptedPersonalApiKey: encrypt(value) }, null, 2),
  );
  const index = await readIndex();
  for (const [name, entry] of Object.entries(index)) {
    if (!entry.fileName) delete index[name];
  }
  await writeIndex(index);
  return getArtistImageProviderStatus();
};

/** 移除个人密钥 */
export const clearPersonalApiKey = async (): Promise<ArtistImageProviderStatus> => {
  await fs.rm(CREDENTIALS_FILE, { force: true });
  return getArtistImageProviderStatus();
};
