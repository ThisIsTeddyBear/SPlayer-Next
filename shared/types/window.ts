import type { DesktopLyricSettings, DynamicIslandSettings, TaskbarLyricSettings } from "./settings";

export interface WindowApi {
  toggleDesktopLyric: () => Promise<boolean>;
  closeDesktopLyric: () => Promise<void>;
  isDesktopLyricOpen: () => Promise<boolean>;
  onDesktopLyricVisibilityChange: (callback: (open: boolean) => void) => () => void;
  toggleDynamicIsland: () => Promise<boolean>;
  closeDynamicIsland: () => Promise<void>;
  isDynamicIslandOpen: () => Promise<boolean>;
  onDynamicIslandVisibilityChange: (callback: (open: boolean) => void) => () => void;
  toggleTaskbarLyric: () => Promise<boolean>;
  closeTaskbarLyric: () => Promise<void>;
  isTaskbarLyricOpen: () => Promise<boolean>;
  onTaskbarLyricVisibilityChange: (callback: (open: boolean) => void) => () => void;
  minimize: () => void;
  toggleMaximize: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
  toggleFullscreen: () => void;
  isFullscreen: () => Promise<boolean>;
  onFullscreenChange: (callback: (fullscreen: boolean) => void) => () => void;
  hide: () => void;
  quit: () => void;
}

export interface DesktopLyricApi {
  onConfigChange: (callback: (config: DesktopLyricSettings) => void) => () => void;
  setHeight: (height: number) => Promise<void>;
  setUnlockButtonBounds: (bounds: DesktopLyricUnlockButtonBounds) => void;
  move: (x: number, y: number) => void;
  saveState: () => void;
  onCursorInside: (callback: (inside: boolean) => void) => () => void;
}

export interface DesktopLyricUnlockButtonBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TaskbarLyricLayoutEvent {
  isCentered: boolean;
  systemType: string;
  isLight: boolean;
  anchor: "left" | "right";
  maxWidth: number;
}

export interface TaskbarLyricApi {
  onLayout: (callback: (data: TaskbarLyricLayoutEvent) => void) => () => void;
  onConfigChange: (callback: (config: TaskbarLyricSettings) => void) => () => void;
  setContentWidth: (width: number) => void;
}

export interface DynamicIslandApi {
  onConfigChange: (callback: (config: DynamicIslandSettings) => void) => () => void;
  move: (x: number, y: number) => void;
  saveState: () => void;
  resize: (width: number) => void;
  setShape: (width: number | null) => void;
  setHeight: (height: number) => void;
  getMode: () => Promise<"snapped" | "floating">;
  onModeChange: (callback: (mode: "snapped" | "floating") => void) => () => void;
  onCursorInside: (callback: (inside: boolean) => void) => () => void;
}
