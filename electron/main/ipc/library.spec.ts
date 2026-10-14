// @vitest-environment node
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  dirs: [] as string[],
  selected: "",
  set: vi.fn(),
  deleted: vi.fn(),
}));
vi.mock("./trusted", () => ({
  ipcMain: {
    handle: (channel: string, callback: (...args: any[]) => any) =>
      mocks.handlers.set(channel, callback),
  },
}));
vi.mock("electron", () => ({
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [mocks.selected] }) },
  shell: {},
}));
vi.mock("@main/store", () => ({ store: { get: () => mocks.dirs, set: mocks.set } }));
vi.mock("@main/database", () => ({ deleteTracksByDir: mocks.deleted }));
vi.mock("@main/services/scanner", () => ({}));
vi.mock("@main/services/engine", () => ({}));
vi.mock("@main/utils/fetchBytes", () => ({}));
vi.mock("@main/utils/config", () => ({}));
vi.mock("@main/utils/logger", () => ({ libraryLog: { info: vi.fn() } }));
vi.mock("@main/services/artistImages", () => ({}));
vi.mock("@main/services/metadataLookup", () => ({}));

beforeEach(async () => {
  vi.resetModules();
  mocks.handlers.clear();
  vi.clearAllMocks();
  const library = await import("./library");
  library.registerLibraryIpc();
});

it.each([true, false])(
  "rejects folder overlap before modifying configuration (parent: %s)",
  async (parent) => {
    const root = path.resolve("music");
    const child = path.join(root, "artist");
    mocks.dirs = [parent ? child : root];
    mocks.selected = parent ? root : child;
    expect(await mocks.handlers.get("library:addScanDir")!(null)).toEqual({
      success: false,
      error: "nested",
    });
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.deleted).not.toHaveBeenCalled();
  },
);
