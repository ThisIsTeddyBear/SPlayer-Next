/**
 * Shazam 签名 Worker：加载授权的 sigx Emscripten 运行时，在主进程外生成二进制签名。
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

interface SignatureRequest {
  id: number;
  pcm: Float32Array;
  sampleRate: number;
}

interface SignatureResponse {
  id: number;
  ok: boolean;
  signature?: ArrayBuffer;
  error?: string;
}

interface SigxRuntime {
  HEAPF32?: Float32Array;
  _malloc?: (size: number) => number;
  _free?: (pointer: number) => void;
  ccall?: (
    name: string,
    returnType: null,
    argTypes: string[],
    args: number[],
    options?: { async?: boolean },
  ) => unknown;
}

const shazamDir = workerData?.shazamDir as string | undefined;
let runtime: SigxRuntime | null = null;
let runtimePromise: Promise<SigxRuntime> | null = null;

/** 等待 Emscripten 运行时完成初始化 */
const waitForRuntime = (value: SigxRuntime): Promise<SigxRuntime> =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + 5_000;
    const check = (): void => {
      if (value.HEAPF32 && value._malloc && value._free && value.ccall) {
        resolve(value);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error("sigx runtime initialization timed out"));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });

/** 加载授权的 sigx 运行时 */
const loadRuntime = (): Promise<SigxRuntime> => {
  if (runtimePromise) return runtimePromise;
  if (!shazamDir) return Promise.reject(new Error("shazam assets are unavailable"));
  const gluePath = path.join(shazamDir, "sigx.cjs");
  const wasmPath = path.join(shazamDir, "sigx.wasm");
  if (!existsSync(gluePath) || !existsSync(wasmPath)) {
    return Promise.reject(new Error("shazam assets are unavailable"));
  }
  runtimePromise = (async () => {
    const require = createRequire(import.meta.url);
    const instantiateStreaming = WebAssembly.instantiateStreaming;
    let value: SigxRuntime;
    try {
      WebAssembly.instantiateStreaming =
        undefined as unknown as typeof WebAssembly.instantiateStreaming;
      value = require(gluePath) as SigxRuntime;
    } finally {
      WebAssembly.instantiateStreaming = instantiateStreaming;
    }
    runtime = await waitForRuntime(value);
    return runtime;
  })();
  return runtimePromise;
};

const respond = (response: SignatureResponse, transfer?: ArrayBuffer): void => {
  if (transfer) {
    parentPort?.postMessage(response, [transfer]);
  } else {
    parentPort?.postMessage(response);
  }
};

Object.defineProperty(globalThis, "self", {
  value: {
    postMessage: (message: unknown) => {
      const data = message as { type?: string; index?: number; signatureArray?: Int8Array };
      if (data.type !== "sigready" || data.index === undefined || !data.signatureArray) return;
      const signature = new Uint8Array(data.signatureArray.byteLength);
      signature.set(data.signatureArray);
      const buffer = signature.buffer as ArrayBuffer;
      respond({ id: data.index, ok: true, signature: buffer }, buffer);
    },
  },
});

const createSignature = async (request: SignatureRequest): Promise<void> => {
  try {
    const sigx = await loadRuntime();
    const pointer = sigx._malloc!(request.pcm.byteLength);
    sigx.HEAPF32!.set(request.pcm, pointer / Float32Array.BYTES_PER_ELEMENT);
    try {
      await Promise.resolve(
        sigx.ccall!(
          "extract_signature",
          null,
          ["number", "number", "number", "number"],
          [request.id, request.sampleRate, pointer, request.pcm.length],
          { async: true },
        ),
      );
    } finally {
      sigx._free!(pointer);
    }
  } catch (error) {
    respond({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

let requestQueue = Promise.resolve();

parentPort?.on("message", (request: SignatureRequest) => {
  requestQueue = requestQueue.then(() => createSignature(request));
});
