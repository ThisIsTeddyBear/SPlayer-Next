import fs from "node:fs";
import fsp, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { app } from "electron";
import { store } from "@main/store";
import { getSongCacheDir } from "@main/utils/config";
import { songCacheLog } from "@main/utils/logger";
import type { TrackSource } from "@shared/types/player";
import {
  clearAll as dbClearAll,
  deleteByKey,
  findByFilename,
  findByKey,
  listAllFilenames,
  listLruVictims,
  totalSize,
  touchLastUsed,
  upsert,
} from "@main/database/songCache";

const MAX_CONCURRENT = 2;
const EVICT_BATCH = 8;

/**
 */
const REJECTED_MIME_PREFIXES = ["text/html", "application/json", "application/xml", "text/xml"];

const isRejectedMime = (mime: string | null): boolean => {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  return REJECTED_MIME_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

/**
 *
 */
const looksLikeAudio = async (filePath: string): Promise<boolean> => {
  let fd: FileHandle | null = null;
  try {
    fd = await fsp.open(filePath, "r");
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fd.read(buf, 0, 4, 0);
    if (bytesRead === 0) return false;
    return buf[0] !== 0x3c && buf[0] !== 0x7b && buf[0] !== 0x5b;
  } catch {
    return false;
  } finally {
    if (fd) await fd.close().catch(() => {});
  }
};

interface InFlight {
  promise: Promise<string | null>;
  controller: AbortController;
}

let cacheDir = getSongCacheDir();
const inFlight = new Map<string, InFlight>();
const waiting: Array<() => void> = [];

const sizeLimitBytes = (): number => {
  const gb = store.get("cache.songCache.sizeLimitGb") ?? 10;
  return gb > 0 ? gb * 1024 * 1024 * 1024 : Number.POSITIVE_INFINITY;
};

const isCacheEnabled = (): boolean => store.get("cache.songCache.enabled") === true;

/**
 */
const filenameFor = (cacheKey: string): string => {
  const hash = crypto.createHash("sha1").update(cacheKey).digest("hex").slice(0, 16);
  return `${hash}.bin`;
};

 */
const absPath = (filename: string): string => path.join(cacheDir, filename);

/**
 * @returns
 */
const acquireSlot = async (): Promise<void> => {
  if (inFlight.size < MAX_CONCURRENT) return;
  await new Promise<void>((resolve) => waiting.push(resolve));
};

/**
 * @returns
 */
const releaseSlot = (): void => {
  const next = waiting.shift();
  if (next) next();
};

/**
 */
const cleanupOrphans = async (): Promise<void> => {
  let entries: string[];
  try {
    entries = await fsp.readdir(cacheDir);
  } catch {
    return;
  }

  let partRemoved = 0;
  let orphanFiles = 0;
  for (const name of entries) {
    if (name.endsWith(".part")) {
      try {
        await fsp.unlink(path.join(cacheDir, name));
        partRemoved += 1;
      } catch {}
    }
  }

  const known = new Set(listAllFilenames());
  for (const name of entries) {
    if (name.endsWith(".part")) continue;
    if (!known.has(name)) {
      try {
        await fsp.unlink(path.join(cacheDir, name));
        orphanFiles += 1;
      } catch {}
    }
  }

  let missingRows = 0;
  for (const filename of known) {
    if (!fs.existsSync(path.join(cacheDir, filename))) {
      const row = findByFilename(filename);
      if (row) deleteByKey(row.cacheKey);
      missingRows += 1;
    }
  }

  songCacheLog.info(
    `[init] dir=${cacheDir} orphans.part=${partRemoved} orphan-files=${orphanFiles} missing-rows=${missingRows}`,
  );
};

/**
 */
const evictIfNeeded = async (): Promise<void> => {
  const cap = sizeLimitBytes();
  let current = totalSize();
  if (current <= cap) return;

  let evicted = 0;
  let freed = 0;
  while (current > cap) {
    const victims = listLruVictims(EVICT_BATCH);
    if (victims.length === 0) break;
    for (const victim of victims) {
      try {
        await fsp.unlink(absPath(victim.filename));
      } catch {}
      deleteByKey(victim.cacheKey);
      current -= victim.size;
      freed += victim.size;
      evicted += 1;
    }
  }
  if (evicted > 0) songCacheLog.info(`[evict] count=${evicted} freed=${freed}`);
};

/**
 */
const runDownload = async (
  cacheKey: string,
  source: TrackSource,
  streamUrl: string,
  controller: AbortController,
): Promise<string | null> => {
  const start = Date.now();
  const filename = filenameFor(cacheKey);
  const finalPath = absPath(filename);
  const partPath = `${finalPath}.part`;

  try {
    await fsp.mkdir(cacheDir, { recursive: true });
    const response = await fetch(streamUrl, { signal: controller.signal });
    if (!response.ok || !response.body) {
      songCacheLog.warn(`[fetch] fail key=${cacheKey} status=${response.status}`);
      return null;
    }

    const mime = response.headers.get("content-type");
    if (isRejectedMime(mime)) {
      songCacheLog.warn(`[fetch] reject mime key=${cacheKey} mime=${mime}`);
      return null;
    }
    const contentLengthHeader = response.headers.get("content-length");
    const declaredSize = contentLengthHeader ? Number(contentLengthHeader) : NaN;
    if (Number.isFinite(declaredSize) && declaredSize > sizeLimitBytes()) {
      songCacheLog.warn(`[fetch] skip oversize key=${cacheKey} declared=${declaredSize}`);
      return null;
    }

    const nodeStream = Readable.fromWeb(response.body as never);
    const writeStream = fs.createWriteStream(partPath);
    await pipeline(nodeStream, writeStream);

    const stat = await fsp.stat(partPath);
    if (stat.size === 0) {
      await fsp.unlink(partPath).catch(() => {});
      songCacheLog.warn(`[fetch] empty key=${cacheKey}`);
      return null;
    }
    if (stat.size > sizeLimitBytes()) {
      await fsp.unlink(partPath).catch(() => {});
      songCacheLog.warn(`[fetch] post oversize key=${cacheKey} actual=${stat.size}`);
      return null;
    }
    if (!(await looksLikeAudio(partPath))) {
      await fsp.unlink(partPath).catch(() => {});
      songCacheLog.warn(`[fetch] not audio key=${cacheKey} mime=${mime} size=${stat.size}`);
      return null;
    }

    await fsp.rename(partPath, finalPath);
    const now = Date.now();
    upsert({
      cacheKey,
      source,
      filename,
      size: stat.size,
      mime,
      cachedAt: now,
      lastUsedAt: now,
    });
    await evictIfNeeded();

    songCacheLog.info(`[fetch] done key=${cacheKey} size=${stat.size} ms=${Date.now() - start}`);
    return finalPath;
  } catch (err) {
    await fsp.unlink(partPath).catch(() => {});
    if (controller.signal.aborted) {
      songCacheLog.info(`[fetch] cancel key=${cacheKey}`);
    } else {
      songCacheLog.error(`[fetch] error key=${cacheKey}`, err);
    }
    return null;
  }
};

export const init = async (): Promise<void> => {
  cacheDir = getSongCacheDir();
  await fsp.mkdir(cacheDir, { recursive: true });
  await cleanupOrphans();
  app.on("before-quit", () => {
    for (const entry of inFlight.values()) entry.controller.abort();
  });
};

export const reloadDir = (): void => {
  cacheDir = getSongCacheDir();
};

export const lookup = async (cacheKey: string): Promise<string | null> => {
  if (!isCacheEnabled()) return null;
  const row = findByKey(cacheKey);
  if (!row) return null;
  const full = absPath(row.filename);
  if (!fs.existsSync(full)) {
    deleteByKey(cacheKey);
    return null;
  }
  touchLastUsed(cacheKey, Date.now());
  return full;
};

/**
 */
export const fetchAsync = (
  cacheKey: string,
  source: TrackSource,
  streamUrl: string,
): Promise<string | null> => {
  if (!isCacheEnabled()) return Promise.resolve(null);
  const existing = inFlight.get(cacheKey);
  if (existing) return existing.promise;

  const controller = new AbortController();
  const promise = (async () => {
    await acquireSlot();
    try {
      return await runDownload(cacheKey, source, streamUrl, controller);
    } finally {
      inFlight.delete(cacheKey);
      releaseSlot();
    }
  })();
  inFlight.set(cacheKey, { promise, controller });
  return promise;
};

/**
 */
export const cancel = (cacheKey: string): void => {
  const entry = inFlight.get(cacheKey);
  if (entry) entry.controller.abort();
};

/**
 */
export const invalidate = async (sourcePath: string): Promise<void> => {
  const filename = path.basename(sourcePath);
  const row = findByFilename(filename);
  if (!row) return;
  deleteByKey(row.cacheKey);
  await fsp.unlink(absPath(filename)).catch(() => {});
  songCacheLog.info(`[invalidate] path=${sourcePath}`);
};

export const clearAll = async (): Promise<void> => {
  for (const entry of inFlight.values()) entry.controller.abort();
  inFlight.clear();
  dbClearAll();
  try {
    const entries = await fsp.readdir(cacheDir);
    await Promise.all(entries.map((name) => fsp.unlink(path.join(cacheDir, name)).catch(() => {})));
  } catch {}
  songCacheLog.info("[clearAll] done");
};

export const stats = (): { size: number; path: string } => ({
  size: totalSize(),
  path: cacheDir,
});
