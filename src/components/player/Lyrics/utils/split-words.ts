import type { LyricWord } from "@shared/types/lyrics";

const CJK_RE = /^[\p{Unified_Ideograph}぀-ヿ]+$/u;

/**
 * Determine whether a string consists entirely of CJK characters
 * @param char - String to test
 * @returns Whether all characters are CJK
 */
export const isCJK = (char: string): boolean => CJK_RE.test(char);

const hasSegmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter !== "undefined";

/** Word boundary segmenter singleton */
let wordSegmenter: Intl.Segmenter | undefined;

/**
 * Create a lyric atom with proportional timing
 * @param word - Word text content
 * @param romanWord - Romanization/pinyin text
 * @param obscene - Whether the word is flagged as profane
 * @param startTime - Start time in milliseconds
 * @param endTime - End time in milliseconds
 * @param endsWithSpace - Whether the syllable is followed by whitespace
 * @param emptyBeat - Empty beat count
 */
const makeAtom = (
  word: string,
  romanWord: string,
  obscene: boolean,
  startTime: number,
  endTime: number,
  endsWithSpace?: boolean,
  emptyBeat?: number,
): LyricWord => ({
  word,
  romanWord,
  startTime,
  endTime,
  obscene,
  ...(endsWithSpace ? { endsWithSpace: true } : {}),
  ...(emptyBeat !== undefined ? { emptyBeat } : {}),
});

/**
 * Regroup lyric words: split multi-character CJK words character-by-character,
 * and group phonetic tokens by language word boundaries using Intl.Segmenter.
 *
 * @param words - Raw lyric word array
 * @returns Regrouped array of single words or word groups
 */
export const chunkAndSplitLyricWords = (words: LyricWord[]): (LyricWord | LyricWord[])[] => {
  const atoms: LyricWord[] = [];

  for (const w of words) {
    const content = w.word.trim();
    const romanWord = w.romanWord ?? "";
    const obscene = w.obscene ?? false;
    const endsWithSpace = w.endsWithSpace ?? false;
    const emptyBeat = w.emptyBeat;

    // Retain whitespace-only or ruby-annotated words directly
    if (content.length === 0 || (w.ruby?.length ?? 0) > 0) {
      atoms.push({ ...w });
      continue;
    }

    const parts = w.word.split(/(\s+)/).filter((p) => p.length > 0);
    const totalLen = w.word.replace(/\s/g, "").length || 1;
    const duration = w.endTime - w.startTime;
    let offset = 0;

    for (let pIdx = 0; pIdx < parts.length; pIdx++) {
      const part = parts[pIdx];
      const isLastPart = pIdx === parts.length - 1;
      if (!part.trim()) {
        const t = w.startTime + (offset / totalLen) * duration;
        atoms.push(makeAtom(part, "", obscene, t, t, isLastPart && endsWithSpace, emptyBeat));
        continue;
      }

      if (isCJK(part) && part.length > 1 && romanWord.trim().length === 0) {
        // Multi-character CJK: split character by character with evenly divided duration
        const charDur = duration / totalLen;
        for (let cIdx = 0; cIdx < part.length; cIdx++) {
          const char = part[cIdx];
          const isLastChar = isLastPart && cIdx === part.length - 1;
          const t = w.startTime + (offset / totalLen) * duration;
          atoms.push(
            makeAtom(char, "", obscene, t, t + charDur, isLastChar && endsWithSpace, emptyBeat),
          );
          offset++;
        }
      } else {
        const t = w.startTime + (offset / totalLen) * duration;
        const partDur = (part.length / totalLen) * duration;
        atoms.push(
          makeAtom(
            part,
            romanWord,
            obscene,
            t,
            t + partDur,
            isLastPart && endsWithSpace,
            emptyBeat,
          ),
        );
        offset += part.length;
      }
    }
  }

  if (!hasSegmenter) return atoms;

  // Split into runs separated by natural word boundaries (whitespace)
  // to avoid merging Western words across spaces
  const runs: LyricWord[][] = [];
  let currentRun: LyricWord[] = [];

  for (let i = 0; i < atoms.length; i++) {
    const atom = atoms[i];
    currentRun.push(atom);
    if (i === atoms.length - 1 || hasWordBoundaryBetween(atom, atoms[i + 1])) {
      runs.push(currentRun);
      currentRun = [];
    }
  }

  wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: "word" });
  const result: (LyricWord | LyricWord[])[] = [];

  for (const run of runs) {
    if (run.length === 1) {
      result.push(run[0]);
    } else {
      result.push(...groupAtomsBySegmenter(run, wordSegmenter));
    }
  }

  return result;
};

/**
 * Determine whether a natural word boundary exists between two adjacent atoms
 * @param current - Current atom
 * @param next - Next atom
 * @returns Whether a boundary exists
 */
const hasWordBoundaryBetween = (current: LyricWord, next?: LyricWord): boolean => {
  if (current.endsWithSpace || /\s$/.test(current.word) || !current.word.trim()) {
    return true;
  }
  if (next && (/^\s/.test(next.word) || !next.word.trim())) {
    return true;
  }
  return false;
};

/**
 * Group continuous whitespace-free atoms using Intl.Segmenter
 * @param atoms - Continuous atoms array
 * @param segmenter - Segmenter instance
 * @returns Regrouped array
 */
const groupAtomsBySegmenter = (
  atoms: LyricWord[],
  segmenter: Intl.Segmenter,
): (LyricWord | LyricWord[])[] => {
  const fullText = atoms.map((a) => a.word).join("");
  const segments = segmenter.segment(fullText);
  const result: (LyricWord | LyricWord[])[] = [];
  let atomIdx = 0;
  let actual = 0;
  let expected = 0;
  let group: LyricWord[] = [];

  for (const seg of segments) {
    expected += seg.segment.length;

    while (actual < expected && atomIdx < atoms.length) {
      const atom = atoms[atomIdx++];
      group.push(atom);
      actual += atom.word.length;
    }

    if (actual === expected) {
      while (group.length > 1 && !group[0].word.trim()) {
        const leading = group.shift();
        if (leading) result.push(leading);
      }
      result.push(group.length === 1 ? group[0] : group);
      group = [];
    }
  }

  while (atomIdx < atoms.length) {
    result.push(atoms[atomIdx++]);
  }
  if (group.length > 0) {
    result.push(group.length === 1 ? group[0] : group);
  }

  return result;
};

/** Match letter or digit Unicode characters */
const LETTER_OR_DIGIT_RE = /[\p{L}\p{N}]/u;

/**
 * Determine whether a space should be inserted between two adjacent texts
 * CJK characters do not need spaces; non-CJK alphanumeric boundaries require spaces.
 *
 * @param prevText - Preceding text
 * @param nextText - Following text
 * @returns Whether a space is needed
 */
export const needsSpaceBetween = (prevText: string, nextText: string): boolean => {
  if (!prevText || !nextText) return false;
  const lastChar = prevText[prevText.length - 1];
  const firstChar = nextText[0];
  if (isCJK(lastChar) || isCJK(firstChar)) return false;
  return LETTER_OR_DIGIT_RE.test(lastChar) && LETTER_OR_DIGIT_RE.test(firstChar);
};
