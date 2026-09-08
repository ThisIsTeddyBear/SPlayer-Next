// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { safeStorage } from "electron";
import { encryptSecret, decryptSecret } from "./secretStorage";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    getSelectedStorageBackend: vi.fn(() => "gnome_libsecret"),
    encryptString: vi.fn((plain: string) => Buffer.from(`encrypted:${plain}`)),
    decryptString: vi.fn((encrypted: Buffer) => encrypted.toString().slice(10)),
  },
}));

beforeEach(() => {
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
  vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue("gnome_libsecret");
});

it("preserves existing OS-encrypted credential format", () => {
  expect(decryptSecret(encryptSecret("secret"))).toBe("secret");
});

it("never saves or interprets plaintext when OS secure storage is unavailable", () => {
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
  expect(() => encryptSecret("secret")).toThrow("secure storage is unavailable");
  expect(() => decryptSecret(Buffer.from("plaintext").toString("base64"))).toThrow();
});

it.runIf(process.platform === "linux")("rejects the Linux basic_text backend", () => {
  vi.mocked(safeStorage.getSelectedStorageBackend).mockReturnValue("basic_text");
  expect(() => encryptSecret("secret")).toThrow();
});
