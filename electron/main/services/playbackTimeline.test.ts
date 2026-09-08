import assert from "node:assert/strict";
import { test } from "node:test";
import {
  beginPlaybackLoad,
  clearPlaybackTimeline,
  isCurrentPlaybackLoad,
  toDisplayDurationMs,
  toDisplayPositionMs,
  toEnginePositionMs,
} from "./playbackTimeline.ts";

test("CUE seek and status share the same bounded millisecond timeline", () => {
  beginPlaybackLoad({ cueStartMs: 60000, cueEndMs: 90000 });
  assert.equal(toEnginePositionMs(10000), 70000);
  assert.equal(toEnginePositionMs(100000), 90000);
  assert.equal(toDisplayPositionMs(70000), 10000);
  assert.equal(toDisplayPositionMs(1000), 0);
  assert.equal(toDisplayDurationMs(200000), 30000);
  assert.throws(() => toEnginePositionMs(NaN));
  assert.throws(() => toEnginePositionMs(-1));
});

test("new loads and stop invalidate old asynchronous completions", () => {
  const old = beginPlaybackLoad({ cueStartMs: 1000, cueEndMs: 2000 });
  const current = beginPlaybackLoad();
  assert.equal(isCurrentPlaybackLoad(old), false);
  assert.equal(isCurrentPlaybackLoad(current), true);
  assert.equal(toEnginePositionMs(500), 500);
  clearPlaybackTimeline();
  assert.equal(isCurrentPlaybackLoad(current), false);
});
