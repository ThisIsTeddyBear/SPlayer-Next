import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { nextTick, reactive } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useMediaStore } from "./media";
import type { LyricsApi } from "@shared/types/lyrics";
import { buildLineElements } from "@/components/player/Lyrics/engine/line-builder";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  romanizationCache: new Map<string, string>(),
  settings: {
    locale: "en-US",
    lyric: { showRomanization: true, cjkTransform: "none", enableExcludeLyrics: false },
    preset: { uncensorProfanity: false },
  },
}));
vi.mock("@/services/lyric/loader", () => ({ watchLyricPreference: vi.fn() }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@main/ipc/trusted", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("@main/utils/logger", () => ({ systemLog: { warn: vi.fn() } }));
vi.mock("@main/database/lyricRomanizationCache", () => ({
  getCachedRomanization: (text: string) => mocks.romanizationCache.get(text),
  setCachedRomanization: (text: string, reading: string) =>
    mocks.romanizationCache.set(text, reading),
}));

const { romanizeLines } = await vi.importActual<{ romanizeLines: LyricsApi["romanize"] }>(
  "@main/ipc/romanization",
);

const content = `<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="hi">
  <body><div><p begin="1s" end="4s">
    <span begin="1s" end="2s">तुमको </span><span begin="2s" end="4s">भी है खबर</span>
  </p></div></body></tt>`;

const timedTransliteration = `<tt xmlns="http://www.w3.org/ns/ttml"
  xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xml:lang="hi">
  <head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
    <transliterations><transliteration xml:lang="hi-Latn"><text for="L1">
      <span begin="46.222" end="46.747" xmlns="http://www.w3.org/ns/ttml">Tumko</span> <span begin="46.747" end="47.969" xmlns="http://www.w3.org/ns/ttml">bhi</span>
    </text></transliteration></transliterations>
  </iTunesMetadata></metadata></head>
  <body><div><p begin="46.222" end="47.969" itunes:key="L1">
    <span begin="46.222" end="46.747">तुमको</span> <span begin="46.747" end="47.969">भी</span>
  </p></div></body></tt>`;

describe("media romanization through TTML and IPC", () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    mocks.settings = reactive({
      locale: "en-US",
      lyric: { showRomanization: true, cjkTransform: "none", enableExcludeLyrics: false },
      preset: { uncensorProfanity: false },
    });
    mocks.romanizationCache.clear();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockImplementation(
      async () =>
        new Response(JSON.stringify([[[null, null, null, "tumko bhi hai khabar"]], null, "hi"])),
    );
    window.api = {
      lyrics: { romanize: vi.fn(romanizeLines) },
      nowPlaying: { update: vi.fn() },
      opencc: { convertBatch: vi.fn(async (texts: string[]) => texts) },
    } as unknown as typeof window.api;
  });

  afterEach(() => {
    disposePinia(pinia);
    vi.unstubAllGlobals();
  });

  it("fills a Hindi TTML with no transliterations via the real IPC implementation", async () => {
    const media = useMediaStore();
    media.setLyric({ source: "external", format: "ttml" }, { content });
    await flushPromises();
    await nextTick();
    expect(window.api.lyrics.romanize).toHaveBeenCalledWith(["तुमको भी है खबर"]);
    expect(media.parsedLyric[0].romanLyric).toBe("tumko bhi hai khabar");
    expect(media.romanizationLoading).toBe(false);
    const rendered = buildLineElements(media.parsedLyric, {
      enableEmphasizeEffect: false,
      showTranslation: false,
      showRomanization: true,
    });
    expect(rendered.lineElements[0].querySelector(".lp-sub")?.textContent).toBe(
      "tumko bhi hai khabar",
    );
  });

  it("uses the persisted lyric cache before contacting Google", async () => {
    mocks.romanizationCache.set("缓存歌词", "Huan cun ge ci");
    const readings = await romanizeLines(["缓存歌词"]);
    expect(readings).toEqual({ 缓存歌词: "Huan cun ge ci" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("enriches the result after CJK conversion replaces the lyric array", async () => {
    mocks.settings.lyric.cjkTransform = "s2t";
    const media = useMediaStore();
    media.setLyric({ source: "external", format: "ttml" }, { content });
    await flushPromises();
    await nextTick();
    expect(media.parsedLyric[0].romanLyric).toBe("tumko bhi hai khabar");
  });

  it("shows Apple timed transliteration as a line without needing Google", async () => {
    vi.mocked(window.api.lyrics.romanize).mockResolvedValue({});
    const media = useMediaStore();
    media.setLyric({ source: "external", format: "ttml" }, { content: timedTransliteration });
    await flushPromises();
    expect(media.parsedLyric[0].romanLyric).toBe("Tumko bhi");
    expect(window.api.lyrics.romanize).not.toHaveBeenCalled();
    expect(media.parsedLyric[0].words.filter((w) => w.romanWord).map((w) => w.romanWord)).toEqual([
      "Tumko",
      "bhi",
    ]);
  });

  it("applies the romanization preference immediately to the loaded TTML", async () => {
    mocks.settings.lyric.showRomanization = false;
    const media = useMediaStore();
    media.setLyric({ source: "external", format: "ttml" }, { content });
    await flushPromises();
    expect(window.api.lyrics.romanize).not.toHaveBeenCalled();
    mocks.settings.lyric.showRomanization = true;
    await flushPromises();
    expect(media.parsedLyric[0].romanLyric).toBe("tumko bhi hai khabar");
  });

  it("exposes a failed request and retries it with one click", async () => {
    vi.mocked(window.api.lyrics.romanize).mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const media = useMediaStore();
    media.setLyric({ source: "external", format: "ttml" }, { content });
    await flushPromises();
    expect(media.romanizationLoading).toBe(false);
    expect(media.romanizationError).toBe(true);
    media.toggleRomanization();
    await flushPromises();
    expect(media.romanizationVisible).toBe(true);
    expect(media.parsedLyric[0].romanLyric).toBe("tumko bhi hai khabar");
    expect(media.romanizationError).toBe(false);
  });

  it("does not silently accept an empty response or retry it endlessly", async () => {
    vi.mocked(window.api.lyrics.romanize).mockResolvedValue({});
    const media = useMediaStore();
    media.setLyric({ source: "external", format: "ttml" }, { content });
    await flushPromises();
    expect(media.romanizationError).toBe(true);
    expect(window.api.lyrics.romanize).toHaveBeenCalledTimes(1);
  });

  it("keeps partial results without automatically repeating failed requests", async () => {
    vi.mocked(window.api.lyrics.romanize).mockResolvedValue({
      "तुमको भी है खबर": "tumko bhi hai khabar",
    });
    const partial = content.replace("</div>", '<p begin="5s" end="6s">नमस्ते</p></div>');
    const media = useMediaStore();
    media.setLyric({ source: "external", format: "ttml" }, { content: partial });
    await flushPromises();
    expect(media.parsedLyric[0].romanLyric).toBe("tumko bhi hai khabar");
    expect(media.parsedLyric[1].romanLyric).toBe("");
    expect(media.romanizationError).toBe(true);
    expect(window.api.lyrics.romanize).toHaveBeenCalledTimes(1);
  });

  it("discards the previous track's pending result", async () => {
    let finish!: (value: Record<string, string>) => void;
    vi.mocked(window.api.lyrics.romanize).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const media = useMediaStore();
    media.setLyric({ source: "external", format: "ttml" }, { content });
    await flushPromises();
    media.setLyric({ source: "external", format: "ttml" }, { content: timedTransliteration });
    finish({ "तुमको भी है खबर": "stale result" });
    await flushPromises();
    expect(media.parsedLyric[0].romanLyric).toBe("Tumko bhi");
    expect(media.romanizationError).toBe(false);
    expect(media.romanizationLoading).toBe(false);
  });
});
