import localforage from "localforage";
import type { PlaybackContext, PlaybackQueueItem, Track } from "@shared/types/player";

const db = localforage.createInstance({ name: "splayer", storeName: "queue" });

const shuffleArray = <T>(arr: T[]): T[] => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

type PersistedQueueItem = Track | PlaybackQueueItem;

const restoreQueueItem = (value: PersistedQueueItem): PlaybackQueueItem => {
  if (typeof value.track === "object" && value.track !== null) return value as PlaybackQueueItem;
  return { track: value as Track };
};

const createQueueItem = (track: Track, context?: PlaybackContext): PlaybackQueueItem =>
  context ? { track, context } : { track };

export const queueEntries = shallowRef<PlaybackQueueItem[]>([]);

export const queue = computed<Track[]>(() => queueEntries.value.map((item) => item.track));

export const originalQueue = shallowRef<PlaybackQueueItem[] | null>(null);

export const queueLength = computed(() => queue.value.length);

const save = (): void => {
  db.setItem("playList", toRaw(queueEntries.value)).catch(console.error);
  db.setItem("originalPlayList", toRaw(originalQueue.value)).catch(console.error);
};

export const restoreQueue = async (): Promise<void> => {
  try {
    const [list, original] = await Promise.all([
      db.getItem<PersistedQueueItem[]>("playList"),
      db.getItem<PersistedQueueItem[] | null>("originalPlayList"),
    ]);
    if (!list?.length) return;
    queueEntries.value = list.map(restoreQueueItem);
    originalQueue.value = original?.map(restoreQueueItem) ?? null;
  } catch (e) {
    console.error("[queue] Failed to restore persisted data:", e);
  }
};

/**
 */
export const setQueue = (items: readonly Track[], context?: PlaybackContext): void => {
  queueEntries.value = items.map((track) => createQueueItem(track, context));
  originalQueue.value = null;
  save();
};

/**
 */
export const insertToQueue = (item: Track, index: number, context?: PlaybackContext): void => {
  const entry = createQueueItem(item, context);
  const safeIndex = Math.max(0, Math.min(index, queueEntries.value.length));
  const next = [...queueEntries.value];
  next.splice(safeIndex, 0, entry);
  queueEntries.value = next;
  if (originalQueue.value) {
    originalQueue.value = [...originalQueue.value, entry];
  }
  save();
};

/**
 */
export const insertManyToQueue = (
  items: Track[],
  index: number,
  context?: PlaybackContext,
): void => {
  if (items.length === 0) return;
  const entries = items.map((track) => createQueueItem(track, context));
  const list = queueEntries.value;
  const safeIndex = Math.max(0, Math.min(index, list.length));
  queueEntries.value = [...list.slice(0, safeIndex), ...entries, ...list.slice(safeIndex)];
  if (originalQueue.value) {
    originalQueue.value = [...originalQueue.value, ...entries];
  }
  save();
};

/**
 */
export const updateQueueTracks = (updates: readonly Track[]): void => {
  if (updates.length === 0) return;
  const byId = new Map(updates.map((item) => [item.id, item]));
  const touched =
    queueEntries.value.some((item) => byId.has(item.track.id)) ||
    (originalQueue.value?.some((item) => byId.has(item.track.id)) ?? false);
  if (!touched) return;
  queueEntries.value = queueEntries.value.map((item) => ({
    ...item,
    track: byId.get(item.track.id) ?? item.track,
  }));
  if (originalQueue.value) {
    originalQueue.value = originalQueue.value.map((item) => ({
      ...item,
      track: byId.get(item.track.id) ?? item.track,
    }));
  }
  save();
};

/**
 */
export const updateQueueItem = (index: number, track: Track, context?: PlaybackContext): void => {
  if (index < 0 || index >= queueEntries.value.length) return;
  const previous = queueEntries.value[index];
  const replacement = createQueueItem(track, context);
  const next = [...queueEntries.value];
  next[index] = replacement;
  queueEntries.value = next;
  if (originalQueue.value) {
    originalQueue.value = originalQueue.value.map((item) =>
      item.track.id === previous.track.id ? replacement : item,
    );
  }
  save();
};

/**
 */
export const removeServerTracks = (serverId: string): void => {
  const belongsToServer = (track: Track): boolean =>
    track.source === "streaming" && track.serverId === serverId;
  const next = queueEntries.value.filter((item) => !belongsToServer(item.track));
  const nextOriginal = originalQueue.value?.filter((item) => !belongsToServer(item.track)) ?? null;
  if (
    next.length === queueEntries.value.length &&
    nextOriginal?.length === originalQueue.value?.length
  ) {
    return;
  }
  queueEntries.value = next;
  originalQueue.value = nextOriginal;
  save();
};

/**
 */
export const removeFromQueue = (index: number): void => {
  if (index < 0 || index >= queueEntries.value.length) return;
  const removed = queueEntries.value[index];
  const next = [...queueEntries.value];
  next.splice(index, 1);
  queueEntries.value = next;
  if (originalQueue.value) {
    const origIdx = originalQueue.value.findIndex((item) => item.track.id === removed.track.id);
    if (origIdx !== -1) {
      const nextOrig = [...originalQueue.value];
      nextOrig.splice(origIdx, 1);
      originalQueue.value = nextOrig;
    }
  }
  save();
};

/**
 */
export const moveInQueue = (fromIndex: number, toIndex: number): void => {
  if (fromIndex === toIndex) return;
  if (fromIndex < 0 || fromIndex >= queueEntries.value.length) return;
  if (toIndex < 0 || toIndex >= queueEntries.value.length) return;
  const next = [...queueEntries.value];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  queueEntries.value = next;
  save();
};

/**
 */
export const clearQueue = (): void => {
  queueEntries.value = [];
  originalQueue.value = null;
  save();
};

/**
 */
export const shuffleQueue = (keepIndex: number): void => {
  const currentQueue = queueEntries.value;
  if (currentQueue.length <= 1) return;
  const safeIndex = keepIndex >= 0 && keepIndex < currentQueue.length ? keepIndex : 0;
  if (!originalQueue.value) {
    originalQueue.value = [...currentQueue];
  }
  const keepTrack = currentQueue[safeIndex];
  const rest = currentQueue.filter((_, index) => index !== safeIndex);
  shuffleArray(rest);
  queueEntries.value = [keepTrack, ...rest];
  save();
};

/**
 */
export const unshuffleQueue = (currentTrackId: string): number => {
  if (!originalQueue.value) return 0;
  queueEntries.value = [...originalQueue.value];
  originalQueue.value = null;
  save();
  const idx = queueEntries.value.findIndex((item) => item.track.id === currentTrackId);
  return idx !== -1 ? idx : 0;
};

/**
 */
export const getTrack = (index: number): Track | null => {
  return getQueueItem(index)?.track ?? null;
};

/**
 */
export const getQueueItem = (index: number): PlaybackQueueItem | null => {
  return index >= 0 && index < queueEntries.value.length ? queueEntries.value[index] : null;
};

/**
 */
export const findTrackIndex = (trackId: string): number => {
  return queueEntries.value.findIndex((item) => item.track.id === trackId);
};
