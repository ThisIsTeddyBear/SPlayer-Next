import type { LocaleCode } from "@shared/types/settings";

interface MainMessages {
  prev: string;
  play: string;
  pause: string;
  next: string;
  addToLiked: string;
  removeFromLiked: string;
  shuffle: string;
  sequential: string;
  repeatList: string;
  repeatOne: string;
  openDesktopLyric: string;
  closeDesktopLyric: string;
  openDynamicIsland: string;
  closeDynamicIsland: string;
  openTaskbarLyric: string;
  closeTaskbarLyric: string;
  quit: string;
}

const messages: Record<LocaleCode, MainMessages> = {
  "en-US": {
    prev: "Previous",
    play: "Play",
    pause: "Pause",
    next: "Next",
    addToLiked: "Add to Liked",
    removeFromLiked: "Remove from Liked",
    shuffle: "Shuffle",
    sequential: "Sequential",
    repeatList: "Repeat All",
    repeatOne: "Repeat One",
    openDesktopLyric: "Open Desktop Lyric",
    closeDesktopLyric: "Close Desktop Lyric",
    openDynamicIsland: "Open Dynamic Island",
    closeDynamicIsland: "Close Dynamic Island",
    openTaskbarLyric: "Open Taskbar Lyric",
    closeTaskbarLyric: "Close Taskbar Lyric",
    quit: "Quit",
  },
};

let currentLocale: LocaleCode = "en-US";

/** 获取翻译文本 */
export const t = (key: keyof MainMessages): string => messages[currentLocale][key];

/** 切换语言，返回是否发生变化 */
export const setLocale = (locale: LocaleCode): boolean => {
  if (currentLocale === locale) return false;
  currentLocale = locale;
  return true;
};

/** 获取当前语言 */
export const getLocale = (): LocaleCode => currentLocale;
