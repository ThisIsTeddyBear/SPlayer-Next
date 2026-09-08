import { app, BrowserWindow } from "electron";
import assert from "node:assert/strict";
import path from "node:path";

const timeout = setTimeout(() => {
  console.error("Sandboxed preload smoke test timed out");
  app.exit(1);
}, 30000);

app
  .whenReady()
  .then(async () => {
    const runtime = {
      installType: "appimage",
      osInfo: { type: "Linux", arch: "x64", release: "test" },
    };
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.resolve("out/preload/index.cjs"),
        additionalArguments: [`--splayer-runtime=${encodeURIComponent(JSON.stringify(runtime))}`],
      },
    });
    window.webContents.on("preload-error", (_event, _filename, error) => {
      throw error;
    });
    await window.loadURL("data:text/html,<html><body>Preload test</body></html>");
    const result = await window.webContents.executeJavaScript(`({
    hasApi: typeof window.api?.player?.load === "function",
    hasRawIpc: typeof window.electron?.ipcRenderer !== "undefined",
    hasRequire: typeof window.require !== "undefined",
    installType: window.api?.system?.installType,
    hasVersions: typeof window.electron?.process?.versions?.electron === "string",
    virtualFilePath: window.api.system.getPathForFile(new File(["test"], "test.txt"))
  })`);
    assert.deepEqual(result, {
      hasApi: true,
      hasRawIpc: false,
      hasRequire: false,
      installType: "appimage",
      hasVersions: true,
      virtualFilePath: "",
    });
    console.log("Sandboxed CommonJS preload smoke test passed");
    clearTimeout(timeout);
    window.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  });
