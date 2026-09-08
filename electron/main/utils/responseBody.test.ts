import assert from "node:assert/strict";
import { test } from "node:test";
import { readResponseBytes } from "./responseBody.ts";

test("bounded response reader accepts exact limits", async () => {
  assert.deepEqual(await readResponseBytes(new Response("music"), 5), new TextEncoder().encode("music"));
});

test("bounded response reader cancels oversized chunked bodies", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(readResponseBytes(response, 5), /size limit/);
  assert.equal(cancelled, true);
});

test("bounded response reader rejects declared oversized bodies before reading", async () => {
  await assert.rejects(
    readResponseBytes(new Response("large", { headers: { "content-length": "100" } }), 5),
    /size limit/,
  );
});
