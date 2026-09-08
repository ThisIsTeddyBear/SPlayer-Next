/**
 * WebSocket 入口：双向通道
 *
 * Server → Client：
 *   - 连接建立：`{ kind: "hello", clients: N }`
 *   - player 事件：`{ kind: "event", type, data }`（由 wsBroadcast 推）
 *   - 命令 ack：`{ kind: "ack", op }` / `{ kind: "error", op, error }`
 *
 * Client → Server：`{ op: "play" | "pause" | "stop" | "next" | "prev" | "seek" | "setVolume", ... }`
 */

import type { WSContext } from "hono/ws";
import { serverLog } from "@main/utils/logger";
import { playerControl } from "@main/services/playerControl";
import { addWsClient, removeWsClient, getWsClientCount } from "./broadcast";
import { store } from "@main/store";

interface ClientMessage {
  op: string;
  positionMs?: number;
  volume?: number;
}

const clientBudgets = new WeakMap<WSContext, { started: number; count: number; pending: number }>();

const ack = (ws: WSContext, op: string): void => {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ kind: "ack", op }));
};

const fail = (ws: WSContext, op: string, error: string): void => {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ kind: "error", op, error }));
};

const dispatchCommand = async (ws: WSContext, msg: ClientMessage): Promise<void> => {
  try {
    switch (msg.op) {
      case "play":
        playerControl.play();
        return ack(ws, msg.op);
      case "pause":
        playerControl.pause();
        return ack(ws, msg.op);
      case "stop":
        playerControl.stop();
        return ack(ws, msg.op);
      case "next":
        playerControl.next();
        return ack(ws, msg.op);
      case "prev":
        playerControl.prev();
        return ack(ws, msg.op);
      case "seek": {
        const positionMs = msg.positionMs;
        if (typeof positionMs !== "number" || !Number.isFinite(positionMs) || positionMs < 0) {
          return fail(ws, msg.op, "positionMs (number, >=0) required");
        }
        await playerControl.seek(positionMs);
        return ack(ws, msg.op);
      }
      case "setVolume": {
        const volume = msg.volume;
        if (typeof volume !== "number" || !Number.isFinite(volume) || volume < 0 || volume > 1) {
          return fail(ws, msg.op, "volume (number, 0..1) required");
        }
        playerControl.setVolume(volume);
        return ack(ws, msg.op);
      }
      default:
        return fail(ws, msg.op ?? "?", "unknown op");
    }
  } catch (err) {
    fail(ws, msg.op ?? "?", err instanceof Error ? err.message : String(err));
  }
};

export const wsHandlers = {
  onOpen(_evt: Event, ws: WSContext) {
    if (getWsClientCount() >= 32) {
      ws.close(1013, "too many clients");
      return;
    }
    addWsClient(ws);
    clientBudgets.set(ws, { started: Date.now(), count: 0, pending: 0 });
    ws.send(JSON.stringify({ kind: "hello", clients: getWsClientCount() }));
  },
  async onMessage(evt: MessageEvent, ws: WSContext) {
    const budget = clientBudgets.get(ws);
    if (!budget) return;
    if (Date.now() - budget.started >= 1000) {
      budget.started = Date.now();
      budget.count = 0;
    }
    if (++budget.count > 30 || budget.pending >= 8) {
      ws.close(1008, "command limit exceeded");
      clientBudgets.delete(ws);
      return;
    }
    if (!store.get("externalApi.enabled") || !store.get("externalApi.wsEnabled")) {
      ws.close(1008, "external control disabled");
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof evt.data === "string" ? evt.data : evt.data.toString());
    } catch {
      return fail(ws, "?", "invalid json");
    }
    if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof msg.op !== "string") {
      return fail(ws, "?", "command object required");
    }
    budget.pending++;
    try {
      await dispatchCommand(ws, msg);
    } finally {
      budget.pending--;
    }
  },
  onClose(_evt: CloseEvent, ws: WSContext) {
    clientBudgets.delete(ws);
    removeWsClient(ws);
  },
  onError(_evt: Event, ws: WSContext) {
    clientBudgets.delete(ws);
    serverLog.warn("WS 客户端错误");
    removeWsClient(ws);
  },
};
