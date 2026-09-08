import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { MICROPHONE_WORKLET_SOURCE } from "../../../../src/services/recognition/microphoneCapture.worklet.ts";

test("microphone worklet preserves PCM, acknowledges flush and stops processing", () => {
  const messages: Array<{ type: string; pcm?: Float32Array }> = [];
  class Processor {
    port = {
      onmessage: undefined as ((event: { data: { type: string } }) => void) | undefined,
      postMessage: (message: { type: string; pcm?: Float32Array }) => messages.push(message),
    };
    process(_inputs: Float32Array[][]): boolean {
      return true;
    }
  }
  let Capture: typeof Processor | undefined;
  vm.runInNewContext(MICROPHONE_WORKLET_SOURCE, {
    AudioWorkletProcessor: Processor,
    Float32Array,
    sampleRate: 48000,
    registerProcessor: (_name: string, constructor: typeof Processor) => {
      Capture = constructor;
    },
  });
  assert.ok(Capture);
  const processor = new Capture();
  for (let index = 0; index < 375; index++) {
    assert.equal(processor.process([[new Float32Array(128).fill(0.5)]]), true);
  }
  processor.port.onmessage?.({ data: { type: "flush" } });
  assert.equal(messages.at(-1)?.type, "flushed");
  const samples = messages.flatMap((message) => [...(message.pcm ?? [])]);
  assert.equal(samples.length, 8000);
  assert.equal(samples.every((value) => value === 0.5), true);
  const count = messages.length;
  assert.equal(processor.process([[new Float32Array(128)]]), false);
  assert.equal(messages.length, count);
});
