import electronUpdater, { type UpdateInfo } from "electron-updater";
import { app, shell } from "electron";
import { sendToMain } from "@main/utils/broadcast";
import { store } from "@main/store";
import { isDev, isMac, isPortable, isAppX } from "@main/utils/config";
import { updaterLog } from "@main/utils/logger";
import type { UpdateEvent, UpdateMeta } from "@shared/types/update";
import type { UpdateChannel } from "@shared/types/settings";

const { autoUpdater } = electronUpdater;

/**
 * Whether in-app download and installation is supported
 * AppX updates are managed by the Windows Store; Mac/Portable do not support auto-installation
 */
const canSelfInstall = !isMac && !isPortable && !isAppX;

/** Releases page URL */
const RELEASES_URL = "https://github.com/ThisIsTeddyBear/SPlayer-Next/releases";

/** GitHub provider repository */
const GITHUB_REPO = { owner: "ThisIsTeddyBear", repo: "SPlayer-Next" } as const;

/** Nightly rolling release feed */
const NIGHTLY_FEED_URL = `${RELEASES_URL}/download/nightly`;

/** Microsoft Store updates URL */
const STORE_UPDATES_URL = "ms-windows-store://updates";

/** Scheduled check interval (6 hours) */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Whether current check was triggered manually by user */
let manualCheck = false;

/** In-flight check Promise */
let currentCheck: Promise<unknown> | null = null;

/** Pending check queued during an in-flight check */
let pendingCheck: { manual: boolean } | null = null;

/** Recent detected available version */
let availableVersion: string | null = null;

let intervalTimer: ReturnType<typeof setInterval> | null = null;

const emit = (event: UpdateEvent): void => sendToMain("update:event", event);

/**
 * Read current update channel
 * @returns Update channel
 */
const getChannel = (): UpdateChannel => {
  const channel = store.get("update.channel");
  if (channel === "beta" || channel === "alpha" || channel === "nightly") return channel;
  if (app.getVersion().includes("-nightly.")) return "nightly";
  return "stable";
};

/**
 * Apply current update channel to electron-updater
 */
const applyChannel = (): void => {
  const channel = getChannel();
  autoUpdater.channel = channel === "stable" ? "latest" : channel;
  autoUpdater.allowPrerelease = channel !== "stable";
  autoUpdater.allowDowngrade = false;
  autoUpdater.setFeedURL(
    channel === "nightly"
      ? { provider: "generic", url: NIGHTLY_FEED_URL }
      : { provider: "github", ...GITHUB_REPO },
  );
};

/**
 * Normalize release notes format
 * @param notes Release notes, string or array
 * @returns Normalized release notes string
 */
const normalizeNotes = (notes: UpdateInfo["releaseNotes"]): string => {
  if (!notes) return "";
  if (typeof notes === "string") return notes;
  return notes
    .map((item) => item.note ?? "")
    .filter(Boolean)
    .join("\n\n");
};

/**
 * Convert electron-updater UpdateInfo to UpdateMeta
 * @param info Update information
 * @returns Update metadata
 */
const toMeta = (info: UpdateInfo): UpdateMeta => ({
  version: info.version,
  releaseNotes: normalizeNotes(info.releaseNotes),
  releaseDate: info.releaseDate,
  size: Math.max(0, ...(info.files ?? []).map((file) => file.size ?? 0)),
});

const bindEvents = (): void => {
  autoUpdater.on("checking-for-update", () => emit({ type: "checking" }));
  autoUpdater.on("update-available", (info) => {
    availableVersion = info.version;
    emit({
      type: "available",
      meta: toMeta(info),
      manual: manualCheck,
      canInstall: canSelfInstall,
    });
  });
  autoUpdater.on("update-not-available", () => {
    availableVersion = null;
    emit({ type: "notAvailable", manual: manualCheck });
  });
  autoUpdater.on("download-progress", (progress) =>
    emit({ type: "progress", percent: Math.round(progress.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) => emit({ type: "downloaded", meta: toMeta(info) }));
  autoUpdater.on("error", (error) => {
    updaterLog.error("Update error", error);
    emit({ type: "error", message: error?.message ?? String(error), manual: manualCheck });
  });
};

/**
 * Execute update check
 * @param manual - Whether triggered manually by the user
 */
const runCheck = (manual: boolean): void => {
  if (currentCheck) {
    pendingCheck = {
      manual: manual || pendingCheck?.manual === true,
    };
    return;
  }
  applyChannel();
  manualCheck = manual;
  currentCheck = autoUpdater
    .checkForUpdates()
    .catch(() => {})
    .finally(() => {
      currentCheck = null;
      const pending = pendingCheck;
      pendingCheck = null;
      if (pending) runCheck(pending.manual);
    });
};

/**
 * Check for updates: automatic checks respect the setting switch; manual checks always execute
 * @param manual Whether triggered manually by the user
 */
export const checkForUpdates = (manual: boolean): void => {
  if (!manual && !store.get("update.autoCheck")) return;
  runCheck(manual);
};

/** Download update */
export const downloadUpdate = (): void => {
  if (!canSelfInstall) return;
  autoUpdater.downloadUpdate().catch((error) => {
    updaterLog.error("Failed to download update", error);
    emit({ type: "error", message: error?.message ?? String(error), manual: true });
  });
};

/**
 * Apply update channel change and immediately recheck
 * Transition strategy: changing channel does not trigger downgrade; only alerts if a newer version exists
 * @param previous - Previous channel
 * @param channel - New channel
 */
export const applyChannelChange = (previous: UpdateChannel, channel: UpdateChannel): void => {
  if (previous === channel) return;
  updaterLog.info(`Switched update channel: ${previous} -> ${channel}`);
  runCheck(true);
};

/** Quit application and install update */
export const quitAndInstall = (): void => {
  if (!canSelfInstall) return;
  autoUpdater.quitAndInstall();
};

/** Open download page: AppX navigates to Microsoft Store, other builds open GitHub Releases */
export const openDownloadPage = (): void => {
  const tag = getChannel() === "nightly" ? "nightly" : availableVersion && `v${availableVersion}`;
  const releaseUrl = tag ? `${RELEASES_URL}/tag/${encodeURIComponent(tag)}` : RELEASES_URL;
  void shell.openExternal(isAppX ? STORE_UPDATES_URL : releaseUrl);
};

/** Initialize updater */
export const initUpdater = (): void => {
  autoUpdater.logger = updaterLog;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  applyChannel();
  bindEvents();
  if (isDev) {
    autoUpdater.forceDevUpdateConfig = true;
    updaterLog.info("Development mode supports manual update checks only");
    return;
  }
  // Scheduled update check
  intervalTimer = setInterval(() => checkForUpdates(false), CHECK_INTERVAL_MS);
};

/** Dispose updater timer */
export const disposeUpdater = (): void => {
  if (intervalTimer) clearInterval(intervalTimer);
  intervalTimer = null;
};
