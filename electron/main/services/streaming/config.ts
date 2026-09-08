import fs from "node:fs";
import path from "node:path";
import {
  encryptSecret as encryptPassword,
  decryptSecret as decryptPassword,
} from "@main/utils/secretStorage";
import { writeFileSync as atomicWriteSync } from "atomically";
import { streamingLog } from "@main/utils/logger";
import { configDir } from "@main/utils/paths";
import type {
  StreamingServerConfig,
  StreamingServerInput,
  StreamingRuntimeConfig,
} from "@shared/types/streaming";

const STORAGE_FILE = path.join(configDir, "streaming.json");

interface PersistedServer {
  id: string;
  name: string;
  type: StreamingServerConfig["type"];
  url: string;
  username: string;
  encryptedPassword: string;
  lastConnected?: number;
}

interface PersistedState {
  servers: PersistedServer[];
  activeServerId: string | null;
}

let state: PersistedState | undefined;

/**
 */
const getState = (): PersistedState => {
  if (state) return state;
  try {
    const parsed = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as PersistedState;
    if (!Array.isArray(parsed?.servers)) throw new Error("Invalid streaming configuration");
    state = { servers: parsed.servers, activeServerId: parsed.activeServerId ?? null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      streamingLog.error("Failed to read streaming configuration; original file preserved", error);
      throw new Error(
        "Streaming configuration cannot be read. Restore its backup before saving changes.",
      );
    }
    state = { servers: [], activeServerId: null };
  }
  return state;
};

const save = (): void => {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(STORAGE_FILE, JSON.stringify(getState(), null, 2));
  } catch (error) {
    state = undefined;
    throw error;
  }
};

/**
 */
const toServerConfig = (server: PersistedServer): StreamingServerConfig => ({
  id: server.id,
  name: server.name,
  type: server.type,
  url: server.url,
  username: server.username,
  hasPassword: Boolean(server.encryptedPassword),
  lastConnected: server.lastConnected,
});

/**
 */
const toRuntimeConfig = (server: PersistedServer): StreamingRuntimeConfig => ({
  ...toServerConfig(server),
  password: decryptPassword(server.encryptedPassword),
});

/**
 */
export const getStreamingConfig = (): {
  servers: StreamingServerConfig[];
  activeServerId: string | null;
} => ({
  servers: getState().servers.map(toServerConfig),
  activeServerId: getState().activeServerId,
});

/**
 */
export const getStreamingServer = (serverId: string): StreamingRuntimeConfig => {
  const server = getState().servers.find((item) => item.id === serverId);
  if (!server) throw new Error("Streaming server was not found");
  return toRuntimeConfig(server);
};

/**
 */
export const addStreamingServer = (input: StreamingServerInput): StreamingServerConfig => {
  const server: PersistedServer = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    type: input.type,
    url: input.url.trim().replace(/\/+$/, ""),
    username: input.username,
    encryptedPassword: encryptPassword(input.password),
  };
  getState().servers.push(server);
  save();
  return toServerConfig(server);
};

/**
 */
export const updateStreamingServer = (
  serverId: string,
  input: StreamingServerInput,
): StreamingServerConfig => {
  const server = getState().servers.find((item) => item.id === serverId);
  if (!server) throw new Error("Streaming server was not found");
  const encryptedPassword = input.password
    ? encryptPassword(input.password)
    : server.encryptedPassword;
  server.name = input.name.trim();
  server.type = input.type;
  server.url = input.url.trim().replace(/\/+$/, "");
  server.username = input.username;
  server.encryptedPassword = encryptedPassword;
  server.lastConnected = undefined;
  save();
  return toServerConfig(server);
};

/**
 */
export const removeStreamingServer = (serverId: string): void => {
  const current = getState();
  current.servers = current.servers.filter((server) => server.id !== serverId);
  if (current.activeServerId === serverId) current.activeServerId = null;
  save();
};

/**
 */
export const setActiveStreamingServer = (serverId: string | null): void => {
  const current = getState();
  if (serverId && !current.servers.some((server) => server.id === serverId)) {
    throw new Error("Streaming server was not found");
  }
  current.activeServerId = serverId;
  save();
};

/**
 */
export const markStreamingServerConnected = (serverId: string): StreamingServerConfig => {
  const server = getState().servers.find((item) => item.id === serverId);
  if (!server) throw new Error("Streaming server was not found");
  server.lastConnected = Date.now();
  save();
  return toServerConfig(server);
};

/**
 */
export const createTestStreamingServer = (
  input: StreamingServerInput,
  serverId?: string,
): StreamingRuntimeConfig => {
  const saved = serverId ? getState().servers.find((server) => server.id === serverId) : undefined;
  const password = input.password || (saved ? decryptPassword(saved.encryptedPassword) : "");

  const base = {
    id: `__test__:${crypto.randomUUID()}`,
    name: input.name.trim(),
    url: input.url.trim().replace(/\/+$/, ""),
    username: input.username,
    password,
    hasPassword: Boolean(password),
  };

  return {
    ...base,
    type: input.type,
  };
};
