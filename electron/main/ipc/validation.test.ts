import assert from "node:assert/strict";
import { test } from "node:test";
import { validateIpcArgs } from "./validation.ts";

test("native numeric inputs reject coercion, NaN, infinity and invalid bounds", () => {
  for (const value of [null, "0.5", NaN, Infinity, -1, 2]) {
    assert.throws(() => validateIpcArgs("player:setVolume", [value]));
  }
  validateIpcArgs("player:setVolume", [0]);
  validateIpcArgs("player:setVolume", [1]);
  assert.throws(() => validateIpcArgs("player:seek", [-1]));
});

test("configuration paths cannot traverse prototypes", () => {
  for (const path of ["__proto__.x", "system.constructor.x", "system..x", null]) {
    assert.throws(() => validateIpcArgs("config:set", [path, true]));
  }
  validateIpcArgs("config:set", ["desktopLyric.locked", true]);
});

test("native options require the expected primitive and collection shapes", () => {
  assert.throws(() => validateIpcArgs("player:setFftEnabled", ["false"]));
  assert.throws(() => validateIpcArgs("player:load", ["song.flac", null]));
  assert.throws(() => validateIpcArgs("player:setEqualizerBands", [[0, NaN]]));
  validateIpcArgs("player:setEqualizerBands", [Array(10).fill(0)]);
});
