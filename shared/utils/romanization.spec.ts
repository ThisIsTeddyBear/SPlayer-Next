import { describe, expect, it } from "vitest";
import {
  extractGoogleRomanization,
  hasNonLatinLetter,
  normalizeRomanization,
} from "./romanization";

describe("romanization", () => {
  it("reads the dt=rm response format used by Google Translate", () => {
    expect(
      extractGoogleRomanization([[[null, "ありがとう", null, "Arigatō"]], null, "ja"]),
    ).toBe("Arigatō");
  });

  it("retains diacritics while normalizing whitespace and punctuation", () => {
    expect(normalizeRomanization("  Wārudo —  ok  ")).toBe("Wārudo - ok");
  });

  it("only requests fallback conversion for non-Latin lyrics", () => {
    expect(hasNonLatinLetter("Hello, world!")).toBe(false);
    expect(hasNonLatinLetter("こんにちは")).toBe(true);
  });
});
