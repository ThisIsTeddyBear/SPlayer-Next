import type { Track, PlayerState } from "@shared/types/player";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tracks: Track[] = [];
  const status = {
    state: "paused" as PlayerState,
    position: 0,
    duration: 120000,
    currentSource: null as string | null,
    trackLoading: false,
    playIndex: 0,
    fmMode: false,
    heartMode: false,
    shuffleMode: "off",
    repeatMode: "list",
    get isPlaying() {
      return this.state === "playing";
    },
    get currentTrack() {
      return tracks[this.playIndex] ?? null;
    },
    get currentPlaybackContext() {
      return undefined;
    },
  };
  const media = {
    track: null as Track | null,
    setTrack(value: Track) {
      this.track = value;
    },
    setPlaybackContext: vi.fn(),
    enrichTrack: vi.fn(),
    clear: vi.fn(),
  };
  return {
    tracks,
    status,
    media,
    settings: {
      preset: { skipKeywordsSongs: false, skipTrackKeywords: ["blocked"] },
      system: { player: { autoPlay: false, rememberLastTrack: true } },
    },
    resolve: vi.fn(),
    api: {
      load: vi.fn(),
      play: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
    },
    error: vi.fn(),
    info: vi.fn(),
  };
});
vi.mock("./events", () => ({ handleEvent: vi.fn() }));
vi.mock("./fm", () => ({}));
vi.mock("./stats", () => ({ installPlayStats: vi.fn() }));
vi.mock("@/stores/status", () => ({ useStatusStore: () => mocks.status }));
vi.mock("@/stores/media", () => ({ useMediaStore: () => mocks.media }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => mocks.settings }));
vi.mock("@/stores/streaming", () => ({ useStreamingStore: vi.fn() }));
vi.mock("@/stores/plugins", () => ({ usePluginsStore: vi.fn() }));
vi.mock("@/stores/library", () => ({ useLibraryStore: vi.fn() }));
vi.mock("@/stores/history", () => ({ useHistoryStore: () => ({ record: vi.fn() }) }));
vi.mock("@/stores/queue", () => ({
  queue: {
    get value() {
      return mocks.tracks;
    },
  },
  queueLength: {
    get value() {
      return mocks.tracks.length;
    },
  },
  getTrack: (index: number) => mocks.tracks[index] ?? null,
  setQueue: (tracks: Track[]) => mocks.tracks.splice(0, mocks.tracks.length, ...tracks),
  findTrackIndex: (id: string) => mocks.tracks.findIndex((track) => track.id === id),
  insertToQueue: (track: Track, index: number) => mocks.tracks.splice(index, 0, track),
  updateQueueTracks: vi.fn(),
  removeServerTracks: (serverId: string) => {
    const tracks = mocks.tracks.filter((track) => track.serverId !== serverId);
    mocks.tracks.splice(0, mocks.tracks.length, ...tracks);
  },
}));
vi.mock("@/services/audioSource", () => ({ resolveTrackSource: mocks.resolve }));
vi.mock("@/services/lyric/loader", () => ({ beginLoad: vi.fn(), loadForTrack: vi.fn() }));
vi.mock("@/services/coverLoader", () => ({ loadCoverForTrack: vi.fn() }));
vi.mock("@/services/abLoop", () => ({
  reset: vi.fn(),
  installAbLoopSync: vi.fn(),
  disposeAbLoopSync: vi.fn(),
}));
vi.mock("@/services/cacheScheduler", () => ({ cancel: vi.fn(), schedule: vi.fn() }));
vi.mock("@/services/deviceVolume", () => ({ getDeviceVolume: vi.fn(), setDeviceVolume: vi.fn() }));
vi.mock("@/services/nextTrackPreloader", () => ({
  consumePreloadedTrack: () => null,
  scheduleNextTrackPreload: vi.fn(),
  disposeNextTrackPreload: vi.fn(),
  installNextTrackPreloadWatchers: vi.fn(),
}));
vi.mock("@/composables/useFavorite", () => ({ useFavorite: vi.fn() }));
vi.mock("@/utils/color", () => ({ extractColorFromUrl: vi.fn() }));
vi.mock("@/utils/errors", () => ({ handleError: mocks.error, isSkippableError: () => false }));
vi.mock("@/composables/useToast", () => ({ toast: { info: mocks.info } }));
vi.mock("@/i18n", () => ({ default: { global: { t: (key: string) => key } } }));

const track = (id: string): Track => ({
  id,
  title: id,
  artists: [],
  source: "local",
  path: `${id}.flac`,
  duration: 120000,
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.tracks.splice(0, mocks.tracks.length, track("A"));
  mocks.media.track = mocks.tracks[0];
  Object.assign(mocks.status, {
    state: "paused",
    position: 0,
    duration: 120000,
    currentSource: null,
    trackLoading: false,
    playIndex: 0,
  });
  mocks.settings.preset.skipKeywordsSongs = false;
  mocks.resolve.mockImplementation(async (track: Track) => ({
    source: track.path,
    provider: "local",
  }));
  mocks.api.load.mockResolvedValue({
    success: true,
    data: { detail: {}, mediaInfo: { duration: 120000 } },
  });
  mocks.api.play.mockResolvedValue({ success: true });
  mocks.api.stop.mockResolvedValue({ success: true });
  mocks.api.seek.mockResolvedValue({ success: true });
  window.api = { player: mocks.api } as unknown as typeof window.api;
});

it("honors Play queued while restoring without autoplay", async () => {
  const gate = deferred<{ source: string; provider: string }>();
  mocks.resolve.mockReturnValueOnce(gate.promise);
  const player = await import("./index");
  const pending = player.restoreLastTrack();
  await player.play();
  gate.resolve({ source: "A.flac", provider: "local" });
  await pending;
  expect(mocks.api.play).toHaveBeenCalledOnce();
  expect(mocks.status.state).toBe("playing");
});

it("does not resurrect a stopped pending source", async () => {
  const gate = deferred<{ source: string; provider: string }>();
  mocks.resolve.mockReturnValueOnce(gate.promise);
  const player = await import("./index");
  const pending = player.playNow(track("B"));
  await player.stop();
  gate.resolve({ source: "B.flac", provider: "local" });
  await pending;
  expect(mocks.api.load).not.toHaveBeenCalled();
  expect(mocks.status.state).toBe("stopped");
});

it("cannot replace a user selection with late startup audio", async () => {
  const gate = deferred<{ source: string; provider: string }>();
  mocks.resolve.mockReturnValueOnce(gate.promise);
  const player = await import("./index");
  const pending = player.restoreLastTrack();
  await player.playNow(track("B"));
  gate.resolve({ source: "A.flac", provider: "local" });
  await pending;
  expect(mocks.api.load).toHaveBeenCalledOnce();
  expect(mocks.status.currentSource).toBe("B.flac");
});

it("ignores a completed old load while the next source is resolving", async () => {
  const oldLoad = deferred<any>();
  const nextSource = deferred<{ source: string; provider: string }>();
  mocks.api.load.mockReturnValueOnce(oldLoad.promise);
  const player = await import("./index");
  const first = player.playNow(track("B"));
  await vi.waitFor(() => expect(mocks.api.load).toHaveBeenCalledOnce());
  mocks.resolve.mockReturnValueOnce(nextSource.promise);
  const second = player.playNow(track("C"));
  oldLoad.resolve({ success: true, data: { detail: {}, mediaInfo: { duration: 120000 } } });
  await first;
  expect(mocks.media.enrichTrack).not.toHaveBeenCalled();
  expect(mocks.status.trackLoading).toBe(true);
  nextSource.resolve({ source: "C.flac", provider: "local" });
  await second;
  expect(mocks.status.currentSource).toBe("C.flac");
});

it("rolls back failed seeks and accepts later authoritative positions", async () => {
  mocks.api.seek.mockResolvedValueOnce({ success: false, error: "UNKNOWN" });
  const player = await import("./index");
  await player.seek(60000);
  expect(player.isSeeking()).toBe(false);
  expect(player.hasReachedSeekTarget(10000)).toBe(true);
  expect(mocks.status.position).toBe(0);
  expect(mocks.error).toHaveBeenCalledWith("UNKNOWN");
  await player.seek(10000);
  expect(player.hasReachedSeekTarget(70000)).toBe(true);
});

it("stops an all-filtered queue without recursion", async () => {
  mocks.media.track = null;
  mocks.settings.preset.skipKeywordsSongs = true;
  const player = await import("./index");
  await player.playFrom([track("blocked")]);
  expect(mocks.api.load).not.toHaveBeenCalled();
  expect(mocks.status.state).toBe("stopped");
  expect(mocks.info).toHaveBeenCalledWith("player.allTracksFiltered");
});

it("preserves the active local queue item when an earlier server item is removed", async () => {
  mocks.tracks.splice(
    0,
    mocks.tracks.length,
    { ...track("S"), source: "streaming", serverId: "server" },
    track("L"),
  );
  mocks.media.track = mocks.tracks[1];
  mocks.status.playIndex = 1;
  const player = await import("./index");
  await player.removeStreamingServerTracks("server");
  expect(mocks.status.playIndex).toBe(0);
  expect(mocks.status.currentTrack?.id).toBe("L");
  expect(mocks.api.stop).not.toHaveBeenCalled();
});
