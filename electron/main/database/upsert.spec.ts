// @vitest-environment node
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { searchTracks, upsertTracks } from "./queries";
import { migrate } from "./migration";

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
  const source = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  database.exec(source.match(/db\.exec\(`([\s\S]*?)`\);/)![1]);
});
afterEach(() => database.close());

const track = {
  id: "test",
  path: "test.flac",
  title: "Original",
  artists: [],
  duration: 1000,
  fileSize: 1,
  mtime: 1,
  ctime: 1,
};

it("keeps search current and unique after repeated rescans and tag edits", () => {
  upsertTracks([track]);
  upsertTracks([{ ...track, title: "Renamed" }]);
  upsertTracks([{ ...track, title: "Renamed" }]);
  expect(searchTracks("Original")).toEqual([]);
  expect(searchTracks("Renamed")).toHaveLength(1);
  expect(database.prepare("SELECT COUNT(*) AS count FROM tracks_fts").get()).toEqual({ count: 1 });
});

it("repairs stale full-text entries when upgrading an existing library", () => {
  upsertTracks([track]);
  database.exec(
    "INSERT INTO tracks_fts (id, title) VALUES ('test', 'Stale'); PRAGMA user_version = 8;",
  );
  migrate({
    exec: (sql: string) => database.exec(sql),
    prepare: (sql: string) => database.prepare(sql),
    pragma: (sql: string, options?: { simple?: boolean }) => {
      const rows = database.prepare(`PRAGMA ${sql}`).all();
      return options?.simple ? Object.values(rows[0])[0] : rows;
    },
  } as unknown as Parameters<typeof migrate>[0]);
  expect(searchTracks("Stale")).toEqual([]);
  expect(database.prepare("SELECT COUNT(*) AS count FROM tracks_fts").get()).toEqual({ count: 1 });
});
