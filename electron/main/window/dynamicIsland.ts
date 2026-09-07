import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { createWindow } from "./create";
import { store } from "@main/store";
import { broadcast } from "@main/utils/broadcast";
import { isMac } from "@main/utils/config";
import { setTrayDynamicIsland } from "@main/services/tray";
import { isAppQuitting } from "@main/utils/lifecycle";
import { DYNAMIC_ISLAND_BASE_HEIGHT } from "@shared/defaults/settings";

let dynamicIslandWindow: BrowserWindow | null = null;

const NOTCH_PHYSICAL_WIDTH = 358;
const NOTCH_PHYSICAL_HEIGHT = 58;
const RETINA_NOTCH_BODY_WIDTH = 181;
const NOTCH_SIDE_OVERHANG = 5;
const RETINA_NOTCH_WIDTH = RETINA_NOTCH_BODY_WIDTH + NOTCH_SIDE_OVERHANG * 2;
const RETINA_NOTCH_HEIGHT = 29;
const NOTCH_TOP_OFFSET = 0;
const NOTCH_TOP_FILL = 3;
const MIN_HEIGHT = 14;
const MAX_HEIGHT = 200;
const MAX_WIDTH = 620;
const MAX_WIDTH_RATIO = 0.55;
const SNAP_THRESHOLD = 8;
const INITIAL_WIDTH = 200;
const CURSOR_POLL_MS = 150;

/**
 */
const cachedSize = { width: INITIAL_WIDTH, height: 40 };
let activeShapeWidth: number | null = null;

const isNotchFusionEnabled = (): boolean => isMac && store.get("dynamicIsland").notchFusion;

const clampHeight = (h: number): number =>
  Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(h)));

/**
 */
const getNotchMetrics = (
  display: Electron.Display,
): { width: number; height: number; topOffset: number } => {
  const scaleFactor = Math.max(1, display.scaleFactor || 1);
  if (Math.abs(scaleFactor - 2) < 0.25) {
    return {
      width: RETINA_NOTCH_WIDTH,
      height: RETINA_NOTCH_HEIGHT,
      topOffset: NOTCH_TOP_OFFSET,
    };
  }
  return {
    width: Math.round(NOTCH_PHYSICAL_WIDTH / scaleFactor) + NOTCH_SIDE_OVERHANG * 2,
    height: Math.round(NOTCH_PHYSICAL_HEIGHT / scaleFactor),
    topOffset: NOTCH_TOP_OFFSET,
  };
};

/**
 */
const getWidthLimits = (display: Electron.Display): { min: number; max: number } => {
  if (!isNotchFusionEnabled()) {
    return { min: 1, max: display.workArea.width };
  }
  const notch = getNotchMetrics(display);
  const max = Math.max(
    notch.width,
    Math.min(MAX_WIDTH, Math.floor(display.bounds.width * MAX_WIDTH_RATIO)),
  );
  return { min: notch.width, max };
};

const clampWidth = (width: number, display: Electron.Display): number => {
  const limits = getWidthLimits(display);
  return Math.min(limits.max, Math.max(limits.min, Math.round(width)));
};

/**
 */
const getCurrentDisplay = (): Electron.Display => {
  const saved = store.get("windowStates.dynamicIsland");
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    const bounds = dynamicIslandWindow.getBounds();
    return screen.getDisplayNearestPoint({
      x: bounds.x + Math.round(bounds.width / 2),
      y: bounds.y + Math.round(bounds.height / 2),
    });
  }
  if (saved.x !== null && saved.y !== null) {
    return screen.getDisplayNearestPoint({
      x: saved.x,
      y: saved.y + Math.round(cachedSize.height / 2),
    });
  }
  return screen.getPrimaryDisplay();
};

/**
 */
const computeSnappedPos = (
  display: Electron.Display = getCurrentDisplay(),
): { x: number; y: number } => {
  if (!isNotchFusionEnabled()) {
    const config = store.get("dynamicIsland");
    const saved = store.get("windowStates.dynamicIsland");
    const wa = display.workArea;
    if (config.snapCentered || saved.x === null) {
      return {
        x: wa.x + Math.round((wa.width - cachedSize.width) / 2),
        y: wa.y,
      };
    }
    const savedX = saved.x;
    const leftFromCenter = savedX - Math.round(cachedSize.width / 2);
    return {
      x: Math.max(wa.x, Math.min(wa.x + wa.width - cachedSize.width, leftFromCenter)),
      y: wa.y,
    };
  }

  const bounds = display.bounds;
  const centerX = bounds.x + Math.round(bounds.width / 2);
  const leftFromCenter = centerX - Math.round(cachedSize.width / 2);
  const x = Math.max(
    bounds.x,
    Math.min(bounds.x + bounds.width - cachedSize.width, leftFromCenter),
  );
  return { x, y: bounds.y + NOTCH_TOP_OFFSET };
};

/**
 */
export const applyDynamicIslandAlwaysOnTop = (alwaysOnTop: boolean): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  win.setAlwaysOnTop(alwaysOnTop, "screen-saver");
};

/**
 */
let cursorPollTimer: NodeJS.Timeout | null = null;
let lastCursorInside = false;

const isCursorInsideBounds = (): boolean => {
  if (!dynamicIslandWindow || dynamicIslandWindow.isDestroyed()) return false;
  const cursor = screen.getCursorScreenPoint();
  const b = dynamicIslandWindow.getBounds();
  const shapeWidth =
    activeShapeWidth === null ? b.width : Math.min(b.width, Math.max(1, activeShapeWidth));
  const shapeLeft = b.x + Math.round((b.width - shapeWidth) / 2);
  return (
    cursor.x >= shapeLeft &&
    cursor.x < shapeLeft + shapeWidth &&
    cursor.y >= b.y &&
    cursor.y < b.y + b.height
  );
};

const startCursorPolling = (): void => {
  if (cursorPollTimer) return;
  lastCursorInside = isCursorInsideBounds();
  dynamicIslandWindow?.webContents.send("dynamicIsland:cursorInside", lastCursorInside);
  cursorPollTimer = setInterval(() => {
    if (!dynamicIslandWindow || dynamicIslandWindow.isDestroyed()) {
      stopCursorPolling();
      return;
    }
    const inside = isCursorInsideBounds();
    if (inside !== lastCursorInside) {
      lastCursorInside = inside;
      dynamicIslandWindow.webContents.send("dynamicIsland:cursorInside", inside);
    }
  }, CURSOR_POLL_MS);
};

const stopCursorPolling = (): void => {
  if (cursorPollTimer) {
    clearInterval(cursorPollTimer);
    cursorPollTimer = null;
  }
  if (lastCursorInside) {
    lastCursorInside = false;
    dynamicIslandWindow?.webContents.send("dynamicIsland:cursorInside", false);
  }
};

/**
 */
export const applyDynamicIslandNonOcclusive = (enabled: boolean): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  win.setIgnoreMouseEvents(enabled, { forward: true });
  if (enabled) {
    startCursorPolling();
  } else {
    stopCursorPolling();
  }
};

/**
 */
export const applyDynamicIslandSnapCentered = (snapCentered: boolean): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const saved = store.get("windowStates.dynamicIsland");
  if (saved.mode !== "snapped") return;

  if (isNotchFusionEnabled()) {
    store.set("windowStates.dynamicIsland", {
      ...saved,
      mode: "snapped",
      x: null,
      y: null,
    });
    const pos = computeSnappedPos();
    win.setBounds({ x: pos.x, y: pos.y, width: cachedSize.width, height: cachedSize.height });
    return;
  }

  if (snapCentered) {
    store.set("windowStates.dynamicIsland", {
      ...saved,
      mode: "snapped",
      x: null,
      y: null,
    });
  } else if (saved.x === null) {
    const bounds = win.getBounds();
    const display = screen.getDisplayNearestPoint({
      x: bounds.x + Math.round(bounds.width / 2),
      y: bounds.y + Math.round(bounds.height / 2),
    });
    store.set("windowStates.dynamicIsland", {
      ...saved,
      mode: "snapped",
      x: bounds.x + Math.round(bounds.width / 2),
      y: display.workArea.y,
    });
  }
  const pos = computeSnappedPos();
  win.setBounds({ x: pos.x, y: pos.y, width: cachedSize.width, height: cachedSize.height });
};

/**
 */
export const applyDynamicIslandNotchFusion = (enabled: boolean): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const saved = store.get("windowStates.dynamicIsland");
  if (enabled) {
    store.set("windowStates.dynamicIsland", {
      ...saved,
      mode: "snapped",
      x: null,
      y: null,
    });
  } else if (saved.mode !== "snapped") {
    return;
  }
  const pos = computeSnappedPos();
  win.setBounds({ x: pos.x, y: pos.y, width: cachedSize.width, height: cachedSize.height });
};

/**
 */
export const applyDynamicIslandHeight = (height: number): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const h = clampHeight(height);
  cachedSize.height = h;
  const saved = store.get("windowStates.dynamicIsland");
  if (saved.mode === "snapped") {
    const pos = computeSnappedPos();
    win.setBounds({ x: pos.x, y: pos.y, width: cachedSize.width, height: h });
  } else {
    const bounds = win.getBounds();
    win.setBounds({ x: bounds.x, y: bounds.y, width: cachedSize.width, height: h });
  }
  updateDynamicIslandShape();
};

/**
 */
export const applyDynamicIslandWidth = (width: number): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const bounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: bounds.x + Math.round(bounds.width / 2),
    y: bounds.y + Math.round(bounds.height / 2),
  });
  const newWidth = clampWidth(width, display);
  const oldWidth = cachedSize.width;
  cachedSize.width = newWidth;
  const saved = store.get("windowStates.dynamicIsland");
  if (saved.mode === "snapped") {
    const pos = computeSnappedPos(display);
    win.setBounds({ x: pos.x, y: pos.y, width: newWidth, height: cachedSize.height });
  } else {
    const centerX = bounds.x + Math.round(oldWidth / 2);
    const newX = centerX - Math.round(newWidth / 2);
    win.setBounds({ x: newX, y: bounds.y, width: newWidth, height: cachedSize.height });
  }
  updateDynamicIslandShape();
};

const updateDynamicIslandShape = (): void => {
  const win = getDynamicIslandWindow();
  if (!win || isMac) return;
  if (activeShapeWidth === null) {
    win.setShape([]);
    return;
  }
  const shapeWidth = Math.min(cachedSize.width, Math.max(1, Math.round(activeShapeWidth)));
  win.setShape([
    {
      x: Math.round((cachedSize.width - shapeWidth) / 2),
      y: 0,
      width: shapeWidth,
      height: cachedSize.height,
    },
  ]);
};

/**
 */
export const applyDynamicIslandShape = (width: number | null): void => {
  activeShapeWidth = width;
  updateDynamicIslandShape();
};

/**
 */
export const moveDynamicIslandWindow = (x: number, y: number): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const tx = Math.round(x);
  let ty = Math.round(y);
  const display = screen.getDisplayNearestPoint({
    x: tx + Math.round(cachedSize.width / 2),
    y: ty + Math.round(cachedSize.height / 2),
  });
  const wa = display.workArea;
  const snapY = isNotchFusionEnabled() ? display.bounds.y + NOTCH_TOP_OFFSET : wa.y;
  ty = Math.max(snapY, Math.min(wa.y + wa.height - cachedSize.height, ty));
  win.setBounds({ x: tx, y: ty, width: cachedSize.width, height: cachedSize.height });
  broadcastMode(ty <= snapY ? "snapped" : "floating");
};

let lastBroadcastMode: "snapped" | "floating" | null = null;

const broadcastMode = (mode: "snapped" | "floating"): void => {
  if (mode === lastBroadcastMode) return;
  lastBroadcastMode = mode;
  const win = getDynamicIslandWindow();
  win?.webContents.send("dynamicIsland:modeChange", mode);
};

/**
 */
export const saveDynamicIslandState = (): void => {
  const win = getDynamicIslandWindow();
  if (!win) return;
  const b = win.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: b.x + Math.round(b.width / 2),
    y: b.y + Math.round(b.height / 2),
  });
  const wa = display.workArea;
  const snapY = isNotchFusionEnabled() ? display.bounds.y + NOTCH_TOP_OFFSET : wa.y;
  if (b.y - snapY <= SNAP_THRESHOLD) {
    const config = store.get("dynamicIsland");
    if (isNotchFusionEnabled() || config.snapCentered) {
      const pos = computeSnappedPos(display);
      win.setBounds({ x: pos.x, y: pos.y, width: cachedSize.width, height: cachedSize.height });
      store.set("windowStates.dynamicIsland", {
        ...store.get("windowStates.dynamicIsland"),
        mode: "snapped",
        x: null,
        y: null,
      });
    } else {
      const clampedLeftX = Math.max(wa.x, Math.min(wa.x + wa.width - cachedSize.width, b.x));
      const centerX = clampedLeftX + Math.round(cachedSize.width / 2);
      win.setBounds({
        x: clampedLeftX,
        y: wa.y,
        width: cachedSize.width,
        height: cachedSize.height,
      });
      store.set("windowStates.dynamicIsland", {
        ...store.get("windowStates.dynamicIsland"),
        mode: "snapped",
        x: centerX,
        y: wa.y,
      });
    }
    broadcastMode("snapped");
  } else {
    store.set("windowStates.dynamicIsland", {
      ...store.get("windowStates.dynamicIsland"),
      mode: "floating",
      x: b.x,
      y: b.y,
    });
    broadcastMode("floating");
  }
};

export const createDynamicIslandWindow = (): BrowserWindow => {
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    dynamicIslandWindow.show();
    dynamicIslandWindow.focus();
    return dynamicIslandWindow;
  }
  const config = store.get("dynamicIsland");
  const saved = store.get("windowStates.dynamicIsland");
  const fusionEnabled = isNotchFusionEnabled();

  const initialDisplay = fusionEnabled ? screen.getPrimaryDisplay() : getCurrentDisplay();
  const floatingPos =
    !fusionEnabled && saved.mode === "floating" && saved.x !== null && saved.y !== null
      ? { x: saved.x, y: saved.y }
      : null;
  const initialNotch = getNotchMetrics(initialDisplay);
  cachedSize.width = clampWidth(INITIAL_WIDTH, initialDisplay);
  cachedSize.height = clampHeight(
    (floatingPos ? 0 : fusionEnabled ? initialNotch.height + NOTCH_TOP_FILL : 0) +
      DYNAMIC_ISLAND_BASE_HEIGHT * config.scale,
  );

  let initialPos: { x: number; y: number };
  if (floatingPos) {
    const display = screen.getDisplayNearestPoint({
      x: floatingPos.x + Math.round(cachedSize.width / 2),
      y: floatingPos.y + Math.round(cachedSize.height / 2),
    });
    const wa = display.workArea;
    initialPos = {
      x: Math.max(wa.x, Math.min(wa.x + wa.width - cachedSize.width, floatingPos.x)),
      y: Math.max(wa.y, Math.min(wa.y + wa.height - cachedSize.height, floatingPos.y)),
    };
  } else {
    if (fusionEnabled) {
      store.set("windowStates.dynamicIsland", {
        ...saved,
        mode: "snapped",
        x: null,
        y: null,
      });
    } else if (config.snapCentered && saved.mode !== "snapped") {
      store.set("windowStates.dynamicIsland", {
        ...saved,
        mode: "snapped",
        x: null,
        y: null,
      });
    }
    initialPos = computeSnappedPos(initialDisplay);
  }

  dynamicIslandWindow = createWindow({
    width: cachedSize.width,
    height: cachedSize.height,
    minWidth: 1,
    minHeight: 1,
    x: initialPos.x,
    y: initialPos.y,
    title: "Dynamic Island",
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    roundedCorners: false,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      disableDialogs: true,
      zoomFactor: 1.0,
    },
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    dynamicIslandWindow.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/windows/dynamic-island/index.html`,
    );
  } else {
    dynamicIslandWindow.loadFile(join(__dirname, "../renderer/windows/dynamic-island/index.html"));
  }

  dynamicIslandWindow.webContents.on("did-finish-load", () => {
    if (!dynamicIslandWindow) return;
    dynamicIslandWindow.webContents.setZoomFactor(1.0);
    const currentSaved = store.get("windowStates.dynamicIsland");
    lastBroadcastMode = null;
    broadcastMode(currentSaved.mode === "floating" ? "floating" : "snapped");
  });

  dynamicIslandWindow.once("ready-to-show", () => {
    if (!dynamicIslandWindow) return;
    dynamicIslandWindow.show();
    dynamicIslandWindow.setAlwaysOnTop(config.alwaysOnTop, "screen-saver");
    if (config.nonOcclusive) {
      dynamicIslandWindow.setIgnoreMouseEvents(true, { forward: true });
      startCursorPolling();
    }
  });

  setTrayDynamicIsland(true);
  broadcast("dynamicIsland:visibilityChange", true);
  store.set("windowStates.dynamicIsland.visible", true);

  dynamicIslandWindow.on("closed", () => {
    stopCursorPolling();
    activeShapeWidth = null;
    dynamicIslandWindow = null;
    lastBroadcastMode = null;
    setTrayDynamicIsland(false);
    broadcast("dynamicIsland:visibilityChange", false);
    if (!isAppQuitting()) {
      store.set("windowStates.dynamicIsland.visible", false);
    }
  });

  return dynamicIslandWindow;
};

export const closeDynamicIslandWindow = (): void => {
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    dynamicIslandWindow.close();
  }
};

export const toggleDynamicIslandWindow = (): boolean => {
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) {
    closeDynamicIslandWindow();
    return false;
  }
  createDynamicIslandWindow();
  return true;
};

export const getDynamicIslandWindow = (): BrowserWindow | null => {
  if (dynamicIslandWindow && !dynamicIslandWindow.isDestroyed()) return dynamicIslandWindow;
  return null;
};
