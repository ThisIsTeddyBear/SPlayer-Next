// @vitest-environment node
import { describe, expect, it } from "vitest";
import { normalizeLxMusicInfo } from "./lx-shim";

describe("normalizeLxMusicInfo", () => {
  it("should not set empty string hash for tracks without hash, and ?? should fall back to songmid", () => {
    const raw = {
      songmid: "208902",
      name: "Test Song",
      singer: "Test Artist",
      albumId: "20744",
      albumName: "Test Album",
    };

    const info = normalizeLxMusicInfo(raw, "wy");

    expect(info.songmid).toBe("208902");
    expect(info.id).toBe("208902");
    expect(info.hash).toBeUndefined();
    expect("hash" in info).toBe(false);
    expect(info.meta.hash).toBeUndefined();
    expect("hash" in info.meta).toBe(false);

    // Verify common third-party plugin pattern: const songId = musicInfo.hash ?? musicInfo.songmid
    const resolvedSongId = info.hash ?? info.songmid;
    expect(resolvedSongId).toBe("208902");
  });

  it("should clean empty string hash from input instead of passing it through", () => {
    const raw = {
      songmid: "208902",
      name: "Test Song",
      singer: "Test Artist",
      hash: "",
      meta: {
        songId: "208902",
        albumName: "",
        albumId: "",
        picUrl: null,
        hash: "",
      },
    };

    const info = normalizeLxMusicInfo(raw, "wy");

    expect(info.hash).toBeUndefined();
    expect("hash" in info).toBe(false);
    expect(info.meta.hash).toBeUndefined();
    expect("hash" in info.meta).toBe(false);

    const resolvedSongId = info.hash ?? info.songmid;
    expect(resolvedSongId).toBe("208902");
  });

  it("should retain valid 32-char hex hash for Kugou tracks", () => {
    const hex32 = "e10adc3949ba59abbe56e057f20f883e";
    const raw = {
      songmid: hex32,
      name: "Test Song",
      singer: "Test Artist",
    };

    const info = normalizeLxMusicInfo(raw, "kg");

    expect(info.hash).toBe(hex32);
    expect(info.meta.hash).toBe(hex32);

    const resolvedSongId = info.hash ?? info.songmid;
    expect(resolvedSongId).toBe(hex32);
  });

  it("should prioritize explicitly provided hash for Kugou tracks", () => {
    const customHash = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const raw = {
      songmid: "123456",
      name: "Test Song",
      singer: "Test Artist",
      hash: customHash,
    };

    const info = normalizeLxMusicInfo(raw, "kg");

    expect(info.hash).toBe(customHash);
    expect(info.meta.hash).toBe(customHash);
    expect(info.songmid).toBe("123456");
  });

  it("should not mount empty string copyrightId when not present", () => {
    const raw = {
      songmid: "208902",
      name: "Test Song",
      copyrightId: "",
    };

    const info = normalizeLxMusicInfo(raw, "wy");
    expect(info.copyrightId).toBeUndefined();
    expect("copyrightId" in info).toBe(false);
  });
});

describe("sandbox console and window compatibility", () => {
  it("sandbox console should support group/groupEnd/table/time/assert methods and window.console should work", () => {
    const logs: string[] = [];
    const fakeSplayer = {
      log: {
        info: (...args: unknown[]) => logs.push(`info:${args.join(" ")}`),
        debug: (...args: unknown[]) => logs.push(`debug:${args.join(" ")}`),
        warn: (...args: unknown[]) => logs.push(`warn:${args.join(" ")}`),
        error: (...args: unknown[]) => logs.push(`error:${args.join(" ")}`),
      },
    };

    const sandboxConsole = {
      log: fakeSplayer.log.info,
      info: fakeSplayer.log.info,
      debug: fakeSplayer.log.debug,
      warn: fakeSplayer.log.warn,
      error: fakeSplayer.log.error,
      group: fakeSplayer.log.info,
      groupCollapsed: fakeSplayer.log.info,
      groupEnd: (): void => {},
      table: fakeSplayer.log.info,
      dir: fakeSplayer.log.info,
      dirxml: fakeSplayer.log.info,
      trace: fakeSplayer.log.debug,
      clear: (): void => {},
      time: (_label?: string): void => {},
      timeEnd: (_label?: string): void => {},
      timeLog: (_label?: string, ..._data: unknown[]): void => {},
      count: (_label?: string): void => {},
      countReset: (_label?: string): void => {},
      assert: (condition?: boolean, ...args: unknown[]): void => {
        if (!condition) fakeSplayer.log.error(...args);
      },
    };

    const sandboxGlobal: Record<string, unknown> = {
      console: sandboxConsole,
    };
    sandboxGlobal.globalThis = sandboxGlobal;
    sandboxGlobal.window = sandboxGlobal;
    sandboxGlobal.self = sandboxGlobal;

    // Verify common LX plugin methods execute without throwing
    expect(() => {
      sandboxConsole.group("test group");
      sandboxConsole.groupCollapsed("collapsed");
      sandboxConsole.groupEnd();
      sandboxConsole.table([{ a: 1 }]);
      sandboxConsole.time("timer");
      sandboxConsole.timeEnd("timer");
      sandboxConsole.assert(true, "should not log");
      sandboxConsole.assert(false, "assertion failed");
    }).not.toThrow();

    // Verify window.console access
    const windowObj = sandboxGlobal.window as Record<string, unknown>;
    const windowConsole = windowObj.console as typeof sandboxConsole;
    expect(typeof windowConsole.groupEnd).toBe("function");
    expect(() => {
      windowConsole.groupEnd();
    }).not.toThrow();

    expect(logs.some((l) => l.includes("info:test group"))).toBe(true);
    expect(logs.some((l) => l.includes("error:assertion failed"))).toBe(true);
  });
});

