import assert from "node:assert/strict";
import { test } from "node:test";
import { isAuthorized } from "./auth.ts";

const key = "a".repeat(64);

test("external API requires an exact bearer token", () => {
  assert.equal(isAuthorized(key, `Bearer ${key}`), true);
  for (const value of [undefined, "", "Bearer null", `Bearer ${key}x`, `Bearer ${"b".repeat(64)}`]) {
    assert.equal(isAuthorized(key, value), false);
  }
  assert.equal(isAuthorized("", "Bearer "), false);
});

test("browser WebSocket authentication uses a dedicated subprotocol", () => {
  assert.equal(isAuthorized(key, undefined, `splayer-api, splayer-token.${key}`), true);
  assert.equal(isAuthorized(key, undefined, `other.${key}`), false);
  assert.equal(isAuthorized(key, undefined, `splayer-token.${key}x`), false);
  assert.equal(isAuthorized(key, "Bearer invalid", `splayer-token.${key}`), true);
});
