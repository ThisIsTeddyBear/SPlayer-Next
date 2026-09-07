import { app } from "electron";
import { createRequire } from "module";
import path from "path";
import { nativeLog } from "./logger";

const requireNative = createRequire(import.meta.url);

/**
 * 加载一个原生插件
 * @param fileName 编译后的文件名 (例如: "audio-engine.node")
 * @param devDirName 开发环境下的目录名 (例如: "audio-engine")，必须位于项目根目录的 native/ 下
 */
export const loadNativeModule = <T = unknown>(fileName: string, devDirName: string): T | null => {
  let nativeModulePath: string;

  if (app.isPackaged) {
    // 打包后: resources/native/audio-engine.node
    nativeModulePath = path.join(process.resourcesPath, "native", fileName);
  } else {
    // 开发时: native/audio-engine/audio-engine.node
    nativeModulePath = path.join(process.cwd(), "native", devDirName, fileName);
  }

  try {
    const mod = requireNative(nativeModulePath) as T;
    nativeLog.debug(`Loaded ${fileName}`);
    return mod;
  } catch (error) {
    nativeLog.error(`Failed to load ${fileName}:`, error);
    return null;
  }
};
