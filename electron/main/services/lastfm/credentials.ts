import fs from "node:fs";
import path from "node:path";
import { encryptSecret as encrypt, decryptSecret as decrypt } from "@main/utils/secretStorage";
import { writeFileSync as atomicWriteSync } from "atomically";
import { lastfmLog } from "@main/utils/logger";
import { configDir } from "@main/utils/paths";

/** 凭证文件 */
const STORAGE_FILE = path.join(configDir, "lastfm.json");

/** 解密后的凭证 */
export interface LastfmCredentials {
  username: string;
  sessionKey: string;
}

/** 持久化形态 */
interface PersistedCredentials {
  username: string;
  encryptedSessionKey: string;
}

/**
 * 读取本地凭证
 * @returns 凭证；不存在或损坏时返回 null
 */
export const load = (): LastfmCredentials | null => {
  try {
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as PersistedCredentials;
    const sessionKey = decrypt(raw.encryptedSessionKey);
    if (!raw.username || !sessionKey) return null;
    return { username: raw.username, sessionKey };
  } catch {
    return null;
  }
};

/**
 * 保存凭证
 * @param username - 用户名
 * @param sessionKey - 会话密钥
 */
export const save = (username: string, sessionKey: string): void => {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data: PersistedCredentials = {
      username,
      encryptedSessionKey: encrypt(sessionKey),
    };
    atomicWriteSync(STORAGE_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    lastfmLog.error("写入 lastfm.json 失败:", err);
    throw err;
  }
};

/** 清除凭证 */
export const clear = (): void => {
  try {
    if (fs.existsSync(STORAGE_FILE)) fs.rmSync(STORAGE_FILE);
  } catch (err) {
    lastfmLog.error("删除 lastfm.json 失败:", err);
  }
};
