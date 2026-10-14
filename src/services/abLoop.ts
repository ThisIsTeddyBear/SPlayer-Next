/**
 * AB 循环服务
 *
 * 用户在进度条上设两个标记 A、B，播放到 B 自动 seek 回 A
 * - 切歌时自动重置（per-song 状态）
 * - B <= A 视为非法配置，自动 disable
 * - 与"音调同步"等其它播放修饰互不干扰
 */

import { useStatusStore } from "@/stores/status";
let stopSync: (() => void) | null = null;
let syncGeneration = 0;

/** 将低频循环配置同步到主进程，隐藏窗口时仍由引擎位置驱动循环。 */
export const installAbLoopSync = (): void => {
  if (stopSync) return;
  const status = useStatusStore();
  stopSync = watch(
    () => [status.abLoop.enable, status.abLoop.pointA, status.abLoop.pointB] as const,
    ([enabled, pointA, pointB]) => {
      const generation = ++syncGeneration;
      const range = enabled && pointA !== null && pointB !== null ? { pointA, pointB } : null;
      void window.api.player
        .setAbLoop(range)
        .then((result) => {
          if (generation === syncGeneration && !result.success) status.abLoop.enable = false;
        })
        .catch((error) => {
          if (generation !== syncGeneration) return;
          status.abLoop.enable = false;
          console.error("[abLoop] sync failed", error);
        });
    },
    { flush: "sync" },
  );
};

/** 释放循环配置监听。 */
export const disposeAbLoopSync = (): void => {
  ++syncGeneration;
  stopSync?.();
  stopSync = null;
};

/** 设 A 点（毫秒）；自动校验 B 关系，非法则 disable */
export const setA = (positionMs: number): void => {
  const { abLoop } = useStatusStore();
  abLoop.pointA = Math.max(0, Math.floor(positionMs));
  if (abLoop.pointB !== null && abLoop.pointB <= abLoop.pointA) {
    abLoop.enable = false;
  }
};

/** 设 B 点（毫秒）；自动校验 A 关系，非法则 disable */
export const setB = (positionMs: number): void => {
  const { abLoop } = useStatusStore();
  abLoop.pointB = Math.max(0, Math.floor(positionMs));
  if (abLoop.pointA !== null && abLoop.pointB <= abLoop.pointA) {
    abLoop.enable = false;
  }
};

/** 微调 A 点（增量秒，可正可负） */
export const nudgeA = (deltaSec: number): void => {
  const { abLoop } = useStatusStore();
  if (abLoop.pointA === null) return;
  setA(abLoop.pointA + deltaSec * 1000);
};

/** 微调 B 点 */
export const nudgeB = (deltaSec: number): void => {
  const { abLoop } = useStatusStore();
  if (abLoop.pointB === null) return;
  setB(abLoop.pointB + deltaSec * 1000);
};

export const clearA = (): void => {
  const { abLoop } = useStatusStore();
  abLoop.pointA = null;
  abLoop.enable = false;
};

export const clearB = (): void => {
  const { abLoop } = useStatusStore();
  abLoop.pointB = null;
  abLoop.enable = false;
};

/** 启用 / 关闭循环；启用前会校验两点存在且 B > A */
export const setEnabled = (on: boolean): void => {
  const { abLoop } = useStatusStore();
  if (on) {
    if (abLoop.pointA === null || abLoop.pointB === null) return;
    if (abLoop.pointB <= abLoop.pointA) return;
  }
  abLoop.enable = on;
};

/** 切歌时调用：清空两点和启用状态 */
export const reset = (): void => {
  const { abLoop } = useStatusStore();
  abLoop.enable = false;
  abLoop.pointA = null;
  abLoop.pointB = null;
};
