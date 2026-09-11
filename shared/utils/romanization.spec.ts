import { describe, expect, it } from "vitest";
import {
  extractGoogleRomanization,
  needsRomanization,
  simplifyGoogleRomanization,
} from "./romanization";

describe("Google romanization response", () => {
  it.each([
    ["ja", "Arigatō", "Arigato"],
    ["ko", "annyeonghaseyo", "annyeonghaseyo"],
    ["zh-CN", "Shìjiè nǐ hǎo", "Shijie ni hao"],
  ])("extracts the reader-friendly %s reading", (language, reading, expected) => {
    const response = [[[null, null, null, reading]], null, language];
    expect(extractGoogleRomanization(response)).toBe(expected);
  });

  it("rejects malformed and untranslated responses", () => {
    expect(extractGoogleRomanization({})).toBeUndefined();
    expect(extractGoogleRomanization([[[null, null, null, "ありがとう"]]])).toBeUndefined();
  });

  it("joins all Google segments before rendering the reading", () => {
    const response = [
      [
        [null, null, null, "Tumko "],
        [null, null, null, "bhi hai khabar"],
      ],
    ];
    expect(extractGoogleRomanization(response, "तुमको भी है खबर")).toBe("Tumko bhi hai khabar");
  });

  it("uses LyricMotion's plain-ASCII, listener-friendly readings", () => {
    expect(simplifyGoogleRomanization("tūmkō bhī hāi khabar", "तुमको भी है खबर")).toBe(
      "tumko bhi hai khabar",
    );
    expect(simplifyGoogleRomanization("cānd", "चाँद")).toBe("chand");
    expect(simplifyGoogleRomanization("d’āb–e", "داب")).toBe("d'ab-e");
    expect(simplifyGoogleRomanization("mērē ' c", "ਮੇਰੇ ’ਚ")).toBe("mere'ch");
  });

  it("distinguishes native-script lyrics from Latin lyrics", () => {
    expect(needsRomanization("こんにちは")).toBe(true);
    expect(needsRomanization("안녕하세요")).toBe(true);
    expect(needsRomanization("Hello, world!")).toBe(false);
  });
});
