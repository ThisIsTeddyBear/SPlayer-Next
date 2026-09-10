import { describe, expect, it } from "vitest";
import { extractGoogleRomanization, needsRomanization } from "./romanization";

describe("Google romanization response", () => {
  it.each([
    ["ja", "Arigatō"],
    ["ko", "annyeonghaseyo"],
    ["zh-CN", "Shìjiè nǐ hǎo"],
  ])("extracts the %s reading", (language, reading) => {
    const response = [[[null, null, null, reading]], null, language];
    expect(extractGoogleRomanization(response)).toBe(reading);
  });

  it("rejects malformed and untranslated responses", () => {
    expect(extractGoogleRomanization({})).toBeUndefined();
    expect(extractGoogleRomanization([[[null, null, null, "ありがとう"]]])).toBeUndefined();
  });

  it("distinguishes native-script lyrics from Latin lyrics", () => {
    expect(needsRomanization("こんにちは")).toBe(true);
    expect(needsRomanization("안녕하세요")).toBe(true);
    expect(needsRomanization("Hello, world!")).toBe(false);
  });
});
