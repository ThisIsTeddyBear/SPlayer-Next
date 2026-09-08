import { afterEach, describe, expect, it, vi } from "vitest";
import { captureMicrophone, waitCapture } from "./microphoneCapture";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("microphone cleanup", () => {
  it("does not request permission for an already cancelled operation", async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    await expect(captureMicrophone(undefined, AbortSignal.abort())).rejects.toBeDefined();
    expect(getUserMedia).not.toHaveBeenCalled();
    await waitCapture(60000, AbortSignal.abort());
  });

  it("stops a stream acquired after cancellation while permission was pending", async () => {
    const controller = new AbortController();
    const stop = vi.fn();
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => {
          controller.abort();
          return { getTracks: () => [{ stop }] };
        },
      },
    });
    await expect(captureMicrophone(undefined, controller.signal)).rejects.toBeDefined();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("releases tracks and audio context if worklet loading fails", async () => {
    const stop = vi.fn();
    const close = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) },
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        close = close;
        audioWorklet = {
          addModule: async () => {
            throw new Error("worklet failed");
          },
        };
      },
    );
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: revoke });
    await expect(captureMicrophone()).rejects.toThrow("worklet failed");
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });
});
