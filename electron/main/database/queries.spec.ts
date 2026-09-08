// @vitest-environment node
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deleteTracksByDir, getCueTrackPathsByDirs, getTracksByIds } from "./queries";

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
      artists TEXT DEFAULT '[]', title TEXT DEFAULT '', duration INTEGER DEFAULT 0);
    CREATE TABLE playlists (id TEXT PRIMARY KEY, type TEXT);
    CREATE TABLE playlist_tracks (playlist_id TEXT, track_id TEXT);
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
