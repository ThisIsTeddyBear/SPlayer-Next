import { dialog } from "electron";
import { ipcMain } from "./trusted";
import { matchLocalTTML, invalidateLocalLyricRepo } from "@main/services/localLyricRepo";
import type { Track } from "@shared/types/player";

/** 注册本地歌词仓库入口。 */
export const registerLyricsIpc = (): void => {
  ipcMain.handle("lyrics:matchLocalTTML", async (_event, track: Track) => ({
    ok: true,
    data: await matchLocalTTML(track),
  }));
  ipcMain.handle("lyrics:refreshLocalRepo", () => invalidateLocalLyricRepo());
  ipcMain.handle("lyrics:pickLyricRepoDir", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
};
