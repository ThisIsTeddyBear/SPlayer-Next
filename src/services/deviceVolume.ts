/** Storage key */
const STORAGE_KEY = "splayer:device-volumes";

/** Maximum device records to keep */
const MAX_DEVICE_RECORDS = 30;

/** Device volume storage entry */
export interface DeviceVolumeRecord {
  /** Volume level (0.0 ~ 1.0) */
  volume: number;
  /** Timestamp of last update (ms) */
  updatedAt: number;
}

/** Device volume storage dictionary */
export type DeviceVolumeStorage = Record<string, DeviceVolumeRecord>;

/** Initialize memory cache from localStorage */
const loadFromStorage = (): DeviceVolumeStorage => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as DeviceVolumeStorage) : {};
  } catch {
    return {};
  }
};

/** In-memory cache of device volumes */
const memoryCache: DeviceVolumeStorage = loadFromStorage();

/**
 * Read saved volume for a specific audio device
 * @param deviceId - Audio device stable ID
 * @returns Volume (0.0 ~ 1.0), or null if no record exists
 */
export const getDeviceVolume = (deviceId: string): number | null => {
  const volume = memoryCache[deviceId]?.volume;
  if (typeof volume !== "number") return null;
  return Math.max(0, Math.min(1, volume));
};

/**
 * Save volume for a specific audio device and persist to storage
 * @param deviceId - Audio device stable ID
 * @param volume - Volume level (0.0 ~ 1.0)
 */
export const setDeviceVolume = (deviceId: string, volume: number): void => {
  memoryCache[deviceId] = { volume, updatedAt: Date.now() };

  // Evict oldest updated record when exceeding max capacity
  const keys = Object.keys(memoryCache);
  if (keys.length > MAX_DEVICE_RECORDS) {
    keys.sort((a, b) => memoryCache[a].updatedAt - memoryCache[b].updatedAt);
    for (let i = 0; i < keys.length - MAX_DEVICE_RECORDS; i++) {
      delete memoryCache[keys[i]];
    }
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryCache));
  } catch {
    // Ignore storage errors or disabled quota
  }
};

