import type { LyricLine } from "@shared/types/lyrics";
import { describe, expect, it } from "vitest";
import { applyGeneratedRomanization, collectMissingRomanization } from "./romanization";

const makeLine = (text: string, romanLyric = ""): LyricLine => ({
  words: [{ word: text, startTime: 0, endTime: 1_000 }],
  translatedLyric: "",
  romanLyric,
  isBG: false,
  isDuet: false,
  startTime: 0,
  endTime: 1_000,
});

describe("lyric romanization enrichment", () => {
  it("collects TTML-style lines without transliterations", () => {
    const lines = [makeLine("ありがとう"), makeLine("Already supplied", "Supplied")];
    expect(collectMissingRomanization(lines)).toEqual(["ありがとう"]);
  });

  it("fills missing readings without replacing supplied transliterations", () => {
    const missing = makeLine("ありがとう");
    const supplied = makeLine("世界", "Shìjiè");
    const result = applyGeneratedRomanization([missing, supplied], {
      ありがとう: "Arigatō",
      世界: "Wrong",
    });

    expect(result[0].romanLyric).toBe("Arigatō");
    expect(result[1]).toBe(supplied);
    expect(result[1].romanLyric).toBe("Shìjiè");
  });
});
