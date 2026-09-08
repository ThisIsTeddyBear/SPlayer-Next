import { ipcMain as electronIpcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { getTrustedDocument } from "@main/utils/windowSecurity";
import { systemLog } from "@main/utils/logger";
import { validateIpcArgs } from "./validation";

const lyricChannels = new Set([
  "nowPlaying:requestSnapshot",
  "player:dispatch",
  "player:seek",
  "player:play",
  "player:pause",
  "system:focusMainWindow",
  "system:openSettings",
]);

/** 只接受已知窗口的主框架；歌词窗口只能访问歌词显示和播放控制。 */
const isTrusted = (
  event: IpcMainEvent | IpcMainInvokeEvent,
  channel: string,
  args: unknown[],
): boolean => {
  if (event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame) return false;
  const document = getTrustedDocument(event.senderFrame?.url ?? "");
  if (!document) return false;
  if (document === "index.html") return true;
  if (lyricChannels.has(channel)) return true;
  const windowName = document.split("/")[1];
  const prefixes: Record<string, string> = {
    "desktop-lyric": "desktopLyric:",
    "dynamic-island": "dynamicIsland:",
    "taskbar-lyric": "taskbarLyric:",
  };
  const prefix = prefixes[windowName];
  if (channel === "config:get") return args[0] === prefix?.slice(0, -1);
  if (document === "windows/desktop-lyric/index.html") {
    if (channel === "window:closeDesktopLyric") return true;
    if (channel === "config:set") {
      return args[0] === "desktopLyric.locked" && typeof args[1] === "boolean";
    }
  }
  return Boolean(prefix && channel.startsWith(prefix));
};

export const ipcMain = {
  handle(channel: string, listener: Parameters<typeof electronIpcMain.handle>[1]): void {
    electronIpcMain.handle(channel, (event, ...args) => {
      if (!isTrusted(event, channel, args)) throw new Error("Untrusted IPC sender");
      validateIpcArgs(channel, args);
      return listener(event, ...args);
    });
  },
  on(channel: string, listener: (event: IpcMainEvent, ...args: any[]) => void): void {
    electronIpcMain.on(channel, (event, ...args) => {
      if (!isTrusted(event, channel, args)) return;
      try {
        validateIpcArgs(channel, args);
        listener(event, ...args);
      } catch (error) {
        systemLog.warn(`Rejected IPC event: ${channel}`, error);
      }
    });
  },
};
