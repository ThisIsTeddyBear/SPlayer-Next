// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  unlink: vi.fn(),
  clear: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("electron", () => ({ app: { on: vi.fn() } }));
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn(),
    readdir: mocks.read,
    unlink: mocks.unlink,
  },
}));
vi.mock("@main/store", () => ({ store: { get: () => true } }));
vi.mock("@main/utils/config", () => ({ getSongCacheDir: () => "cache/songs" }));
vi.mock("@main/utils/logger", () => ({ songCacheLog: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@main/database/songCache", () => ({
  clearAll: mocks.clear,
  deleteByKey: vi.fn(),
  findByFilename: vi.fn(),
  findByKey: vi.fn(),
  listAllFilenames: vi.fn(),
  listLruVictims: vi.fn(),
  totalSize: vi.fn(),
  touchLastUsed: vi.fn(),
  upsert: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  mocks.clear.mockReset();
  mocks.read.mockReset().mockResolvedValue(["song.bin"]);
  mocks.unlink.mockReset().mockResolvedValue(undefined);
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

it("retains cache records and reports a locked cached file", async () => {
  mocks.unlink.mockRejectedValueOnce(Object.assign(new Error("locked"), { code: "EPERM" }));
  const cache = await import("./songCache");
  await expect(cache.clearAll()).rejects.toMatchObject({ code: "EPERM" });
  expect(mocks.clear).not.toHaveBeenCalled();
  await cache.clearAll();
  expect(mocks.clear).toHaveBeenCalledOnce();
});

it("clears database records when the cache directory is already absent", async () => {
  mocks.read.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));
  const cache = await import("./songCache");
  await cache.clearAll();
  expect(mocks.clear).toHaveBeenCalledOnce();
});

it("waits for cancellation and blocks new downloads during cache clearing", async () => {
  mocks.fetch.mockImplementation(
    (_url, { signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  );
  const cache = await import("./songCache");
  const pending = cache.fetchAsync("old", "netease", "https://example.test/audio");
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  const clearing = cache.clearAll();
  expect(await cache.fetchAsync("new", "netease", "https://example.test/audio")).toBeNull();
  await clearing;
  expect(await pending).toBeNull();
  expect(mocks.clear).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledOnce();
});
