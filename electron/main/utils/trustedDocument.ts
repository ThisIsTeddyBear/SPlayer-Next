import path from "node:path";
import { fileURLToPath } from "node:url";

const entries = [
  "index.html",
  "windows/desktop-lyric/index.html",
  "windows/dynamic-island/index.html",
  "windows/taskbar-lyric/index.html",
] as const;

/**
 * 仅信任已打包的入口或开发服务器的同源入口，不接受任意 file URL 或 URL 前缀。
 * @param value - 待检查的页面 URL
 * @param rendererDir - 打包后渲染页面根目录
 * @param devUrl - 仅开发模式提供的服务器 URL
 * @returns 匹配的入口名称
 */
export const trustedDocument = (
  value: string,
  rendererDir: string,
  devUrl?: string,
): (typeof entries)[number] | undefined => {
  try {
    const url = new URL(value);
    if (url.protocol === "file:") {
      const filename = path.resolve(fileURLToPath(url));
      return entries.find((entry) => filename === path.resolve(rendererDir, entry));
    }
    if (devUrl) {
      const base = new URL(devUrl);
      if (url.origin !== base.origin || url.username || url.password) return;
      return entries.find((entry) => {
        const pathname = new URL(entry, base.href.endsWith("/") ? base : `${base.href}/`).pathname;
        return url.pathname === pathname || (entry === "index.html" && url.pathname === "/");
      });
    }
  } catch {}
  return;
};
