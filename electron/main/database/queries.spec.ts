// @vitest-environment node
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  deleteTracksByDir,
  getCueTrackPathsByDirs,
  getTracksByIds,
  sanitizeFts5Query,
  searchTracks,
} from "./queries";

let database: DatabaseSync;
vi.mock("./index", () => ({
  getDb: () => ({
    prepare: (sql: string) => database.prepare(sql),
    transaction: (fn: () => void) => () => {
      database.exec("BEGIN");
      try {
        fn();
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  }),
}));

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE tracks (id TEXT PRIMARY KEY, path TEXT, cue_path TEXT, cue_audio_path TEXT,
      artists TEXT DEFAULT '[]', title TEXT DEFAULT '', album TEXT, duration INTEGER DEFAULT 0);
    CREATE TABLE playlists (id TEXT PRIMARY KEY, type TEXT);
    CREATE TABLE playlist_tracks (playlist_id TEXT, track_id TEXT);
    CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
      id UNINDEXED,
      title,
      artist,
      album,
      tokenize = 'unicode61'
    );
    CREATE TRIGGER IF NOT EXISTS tracks_ai AFTER INSERT ON tracks BEGIN
      INSERT INTO tracks_fts(id, title, artist, album)
      VALUES (
        new.id,
        new.title,
        COALESCE((SELECT group_concat(json_extract(value, '$.name'), ' ') FROM json_each(new.artists)), ''),
        COALESCE(json_extract(new.album, '$.name'), '')
      );
    END;
    CREATE TRIGGER IF NOT EXISTS tracks_ad AFTER DELETE ON tracks BEGIN
      DELETE FROM tracks_fts WHERE id = old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS tracks_au AFTER UPDATE ON tracks BEGIN
      DELETE FROM tracks_fts WHERE id = old.id;
      INSERT INTO tracks_fts(id, title, artist, album)
      VALUES (
        new.id,
        new.title,
        COALESCE((SELECT group_concat(json_extract(value, '$.name'), ' ') FROM json_each(new.artists)), ''),
        COALESCE(json_extract(new.album, '$.name'), '')
      );
    END;
  `);
});
afterEach(() => database.close());

it("directory deletion escapes SQL wildcards and removes only matching memberships", () => {
  const directory = path.join("music", "100%_mix");
  const sibling = path.join("music", "100XAmix");
  const insert = database.prepare("INSERT INTO tracks (id, path, cue_path) VALUES (?, ?, ?)");
  insert.run("target", path.join(directory, "song.flac"), path.join(directory, "album.cue"));
  insert.run("sibling", path.join(sibling, "song.flac"), path.join(sibling, "album.cue"));
  database.exec(`INSERT INTO playlists VALUES ('local', 'local');
    INSERT INTO playlist_tracks VALUES ('local', 'target'), ('local', 'sibling');`);
  expect(getCueTrackPathsByDirs([directory])).toEqual([path.join(directory, "song.flac")]);
  deleteTracksByDir(directory);
  expect(database.prepare("SELECT id FROM tracks").all()).toEqual([{ id: "sibling" }]);
  expect(database.prepare("SELECT track_id FROM playlist_tracks").all()).toEqual([
    { track_id: "sibling" },
  ]);
});

it("bulk lookup crosses batch boundaries without duplicating IDs", () => {
  const ids = Array.from({ length: 1201 }, (_, index) => String(index));
  const insert = database.prepare("INSERT INTO tracks (id, path) VALUES (?, ?)");
  for (const id of ids) insert.run(id, `${id}.flac`);
  const result = getTracksByIds([...ids, ids[0]]);
  expect(new Set(result.map((track) => track.id))).toEqual(new Set(ids));
  expect(result).toHaveLength(ids.length);
});

it("sanitizeFts5Query escapes quotes and appends prefix wildcard", () => {
  expect(sanitizeFts5Query("")).toBe("");
  expect(sanitizeFts5Query("   ")).toBe("");
  expect(sanitizeFts5Query("hello world")).toBe('"hello"* "world"*');
  expect(sanitizeFts5Query('say "hi"')).toBe('"say"* """hi"""*');
});

it("searchTracks matches titles and artists via FTS5 index", () => {
  const insert = database.prepare(
    "INSERT INTO tracks (id, path, title, artists, album) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run(
    "t1",
    "/music/song1.flac",
    "晴天",
    JSON.stringify([{ id: "a1", name: "周杰伦" }]),
    JSON.stringify({ id: "alb1", name: "叶惠美" }),
  );
  insert.run(
    "t2",
    "/music/song2.flac",
    "Seven",
    JSON.stringify([{ id: "a2", name: "Jung Kook" }]),
    JSON.stringify({ id: "alb2", name: "Golden" }),
  );

  const res1 = searchTracks("晴天");
  expect(res1).toHaveLength(1);
  expect(res1[0].id).toBe("t1");

  const res2 = searchTracks("Jung");
  expect(res2).toHaveLength(1);
  expect(res2[0].id).toBe("t2");
});

it("searchTracks falls back to LIKE search when FTS5 does not match", () => {
  const insert = database.prepare(
    "INSERT INTO tracks (id, path, title, artists, album) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run("t3", "/music/song3.flac", "abcdefgh", "[]", null);

  // Substring match in the middle of a continuous token
  const res = searchTracks("cde");
  expect(res).toHaveLength(1);
  expect(res[0].id).toBe("t3");
});
