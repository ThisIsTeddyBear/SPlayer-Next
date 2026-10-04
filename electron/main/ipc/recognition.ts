/**
 * 听歌识曲 IPC：启动 / 取消 / 提交渲染进程 PCM，事件经 recognition:event 广播。
 */

import { ipcMain } from "./trusted";
import {
  startRecognition,
  cancelRecognition,
  isRecognitionSupported,
} from "@main/services/recognition";
import type { RecognitionConfig } from "@shared/types/recognition";
import {
  clearRecognitionHistory,
  getRecognitionHistory,
  removeRecognitionHistory,
  MAX_RECOGNITION_HISTORY,
} from "@main/database/recognitionHistory";
import { sendToMain } from "@main/utils/broadcast";

/** 注册听歌识曲 IPC 处理 */
export const registerRecognitionIpc = (): void => {
  ipcMain.handle("recognition:isSupported", () => isRecognitionSupported());
  ipcMain.handle("recognition:start", (_event, config: RecognitionConfig) => {
    startRecognition(config);
    return { success: true };
  });
  ipcMain.handle("recognition:cancel", () => {
    cancelRecognition();
    return { success: true };
  });
  ipcMain.handle("recognition:getHistory", (_event, limit = MAX_RECOGNITION_HISTORY) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECOGNITION_HISTORY) {
      throw new Error("Invalid recognition history limit");
    }
    return getRecognitionHistory(limit);
  });
  ipcMain.handle("recognition:removeHistory", (_event, songId: string) => {
    if (typeof songId !== "string" || !songId) {
      throw new Error("Invalid recognition song ID");
    }
    removeRecognitionHistory(songId);
    sendToMain("recognition:historyChanged");
  });
  ipcMain.handle("recognition:clearHistory", () => {
    clearRecognitionHistory();
    sendToMain("recognition:historyChanged");
  });
};
