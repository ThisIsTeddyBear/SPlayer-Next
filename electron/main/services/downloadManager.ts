/**
 *
 */

import fs from "node:fs";
import fsp, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { app } from "electron";
import { store } from "@main/store";
import { getDownloadDir, getCoverCacheDir, getAppCacheDir } from "@main/utils/config";
import { broadcast } from "@main/utils/broadcast";
import { downloadLog } from "@main/utils/logger";
import { getEngine } from "@main/services/engine";
import { fetchBytes } from "@main/utils/fetchBytes";
import { renderDownloadPath, dedupePath, resolveExtension } from "@main/utils/filename";
import * as db from "@main/database/downloads";
import { ErrorCode } from "@shared/types/errors";
import type { JsTagWriteRequest } from "@splayer/audio-engine";
import type {
  DownloadRequest,
  DownloadResolvePayload,
  DownloadResolution,
  DownloadTask,
  EnqueueResult,
} from "@shared/types/download";

const PROGRESS_INTERVAL_MS = 250;
const REJECTED_MIME_PREFIXES = ["text/html", "application/json", "application/xml", "text/xml"];

const isRejectedMime = (mime: string | null): boolean =>
  !!mime && REJECTED_MIME_PREFIXES.some((prefix) => mime.toLowerCase().startsWith(prefix));

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

interface Pending {
  req: DownloadRequest;
  task: DownloadTask;
  controller: AbortController;
  dedupeKey: string;
  removed?: boolean;
}

const tasks = new Map<string, Pending>();
const queue: string[] = [];
let active: string | null = null;

interface ResolutionGate {
  resolve: (res: DownloadResolution) => void;
  reject: (err: Error) => void;
}

const resolutionGates = new Map<string, ResolutionGate>();

const tmpDir = (): string => path.join(getAppCacheDir(), "downloads-tmp");

const dedupeKeyOf = (req: DownloadRequest): string =>
  `${req.track.source}:${req.track.id}:${req.qualityLevel}`;

const artistString = (req: DownloadRequest): string =>
  req.track.artists.map((artist) => artist.name).join("/");

const broadcastState = (task: DownloadTask): void => {
  if (tasks.get(task.taskId)?.removed) return;
  db.upsert(task);
  broadcast("download:state", task);
};

const moveFile = async (src: string, dest: string): Promise<void> => {
  try {
    await fsp.rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    } else {
      throw err;
    }
  }
};

/**
 */
const streamToFile = async (
  body: ReadableStream<Uint8Array>,
  partPath: string,
  taskId: string,
  total: number,
  signal: AbortSignal,
): Promise<number> => {
  const reader = body.getReader();
  let received = 0;
  let lastTs = 0;
  const source = (async function* read() {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        received += value.length;
        const now = Date.now();
        if (now - lastTs >= PROGRESS_INTERVAL_MS) {
          lastTs = now;
          broadcast("download:progress", { taskId, received, total }, true);
        }
        yield value;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  })();
  await pipeline(source, fs.createWriteStream(partPath), { signal });
  return received;
};

const applyTags = async (req: DownloadRequest, filePath: string): Promise<boolean> => {
  const { tagOptions } = req;
  const writeRequest: JsTagWriteRequest = { path: filePath };
  let hasWrite = false;
  if (tagOptions.embedMeta) {
    writeRequest.title = req.track.title;
    writeRequest.artist = artistString(req);
    if (req.track.album?.name) writeRequest.album = req.track.album.name;
    hasWrite = true;
  }
  if (tagOptions.embedLyric && req.lyricText) {
    writeRequest.lyrics = req.lyricText;
    hasWrite = true;
  }
  if (tagOptions.embedCover && req.coverUrl) {
    const cover = await fetchBytes(req.coverUrl, { requireImage: true });
    if (cover) {
      writeRequest.cover = cover;
      hasWrite = true;
    } else {
      downloadLog.warn(`封面下载失败，跳过封面: ${req.coverUrl}`);
    }
  }
  if (!hasWrite) return true;
  try {
    const results = await getEngine().writeTrackTags([writeRequest], getCoverCacheDir());
    return results[0]?.success === true;
  } catch (err) {
    downloadLog.warn(`写标签失败 ${filePath}:`, err);
    return false;
  }
};

const writeSidecar = async (filePath: string, text: string): Promise<void> => {
  try {
    await fsp.writeFile(filePath, text, "utf-8");
  } catch (err) {
    downloadLog.warn(`写歌词文件失败 ${filePath}:`, err);
  }
};

const writeLyricFiles = async (req: DownloadRequest, audioPath: string): Promise<void> => {
  const base = audioPath.slice(0, audioPath.length - path.extname(audioPath).length);
  if (req.tagOptions.writeLrc && req.lyricText) await writeSidecar(`${base}.lrc`, req.lyricText);
  if (req.tagOptions.saveTtml && req.ttmlText) await writeSidecar(`${base}.ttml`, req.ttmlText);
};

const waitForResolution = (taskId: string, signal: AbortSignal): Promise<DownloadResolution> =>
  new Promise((resolve, reject) => {
    const onAbort = (): void => {
      resolutionGates.delete(taskId);
      reject(new Error("resolution aborted"));
    };
    const gate: ResolutionGate = {
      resolve: (res) => {
        resolutionGates.delete(taskId);
        signal.removeEventListener("abort", onAbort);
        resolve(res);
      },
      reject: (err) => {
        resolutionGates.delete(taskId);
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    };
    resolutionGates.set(taskId, gate);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });

export const submitResolution = (taskId: string, res: DownloadResolution): void => {
  resolutionGates.get(taskId)?.resolve(res);
};

export const failResolution = (taskId: string): void => {
  resolutionGates.get(taskId)?.reject(new Error("resolve failed"));
};

const runTask = async (
  req: DownloadRequest,
  task: DownloadTask,
  controller: AbortController,
): Promise<void> => {
  const partPath = path.join(tmpDir(), `${req.taskId}.part`);

  try {
    if (!req.url) {
      const payload: DownloadResolvePayload = {
        taskId: req.taskId,
        track: req.track,
        qualityLevel: req.qualityLevel,
        tagOptions: req.tagOptions,
        coverUrl: req.coverUrl,
        usePlaybackForDownload: req.usePlaybackForDownload,
        lyricFileFormat: req.lyricFileFormat,
      };
      const resolution = waitForResolution(req.taskId, controller.signal);
      broadcast("download:resolve", payload);
      Object.assign(req, await resolution);
    }
    const audioUrl = req.url;
    if (!audioUrl) throw new Error("missing download url");

    const downloadDir = getDownloadDir();
    const { relDir, baseName } = renderDownloadPath(
      store.get("download.folderScheme"),
      store.get("download.fileTemplate"),
      {
        artist: artistString(req),
        title: req.track.title,
        album: req.track.album?.name ?? "",
      },
    );
    const targetDir = path.join(downloadDir, relDir);
    const finalNoExt = path.join(targetDir, baseName);
    const policy = store.get("download.overwritePolicy");

    const guessExt = resolveExtension(req.declaredFormat, null, audioUrl);
    if (policy === "skip" && fs.existsSync(`${finalNoExt}${guessExt}`)) {
      task.status = "done";
      task.filePath = `${finalNoExt}${guessExt}`;
      task.finishedAt = Date.now();
      broadcastState(task);
      return;
    }

    await fsp.mkdir(tmpDir(), { recursive: true });
    await fsp.mkdir(targetDir, { recursive: true });

    const response = await fetch(audioUrl, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }
    const mime = response.headers.get("content-type");
    if (isRejectedMime(mime)) throw new Error(`rejected mime ${mime}`);
    const total = Number(response.headers.get("content-length")) || req.declaredSize || 0;

    const received = await streamToFile(
      response.body as ReadableStream<Uint8Array>,
      partPath,
      req.taskId,
      total,
      controller.signal,
    );
    if (received === 0) throw new Error("empty body");
    if (!(await looksLikeAudio(partPath))) throw new Error("not audio");

    const ext = resolveExtension(req.declaredFormat, mime, audioUrl);
    const finalPath = policy === "rename" ? dedupePath(finalNoExt, ext) : `${finalNoExt}${ext}`;
    await moveFile(partPath, finalPath);

    await writeLyricFiles(req, finalPath);
    const tagOk = await applyTags(req, finalPath);

    task.status = "done";
    task.received = received;
    task.total = total || received;
    task.filePath = finalPath;
    task.tagWarning = !tagOk;
    task.finishedAt = Date.now();
    broadcastState(task);
    downloadLog.info(`完成 ${req.track.title} → ${finalPath}`);
  } catch (err) {
    await fsp.unlink(partPath).catch(() => {});
    if (controller.signal.aborted) {
      task.status = "canceled";
    } else {
      task.status = "failed";
      task.errorCode = ErrorCode.UNKNOWN;
      downloadLog.error(`失败 ${req.track.title}:`, err);
    }
    task.finishedAt = Date.now();
    broadcastState(task);
  }
};

const pump = async (): Promise<void> => {
  if (active !== null) return;
  const taskId = queue.shift();
  if (taskId === undefined) return;
  const pending = tasks.get(taskId);
  if (!pending) return void pump();
  active = taskId;
  pending.task.status = "downloading";
  broadcastState(pending.task);
  try {
    await runTask(pending.req, pending.task, pending.controller);
  } finally {
    tasks.delete(taskId);
    active = null;
    void pump();
  }
};

const enqueueOne = (
  req: DownloadRequest,
  completedByQuality?: Map<string, DownloadTask[]>,
): EnqueueResult => {
  if (tasks.has(req.taskId)) return { ok: false, reason: "queued" };
  const dedupeKey = dedupeKeyOf(req);
  for (const pending of tasks.values()) {
    if (pending.dedupeKey === dedupeKey) return { ok: false, reason: "queued" };
  }
  let completed = completedByQuality?.get(req.qualityLevel);
  if (!completed) {
    completed = db.listCompletedByQuality(req.qualityLevel);
    completedByQuality?.set(req.qualityLevel, completed);
  }
  const downloaded = completed.find(
    (task) => task.track.source === req.track.source && task.track.id === req.track.id,
  );
  if (downloaded?.filePath && fs.existsSync(downloaded.filePath)) {
    return { ok: false, reason: "downloaded" };
  }
  const task: DownloadTask = {
    taskId: req.taskId,
    status: "queued",
    track: req.track,
    qualityLevel: req.qualityLevel,
    received: 0,
    total: req.declaredSize ?? 0,
    createdAt: Date.now(),
  };
  tasks.set(req.taskId, { req, task, controller: new AbortController(), dedupeKey });
  queue.push(req.taskId);
  broadcastState(task);
  void pump();
  return { ok: true };
};

export const enqueue = (req: DownloadRequest): EnqueueResult => enqueueOne(req);

export const enqueueMany = (reqs: DownloadRequest[]): EnqueueResult[] => {
  const completedByQuality = new Map<string, DownloadTask[]>();
  return reqs.map((req) => enqueueOne(req, completedByQuality));
};

export const cancel = (taskId: string): void => {
  const pending = tasks.get(taskId);
  if (!pending) return;
  if (active === taskId) {
    pending.controller.abort();
    return;
  }
  const idx = queue.indexOf(taskId);
  if (idx !== -1) queue.splice(idx, 1);
  tasks.delete(taskId);
  pending.task.status = "canceled";
  pending.task.finishedAt = Date.now();
  broadcastState(pending.task);
};

const LYRIC_SIDECAR_EXTS = [".lrc", ".qrc", ".yrc", ".krc", ".ttml", ".lys"];

/**
 */
const deleteDownloadedFile = async (filePath: string): Promise<void> => {
  await fsp.unlink(filePath).catch(() => {});
  const base = filePath.slice(0, filePath.length - path.extname(filePath).length);
  await Promise.all(LYRIC_SIDECAR_EXTS.map((ext) => fsp.unlink(`${base}${ext}`).catch(() => {})));
};

/**
 */
export const remove = (taskId: string): void => {
  const pending = tasks.get(taskId);
  if (pending) {
    pending.removed = true;
    if (active === taskId) {
      pending.controller.abort();
    } else {
      const idx = queue.indexOf(taskId);
      if (idx !== -1) queue.splice(idx, 1);
      tasks.delete(taskId);
    }
  }
  const filePath = db.findById(taskId)?.filePath;
  db.remove(taskId);
  if (filePath) void deleteDownloadedFile(filePath);
};

export const clearFinished = (): void => db.clearFinished();

export const list = (): DownloadTask[] => db.listAll();

export const init = async (): Promise<void> => {
  db.markInterrupted();
  const dir = tmpDir();
  try {
    const entries = await fsp.readdir(dir);
    await Promise.all(entries.map((name) => fsp.unlink(path.join(dir, name)).catch(() => {})));
  } catch {}
  app.on("before-quit", () => {
    for (const pending of tasks.values()) pending.controller.abort();
  });
};
