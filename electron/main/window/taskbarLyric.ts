import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { loadNativeModule } from "@main/utils/nativeLoader";
import { broadcast } from "@main/utils/broadcast";
import { setTrayTaskbarLyric } from "@main/services/tray";
import { store } from "@main/store";
import { isAppQuitting } from "@main/utils/lifecycle";
import type { TaskbarLyricPosition } from "@shared/types/settings";
import type {
  JsRect,
  JsTaskbarLayout,
  RegistryWatcher,
  TaskbarCreatedWatcher,
  TaskbarService,
  TrayWatcher,
  UiaWatcher,
} from "@splayer/taskbar-lyric";
import { taskbarLog } from "@main/utils/logger";

type TaskbarLyricNative = typeof import("@splayer/taskbar-lyric");

const REG_SUBKEY_EXPLORER_ADVANCED =
  "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";
const REG_SUBKEY_PERSONALIZE = "Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";

type AnchorSide = "left" | "right";

interface PickedSpace {
  rect: JsRect;
  anchor: AnchorSide;
}

let taskbarLyricWindow: BrowserWindow | null = null;
let nativeModule: TaskbarLyricNative | null = null;
let service: TaskbarService | null = null;
let advancedRegWatcher: RegistryWatcher | null = null;
let themeRegWatcher: RegistryWatcher | null = null;
let uiaWatcher: UiaWatcher | null = null;
let trayWatcher: TrayWatcher | null = null;
let taskbarCreatedWatcher: TaskbarCreatedWatcher | null = null;

interface ActiveWindowRegion {
  x: number;
  y: number;
  maxWidth: number;
  height: number;
  anchor: AnchorSide;
}

let activeWindowRegion: ActiveWindowRegion | null = null;
let contentWidth: number | null = null;

const resolveLyricWidth = (): number => {
  const width = store.get("taskbarLyric.maxWidth");
  return typeof width === "number" && width > 0 ? width : 400;
};

/**
 */
const INITIAL_WIDTH = 3000;
const INITIAL_HEIGHT = 200;

/**
 */
const MIN_LYRIC_WIDTH_DIP = 120;

export const getTaskbarLyricWindow = (): BrowserWindow | null =>
  taskbarLyricWindow && !taskbarLyricWindow.isDestroyed() ? taskbarLyricWindow : null;

/**
 *
 */
const applyContentShape = (): void => {
  const win = getTaskbarLyricWindow();
  const region = activeWindowRegion;
  if (!win || !region) return;
  const adjustOccupiedSpace =
    (store.get("taskbarLyric.autoMaxWidth") ?? true) &&
    (store.get("taskbarLyric.autoAdjustOccupiedSpace") ?? false);
  const shapeWidth = Math.min(
    region.maxWidth,
    Math.max(
      MIN_LYRIC_WIDTH_DIP,
      Math.round(adjustOccupiedSpace ? (contentWidth ?? region.maxWidth) : region.maxWidth),
    ),
  );
  if (shapeWidth >= region.maxWidth) {
    win.setShape([]);
    return;
  }
  const x = region.anchor === "right" ? region.maxWidth - shapeWidth : 0;
  win.setShape([{ x, y: 0, width: shapeWidth, height: region.height }]);
};

/**
 */
export const updateTaskbarLyricContentWidth = (width: number): void => {
  if (!Number.isFinite(width) || width <= 0) return;
  contentWidth = width;
  applyContentShape();
};

const pickSpace = (layout: JsTaskbarLayout): PickedSpace | null => {
  const position: TaskbarLyricPosition = store.get("taskbarLyric.position") ?? "auto";
  const { left, right } = layout.space;
  const isCentered = layout.extra.isCentered;

  if (position === "left" && left.width > 0) return { rect: left, anchor: "left" };
  if (position === "right" && right.width > 0) return { rect: right, anchor: "right" };

  if (position === "auto") {
    if (isCentered) {
      if (left.width >= right.width) return { rect: left, anchor: "left" };
      return { rect: right, anchor: "right" };
    }
    return right.width > 0 ? { rect: right, anchor: "right" } : { rect: left, anchor: "left" };
  }

  if (right.width > 0) return { rect: right, anchor: "right" };
  if (left.width > 0) return { rect: left, anchor: "left" };
  return null;
};

let firstLayoutDone = false;

const hideIfVisible = (win: BrowserWindow): void => {
  if (win.isVisible()) win.hide();
};

const applyLayout = (layout: JsTaskbarLayout): void => {
  const win = getTaskbarLyricWindow();
  if (!win) return;

  const picked = pickSpace(layout);
  if (!picked) {
    hideIfVisible(win);
    return;
  }
  const { rect, anchor } = picked;
  if (rect.width <= 0 || rect.height <= 0) {
    hideIfVisible(win);
    return;
  }

  const dpi = screen.getPrimaryDisplay().scaleFactor;
  const leftMargin = store.get("taskbarLyric.leftMargin") ?? 0;
  const rightMargin = store.get("taskbarLyric.rightMargin") ?? 0;
  const availX = Math.round(rect.x / dpi) + leftMargin;
  const availY = Math.round(rect.y / dpi);
  const availWidth = Math.round(rect.width / dpi) - leftMargin - rightMargin;
  const availHeight = Math.round(rect.height / dpi);

  if (availWidth < MIN_LYRIC_WIDTH_DIP) {
    hideIfVisible(win);
    return;
  }

  const autoMaxWidth = store.get("taskbarLyric.autoMaxWidth") ?? true;
  const maxWidth = store.get("taskbarLyric.maxWidth") ?? 400;
  const windowWidth = autoMaxWidth ? availWidth : Math.min(maxWidth, availWidth);
  const windowX = anchor === "right" ? availX + availWidth - windowWidth : availX;

  activeWindowRegion = {
    x: windowX,
    y: availY,
    maxWidth: windowWidth,
    height: availHeight,
    anchor,
  };
  win.setBounds({ x: windowX, y: availY, width: windowWidth, height: availHeight });
  applyContentShape();

  if (!firstLayoutDone) {
    firstLayoutDone = true;
    win.showInactive();
  } else if (!win.isVisible()) {
    win.showInactive();
  }

  win.webContents.send("taskbarLyric:layout", {
    isCentered: layout.extra.isCentered,
    systemType: layout.extra.systemType,
    isLight: layout.extra.isLight,
    anchor,
    maxWidth: windowWidth,
  });
};

const onLayoutChange = (): void => {
  service?.update(resolveLyricWidth());
};

const tryStart = <T>(name: string, factory: () => T): T | null => {
  try {
    return factory();
  } catch (error) {
    taskbarLog.warn(`${name} 启动失败`, error);
    return null;
  }
};

const startWatchers = (mod: TaskbarLyricNative): void => {
  advancedRegWatcher = tryStart(
    "RegistryWatcher(Advanced)",
    () => new mod.RegistryWatcher(REG_SUBKEY_EXPLORER_ADVANCED, onLayoutChange),
  );
  themeRegWatcher = tryStart(
    "RegistryWatcher(Personalize)",
    () => new mod.RegistryWatcher(REG_SUBKEY_PERSONALIZE, onLayoutChange),
  );
  uiaWatcher = tryStart("UiaWatcher", () => new mod.UiaWatcher(onLayoutChange));
  trayWatcher = tryStart("TrayWatcher", () => new mod.TrayWatcher(onLayoutChange));
};

const stopLayoutWatchers = (): void => {
  advancedRegWatcher?.stop();
  advancedRegWatcher = null;
  themeRegWatcher?.stop();
  themeRegWatcher = null;
  uiaWatcher?.stop();
  uiaWatcher = null;
  trayWatcher?.stop();
  trayWatcher = null;
};

/**
 */
const onExplorerRestart = (): void => {
  taskbarLog.info("探测到 explorer 重启，重建 watcher 与嵌入");
  stopLayoutWatchers();
  service?.reinit();
  if (nativeModule) startWatchers(nativeModule);
};

export const createTaskbarLyricWindow = (): BrowserWindow | null => {
  if (process.platform !== "win32") {
    taskbarLog.warn("任务栏歌词仅支持 Windows");
    return null;
  }

  if (taskbarLyricWindow && !taskbarLyricWindow.isDestroyed()) {
    taskbarLyricWindow.show();
    return taskbarLyricWindow;
  }

  if (!nativeModule) {
    nativeModule = loadNativeModule<TaskbarLyricNative>("taskbar-lyric.node", "taskbar-lyric");
    if (!nativeModule) {
      taskbarLog.error("原生模块加载失败");
      return null;
    }
  }

  service = new nativeModule.TaskbarService(applyLayout);

  taskbarLyricWindow = createWindow({
    width: INITIAL_WIDTH,
    height: INITIAL_HEIGHT,
    minWidth: 0,
    minHeight: 0,
    type: "toolbar",
    title: "Taskbar Lyric",
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      disableDialogs: true,
      zoomFactor: 1.0,
    },
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    taskbarLyricWindow.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/windows/taskbar-lyric/index.html`,
    );
  } else {
    taskbarLyricWindow.loadFile(join(__dirname, "../renderer/windows/taskbar-lyric/index.html"));
  }

  taskbarLyricWindow.once("ready-to-show", () => {
    const win = taskbarLyricWindow;
    const svc = service;
    const mod = nativeModule;
    if (!win || !svc || !mod) return;

    const hwndPtrBigInt = win.getNativeWindowHandle().readBigUInt64LE(0);
    if (hwndPtrBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      taskbarLog.error(
        `嵌入窗口失败：hwnd=${hwndPtrBigInt.toString()} 超出 JS Number 安全整数范围`,
      );
      return;
    }
    const hwndPtr = Number(hwndPtrBigInt);
    taskbarLog.info(`嵌入窗口 hwnd=${hwndPtr}`);
    svc.embedWindowByPtr(hwndPtr);
    svc.update(resolveLyricWidth());
    startWatchers(mod);
    taskbarCreatedWatcher = tryStart(
      "TaskbarCreatedWatcher",
      () => new mod.TaskbarCreatedWatcher(onExplorerRestart),
    );
  });

  taskbarLyricWindow.on("closed", () => {
    taskbarLyricWindow = null;
    firstLayoutDone = false;
    activeWindowRegion = null;
    contentWidth = null;
    cleanupWatchers();
    setTrayTaskbarLyric(false);
    broadcast("taskbarLyric:visibilityChange", false);
    if (!isAppQuitting()) {
      store.set("windowStates.taskbarLyric.visible", false);
    }
  });

  setTrayTaskbarLyric(true);
  broadcast("taskbarLyric:visibilityChange", true);
  store.set("windowStates.taskbarLyric.visible", true);
  return taskbarLyricWindow;
};

const cleanupWatchers = (): void => {
  stopLayoutWatchers();
  taskbarCreatedWatcher?.stop();
  taskbarCreatedWatcher = null;
  service?.stop();
  service = null;
};

export const closeTaskbarLyricWindow = (): void => {
  if (taskbarLyricWindow && !taskbarLyricWindow.isDestroyed()) {
    taskbarLyricWindow.close();
  }
};

export const toggleTaskbarLyricWindow = (): boolean => {
  if (taskbarLyricWindow && !taskbarLyricWindow.isDestroyed()) {
    closeTaskbarLyricWindow();
    return false;
  }
  return createTaskbarLyricWindow() !== null;
};

export const applyTaskbarLyricLayout = (): void => {
  service?.update(resolveLyricWidth());
};
