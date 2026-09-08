import type { StreamingRuntimeConfig } from "@shared/types/streaming";
import { isDbOpen } from "@main/database";
import { upsertTracks, deleteStaleTracks } from "@main/database/streaming/tracks";
import { upsertAlbums, deleteStaleAlbums } from "@main/database/streaming/albums";
import { upsertArtists, deleteStaleArtists } from "@main/database/streaming/artists";
import { deleteStalePlaylists, upsertPlaylists } from "@main/database/streaming/playlists";
import { streamingLog } from "@main/utils/logger";
import { sendToMain } from "@main/utils/broadcast";
import type { StreamingAdapter } from "./adapters/types";
import { invalidateStreamingSession, resolveStreamingAdapter } from "./adapters/resolve";
import { streamPages } from "./pages";

const FIRST_SONG_BATCH_SIZE = 100;
const runningServers = new Set<string>();
const cancelledServers = new Set<string>();
const syncedServers = new Set<string>();
const pendingServers = new Map<string, StreamingRuntimeConfig>();

/**
 * 通知主窗口重新读取媒体库
 * @param serverId - 服务器 ID
 */
const notifyLibraryUpdated = (serverId: string): void => {
  sendToMain("streaming:libraryUpdated", serverId);
};

/**
 * 同步一个服务器的完整媒体库
 * @param config - 已鉴权的服务器配置
 * @param adapter - 协议适配器
 * @returns 是否同步成功
 */
const syncServer = async (
  config: StreamingRuntimeConfig,
  adapter: StreamingAdapter,
): Promise<boolean> => {
  const generation = Date.now();
  let songCount = 0;
  let albumCount = 0;
  let firstBatch = true;
  const cancelled = () => cancelledServers.has(config.id) || !isDbOpen();
  try {
    for await (const songs of streamPages(
      (offset, limit) => adapter.listSongs(config, { offset, limit }),
      (track) => track.originalId,
      cancelled,
      FIRST_SONG_BATCH_SIZE,
    )) {
      upsertTracks(
        songs.map((track) => ({
          serverId: config.id,
          remoteId: track.originalId!,
          track,
          generation,
        })),
      );
      songCount += songs.length;
      if (firstBatch) {
        firstBatch = false;
        notifyLibraryUpdated(config.id);
      }
    }
    if (cancelled()) return false;
    for await (const albums of streamPages(
      (offset, limit) => adapter.listAlbums(config, { offset, limit }),
      (album) => album.id,
      cancelled,
    )) {
      upsertAlbums(
        albums.map((album) => ({ serverId: config.id, remoteId: album.id!, album, generation })),
      );
      albumCount += albums.length;
    }
    if (cancelled()) return false;

    const artists = await adapter.listArtists(config);
    if (cancelled()) return false;
    upsertArtists(
      artists.flatMap((artist) =>
        artist.id ? [{ serverId: config.id, remoteId: artist.id, artist, generation }] : [],
      ),
    );

    const playlists = await adapter.listPlaylists(config);
    if (cancelled()) return false;
    upsertPlaylists(
      playlists.flatMap((playlist) =>
        playlist.id ? [{ serverId: config.id, remoteId: playlist.id, playlist, generation }] : [],
      ),
    );

    deleteStaleTracks(config.id, generation);
    deleteStaleAlbums(config.id, generation);
    deleteStaleArtists(config.id, generation);
    deleteStalePlaylists(config.id, generation);
    notifyLibraryUpdated(config.id);
    streamingLog.info(
      `${config.type} library sync complete [${config.name}]: ${songCount} songs, ${albumCount} albums, ${artists.length} artists, ${playlists.length} playlists`,
    );
    return true;
  } catch (error) {
    if (/HTTP 401|HTTP 403/.test(error instanceof Error ? error.message : String(error))) {
      invalidateStreamingSession(config.id);
    }
    notifyLibraryUpdated(config.id);
    streamingLog.warn(`${config.type} library sync failed [${config.name}]:`, error);
    return false;
  }
};

/**
 * 启动后台流媒体同步
 * @param config - 服务器配置
 * @param force - 是否忽略本次应用运行内的成功同步记录
 * @returns 是否启动了新任务
 */
export const queueStreamingSync = (config: StreamingRuntimeConfig, force = false): boolean => {
  if (runningServers.has(config.id)) {
    if (cancelledServers.has(config.id)) pendingServers.set(config.id, config);
    return false;
  }
  if (!force && syncedServers.has(config.id)) return false;
  if (!isDbOpen()) {
    streamingLog.warn(`Database is not initialized; skipping streaming sync [${config.name}]`);
    return false;
  }
  cancelledServers.delete(config.id);
  runningServers.add(config.id);
  void resolveStreamingAdapter(config)
    .then((resolved) => syncServer(resolved.config, resolved.adapter))
    .then((success) => {
      if (success) syncedServers.add(config.id);
      else syncedServers.delete(config.id);
    })
    .catch((error) => {
      syncedServers.delete(config.id);
      if (cancelledServers.has(config.id)) return;
      notifyLibraryUpdated(config.id);
      streamingLog.warn(`${config.type} sync sign-in failed [${config.name}]:`, error);
    })
    .finally(() => {
      runningServers.delete(config.id);
      cancelledServers.delete(config.id);
      const pending = pendingServers.get(config.id);
      if (pending) {
        pendingServers.delete(config.id);
        queueStreamingSync(pending, true);
      }
    });
  return true;
};

/**
 * 取消指定服务器的后台同步
 * @param serverId - 服务器 ID
 */
export const cancelStreamingSync = (serverId: string): void => {
  if (runningServers.has(serverId)) cancelledServers.add(serverId);
  syncedServers.delete(serverId);
  pendingServers.delete(serverId);
};
