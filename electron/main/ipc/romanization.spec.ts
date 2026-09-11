import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  handle: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  getCachedRomanizations: vi.fn(),
  setCachedRomanizations: vi.fn(),
}));

vi.mock("./trusted", () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock("@main/utils/logger", () => ({ systemLog: { info: mocks.info, warn: mocks.warn } }));
vi.mock("@main/database/lyricRomanizationCache", () => ({
  getCachedRomanizations: mocks.getCachedRomanizations,
  setCachedRomanizations: mocks.setCachedRomanizations,
}));

const { registerRomanizationIpc, romanizeLines } = await import("./romanization");

describe("Google Translate romanization", () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.handle.mockReset();
    mocks.info.mockReset();
    mocks.warn.mockReset();
    mocks.getCachedRomanizations.mockReset();
    mocks.getCachedRomanizations.mockReturnValue({});
    mocks.setCachedRomanizations.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses the source transliteration returned by Google Translate", async () => {
    const line = "\u0924\u0941\u092e\u0915\u094b \u092d\u0940 \u0939\u0948 \u0916\u092c\u0930";
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify([[["you also have news", line, null, "tumko bhi hai khabar"]]])),
    );

    await expect(romanizeLines([line])).resolves.toEqual({ [line]: "tumko bhi hai khabar" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.setCachedRomanizations).toHaveBeenCalledWith({ [line]: "tumko bhi hai khabar" });
  });

  it("uses persistent cached romanization before calling Google Translate", async () => {
    const line = "\uC548\uB155\uD558\uC138\uC694";
    mocks.getCachedRomanizations.mockReturnValue({ [line]: "annyeonghaseyo" });

    await expect(romanizeLines([line])).resolves.toEqual({ [line]: "annyeonghaseyo" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.setCachedRomanizations).toHaveBeenCalledWith({});
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
