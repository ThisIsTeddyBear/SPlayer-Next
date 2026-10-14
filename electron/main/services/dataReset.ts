import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "@main/database";
import { store } from "@main/store";
import { getPlayer } from "./engine";
import { clearPlaybackTimeline } from "./playbackTimeline";
import { cancelScan } from "./scanner";
import { cancelRecognition } from "./recognition";
import { cancelAll } from "./downloadManager";
import { clearAll as clearSongs } from "./songCache";
import { cancelAllStreamingSync } from "./streaming/sync";
import { clearStreamingSessions } from "./streaming/adapters/resolve";
import { clearStreamingConfig } from "./streaming/config";
import { cancelConnect, disconnect } from "./lastfm";
import { invalidateLocalLyricRepo } from "./localLyricRepo";
import { configDir } from "@main/utils/paths";
import {
  getAppCacheDir,
  getCoverCacheDir,
  getArtistCacheDir,
  getBackgroundsDir,
} from "@main/utils/config";
import { stopServer } from "@main/server";
import { stopMcpServer } from "./mcp/http";
import { invalidateArtistImages } from "./artistImages";

/** 清除用户记录和缓存；由已确认的设置操作调用，音乐文件不参与清理。 */
export const clearUserData = async (): Promise<void> => {
  cancelScan();
  cancelRecognition();
  cancelAllStreamingSync();
  clearStreamingSessions();
  cancelConnect();
  disconnect();
  invalidateLocalLyricRepo();
  clearPlaybackTimeline();
  getPlayer().stop();
  await Promise.all([
    cancelAll(),
    clearSongs(),
    stopServer(),
    stopMcpServer(),
    invalidateArtistImages(),
  ]);
  for (const dir of [
    getCoverCacheDir(),
    getArtistCacheDir(),
    getBackgroundsDir(),
    path.join(getAppCacheDir(), "downloads-tmp"),
  ]) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  for (const name of ["lastfm.json", "ai-models.json"]) {
    await fs.rm(path.join(configDir, name), { force: true });
  }
  clearStreamingConfig();
  const database = getDb();
  database.transaction(() => {
    database.exec(`
      DELETE FROM playlist_tracks;
      DELETE FROM playlists;
      DELETE FROM tracks;
      DELETE FROM tracks_fts;
      DELETE FROM account_sessions;
      DELETE FROM lyric_cache;
      DELETE FROM lyric_match_cache;
      DELETE FROM lyric_ttml_cache;
      DELETE FROM lyric_romanization_cache;
      DELETE FROM song_cache;
      DELETE FROM play_history;
      DELETE FROM recognition_history;
      DELETE FROM favorite_history;
      DELETE FROM download_tasks;
      DELETE FROM remote_tracks;
      DELETE FROM remote_albums;
      DELETE FROM remote_artists;
      DELETE FROM remote_playlists;
    `);
  })();
  store.clear();
};
