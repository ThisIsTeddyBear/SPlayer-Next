import { BrowserWindow, BrowserWindowConstructorOptions, nativeTheme } from "electron";
import { join } from "path";
import os from "node:os";
import type { RendererRuntime } from "@shared/types/runtime";
import { secureWindow } from "@main/utils/windowSecurity";
import icon from "../../../public/icons/favicon.png?asset";

/**
 * 获取默认窗口配置
 */
const getDefaultOptions = (): BrowserWindowConstructorOptions => ({
  width: 1280,
  height: 800,
  minWidth: 1280,
  minHeight: 800,
  autoHideMenuBar: true,
  show: false,
  backgroundColor: nativeTheme.shouldUseDarkColors ? "#101014" : "#f6f6f6",
  icon,
  webPreferences: {
    preload: join(__dirname, "../preload/index.cjs"),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    additionalArguments: [
      `--splayer-runtime=${encodeURIComponent(
        JSON.stringify({
          installType: process.env.PORTABLE_EXECUTABLE_DIR
            ? "portable"
            : process.execPath.includes("WindowsApps")
              ? "appx"
              : process.platform === "darwin"
                ? "dmg"
                : process.platform === "linux"
                  ? "appimage"
                  : "nsis",
          osInfo: { type: os.type(), arch: os.arch(), release: os.release() },
        } satisfies RendererRuntime),
      )}`,
    ],
    // 关闭 WebGL
    webgl: false,
    // 关闭拼写检查
    spellcheck: false,
    // 禁用 Web SQL
    enableWebSQL: false,
    // 开启后台节流
    backgroundThrottling: true,
    // V8 编译代码缓存
    v8CacheOptions: "code",
  },
});

/**
 * 通用窗口创建方法，仅负责合并配置并创建 BrowserWindow 实例
 * @param options - 覆盖默认配置的参数
 */
export const createWindow = (options: BrowserWindowConstructorOptions = {}): BrowserWindow => {
  const defaultOptions = getDefaultOptions();

  const window = new BrowserWindow({
    ...defaultOptions,
    ...options,
    webPreferences: {
      ...defaultOptions.webPreferences,
      ...options.webPreferences,
    },
  });
  secureWindow(window);
  return window;
};
