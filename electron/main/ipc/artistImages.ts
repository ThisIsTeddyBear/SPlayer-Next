import { ipcMain } from "electron";
import {
  clearPersonalApiKey,
  getArtistImageProviderStatus,
  savePersonalApiKey,
} from "@main/services/artistImages";

/** 注册 Fanart.tv 歌手图片设置 IPC */
export const registerArtistImagesIpc = (): void => {
  ipcMain.handle("artistImages:getStatus", getArtistImageProviderStatus);
  ipcMain.handle("artistImages:savePersonalApiKey", (_event, apiKey: string) =>
    savePersonalApiKey(apiKey),
  );
  ipcMain.handle("artistImages:clearPersonalApiKey", clearPersonalApiKey);
};
