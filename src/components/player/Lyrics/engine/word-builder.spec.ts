import { describe, expect, it } from "vitest";
import { splitGraphemes } from "./word-builder";

const startsWithCombiningMark = (text: string) => /^\p{M}/u.test(text);

describe("歌词强调字素簇拆分", () => {
  it("保留天城文的组合字符", () => {
    const graphemes = splitGraphemes("मैं ख्वाबों");

    expect(graphemes.join("")).toBe("मैं ख्वाबों");
    expect(graphemes).toContain("मैं");
    expect(graphemes).not.toContain("े");
    expect(graphemes.some(startsWithCombiningMark)).toBe(false);
  });

  it("保留马拉雅拉姆文的组合字符", () => {
    const graphemes = splitGraphemes("മേഘങ്ങൾ");

    expect(graphemes.join("")).toBe("മേഘങ്ങൾ");
    expect(graphemes.some(startsWithCombiningMark)).toBe(false);
  });
});
