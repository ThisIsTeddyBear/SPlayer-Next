import type { LyricLine } from "@shared/types/lyrics";

/** 获取一行歌词的原文。 */
export const getLyricLineText = (line: LyricLine): string =>
  line.words
    .map((word) => word.word)
    .join("")
    .trim();

/** 判断文本是否完全由拉丁字符、数字和常见标点组成。 */
const isPurelyLatinScript = (text: string): boolean =>
  // 需要涵盖 ASCII 控制字符以保持既有拉丁文本判断不变。
  // eslint-disable-next-line no-control-regex
  /^[\u0000-\u007f\u0080-\u00ff\u0100-\u017f\u0180-\u024f]*$/.test(text);

/** 收集没有内嵌罗马音的非拉丁歌词行。 */
export const collectMissingRomanization = (lines: LyricLine[]): string[] => [
  ...lines
    .filter((line) => !line.romanLyric.trim())
    .map(getLyricLineText)
    .filter((text) => !isPurelyLatinScript(text)),
];

/** 将生成的罗马音填入原本没有内嵌转写的行。 */
export const applyGeneratedRomanization = (
  lines: LyricLine[],
  readings: Record<string, string>,
): LyricLine[] => {
  let changed = false;
  const result = lines.map((line) => {
    if (line.romanLyric.trim()) return line;

    const reading = readings[getLyricLineText(line)];
    if (!reading) return line;

    changed = true;
    return { ...line, romanLyric: reading };
  });

  return changed ? result : lines;
};
