/**
 *
 */

import type { LyricLine, LyricSingerRole, LyricWord } from "@shared/types/lyrics";
import { parseTTMLTime } from "./timestamp";

/**
 */
const getAttr = (el: Element, name: string): string | null => {
  const direct = el.getAttribute(name);
  if (direct !== null) return direct;
  for (const attr of Array.from(el.attributes)) {
    if (attr.localName === name || attr.name.endsWith(":" + name)) {
      return attr.value;
    }
  }
  return null;
};

/**
 */
const getWordText = (el: Element): string => {
  let text = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const role = getAttr(node as Element, "role");
      if (role !== "x-translation" && role !== "x-roman") {
        text += getWordText(node as Element);
      }
    }
  }
  return text;
};

/**
 */
interface TtmlAgent {
  type: string;
  name: string;
}

const normalizeAlignment = (value: string | null): "start" | "center" | "end" | undefined => {
  switch (value?.toLowerCase()) {
    case "left":
    case "start":
      return "start";
    case "center":
      return "center";
    case "right":
    case "end":
      return "end";
    default:
      return undefined;
  }
};

const collectRegionAlignments = (doc: Document): Map<string, "start" | "center" | "end"> => {
  const alignments = new Map<string, "start" | "center" | "end">();
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    if (el.localName !== "region") continue;
    const id = el.getAttribute("xml:id") || getAttr(el, "id");
    const alignment = normalizeAlignment(getAttr(el, "textAlign"));
    if (id && alignment) alignments.set(id, alignment);
  }
  return alignments;
};

const collectAgents = (doc: Document): { mainAgent: string; agents: Map<string, TtmlAgent> } => {
  const agents = new Map<string, TtmlAgent>();
  let mainAgent = "";
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    if (el.localName !== "agent") continue;
    const id = el.getAttribute("xml:id") || getAttr(el, "id");
    if (!id) continue;
    const type = getAttr(el, "type") || "";
    const name =
      getAttr(el, "name") ||
      Array.from(el.children)
        .find((child) => child.localName === "name")
        ?.textContent?.trim() ||
      "";
    agents.set(id, { type, name });
    if (!mainAgent && type === "person") mainAgent = id;
  }
  return { mainAgent: mainAgent || "v1", agents };
};

/**
 */
const stripParens = (text: string): string =>
  text
    .trim()
    .replace(/^[（(]/, "")
    .replace(/[)）]$/, "")
    .trim();

/**
 */
const normalizeLang = (lang: string | null | undefined): string =>
  (lang ?? "").toLowerCase().replace(/_/g, "-");

/**
 */
const pickLangIndex = (langs: (string | null)[], preferred: string): number => {
  if (langs.length === 0) return -1;
  const want = normalizeLang(preferred);
  if (!want) return 0;
  const wantBase = want.split("-")[0];
  let baseMatch = -1;
  let hasTagged = false;
  for (let i = 0; i < langs.length; i++) {
    const lang = normalizeLang(langs[i]);
    if (!lang) continue;
    hasTagged = true;
    if (lang === want) return i;
    if (baseMatch === -1 && lang.split("-")[0] === wantBase) baseMatch = i;
  }
  if (baseMatch !== -1) return baseMatch;
  return hasTagged ? -1 : 0;
};

interface TransCandidate {
  lang: string | null;
  main: string;
  bg: string;
}

/**
 */
const collectTranslations = (
  doc: Document,
  preferredLang: string,
): Map<string, { main: string; bg: string }> => {
  const candidates = new Map<string, TransCandidate[]>();

  for (const textEl of Array.from(doc.querySelectorAll("text[for]"))) {
    const parent = textEl.parentElement;
    if (!parent || (parent.localName !== "translation" && !parent.closest("translations"))) {
      continue;
    }

    const key = textEl.getAttribute("for");
    if (!key) continue;

    let main = "";
    let bg = "";
    for (const node of Array.from(textEl.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        main += node.textContent ?? "";
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const childEl = node as Element;
        if (getAttr(childEl, "role") === "x-bg") {
          bg += childEl.textContent ?? "";
        } else {
          main += childEl.textContent ?? "";
        }
      }
    }

    main = main.trim();
    bg = stripParens(bg);
    if (!main && !bg) continue;

    const lang = getAttr(parent, "lang");
    const list = candidates.get(key) ?? [];
    list.push({ lang, main, bg });
    candidates.set(key, list);
  }

  const translations = new Map<string, { main: string; bg: string }>();
  for (const [key, list] of candidates) {
    const idx = pickLangIndex(
      list.map((item) => item.lang),
      preferredLang,
    );
    if (idx !== -1) translations.set(key, { main: list[idx].main, bg: list[idx].bg });
  }

  return translations;
};

interface RomanWord {
  startTime: number;
  endTime: number;
  text: string;
}

interface TransliterationMaps {
  lines: Map<string, { main: string; bg: string }>;
  words: Map<string, { main: RomanWord[]; bg: RomanWord[] }>;
}

/**
 *
 */
const collectTransliterations = (doc: Document): TransliterationMaps => {
  const lines = new Map<string, { main: string; bg: string }>();
  const words = new Map<string, { main: RomanWord[]; bg: RomanWord[] }>();

  for (const textEl of Array.from(doc.querySelectorAll("text[for]"))) {
    const parent = textEl.parentElement;
    if (
      !parent ||
      (parent.localName !== "transliteration" && !parent.closest("transliterations"))
    ) {
      continue;
    }

    const key = textEl.getAttribute("for");
    if (!key) continue;

    const mainWords: RomanWord[] = [];
    const bgWords: RomanWord[] = [];
    let lineMain = "";
    let lineBg = "";

    for (const node of Array.from(textEl.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        lineMain += node.textContent ?? "";
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const childEl = node as Element;
        if (getAttr(childEl, "role") === "x-bg") {
          const timedSpans = Array.from(childEl.querySelectorAll("span[begin][end]"));
          if (timedSpans.length > 0) {
            for (const span of timedSpans) {
              bgWords.push({
                startTime: parseTTMLTime(span.getAttribute("begin") ?? ""),
                endTime: parseTTMLTime(span.getAttribute("end") ?? ""),
                text: stripParens(span.textContent ?? ""),
              });
            }
          } else {
            lineBg += childEl.textContent ?? "";
          }
        } else if (childEl.hasAttribute("begin") && childEl.hasAttribute("end")) {
          mainWords.push({
            startTime: parseTTMLTime(childEl.getAttribute("begin") ?? ""),
            endTime: parseTTMLTime(childEl.getAttribute("end") ?? ""),
            text: childEl.textContent ?? "",
          });
        }
      }
    }

    if (mainWords.length > 0 || bgWords.length > 0) {
      words.set(key, { main: mainWords, bg: bgWords });
    }

    lineMain = lineMain.trim();
    lineBg = stripParens(lineBg);
    if (lineMain || lineBg) lines.set(key, { main: lineMain, bg: lineBg });
  }

  return { lines, words };
};

/**
 */
const alignRomanWords = (words: LyricWord[], romanWords: RomanWord[]): void => {
  if (words.length === 0 || romanWords.length === 0) return;
  const FAST_TRACK_TOLERANCE_MS = 2;
  const MIN_IOU = 0.1;
  let searchStart = 0;
  for (const word of words) {
    let bestIou = 0;
    let bestIdx = -1;
    let fastMatched = false;
    for (let idx = searchStart; idx < romanWords.length; idx++) {
      const roman = romanWords[idx];
      if (Math.abs(word.startTime - roman.startTime) <= FAST_TRACK_TOLERANCE_MS) {
        word.romanWord = roman.text;
        searchStart = idx + 1;
        fastMatched = true;
        break;
      }
      const overlapStart = Math.max(word.startTime, roman.startTime);
      const intersection = Math.max(0, Math.min(word.endTime, roman.endTime) - overlapStart);
      if (intersection > 0) {
        const unionStart = Math.min(word.startTime, roman.startTime);
        const union = Math.max(1, Math.max(word.endTime, roman.endTime) - unionStart);
        const iou = intersection / union;
        if (iou > bestIou) {
          bestIou = iou;
          bestIdx = idx;
        }
      }
      if (roman.startTime >= word.endTime) break;
    }
    if (!fastMatched && bestIdx !== -1 && bestIou >= MIN_IOU) {
      word.romanWord = romanWords[bestIdx].text;
      searchStart = bestIdx + 1;
    }
  }
};

/**
 */
export const parseTTML = (text: string, preferredLang = ""): LyricLine[] => {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid TTML XML");
  }

  const { mainAgent, agents } = collectAgents(doc);
  const regionAlignments = collectRegionAlignments(doc);
  const translations = collectTranslations(doc, preferredLang);
  const transliterations = collectTransliterations(doc);
  const lines: LyricLine[] = [];

  /**
   */
  const parseParagraph = (
    el: Element,
    isBG: boolean,
    isDuet: boolean,
    parentKey: string | null,
    inheritedAgent = "",
  ): void => {
    const begin = getAttr(el, "begin");
    const end = getAttr(el, "end");
    const lineAgent = getAttr(el, "agent") || inheritedAgent;
    const agent = lineAgent ? agents.get(lineAgent) : undefined;
    const isGroup = agent?.type === "group";
    const singerRole: LyricSingerRole = isBG
      ? "background"
      : isGroup
        ? "group"
        : lineAgent && lineAgent !== mainAgent
          ? "response"
          : "lead";
    const alignment =
      normalizeAlignment(getAttr(el, "textAlign")) ??
      regionAlignments.get(getAttr(el, "region") || "") ??
      (isBG || isGroup ? "center" : singerRole === "response" ? "end" : "start");

    const line: LyricLine = {
      words: [],
      translatedLyric: "",
      romanLyric: "",
      isBG,
      singerId: lineAgent || undefined,
      singerName: agent?.name || undefined,
      singerRole,
      alignment,
      isDuet: isBG ? isDuet : singerRole === "response",
      startTime: begin ? parseTTMLTime(begin) : 0,
      endTime: end ? parseTTMLTime(end) : 0,
    };

    const itunesKey = isBG ? parentKey : getAttr(el, "key");
    if (itunesKey) {
      const trans = translations.get(itunesKey);
      if (trans) line.translatedLyric = isBG ? trans.bg : trans.main;
      const lineRoman = transliterations.lines.get(itunesKey);
      if (lineRoman) line.romanLyric = isBG ? lineRoman.bg : lineRoman.main;
    }

    const romanWordData = itunesKey ? transliterations.words.get(itunesKey) : undefined;
    const availableRomanWords = romanWordData
      ? [...(isBG ? romanWordData.bg : romanWordData.main)]
      : [];
    const timedWords: LyricWord[] = [];

    let bgCount = 0;
    let lastWasTimedSpan = false;
    const transCandidates: { lang: string | null; text: string }[] = [];

    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const word = node.textContent ?? "";
        if (word.trim()) {
          line.words.push({ word, startTime: line.startTime, endTime: line.endTime });
          lastWasTimedSpan = false;
        } else if (
          lastWasTimedSpan &&
          word.includes(" ") &&
          !word.includes("\n") &&
          !word.includes("\r")
        ) {
          const lastWord = line.words[line.words.length - 1];
          line.words.push({
            word: " ",
            startTime: lastWord?.endTime ?? line.startTime,
            endTime: lastWord?.endTime ?? line.startTime,
          });
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const span = node as Element;
        if (span.localName !== "span") continue;
        const role = getAttr(span, "role");

        if (role === "x-bg") {
          parseParagraph(span, true, line.isDuet, itunesKey, lineAgent);
          bgCount++;
        } else if (role === "x-translation") {
          transCandidates.push({
            lang: getAttr(span, "lang"),
            text: span.textContent?.trim() ?? "",
          });
        } else if (role === "x-roman") {
          if (!line.romanLyric) line.romanLyric = span.textContent?.trim() ?? "";
        } else {
          const wb = getAttr(span, "begin");
          const we = getAttr(span, "end");
          if (wb && we) {
            const lyricWord: LyricWord = {
              word: getWordText(span),
              startTime: parseTTMLTime(wb),
              endTime: parseTTMLTime(we),
            };
            line.words.push(lyricWord);
            timedWords.push(lyricWord);
            lastWasTimedSpan = true;
          }
        }
      }
    }

    alignRomanWords(timedWords, availableRomanWords);

    if (!line.translatedLyric) {
      const valid = transCandidates.filter((item) => item.text);
      const idx = pickLangIndex(
        valid.map((item) => item.lang),
        preferredLang,
      );
      if (idx !== -1) line.translatedLyric = valid[idx].text;
    }

    if (!begin || !end) {
      const timed = line.words.filter((w) => w.word.trim());
      if (timed.length) {
        line.startTime = Math.min(...timed.map((w) => w.startTime));
        line.endTime = Math.max(...timed.map((w) => w.endTime));
      }
    }

    if (isBG && line.words.length) {
      const first = line.words[0];
      if (/^[（(]/.test(first.word)) {
        first.word = first.word.replace(/^[（(]/, "");
        if (!first.word) line.words.shift();
      }
      const last = line.words[line.words.length - 1];
      if (last && /[)）]$/.test(last.word)) {
        last.word = last.word.replace(/[)）]$/, "");
        if (!last.word) line.words.pop();
      }
    }

    if (bgCount > 0) {
      const bgLines = lines.splice(lines.length - bgCount, bgCount);
      lines.push(line, ...bgLines);
    } else {
      lines.push(line);
    }
  };

  for (const p of Array.from(doc.querySelectorAll("p"))) {
    if (getAttr(p, "begin") && getAttr(p, "end")) {
      parseParagraph(p, getAttr(p, "role") === "x-bg", false, null);
    }
  }

  return lines;
};
