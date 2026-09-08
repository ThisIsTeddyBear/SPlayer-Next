import { safeStorage } from "electron";

const requireSecureStorage = (): void => {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")
  ) {
    throw new Error(
      "System secure storage is unavailable. Unlock or configure your OS keychain and retry.",
    );
  }
};

/** 禁止把凭据降级为 base64 明文或使用 Linux 的固定密钥后端。 */
export const encryptSecret = (plain: string): string => {
  if (!plain) return "";
  requireSecureStorage();
  return safeStorage.encryptString(plain).toString("base64");
};

/** 保持原有密文格式兼容；旧版明文回退数据必须由用户重新认证。 */
export const decryptSecret = (encrypted: string): string => {
  if (!encrypted) return "";
  requireSecureStorage();
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    throw new Error(
      "Saved credentials cannot be decrypted. Sign in again to replace them securely.",
    );
  }
};
