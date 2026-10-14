// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  emit: ((_event: unknown) => {}) as (event: unknown) => void,
  mediaEvent: ((_event: unknown) => {}) as (event: unknown) => void,
  state: "playing",
  seek: vi.fn(),
  pause: vi.fn(),
  send: vi.fn(),
  timeline: vi.fn(),
}));
const engine = {
  getDuration: () => 120,
  getPosition: () => 70,
  getStatus: () => ({ state: mocks.state, bitPerfectActive: false }),
  getVolume: () => 1,
  getSpeed: () => 1,
  seek: mocks.seek,
  pauseImmediately: () => {
    mocks.state = "paused";
    mocks.pause();
  },
  onEvent: (callback: typeof mocks.emit) => {
    mocks.emit = callback;
  },
};
vi.mock("./trusted", () => ({
  ipcMain: {
    handle: (channel: string, callback: (...args: any[]) => any) =>
      mocks.handlers.set(channel, callback),
    on: vi.fn(),
  },
}));
vi.mock("electron", () => ({ app: { on: vi.fn() }, powerMonitor: { on: vi.fn() } }));
vi.mock("@main/services/engine", () => ({
  getPlayer: () => engine,
  onPlayerCreated: (callback: (value: typeof engine) => void) => callback(engine),
}));
vi.mock("@main/services/device", () => ({
  startDeviceMonitoring: vi.fn(),
  cancelPendingReinit: vi.fn(),
}));
vi.mock("@main/utils/broadcast", () => ({ sendToMain: mocks.send }));
vi.mock("@main/server/broadcast", () => ({ wsBroadcast: vi.fn() }));
vi.mock("@main/utils/encoding", () => ({ readFileAutoEncoding: vi.fn() }));
vi.mock("@main/utils/protocol", () => ({ toCacheUrl: vi.fn() }));
vi.mock("@main/services/media", () => ({
  onEvent: (callback: typeof mocks.mediaEvent) => {
    mocks.mediaEvent = callback;
  },
  setTimeline: mocks.timeline,
  setPlayState: vi.fn(),
}));
vi.mock("@main/services/nowPlaying", () => ({ onPosition: vi.fn() }));
vi.mock("@main/utils/fetchBytes", () => ({ fetchBytes: vi.fn() }));
vi.mock("@main/services/thumbar", () => ({ getThumbar: () => null }));
vi.mock("@main/services/tray", () => ({}));
vi.mock("@main/services/thumbnail", () => ({}));
vi.mock("@main/window", () => ({
  getMainWindow: () => ({ isVisible: () => false }),
  setTaskbarProgress: vi.fn(),
}));
vi.mock("@main/store", () => ({ store: { get: () => false } }));
vi.mock("@main/utils/config", () => ({ appName: "Test", getSongCacheDir: () => "cache" }));
vi.mock("@main/services/songCache", () => ({}));
vi.mock("@main/utils/metadata", () => ({}));
vi.mock("@main/utils/logger", () => ({ playerLog: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("@main/utils/powerBlocker", () => ({
  releasePowerBlocker: vi.fn(),
  updatePowerBlocker: vi.fn(),
}));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.state = "playing";
  mocks.seek.mockReset().mockResolvedValue(undefined);
  const player = await import("./player");
  player.registerPlayerIpc();
});

it("ends a CUE segment while the main window is hidden", async () => {
  const timeline = await import("@main/services/playbackTimeline");
  timeline.beginPlaybackLoad({ cueStartMs: 60000, cueEndMs: 90000 });
  mocks.emit({ type: "position", position: 90, duration: 120 });
  mocks.emit({ type: "position", position: 90.2, duration: 120 });
  expect(mocks.pause).toHaveBeenCalledOnce();
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(mocks.send).toHaveBeenCalledWith("player:event", { type: "ended" });
});

it("enforces AB loops without broadcasting high-frequency positions to hidden windows", async () => {
  mocks.handlers.get("player:setAbLoop")!(null, { pointA: 1000, pointB: 2000 });
  mocks.emit({ type: "position", position: 2.1, duration: 120 });
  mocks.emit({ type: "position", position: 2.2, duration: 120 });
  expect(mocks.seek).toHaveBeenCalledOnce();
  expect(mocks.seek).toHaveBeenCalledWith(1);
  await vi.waitFor(() =>
    expect(mocks.send).toHaveBeenCalledWith("player:event", {
      type: "seek",
      data: { position: 1000 },
    }),
  );
  expect(mocks.send).toHaveBeenCalledOnce();
});

it("converts system media seeks and metadata to the same CUE timeline", async () => {
  const timeline = await import("@main/services/playbackTimeline");
  timeline.beginPlaybackLoad({ cueStartMs: 60000, cueEndMs: 90000 });
  mocks.mediaEvent({ type: "Seek", positionMs: 10000 });
  expect(mocks.seek).toHaveBeenCalledWith(70);
  await vi.waitFor(() =>
    expect(mocks.timeline).toHaveBeenCalledWith({ currentMs: 10000, totalMs: 30000, seeked: true }),
  );
});

it("returns the bounded authoritative position after a CUE seek", async () => {
  const timeline = await import("@main/services/playbackTimeline");
  timeline.beginPlaybackLoad({ cueStartMs: 60000, cueEndMs: 90000 });
  const result = await mocks.handlers.get("player:seek")!(null, 100000);
  expect(mocks.seek).toHaveBeenCalledWith(90);
  expect(result).toEqual({ success: true, data: { position: 30000 } });
});

it("does not announce a successful system seek if the engine fails", async () => {
  mocks.seek.mockRejectedValueOnce(new Error("device failed"));
  mocks.mediaEvent({ type: "Seek", positionMs: 10000 });
  await Promise.resolve();
  await Promise.resolve();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.timeline).not.toHaveBeenCalled();
});
