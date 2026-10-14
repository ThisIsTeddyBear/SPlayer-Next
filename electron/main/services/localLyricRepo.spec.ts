// @vitest-environment node
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  files: ["old.ttml"],
  change: (() => {}) as () => void,
  close: vi.fn(),
}));
vi.mock("node:fs", () => ({
  watch: (_dir: string, _options: unknown, callback: () => void) => {
    mocks.change = callback;
    return { close: mocks.close, on: vi.fn() };
  },
}));
vi.mock("node:fs/promises", () => ({
  stat: async () => ({ mtimeMs: 1 }),
  readdir: async (dir: string) =>
    dir === "/repo"
      ? [{ name: "nested", isDirectory: () => true }]
      : mocks.files.map((name) => ({ name, isDirectory: () => false, isFile: () => true })),
}));
vi.mock("@main/utils/encoding", () => ({
  readFileAutoEncoding: async (filename: string) =>
    `<tt><head><amll:meta key="musicName" value="${path.basename(filename, ".ttml")}"/></head><body/></tt>`,
}));
vi.mock("@main/store", () => ({
  store: { get: (key: string) => (key === "localLyric.repoDir" ? "/repo" : true) },
}));
vi.mock("@main/database/lyricMatchCache", () => ({
  buildFingerprint: () => "key",
  getMatchedId: () => null,
}));
vi.mock("@main/utils/logger", () => ({ coreLog: { info: vi.fn(), warn: vi.fn() } }));

beforeEach(() => {
  vi.resetModules();
  mocks.files = ["old.ttml"];
  mocks.close.mockClear();
});
const track = (title: string) => ({
  id: title,
  title,
  artists: [],
  source: "local" as const,
  duration: 0,
});

it("refreshes nested lyrics when the root mtime has not changed", async () => {
  const repo = await import("./localLyricRepo");
  expect(await repo.matchLocalTTML(track("old"))).toBeTruthy();
  mocks.files.push("new.ttml");
  mocks.change();
  expect(await repo.matchLocalTTML(track("new"))).toBeTruthy();
  repo.invalidateLocalLyricRepo();
  expect(mocks.close).toHaveBeenCalled();
});
