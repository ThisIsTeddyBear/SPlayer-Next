// @vitest-environment node
import path from "node:path";
import { Writable } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";
import type { DownloadRequest, DownloadTask } from "@shared/types/download";

const mocks = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  records: new Map<string, DownloadTask>(),
  fetch: vi.fn(),
  failedDeletion: false,
  failedSidecar: false,
  policy: "skip",
  link: vi.fn(),
}));
vi.mock("electron", () => ({ app: { on: vi.fn() } }));
vi.mock("node:fs", () => ({
  default: {
    constants: { COPYFILE_EXCL: 1 },
    existsSync: (filename: string) => mocks.files.has(filename),
    createWriteStream: (filename: string) =>
      new Writable({
        write(chunk, _encoding, callback) {
          const previous = mocks.files.get(filename) ?? Buffer.alloc(0);
          mocks.files.set(filename, Buffer.concat([previous, Buffer.from(chunk)]));
          callback();
        },
      }),
  },
}));
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn(),
    link: mocks.link,
    rename: async (src: string, dest: string) => {
      mocks.files.set(dest, mocks.files.get(src)!);
      mocks.files.delete(src);
    },
    unlink: async (filename: string) => {
      if (mocks.failedDeletion && filename === "locked.flac")
        throw Object.assign(new Error("locked"), { code: "EPERM" });
      if (!mocks.files.delete(filename))
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    writeFile: async (filename: string, content: string) => {
      if (mocks.failedSidecar) throw new Error("ENOSPC");
      mocks.files.set(filename, Buffer.from(content));
    },
    open: async (filename: string) => ({
      read: async (buffer: Buffer) => ({
        bytesRead: mocks.files.get(filename)!.copy(buffer, 0, 0, 4),
      }),
      close: async () => {},
    }),
  },
}));
vi.mock("@main/store", () => ({
  store: {
    get: (key: string) =>
      ({
        "download.folderScheme": "none",
        "download.fileTemplate": "{title}",
        "download.overwritePolicy": mocks.policy,
      })[key],
  },
}));
vi.mock("@main/utils/config", () => ({
  getDownloadDir: () => "downloads",
  getCoverCacheDir: () => "covers",
  getAppCacheDir: () => "cache",
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: vi.fn() }));
vi.mock("@main/utils/logger", () => ({
  downloadLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@main/services/engine", () => ({
  getEngine: () => ({ writeTrackTags: async () => [{ success: true }] }),
}));
vi.mock("@main/utils/fetchBytes", () => ({ fetchBytes: vi.fn() }));
vi.mock("@main/database/downloads", () => ({
  upsert: (task: DownloadTask) => mocks.records.set(task.taskId, { ...task }),
  listCompletedByQuality: () => [],
  findById: (id: string) => mocks.records.get(id),
  remove: (id: string) => mocks.records.delete(id),
}));

const request = (): DownloadRequest => ({
  taskId: "test",
  url: "https://example.test/audio",
  qualityLevel: "hq",
  track: { id: "song", source: "local", title: "song", artists: [], duration: 1000 },
  tagOptions: {
    embedCover: false,
    embedMeta: false,
    embedLyric: false,
    writeLrc: false,
    saveTtml: false,
  },
  usePlaybackForDownload: false,
  lyricFileFormat: "lrc",
});

beforeEach(() => {
  vi.resetModules();
  mocks.files.clear();
  mocks.records.clear();
  mocks.failedDeletion = false;
  mocks.failedSidecar = false;
  mocks.policy = "skip";
  mocks.link.mockReset().mockImplementation(async (src: string, dest: string) => {
    if (mocks.files.has(dest)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
    mocks.files.set(dest, mocks.files.get(src)!);
  });
  mocks.fetch.mockReset().mockImplementation(
    async () =>
      new Response(new Uint8Array([102, 76, 97, 67]), {
        headers: { "content-type": "audio/flac" },
      }),
  );
  vi.stubGlobal("fetch", mocks.fetch);
});

it("honors skip after the response reveals an existing FLAC destination", async () => {
  const filename = path.join("downloads", "song.flac");
  mocks.files.set(filename, Buffer.from("original"));
  const manager = await import("./downloadManager");
  manager.enqueue(request());
  await vi.waitFor(() => expect(mocks.records.get("test")?.status).toBe("done"));
  expect(mocks.files.get(filename)?.toString()).toBe("original");
  expect(mocks.link).not.toHaveBeenCalled();
});

it("does not skip FLAC because an unrelated guessed MP3 filename exists", async () => {
  const mp3 = path.join("downloads", "song.mp3");
  mocks.files.set(mp3, Buffer.from("original"));
  const manager = await import("./downloadManager");
  manager.enqueue(request());
  await vi.waitFor(() => expect(mocks.records.get("test")?.status).toBe("done"));
  expect(mocks.records.get("test")?.filePath).toBe(path.join("downloads", "song.flac"));
  expect(mocks.files.get(mp3)?.toString()).toBe("original");
});

it("atomically avoids collisions when a destination appears during download", async () => {
  const filename = path.join("downloads", "song.flac");
  mocks.link.mockImplementationOnce(async () => {
    mocks.files.set(filename, Buffer.from("other process"));
    throw Object.assign(new Error("exists"), { code: "EEXIST" });
  });
  const manager = await import("./downloadManager");
  manager.enqueue(request());
  await vi.waitFor(() => expect(mocks.records.get("test")?.status).toBe("done"));
  expect(mocks.files.get(filename)?.toString()).toBe("other process");
});

it("keeps the task when its file cannot be deleted", async () => {
  mocks.failedDeletion = true;
  const task = { taskId: "locked", filePath: "locked.flac", status: "done" } as DownloadTask;
  mocks.records.set("locked", task);
  const manager = await import("./downloadManager");
  await expect(manager.remove("locked")).rejects.toMatchObject({ code: "EPERM" });
  expect(mocks.records.has("locked")).toBe(true);
});

it("warns about failed lyric sidecars while keeping the downloaded audio", async () => {
  mocks.failedSidecar = true;
  const req = request();
  req.tagOptions.writeLrc = true;
  req.lyricText = "[00:01]Lyric";
  const manager = await import("./downloadManager");
  manager.enqueue(req);
  await vi.waitFor(() => expect(mocks.records.get("test")?.status).toBe("done"));
  expect(mocks.records.get("test")?.tagWarning).toBe(true);
  expect(mocks.files.has(path.join("downloads", "song.flac"))).toBe(true);
});

it("waits for an active download to cancel before clearing data", async () => {
  mocks.fetch.mockImplementation(
    (_url, { signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  );
  const manager = await import("./downloadManager");
  manager.enqueue(request());
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  await manager.cancelAll();
  expect(mocks.records.get("test")?.status).toBe("canceled");
});
