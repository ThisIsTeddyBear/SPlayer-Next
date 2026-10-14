// @vitest-environment node
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rm: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  credentials: vi.fn(),
  reset: vi.fn(),
}));
let database: DatabaseSync;
vi.mock("node:fs/promises", () => ({ default: { rm: mocks.rm } }));
vi.mock("@main/database", () => ({
  getDb: () => ({
    exec: (sql: string) => database.exec(sql),
    transaction: (fn: () => void) => fn,
  }),
}));
vi.mock("@main/store", () => ({ store: { clear: mocks.reset } }));
vi.mock("./engine", () => ({ getPlayer: () => ({ stop: mocks.stop }) }));
vi.mock("./playbackTimeline", () => ({ clearPlaybackTimeline: vi.fn() }));
vi.mock("./scanner", () => ({ cancelScan: mocks.cancel }));
vi.mock("./recognition", () => ({ cancelRecognition: mocks.cancel }));
vi.mock("./downloadManager", () => ({ cancelAll: mocks.cancel }));
vi.mock("./songCache", () => ({ clearAll: mocks.cancel }));
vi.mock("./artistImages", () => ({ invalidateArtistImages: mocks.cancel }));
vi.mock("./streaming/sync", () => ({ cancelAllStreamingSync: mocks.cancel }));
vi.mock("./streaming/adapters/resolve", () => ({ clearStreamingSessions: mocks.credentials }));
vi.mock("./streaming/config", () => ({ clearStreamingConfig: mocks.credentials }));
vi.mock("./lastfm", () => ({ cancelConnect: mocks.cancel, disconnect: mocks.credentials }));
vi.mock("./localLyricRepo", () => ({ invalidateLocalLyricRepo: mocks.cancel }));
vi.mock("@main/utils/paths", () => ({ configDir: "config" }));
vi.mock("@main/utils/config", () => ({
  getAppCacheDir: () => "cache",
  getCoverCacheDir: () => "cache/covers",
  getArtistCacheDir: () => "cache/artists",
  getBackgroundsDir: () => "cache/backgrounds",
}));
vi.mock("@main/server", () => ({ stopServer: mocks.stop }));
vi.mock("./mcp/http", () => ({ stopMcpServer: mocks.stop }));
afterEach(() => database?.close());

it("clears history, credentials and caches without touching downloaded music", async () => {
  database = new DatabaseSync(":memory:");
  const source = fs.readFileSync(new URL("../database/index.ts", import.meta.url), "utf8");
  database.exec(source.match(/db\.exec\(`([\s\S]*?)`\);/)![1]);
  database.exec(`
    INSERT INTO account_sessions VALUES ('test', '{}', 1);
    INSERT INTO play_history (track_id, source, started_at, listened_ms, track_json) VALUES ('song', 'local', 1, 5000, '{}');
    INSERT INTO lyric_cache VALUES ('test', '1', '{}', 1);
    INSERT INTO playlists VALUES ('list', 'local', 'Playlist', NULL, NULL, 1, 1);
    INSERT INTO playlist_tracks VALUES ('list', 'song', 0, 1);
  `);
  const { clearUserData } = await import("./dataReset");
  await clearUserData();
  for (const table of [
    "account_sessions",
    "play_history",
    "lyric_cache",
    "playlists",
    "playlist_tracks",
  ]) {
    expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
  }
  expect(mocks.credentials).toHaveBeenCalledTimes(3);
  expect(mocks.reset).toHaveBeenCalledOnce();
  expect(
    mocks.rm.mock.calls.every(
      ([filename]) => String(filename).startsWith("cache") || String(filename).startsWith("config"),
    ),
  ).toBe(true);
});
