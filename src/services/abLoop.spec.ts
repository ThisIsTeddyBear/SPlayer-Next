import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sync = vi.fn();

import { useStatusStore } from "@/stores/status";
import { disposeAbLoopSync, installAbLoopSync, reset, setA, setB, setEnabled } from "./abLoop";

describe("abLoop", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    sync.mockReset().mockResolvedValue({ success: true });
    window.api = { player: { setAbLoop: sync } } as unknown as typeof window.api;
  });

  afterEach(disposeAbLoopSync);

  it("只有 A、B 合法且 B 大于 A 时才能启用", () => {
    const status = useStatusStore();

    setEnabled(true);
    expect(status.abLoop.enable).toBe(false);

    setA(2_000.9);
    setB(1_000);
    setEnabled(true);
    expect(status.abLoop.enable).toBe(false);

    setB(3_000.9);
    setEnabled(true);
    expect(status.abLoop).toEqual({ enable: true, pointA: 2_000, pointB: 3_000 });
  });

  it("只同步循环配置，由主进程处理循环边界", () => {
    installAbLoopSync();
    setA(1_000);
    setB(2_000);
    setEnabled(true);
    expect(sync).toHaveBeenLastCalledWith({ pointA: 1_000, pointB: 2_000 });
    reset();
    expect(sync).toHaveBeenLastCalledWith(null);
  });

  it("旧配置同步失败不会禁用新的循环", async () => {
    let fail!: (value: { success: boolean }) => void;
    installAbLoopSync();
    setA(1_000);
    setB(2_000);
    sync.mockReturnValueOnce(
      new Promise((resolve) => {
        fail = resolve;
      }),
    );
    setEnabled(true);
    setB(3_000);
    fail({ success: false });
    await Promise.resolve();
    expect(useStatusStore().abLoop.enable).toBe(true);
  });

  it("切歌重置会清空 AB 循环状态", () => {
    const status = useStatusStore();
    setA(1_000);
    setB(2_000);
    setEnabled(true);

    reset();

    expect(status.abLoop).toEqual({ enable: false, pointA: null, pointB: null });
  });
});
