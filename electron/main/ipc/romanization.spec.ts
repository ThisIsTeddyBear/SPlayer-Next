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

  it("stops the batch after Google Translate returns an HTML page", async () => {
    const firstLine = "\u0924\u0941\u092e\u0915\u094b \u092d\u0940 \u0939\u0948 \u0916\u092c\u0930";
    const secondLine =
      "\u092e\u0948\u0902 \u0924\u0941\u092e\u0938\u0947 \u092a\u094d\u092f\u093e\u0930 \u0915\u0930\u0924\u093e \u0939\u0942\u0901";
    mocks.fetch.mockResolvedValue(
      new Response("<html><head><title>Blocked</title></head></html>", {
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(romanizeLines([firstLine, secondLine])).resolves.toEqual({});
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith(
      "[romanization] Google Translate unavailable; stopped after a failed request (additional requests avoided: 1)",
      expect.objectContaining({
        message: "Google Translate returned HTML instead of JSON (HTTP 200 (text/html))",
      }),
    );
  });

  it("requests duplicate lyric text only once", async () => {
    const line = "\u0924\u0941\u092e\u0915\u094b \u092d\u0940 \u0939\u0948 \u0916\u092c\u0930";
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify([[["you also have news", line, null, "tumko bhi hai khabar"]]])),
    );

    await expect(romanizeLines([line, line])).resolves.toEqual({ [line]: "tumko bhi hai khabar" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("batches multiple non-latin lines into a single delimited query", async () => {
    const line1 = "\u0924\u0941\u092e\u0915\u094b \u092d\u0940 \u0939\u0948 \u0916\u092c\u0930";
    const line2 =
      "\u092e\u0948\u0902 \u0924\u0941\u092e\u0938\u0947 \u092a\u094d\u092f\u093e\u0930";
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify([[[null, null, null, "tumko bhi hai khabar | main tumse pyaar"]]]),
      ),
    );

    const res = await romanizeLines([line1, line2]);
    expect(res).toEqual({
      [line1]: "tumko bhi hai khabar",
      [line2]: "main tumse pyaar",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toContain(encodeURIComponent(`${line1} | ${line2}`));
  });

  it("falls back to single-line requests when batched delimiter count does not match", async () => {
    const line1 = "\u0924\u0941\u092e\u0915\u094b \u092d\u0940 \u0939\u0948 \u0916\u092c\u0930";
    const line2 =
      "\u092e\u0948\u0902 \u0924\u0941\u092e\u0938\u0947 \u092a\u094d\u092f\u093e\u0930";
    // First call (batch): returns unmatched reading without delimiter
    // Second & third calls (fallback): return individual readings
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify([[[null, null, null, "unmatched reading without pipe"]]])),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([[[null, null, null, "tumko bhi hai khabar"]]])),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([[[null, null, null, "main tumse pyaar"]]])),
      );

    const res = await romanizeLines([line1, line2]);
    expect(res).toEqual({
      [line1]: "tumko bhi hai khabar",
      [line2]: "main tumse pyaar",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it("simplifies Indic scholarly diacritics and Gurmukhi contractions in batch mode", async () => {
    const line1 = "ਮਸਤੀ ’ਚ ਮਸਤਾਈ ਜ਼ਹਿਰੀ ਜਵਾਨੀ";
    const line2 = "ਨੱਚਣਾ";
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify([[[null, null, null, "Masatī’ca masatā'ī zahirī javānī | nacaṇā"]]]),
      ),
    );

    const res = await romanizeLines([line1, line2]);
    expect(res).toEqual({
      [line1]: "Masati'ch masata'i zahiri javani",
      [line2]: "nachana",
    });
    expect(mocks.setCachedRomanizations).toHaveBeenCalledWith({
      [line1]: "Masati'ch masata'i zahiri javani",
      [line2]: "nachana",
    });
  });

  it("simplifies single-line Indic transliterations with Gurmukhi apostrophes", async () => {
    const line = "ਮਸਤੀ ’ਚ ਮਸਤਾਈ ਜ਼ਹਿਰੀ ਜਵਾਨੀ";
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify([[[null, null, null, "Masatī’ca masatā'ī zahirī javānī"]]])),
    );

    const res = await romanizeLines([line]);
    expect(res).toEqual({
      [line]: "Masati'ch masata'i zahiri javani",
    });
    expect(mocks.setCachedRomanizations).toHaveBeenCalledWith({
      [line]: "Masati'ch masata'i zahiri javani",
    });
  });

  it("preserves English words in mixed-script Indic lyric lines", async () => {
    const line = "Music ਚੱਲਦਾ Club 'ਚ";
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify([[[null, null, null, "Music caladā Club 'ca"]]])),
    );

    const res = await romanizeLines([line]);
    expect(res).toEqual({
      [line]: "Music chalada Club'ch",
    });
    expect(mocks.setCachedRomanizations).toHaveBeenCalledWith({
      [line]: "Music chalada Club'ch",
    });
  });

  it("registers the renderer-only IPC handler", () => {
    registerRomanizationIpc();
    expect(mocks.handle).toHaveBeenCalledWith("lyrics:romanize", expect.any(Function));
  });
});
