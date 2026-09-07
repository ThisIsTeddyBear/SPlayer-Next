import localforage from "localforage";
import type { Track, Artist } from "@shared/types/player";
import type { AlbumSummary, ArtistSummary, ScanProgress } from "@shared/types/library";
import type { Collection } from "@/types/collection";
import type { ArtistProfile, CoverItem } from "@/types/artist";
import { buildFolderTree, countFolders } from "@/utils/folderTree";

const trackDb = localforage.createInstance({ name: "splayer", storeName: "library" });

const LIKED_IDS_KEY = "liked-ids";

export const useLibraryStore = defineStore("library", () => {
  const tracks = shallowRef<Track[]>([]);
  const scanDirs = ref<string[]>([]);
  const scanning = ref(false);
  const scanProgress = ref<ScanProgress | null>(null);
  const initialized = ref(false);
  const artistAvatars = shallowRef<Record<string, string>>({});
  const likedOrderedIds = shallowRef<string[]>([]);
  const likedIdSet = shallowRef<Set<string>>(new Set());

  const persistLiked = (): void => {
    trackDb.setItem(LIKED_IDS_KEY, [...likedOrderedIds.value]).catch(() => {});
  };

  const isLiked = (trackId: string): boolean => likedIdSet.value.has(trackId);

  /**
   */
  const toggleLike = (trackId: string): boolean => {
    if (!trackId) return false;
    const next = new Set(likedIdSet.value);
    if (next.has(trackId)) {
      next.delete(trackId);
      likedOrderedIds.value = likedOrderedIds.value.filter((id) => id !== trackId);
    } else {
      next.add(trackId);
      likedOrderedIds.value = [trackId, ...likedOrderedIds.value];
    }
    likedIdSet.value = next;
    persistLiked();
    return next.has(trackId);
  };

  const normalizeArtistName = (name: string): string => name.trim().toLowerCase();

  /**
   */
  const getArtistAvatar = (artistName: string): string | undefined => {
    const key = normalizeArtistName(artistName);
    if (!key) return;
    return artistAvatars.value[key];
  };

  /**
   */
  const setArtistAvatar = (artistName: string, avatar: string): void => {
    const key = normalizeArtistName(artistName);
    if (!key || !avatar) return;
    if (artistAvatars.value[key] === avatar) return;
    artistAvatars.value = { ...artistAvatars.value, [key]: avatar };
  };

  const loadArtistAvatars = async (artistNames?: readonly string[]): Promise<void> => {
    const names = artistNames
      ? [...new Set(artistNames)]
      : [...new Set(tracks.value.flatMap((track) => track.artists.map((artist) => artist.name)))];
    if (!names.length) return;
    const unsubscribe = window.api.library.onArtistImage(({ artistName, image }) => {
      setArtistAvatar(artistName, image);
    });
    const response = await window.api.library.prefetchArtistImages(names);
    unsubscribe();
    if (!response.success || !response.data) return;
    artistAvatars.value = { ...artistAvatars.value, ...response.data };
  };

  const loadArtistAvatar = async (artistName: string): Promise<string | undefined> => {
    const response = await window.api.library.prefetchArtistImages([artistName]);
    if (!response.success || !response.data) return;
    artistAvatars.value = { ...artistAvatars.value, ...response.data };
    return getArtistAvatar(artistName);
  };

  const cacheTracks = (items: Track[]): void => {
    trackDb.setItem("tracks", toRaw(items)).catch(() => {});
  };

  const load = async (): Promise<void> => {
    const [cached, likedCached] = await Promise.all([
      trackDb.getItem<Track[]>("tracks").catch(() => null),
      trackDb.getItem<string[]>(LIKED_IDS_KEY).catch(() => null),
    ]);
    if (cached?.length) tracks.value = cached;
    if (Array.isArray(likedCached)) {
      likedOrderedIds.value = likedCached;
      likedIdSet.value = new Set(likedCached);
    }
    const [tracksRes, dirsRes] = await Promise.all([
      window.api.library.getTracks(),
      window.api.library.getScanDirs(),
    ]);
    if (tracksRes.success && tracksRes.data) {
      tracks.value = tracksRes.data;
      cacheTracks(tracksRes.data);
    }
    if (dirsRes.success && dirsRes.data) scanDirs.value = dirsRes.data;
    initialized.value = true;
    loadArtistAvatars();
  };

  const startScan = async (incremental = true): Promise<void> => {
    if (scanning.value) return;
    scanning.value = true;
    scanProgress.value = { phase: "scanning", total: 0, scanned: 0 };
    try {
      const res = await window.api.library.scan(incremental);
      if (!res.success) {
        scanning.value = false;
        scanProgress.value = null;
      }
    } catch {
      scanning.value = false;
      scanProgress.value = null;
    }
  };

  const cancelScan = async (): Promise<void> => {
    await window.api.library.cancelScan();
    scanning.value = false;
    scanProgress.value = null;
  };

  const addScanDir = async (): Promise<{ success: boolean; error?: string }> => {
    const res = await window.api.library.addScanDir();
    if (res.success) {
      const newDir = res.data as string;
      const nested = scanDirs.value.some(
        (d) =>
          newDir.startsWith(d + "\\") ||
          newDir.startsWith(d + "/") ||
          d.startsWith(newDir + "\\") ||
          d.startsWith(newDir + "/"),
      );
      if (nested) {
        await window.api.library.removeScanDir(newDir);
        return { success: false, error: "nested" };
      }
      scanDirs.value = [...scanDirs.value, newDir];
    }
    return res;
  };

  const removeScanDir = async (dir: string): Promise<void> => {
    await window.api.library.removeScanDir(dir);
    scanDirs.value = scanDirs.value.filter((d) => d !== dir);
    if (scanning.value) {
      scanning.value = false;
      scanProgress.value = null;
    }
    const res = await window.api.library.getTracks();
    if (res.success && res.data) {
      tracks.value = res.data;
      cacheTracks(res.data);
      loadArtistAvatars();
    }
  };

  let unsubscribe: (() => void) | null = null;

  const subscribeScanProgress = (): void => {
    unsubscribe?.();
    unsubscribe = window.api.library.onScanProgress((data) => {
      scanProgress.value = data;
      if (data.phase === "done") {
        scanning.value = false;
        window.api.library.getTracks().then((res) => {
          if (res.success && res.data) {
            tracks.value = res.data;
            cacheTracks(res.data);
            loadArtistAvatars();
          }
        });
      } else if (data.phase === "error") {
        scanning.value = false;
      }
    });
  };

  const unsubscribeScanProgress = (): void => {
    unsubscribe?.();
    unsubscribe = null;
  };

  const deleteTracks = async (paths: string[]): Promise<{ deleted: number; failed: number }> => {
    const res = await window.api.library.deleteTracks(paths);
    if (res.success) {
      const pathSet = new Set(paths);
      const deletedIds = new Set(
        tracks.value.filter((t) => t.path && pathSet.has(t.path)).map((t) => t.id),
      );
      const remaining = tracks.value.filter((t) => !t.path || !pathSet.has(t.path));
      tracks.value = remaining;
      cacheTracks(remaining);
      if (deletedIds.size > 0 && likedOrderedIds.value.some((id) => deletedIds.has(id))) {
        const filtered = likedOrderedIds.value.filter((id) => !deletedIds.has(id));
        likedOrderedIds.value = filtered;
        likedIdSet.value = new Set(filtered);
        persistLiked();
      }
      return res.data ?? { deleted: 0, failed: paths.length };
    }
    return { deleted: 0, failed: paths.length };
  };

  /**
   */
  const applyTrackUpdates = (updates: Track[]): void => {
    if (updates.length === 0) return;
    const byId = new Map(updates.map((item) => [item.id, item]));
    if (!tracks.value.some((item) => byId.has(item.id))) return;
    tracks.value = tracks.value.map((item) => byId.get(item.id) ?? item);
    cacheTracks(tracks.value);
  };

  const folderTree = computed(() => buildFolderTree(tracks.value, scanDirs.value));

  const folderCount = computed(() => countFolders(folderTree.value));

  const getAlbumList = async (): Promise<AlbumSummary[]> => {
    const res = await window.api.library.getAlbums();
    return res.success && res.data ? res.data : [];
  };

  const getArtistList = async (): Promise<ArtistSummary[]> => {
    const res = await window.api.library.getArtists();
    return res.success && res.data ? res.data : [];
  };

  const getAlbumCollection = async (albumName: string): Promise<Collection | null> => {
    const res = await window.api.library.getAlbumTracks(albumName);
    if (!res.success || !res.data?.length) return null;
    const albumTracks = res.data;
    const artistMap = new Map<string, Artist>();
    for (const t of albumTracks) {
      for (const a of t.artists) {
        const key = a.name.toLowerCase();
        if (!artistMap.has(key)) artistMap.set(key, a);
      }
    }
    return {
      id: encodeURIComponent(albumName),
      type: "album",
      source: "local",
      title: albumName,
      cover: albumTracks.find((t) => t.cover)?.cover,
      artists: [...artistMap.values()],
      tracks: albumTracks,
      trackCount: albumTracks.length,
    };
  };

  const getArtistProfile = async (artistName: string): Promise<ArtistProfile | null> => {
    const name = artistName.trim();
    if (!name) return null;
    const res = await window.api.library.getArtistTracks(name);
    if (!res.success || !res.data?.length) return null;
    const artistTracks = res.data;
    const albumMap = new Map<string, { cover?: string; count: number }>();
    for (const t of artistTracks) {
      if (!t.album?.name) continue;
      const key = t.album.name;
      const existing = albumMap.get(key);
      if (existing) {
        existing.count++;
        if (!existing.cover && t.cover) existing.cover = t.cover;
      } else {
        albumMap.set(key, { cover: t.cover, count: 1 });
      }
    }
    const albums: CoverItem[] = [...albumMap.entries()].map(([albumName, info]) => ({
      id: encodeURIComponent(albumName),
      title: albumName,
      cover: info.cover,
      trackCount: info.count,
    }));
    return {
      id: encodeURIComponent(name),
      name,
      avatar: getArtistAvatar(name),
      source: "local",
      tracks: artistTracks,
      albums,
      trackCount: artistTracks.length,
      albumCount: albums.length,
    };
  };

  return {
    tracks,
    scanDirs,
    scanning,
    scanProgress,
    initialized,
    artistAvatars,
    likedOrderedIds,
    likedIdSet,
    isLiked,
    toggleLike,
    load,
    startScan,
    cancelScan,
    addScanDir,
    removeScanDir,
    subscribeScanProgress,
    unsubscribeScanProgress,
    deleteTracks,
    applyTrackUpdates,
    getArtistAvatar,
    setArtistAvatar,
    loadArtistAvatars,
    loadArtistAvatar,
    getArtistList,
    getAlbumList,
    getAlbumCollection,
    getArtistProfile,
    folderTree,
    folderCount,
  };
});
