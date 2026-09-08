/**
 * 外部 API 门禁中间件
 * - externalApi.enabled   总开关：关闭时 /api/* 与 /ws 全部 403
 * - externalApi.wsEnabled 子开关：关闭时 /ws 单独 403，REST 不受影响
 */

import type { MiddlewareHandler } from "hono";
import { store } from "@main/store";
import { getAccessKey } from "./accessKey";
import { isAuthorized } from "./auth";

/** 总开关 */
export const externalControlGate: MiddlewareHandler = async (c, next) => {
  if (!store.get("externalApi.enabled")) {
    return c.json({ error: "external API disabled" }, 403);
  }
  const protocols = c.req.path === "/ws" ? c.req.header("Sec-WebSocket-Protocol") : undefined;
  if (!isAuthorized(getAccessKey(), c.req.header("Authorization"), protocols)) {
    c.header("WWW-Authenticate", "Bearer");
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
  return;
};

/** WS 子开关 */
export const wsGate: MiddlewareHandler = async (c, next) => {
  if (!store.get("externalApi.wsEnabled")) {
    return c.json({ error: "WebSocket disabled" }, 403);
  }
  await next();
  return;
};
