import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  extractColorFromImageElement,
  extractColorFromUrl,
  generateSongPalette,
  hexToRgb,
  SOLID_PALETTE_DARK,
  SOLID_PALETTE_LIGHT,
} from "./color";

const state = vi.hoisted(() => ({
  theme: {
    songThemeEnabled: true,
    songColors: [] as string[],
    coverColor: null as string | null,
    coverSingerColors: [] as string[],
  },
  settings: { player: { followCoverColor: true } },
}));

vi.mock("@/stores/theme", () => ({ useThemeStore: () => state.theme }));
vi.mock("@/stores/settings", () => ({ useSettingsStore: () => state.settings }));

const images: ImageDouble[] = [];

class ImageDouble {
  src = "";
  crossOrigin = "";
  naturalWidth = 64;
  naturalHeight = 64;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    images.push(this);
  }
}

beforeEach(() => {
  images.length = 0;
  state.theme.songThemeEnabled = true;
  state.theme.songColors = [];
  state.theme.coverColor = null;
  state.theme.coverSingerColors = [];
  state.settings.player.followCoverColor = true;
  vi.stubGlobal("Image", ImageDouble);

  let source = "";
  const context = {
    drawImage: (image: ImageDouble) => {
      source = image.src;
    },
    getImageData: () => {
      const data = new Uint8ClampedArray(64 * 64 * 4);
      for (let pixel = 0; pixel < 64 * 64; pixel++) {
        const row = Math.floor(pixel / 64);
        const rgb = source.endsWith("gray")
          ? [115, 115, 115]
          : source.endsWith("red") || (source.endsWith("mixed") && row < 21)
            ? [220, 38, 38]
            : source.endsWith("mixed") && row > 42
              ? [22, 163, 74]
              : [37, 99, 235];
        data.set([...rgb, 255], pixel * 4);
      }
      return { data };
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * 计算色板中两种不透明颜色的对比度，验证亮度约束而非具体色值。
 * @param foreground - 前景 RGB 分量
 * @param background - 背景 RGB 分量
 * @returns 两种颜色的相对亮度对比值
 */
const contrast = (foreground: string, background: string): number => {
  const luminances = [foreground, background].map((rgb) => {
    const values = rgb.split(" ").map((part) => {
      const value = Number(part) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  });
  return (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
};

it.each([true, false])("keeps text neutral and readable across song hues (dark: %s)", (isDark) => {
  for (const color of ["#dc2626", "#2563eb", "#16a34a", "#facc15", "#7e22ce"]) {
    const palette = generateSongPalette(color, isDark);
    const neutral = isDark ? SOLID_PALETTE_DARK : SOLID_PALETTE_LIGHT;
    expect(palette.onSurface).toBe(neutral.onSurface);
    expect(contrast(palette.onPrimary, palette.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette.onPrimaryContainer, palette.primaryContainer)).toBeGreaterThanOrEqual(4.5);
    for (const surface of [palette.surface, palette.surfacePanel, palette.surfaceBright]) {
      expect(contrast(palette.onSurface, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.onSurfaceVariant, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.primary, surface)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it("keeps app colors independent of the player's lyric color switch", () => {
  state.settings.player.followCoverColor = false;
  extractColorFromUrl("cover://blue");
  images[0].onload?.();
  expect(state.theme.songColors).toHaveLength(1);
  expect(state.theme.coverColor).toBeNull();
  expect(state.theme.coverSingerColors).toEqual([]);
});

it("ignores a late cover result after the current song is cleared", () => {
  extractColorFromUrl("cover://red");
  extractColorFromUrl(null);
  images[0].onload?.();
  expect(state.theme.songColors).toEqual([]);
  expect(state.theme.coverColor).toBeNull();
});

it("keeps the latest song's palette when older artwork finishes last", () => {
  extractColorFromUrl("cover://red");
  extractColorFromUrl("cover://blue");
  images[1].onload?.();
  const latest = [...state.theme.songColors];
  expect(latest).toHaveLength(1);
  images[0].onload?.();
  expect(state.theme.songColors).toEqual(latest);
});

it("clears the previous palette when artwork fails to load", () => {
  extractColorFromUrl("cover://red");
  images[0].onload?.();
  extractColorFromUrl("cover://missing");
  images[1].onerror?.();
  expect(state.theme.songColors).toEqual([]);
  expect(state.theme.coverColor).toBeNull();
});

it("returns no accent for grayscale art and releases the sampling bitmap", () => {
  const createElement = vi.spyOn(document, "createElement");
  const image = new ImageDouble();
  image.src = "cover://gray";
  expect(extractColorFromImageElement(image as unknown as HTMLImageElement)).toEqual({
    primary: null,
    singerColors: [],
    ambientColors: [],
  });
  const canvas = createElement.mock.results[0].value as HTMLCanvasElement;
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
});

it("uses at most three colors sampled from the artwork for ambient gradients", () => {
  const image = new ImageDouble();
  image.src = "cover://mixed";
  const result = extractColorFromImageElement(image as unknown as HTMLImageElement);
  expect(result.ambientColors).toHaveLength(3);
  const sampled = ["#dc2626", "#2563eb", "#16a34a"].map((hex) =>
    hexToRgb(hex).split(" ").map(Number),
  );
  for (const color of result.ambientColors) {
    const actual = hexToRgb(color).split(" ").map(Number);
    expect(sampled.some((rgb) => rgb.every((channel, i) => Math.abs(channel - actual[i]) <= 8))).toBe(
      true,
    );
  }
});
