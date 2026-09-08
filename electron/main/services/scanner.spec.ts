// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { JsScanEvent } from "@splayer/audio-engine";
import { cancelScan, isScanning, startScan } from "./scanner";

const mocks = vi.hoisted(() => ({
  scanDirs: vi.fn(),
  cancelScan: vi.fn(),
  upsertTracks: vi.fn(),
  deleteTracksByPaths: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock("./engine", () => ({ getEngine: () => mocks }));
vi.mock("@main/database", () => ({
  getAllTracks: () => [],
  getFileRecords: () => [],
  getCueTrackPathsByDirs: () => [],
  upsertTracks: mocks.upsertTracks,
  deleteTracksByPaths: mocks.deleteTracksByPaths,
}));
vi.mock("@main/utils/broadcast", () => ({ broadcast: mocks.broadcast }));
vi.mock("@main/utils/protocol", () => ({ toCacheUrl: (value: string) => value }));
vi.mock("@main/utils/config", () => ({ getCoverCacheDir: () => "covers", isWin: false }));
vi.mock("@main/utils/logger", () => ({ libraryLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@main/utils/encoding", () => ({ readFileAutoEncoding: vi.fn() }));

beforeEach(() => {
  cancelScan();
  mocks.scanDirs.mockReset();
  vi.clearAllMocks();
});

it("ignores both progress and completion from a cancelled scan after a new scan starts", async () => {
  startScan(["old"]);
  const old = mocks.scanDirs.mock.calls[0][1] as (event: JsScanEvent) => void;
  cancelScan();
  startScan(["new"]);
  const current = mocks.scanDirs.mock.calls[1][1] as (event: JsScanEvent) => void;
  old({ eventType: "progress", total: 1, scanned: 1, tracks: [] });
  old({ eventType: "done", total: 1, scanned: 1, removedPaths: ["new/song.flac"] });
  await Promise.resolve();
  expect(isScanning()).toBe(true);
  expect(mocks.deleteTracksByPaths).not.toHaveBeenCalled();
  expect(mocks.broadcast).not.toHaveBeenCalled();
  current({ eventType: "done", total: 0, scanned: 0 });
  await Promise.resolve();
  expect(isScanning()).toBe(false);
});

it("releases the scanning state when native startup fails synchronously", () => {
  mocks.scanDirs.mockImplementationOnce(() => {
    throw new Error("native failed");
  });
  expect(() => startScan(["music"])).toThrow("native failed");
  expect(isScanning()).toBe(false);
  startScan(["music"]);
  expect(isScanning()).toBe(true);
  cancelScan();
});
