/**
 * 复杂文字（印地语/旁遮普语等）字形簇拆分与长音节强调测试
 */
import { describe, expect, it } from "vitest";
import { splitGraphemes } from "@shared/utils/lyrics";
import { shouldChunkEmphasize, shouldEmphasize } from "./emphasize";
import type { LyricWord } from "@shared/types/lyrics";

describe("splitGraphemes", () => {
  it("正确拆分印地语/天城文（Devanagari），变音符号（matra）与辅音保持完整", () => {
    expect(splitGraphemes("जाएगा")).toEqual(["जा", "ए", "गा"]);
    expect(splitGraphemes("टूटा")).toEqual(["टू", "टा"]);
    expect(splitGraphemes("है")).toEqual(["है"]);
    expect(splitGraphemes("मुसाफ़िर")).toEqual(["मु", "सा", "फ़ि", "र"]);
    expect(splitGraphemes("नमस्ते")).toEqual(["न", "म", "स्ते"]);
    expect(splitGraphemes("प्यार")).toEqual(["प्या", "र"]);
  });

  it("正确拆分旁遮普语/果鲁穆奇文（Gurmukhi）", () => {
    expect(splitGraphemes("ਆਜਾ")).toEqual(["ਆ", "ਜਾ"]);
    expect(splitGraphemes("ਕੋਈ")).toEqual(["ਕੋ", "ਈ"]);
  });

  it("正确拆分拉丁字符及组合重音字符", () => {
    expect(splitGraphemes("hello")).toEqual(["h", "e", "l", "l", "o"]);
    // café 配合组合重音符 \u0301 不被拆散
    expect(splitGraphemes("cafe\u0301")).toEqual(["c", "a", "f", "e\u0301"]);
  });

  it("正确处理 CJK 字符", () => {
    expect(splitGraphemes("你好世界")).toEqual(["你", "好", "世", "界"]);
  });

  it("正确处理空字符串和空格", () => {
    expect(splitGraphemes("")).toEqual([]);
  });

  it("正确处理 Emoji 零宽连字序列（ZWJ）", () => {
    expect(splitGraphemes("👨‍👩‍👧‍👦")).toEqual(["👨‍👩‍👧‍👦"]);
  });
});

describe("shouldEmphasize & shouldChunkEmphasize", () => {
  const makeWord = (word: string, durationMs: number): LyricWord => ({
    word,
    startTime: 1000,
    endTime: 1000 + durationMs,
  });

  it("单字形及多字形印地语在持续时间长时触发强调", () => {
    // "है" 单字形簇，持续 1200ms
    expect(shouldEmphasize(makeWord("है", 1200))).toBe(true);
    // "जाएगा" 3个字形簇，持续 1500ms
    expect(shouldEmphasize(makeWord("जाएगा", 1500))).toBe(true);
    // 持续时间过短时不强调
    expect(shouldEmphasize(makeWord("जाएगा", 500))).toBe(false);
  });

  it("旁遮普语单词在持续时间长时触发强调", () => {
    expect(shouldEmphasize(makeWord("ਆਜਾ", 1300))).toBe(true);
  });

  it("纯标点符号即使持续时间长也不触发强调", () => {
    expect(shouldEmphasize(makeWord("...", 1500))).toBe(false);
    expect(shouldEmphasize(makeWord(",", 2000))).toBe(false);
    expect(shouldEmphasize(makeWord("—", 1200))).toBe(false);
    expect(shouldEmphasize(makeWord("   ", 1500))).toBe(false);
  });

  it("字形簇超过7个的超长词不触发字符级浮动强调", () => {
    // "extraordinary" 有 13 个字符
    expect(shouldEmphasize(makeWord("extraordinary", 2000))).toBe(false);
  });

  it("CJK 字符满足持续时间即强调", () => {
    expect(shouldEmphasize(makeWord("爱", 1000))).toBe(true);
  });

  it("shouldChunkEmphasize 正确判断音节块", () => {
    const chunk1: LyricWord[] = [
      { word: "जा", startTime: 1000, endTime: 1400 },
      { word: "ए", startTime: 1400, endTime: 1800 },
      { word: "गा", startTime: 1800, endTime: 2400 },
    ];
    // 合并总时长 1400ms，字形数 3，应该强调
    expect(shouldChunkEmphasize(chunk1)).toBe(true);

    const chunkShort: LyricWord[] = [
      { word: "जा", startTime: 1000, endTime: 1100 },
      { word: "ए", startTime: 1100, endTime: 1200 },
    ];
    // 合并总时长 200ms，不满足持续时间阈值
    expect(shouldChunkEmphasize(chunkShort)).toBe(false);
  });
});

