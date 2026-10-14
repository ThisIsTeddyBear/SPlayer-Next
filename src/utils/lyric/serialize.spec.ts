import { describe, expect, it } from "vitest";
import { parseLRC } from "./parseLRC";
import { buildDownloadLyric } from "./serialize";
import { parseBracketTag } from "./timestamp";

describe("LRC compatibility and export", () => {
  it("accepts integer seconds and fractional timestamps", () => {
    expect(parseBracketTag("[00:01]")).toBe(1000);
    expect(parseBracketTag("[00:01.5]")).toBe(1500);
    expect(parseLRC("[00:01]Hello\n[00:02]World").map((line) => line.startTime)).toEqual([
      1000, 2000,
    ]);
  });

  it("applies offsets to lines and words without exporting metadata", () => {
    const input = { content: "[offset:500]\n[00:01.00]Hello" };
    const lines = parseLRC(input.content);
    expect(lines[0].startTime).toBe(500);
    expect(lines[0].words[0].startTime).toBe(500);
    expect(buildDownloadLyric(input, "lrc", "lrc")).toBe("[00:00.50]Hello");
    expect(parseLRC("[offset:2000]\n[00:01]Hello")[0].startTime).toBe(0);
    expect(parseLRC("[offset:-2000]\n[00:01]Hello")[0].startTime).toBe(3000);
  });

  it("preserves background vocals alongside bilingual lines", () => {
    const lines = parseLRC("[00:01]Lead\n[00:01]Translation\n[bg:[00:01](Echo)]\n[00:03]Next");
    expect(lines).toHaveLength(3);
    expect(lines[0].translatedLyric).toBe("Translation");
    expect(lines[1].isBG).toBe(true);
    expect(lines[1].words[0].word).toBe("Echo");
    expect(lines[0].endTime).toBe(3000);
    expect(parseLRC("[00:01]Lead\n[bg:[00:01](Echo)]\n[00:01]Translation")[0].translatedLyric).toBe(
      "Translation",
    );
  });

  it("shifts repeated enhanced lines and preserves their ending markers", () => {
    const lines = parseLRC("[00:01][00:03]<00:01>Echo<00:01.50>");
    expect(lines.map((line) => [line.startTime, line.endTime])).toEqual([
      [1000, 1500],
      [3000, 3500],
    ]);
  });

  it("round trips word gaps and the final word end", () => {
    const input = {
      content: "[00:01]<00:01>A<00:01.50><00:02>B<00:02.50>\n[00:03]<00:03>C<00:03.50>",
    };
    const exported = buildDownloadLyric(input, "lrc", "enhanced-lrc");
    expect(exported).not.toBeNull();
    const lines = parseLRC(exported!);
    expect(lines[0].words.map((word) => [word.startTime, word.endTime])).toEqual([
      [1000, 1500],
      [2000, 2500],
    ]);
    expect(lines[1].endTime).toBe(3500);
  });
});
