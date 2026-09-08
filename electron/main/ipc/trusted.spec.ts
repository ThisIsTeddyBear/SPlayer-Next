// @vitest-environment node
import { expect, it, vi } from "vitest";
import { ipcMain as electronIpcMain } from "electron";
import { ipcMain } from "./trusted";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }));
vi.mock("@main/utils/logger", () => ({ systemLog: { warn: vi.fn() } }));
vi.mock("@main/utils/windowSecurity", () => ({
  getTrustedDocument: (url: string) => (url.startsWith("trusted:") ? url.slice(8) : undefined),
}));

const eventFor = (document: string, subframe = false) => {
  const mainFrame = { url: document };
  return {
    senderFrame: subframe ? { url: document } : mainFrame,
    sender: { mainFrame, isDestroyed: () => false },
  } as Parameters<Parameters<typeof electronIpcMain.handle>[1]>[0];
};

it("rejects untrusted documents and subframes before invoking privileged handlers", () => {
  const handler = vi.fn();
  ipcMain.handle("config:reset", handler);
  const wrapped = vi.mocked(electronIpcMain.handle).mock.calls[0][1];
  expect(() => wrapped(eventFor("https://remote.test"))).toThrow("Untrusted");
  expect(() => wrapped(eventFor("trusted:index.html", true))).toThrow("Untrusted");
  expect(handler).not.toHaveBeenCalled();
});

it("lyric windows can read their own settings but not another window or secrets", () => {
  const handler = vi.fn();
  ipcMain.handle("config:get", handler);
  const wrapped = vi.mocked(electronIpcMain.handle).mock.calls[0][1];
  const lyric = eventFor("trusted:windows/desktop-lyric/index.html");
  wrapped(lyric, "desktopLyric");
  expect(handler).toHaveBeenCalledOnce();
  expect(() => wrapped(lyric, "externalApi.accessKey")).toThrow("Untrusted");
  expect(() => wrapped(lyric, "dynamicIsland")).toThrow("Untrusted");
});

it("validates native arguments even for the trusted main document", () => {
  const handler = vi.fn();
  ipcMain.handle("player:setVolume", handler);
  const wrapped = vi.mocked(electronIpcMain.handle).mock.calls[0][1];
  expect(() => wrapped(eventFor("trusted:index.html"), NaN)).toThrow("Invalid numeric");
  wrapped(eventFor("trusted:index.html"), 0.5);
  expect(handler).toHaveBeenCalledOnce();
});
