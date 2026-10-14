// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  quit: (() => {}) as () => void,
  error: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {
    on: (_event: string, callback: () => void) => {
      mocks.quit = callback;
    },
  },
}));
vi.mock("node:fs", () => ({
  default: { readFileSync: mocks.read, existsSync: () => true, mkdirSync: vi.fn() },
}));
vi.mock("atomically", () => ({ writeFileSync: mocks.write }));
vi.mock("@main/utils/paths", () => ({ configDir: "config" }));
vi.mock("@main/utils/logger", () => ({ systemLog: { error: mocks.error } }));
vi.mock("./migrations", () => ({ migrations: [] }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.read.mockReset().mockReturnValue("{}");
  mocks.write.mockReset();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each(["{ broken", "[]", "null"])(
  "preserves an unreadable settings document %s",
  async (content) => {
    mocks.read.mockReturnValue(content);
    const { store } = await import("./index");
    expect(mocks.write).not.toHaveBeenCalled();
    expect(() => store.set("library.scanDirs", ["music"])).toThrow();
    mocks.quit();
    expect(mocks.write).not.toHaveBeenCalled();
    store.clear();
    expect(mocks.write).toHaveBeenCalledOnce();
  },
);

it("creates defaults only when the file is missing", async () => {
  mocks.read.mockImplementation(() => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  });
  await import("./index");
  expect(mocks.write).toHaveBeenCalledOnce();
});

it("can start with in-memory settings when startup persistence fails", async () => {
  mocks.write.mockImplementation(() => {
    throw new Error("ENOSPC");
  });
  const { store } = await import("./index");
  expect(store.get("library.scanDirs")).toEqual([]);
  expect(mocks.error).toHaveBeenCalled();
  expect(() => store.flushImmediate()).toThrow("ENOSPC");
});

it("surfaces immediate writes and logs deferred write failures", async () => {
  const { store } = await import("./index");
  mocks.write.mockImplementation(() => {
    throw new Error("ENOSPC");
  });
  store.set("library.scanDirs", ["music"]);
  expect(() => store.flushImmediate()).toThrow("ENOSPC");
  store.set("library.scanDirs", []);
  vi.runAllTimers();
  expect(mocks.error).toHaveBeenCalled();
});
