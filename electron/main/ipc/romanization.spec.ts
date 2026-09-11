import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  handle: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("./trusted", () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock("@main/utils/logger", () => ({ systemLog: { info: mocks.info, warn: mocks.warn } }));

const { registerRomanizationIpc, romanizeLines } = await import("./romanization");

describe("Google Translate 罗马音", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.handle.mockReset();
    mocks.info.mockReset();
    mocks.warn.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses the source transliteration returned by Google Translate", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify([[["you also have news", "तुमको भी है खबर", null, "tumko bhi hai khabar"]]]),
      ),
    );

    await expect(romanizeLines(["तुमको भी है खबर"])).resolves.toEqual({
      "तुमको भी है खबर": "tumko bhi hai khabar",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not send Latin lyric lines to Google Translate", async () => {
    await expect(romanizeLines(["Already Romanized"])).resolves.toEqual({});
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("registers the renderer-only IPC handler", () => {
    registerRomanizationIpc();
    expect(mocks.handle).toHaveBeenCalledWith("lyrics:romanize", expect.any(Function));
  });
});
