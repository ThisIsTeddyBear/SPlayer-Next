import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  media: {
    track: { id: "local", source: "local" },
    parsedLyric: [] as unknown[],
    resetLyricState: vi.fn(),
    setLyric: vi.fn(),
  },
}));
vi.mock("@/stores/media", () => ({ useMediaStore: () => mocks.media }));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({ lyric: { lyricFormatOrder: ["ttml", "lrc"] } }),
}));
vi.mock("@/services/lyric/preload", () => ({
  consumePreloadedLyric: async () => ({ hit: false }),
}));
vi.mock("@/services/lyric/resolve", () => ({
  resolveLocalRepoLyric: async () => null,
  embeddedLyricFromDetail: (detail: { embeddedLyric?: string }) =>
    detail.embeddedLyric
      ? { source: { source: "embedded", format: "lrc" }, content: detail.embeddedLyric }
      : null,
}));

beforeEach(() => {
  vi.resetModules();
  mocks.read.mockReset();
  mocks.media.parsedLyric = [];
  mocks.media.setLyric
    .mockReset()
    .mockImplementation((_source, input: { content: string } | null) => {
      mocks.media.parsedLyric = input?.content.includes("[00:01]") ? [{}] : [];
    });
  window.api = { player: { readLyricFile: mocks.read } } as unknown as typeof window.api;
});

const detail = (embeddedLyric = "[00:01]Embedded") => ({
  quality: { sampleRate: 0, channels: 2, bitsPerSample: 0, bitRate: 0, codec: "" },
  externalLyrics: [
    { format: "ttml" as const, path: "preferred.ttml" },
    { format: "lrc" as const, path: "fallback.lrc" },
  ],
  embeddedLyric,
});

it("tries the next sidecar after unreadable or invalid preferred lyrics", async () => {
  mocks.read.mockResolvedValueOnce({ success: true, data: "invalid XML" });
  mocks.read.mockResolvedValueOnce({ success: true, data: "[00:01]Fallback" });
  const { loadForTrack } = await import("./loader");
  await loadForTrack(detail());
  expect(mocks.read).toHaveBeenCalledTimes(2);
  expect(mocks.media.setLyric).toHaveBeenLastCalledWith(
    { source: "external", format: "lrc" },
    { content: "[00:01]Fallback" },
  );
});

it("uses embedded lyrics after every external candidate fails", async () => {
  mocks.read.mockResolvedValue({ success: false });
  const { loadForTrack } = await import("./loader");
  await loadForTrack(detail());
  expect(mocks.media.setLyric).toHaveBeenLastCalledWith(
    { source: "embedded", format: "lrc" },
    { content: "[00:01]Embedded" },
  );
});
