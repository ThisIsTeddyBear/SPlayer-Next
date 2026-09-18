// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLyricRomanizationCache,
  getCachedRomanizations,
  setCachedRomanizations,
} from "./lyricRomanizationCache";

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

describe("lyricRomanizationCache", () => {
  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE lyric_romanization_cache (
        lyric_text TEXT PRIMARY KEY,
        romanization TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL
      );
      CREATE INDEX idx_lyric_romanization_cache_last_used
        ON lyric_romanization_cache(last_used_at);
    `);
  });

  it("stores and retrieves cached romanizations", () => {
    const text = "こんにちは";
    const reading = "konnichiwa";

    setCachedRomanizations({ [text]: reading });
    const cached = getCachedRomanizations([text]);

    expect(cached).toEqual({ [text]: reading });
  });

  it("auto-migrates unsimplified Indic romanizations to readable ASCII on hit", () => {
    const text = "ਮਸਤੀ ’ਚ ਮਸਤਾਈ ਜ਼ਹਿਰੀ ਜਵਾਨੀ";
    const unsimplified = "Masatī’ca masatā'ī zahirī javānī";

    // Simulate older database entry saved prior to simplification
    database
      .prepare(
        "INSERT INTO lyric_romanization_cache (lyric_text, romanization, cached_at, last_used_at) VALUES (?, ?, ?, ?)",
      )
      .run(text, unsimplified, 1000, 1000);

    const cached = getCachedRomanizations([text]);

    // Should return the simplified readable version
    expect(cached).toEqual({ [text]: "Masati'ch masata'i zahiri javani" });

    // The SQLite row should now be updated with the simplified version
    const updatedRow = database
      .prepare("SELECT romanization FROM lyric_romanization_cache WHERE lyric_text = ?")
      .get(text) as { romanization: string };
    expect(updatedRow.romanization).toBe("Masati'ch masata'i zahiri javani");
  });

  it("auto-migrates Gurmukhi ISO c to ch in SQLite cache", () => {
    const text = "ਨੱਚਣਾ";
    const unsimplified = "nacaṇā";

    database
      .prepare(
        "INSERT INTO lyric_romanization_cache (lyric_text, romanization, cached_at, last_used_at) VALUES (?, ?, ?, ?)",
      )
      .run(text, unsimplified, 1000, 1000);

    const cached = getCachedRomanizations([text]);
    expect(cached).toEqual({ [text]: "nachana" });

    const updatedRow = database
      .prepare("SELECT romanization FROM lyric_romanization_cache WHERE lyric_text = ?")
      .get(text) as { romanization: string };
    expect(updatedRow.romanization).toBe("nachana");
  });

  it("leaves Japanese, Korean, Chinese and already-proper romanizations completely intact", () => {
    // Japanese: 'c' in tsuki / ch should not be affected by Indic rules
    const jaText = "月が綺麗ですね";
    const jaRoman = "Tsuki ga kirei desu ne";

    // Korean: standard Revised Romanization
    const koText = "안녕하세요";
    const koRoman = "annyeonghaseyo";

    // Chinese Pinyin: 'c' (e.g. cai) must NOT be replaced with 'ch' because Chinese is not Indic
    const zhText = "今天买菜";
    const zhRoman = "jintian mai cai";

    // Already simplified Indic romanization (with ch and without diacritics)
    const hiText = "तुमको भी है खबर";
    const hiRoman = "tumko bhi hai khabar";
    const paText = "ਨੱਚਣਾ";
    const paRoman = "nachana";
    const paChaloText = "ਚਲੋ ਚੱਲੀਏ";
    const paChaloRoman = "Chalo chaliye";
    const mixedText = "Music ਚੱਲਦਾ Club 'ਚ";
    const mixedRoman = "Music chalada Club'ch";

    database
      .prepare(
        "INSERT INTO lyric_romanization_cache (lyric_text, romanization, cached_at, last_used_at) VALUES (?, ?, ?, ?)",
      )
      .run(jaText, jaRoman, 1000, 1000);
    database
      .prepare(
        "INSERT INTO lyric_romanization_cache (lyric_text, romanization, cached_at, last_used_at) VALUES (?, ?, ?, ?)",
      )
      .run(koText, koRoman, 1000, 1000);
    database
      .prepare(
        "INSERT INTO lyric_romanization_cache (lyric_text, romanization, cached_at, last_used_at) VALUES (?, ?, ?, ?)",
      )
      .run(zhText, zhRoman, 1000, 1000);
    database
      .prepare(
        "INSERT INTO lyric_romanization_cache (lyric_text, romanization, cached_at, last_used_at) VALUES (?, ?, ?, ?)",
      )
      .run(hiText, hiRoman, 1000, 1000);
    database
      .prepare(
        "INSERT INTO lyric_romanization_cache (lyric_text, romanization, cached_at, last_used_at) VALUES (?, ?, ?, ?)",
      )
      .run(paText, paRoman, 1000, 1000);
    database
      .prepare(
        "INSERT INTO lyric_romanization_cache (lyric_text, romanization, cached_at, last_used_at) VALUES (?, ?, ?, ?)",
      )
      .run(paChaloText, paChaloRoman, 1000, 1000);
    database
      .prepare(
        "INSERT INTO lyric_romanization_cache (lyric_text, romanization, cached_at, last_used_at) VALUES (?, ?, ?, ?)",
      )
      .run(mixedText, mixedRoman, 1000, 1000);

    const cached = getCachedRomanizations([
      jaText,
      koText,
      zhText,
      hiText,
      paText,
      paChaloText,
      mixedText,
    ]);
    expect(cached).toEqual({
      [jaText]: jaRoman,
      [koText]: koRoman,
      [zhText]: zhRoman,
      [hiText]: hiRoman,
      [paText]: paRoman,
      [paChaloText]: paChaloRoman,
      [mixedText]: mixedRoman,
    });
  });

  it("clears all cached romanizations", () => {
    setCachedRomanizations({ a: "1", b: "2" });
    clearLyricRomanizationCache();
    expect(getCachedRomanizations(["a", "b"])).toEqual({});
  });
});
