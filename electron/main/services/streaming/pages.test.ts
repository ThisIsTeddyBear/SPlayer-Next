import assert from "node:assert/strict";
import { test } from "node:test";
import { streamPages } from "./pages.ts";

test("pagination reads past 500 albums and respects lower server limits", async () => {
  const catalog = Array.from({ length: 1201 }, (_, id) => ({ id: String(id) }));
  const result: typeof catalog = [];
  for await (const page of streamPages(
    async (offset, limit) => catalog.slice(offset, offset + Math.min(limit, 200)),
    (item) => item.id,
    () => false,
  )) {
    result.push(...page);
  }
  assert.deepEqual(result, catalog);
});

test("a server ignoring offset cannot loop forever or trigger stale deletion", async () => {
  await assert.rejects(async () => {
    for await (const page of streamPages(
      async () => [{ id: "same" }],
      (item) => item.id,
      () => false,
    )) {
      assert.equal(page.length, 1);
    }
  }, /repeated IDs/);
});

test("cancellation discards an in-flight page", async () => {
  let cancelled = false;
  const pages = streamPages(
    async () => {
      cancelled = true;
      return [{ id: "late" }];
    },
    (item) => item.id,
    () => cancelled,
  );
  assert.equal((await pages.next()).done, true);
});
