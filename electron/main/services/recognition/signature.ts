/**
 * Shazam 签名计算入口：管理 sigx Worker 的创建与请求分发。
 */

import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { app } from "electron";
import { recognitionLog } from "@main/utils/logger";

interface SignatureResponse {
  id: number;
  ok: boolean;
  signature?: ArrayBuffer;
  error?: string;
}

type SignatureResult = { ok: true; signature: Uint8Array } | { ok: false; error: string };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (response: SignatureResponse) => void>();

/** 解析 sigx 资产目录 */
const resolveSigxDir = (): string | null => {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, "shazam")
    : path.join(app.getAppPath(), "resources", "shazam");
  const files = ["sigx.cjs", "sigx.wasm"];
  return files.every((file) => fs.existsSync(path.join(dir, file))) ? dir : null;
};

const getWorker = (): Worker => {
  if (worker) return worker;
  const next = new Worker(path.join(__dirname, "signature.worker.js"), {
    workerData: { shazamDir: resolveSigxDir() },
  });
  next.on("message", (message: SignatureResponse) => {
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    resolve(message);
  });
  next.on("error", (error) => {
    recognitionLog.error("Shazam 签名 Worker 异常:", error);
    for (const resolve of pending.values()) {
      resolve({ id: 0, ok: false, error: error.message });
    }
    pending.clear();
    worker = null;
  });
  next.on("exit", () => {
    worker = null;
  });
  worker = next;
  return next;
};

/**
 * 为采集的 PCM 生成 Shazam 二进制签名
 * @param pcm - 单声道 f32 PCM
 * @param sampleRate - PCM 采样率
 * @returns 二进制签名或错误信息
 */
export const createSignature = (pcm: Float32Array, sampleRate: number): Promise<SignatureResult> =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, (response) => {
      if (!response.ok || !response.signature) {
        resolve({ ok: false, error: response.error ?? "signature-unavailable" });
        return;
      }
      resolve({ ok: true, signature: new Uint8Array(response.signature) });
    });
    getWorker().postMessage({ id, pcm, sampleRate }, [pcm.buffer as ArrayBuffer]);
  });

/** Shazam 签名资产是否可用 */
export const isSignatureAvailable = (): boolean => resolveSigxDir() !== null;
