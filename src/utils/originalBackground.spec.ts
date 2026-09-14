import { describe, expect, it } from "vitest";
import {
  analyzeOriginalBackground,
  getOriginalBackgroundQuality,
  getOriginalBackgroundTransitionDuration,
  normalizeRgb,
} from "./originalBackground";

describe("originalBackground", () => {
  it("protects lyric contrast for bright artwork", () => {
    const result = analyzeOriginalBackground(new Uint8ClampedArray(Array(64).fill(250)));
    expect(result.exposure).toBe(0.64);
    expect(result.overlayOpacity).toBe(0.74);
  });

  it("lifts nearly black artwork", () => {
    const result = analyzeOriginalBackground(
      new Uint8ClampedArray([8, 8, 8, 255, 8, 8, 8, 255, 8, 8, 8, 255, 8, 8, 8, 255]),
    );
    expect(result.exposure).toBe(1.32);
    expect(result.saturation).toBe(1.3);
  });

  it("selects a bounded rendering quality", () => {
    expect(getOriginalBackgroundQuality(1280, 800, 1)).toEqual({ renderScale: 0.55, maxFps: 30 });
    expect(getOriginalBackgroundQuality(3840, 2160, 2)).toEqual({ renderScale: 0.475, maxFps: 24 });
  });

  it("uses a short transition for rapid cover changes", () => {
    expect(getOriginalBackgroundTransitionDuration(300)).toBe(420);
    expect(getOriginalBackgroundTransitionDuration(2000)).toBe(700);
  });

  it("normalizes RGB values for shader uniforms", () => {
    expect(normalizeRgb([255, 127.5, 0])).toEqual([1, 0.5, 0]);
  });
});
