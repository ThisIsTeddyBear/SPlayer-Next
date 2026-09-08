import { app, type BrowserWindow } from "electron";
import path from "node:path";
import { trustedDocument } from "./trustedDocument";

export const getTrustedDocument = (url: string) =>
  trustedDocument(
    url,
    path.join(app.getAppPath(), "out/renderer"),
    app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL,
  );

/** 为应用窗口统一限制导航、子窗口和媒体权限。 */
export const secureWindow = (window: BrowserWindow): void => {
  const contents = window.webContents;
  contents.on("will-navigate", (event, url) => {
    if (!getTrustedDocument(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!getTrustedDocument(url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.session.setPermissionRequestHandler((sender, permission, callback, details) => {
    const trusted =
      details.isMainFrame &&
      getTrustedDocument(sender.getURL()) === "index.html" &&
      getTrustedDocument(details.requestingUrl) === "index.html";
    const audio =
      permission === "media" &&
      "mediaTypes" in details &&
      details.mediaTypes?.length === 1 &&
      details.mediaTypes[0] === "audio";
    const clipboard =
      sender.isFocused() &&
      (permission === "clipboard-read" || permission === "clipboard-sanitized-write");
    callback(trusted && (audio || clipboard));
  });
  contents.session.setPermissionCheckHandler((sender, permission, _origin, details) => {
    if (!sender || !details.isMainFrame || getTrustedDocument(sender.getURL()) !== "index.html") {
      return false;
    }
    if (permission === "media") return details.mediaType === "audio";
    return (
      sender.isFocused() &&
      (permission === "clipboard-read" || permission === "clipboard-sanitized-write")
    );
  });
};
