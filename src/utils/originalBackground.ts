export type RgbColor = readonly [number, number, number];

export interface OriginalBackgroundPalette {
  primary: RgbColor;
  secondary: RgbColor;
  luminance: number;
  exposure: number;
  saturation: number;
  overlayOpacity: number;
}

export interface OriginalBackgroundQuality {
  renderScale: number;
  maxFps: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const getLuminance = (r: number, g: number, b: number): number =>
  (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;

const distance = (a: RgbColor, b: RgbColor): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * 从缩小后的封面像素提取背景配色与可读性参数
 * @param pixels - RGBA 像素数据
 * @returns 背景渲染所需的配色与亮度参数
 */
export const analyzeOriginalBackground = (pixels: Uint8ClampedArray): OriginalBackgroundPalette => {
  const buckets = new Map<
    string,
    { r: number; g: number; b: number; weight: number; count: number }
  >();
  let totalLuminance = 0;
  let totalWeight = 0;

  for (let index = 0; index < pixels.length; index += 16) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const alpha = pixels[index + 3] / 255;
    if (alpha < 0.2) continue;

    const maximum = Math.max(r, g, b);
    const minimum = Math.min(r, g, b);
    const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum;
    const luminance = getLuminance(r, g, b);
    const weight = alpha * (0.2 + saturation * 1.8) * (0.5 + Math.abs(luminance - 0.5));
    const key = `${Math.round(r / 32)}:${Math.round(g / 32)}:${Math.round(b / 32)}`;
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, weight: 0, count: 0 };
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
    bucket.weight += weight;
    bucket.count++;
    buckets.set(key, bucket);
    totalLuminance += luminance * alpha;
    totalWeight += alpha;
  }

  const candidates = [...buckets.values()]
    .filter((bucket) => bucket.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .map(
      (bucket) =>
        [bucket.r / bucket.weight, bucket.g / bucket.weight, bucket.b / bucket.weight] as RgbColor,
    );
  const primary = candidates[0] ?? ([32, 32, 40] as RgbColor);
  const secondary = candidates.find((color) => distance(color, primary) > 52) ?? primary;
  const luminance = totalWeight > 0 ? totalLuminance / totalWeight : 0.14;

  return {
    primary,
    secondary,
    luminance,
    exposure: luminance > 0.72 ? 0.64 : luminance < 0.13 ? 1.32 : 0.9,
    saturation: luminance > 0.74 ? 0.88 : luminance < 0.16 ? 1.3 : 1.12,
    overlayOpacity: luminance > 0.66 ? 0.74 : luminance < 0.1 ? 0.48 : 0.6,
  };
};

/**
 * 根据输出尺寸选择固定质量档位，限制高分辨率设备的 GPU 占用
 * @param width - CSS 宽度
 * @param height - CSS 高度
 * @param dpr - 设备像素比
 * @returns 渲染比例与帧率上限
 */
export const getOriginalBackgroundQuality = (
  width: number,
  height: number,
  dpr: number,
): OriginalBackgroundQuality => {
  const longestEdge = Math.max(width, height);
  const pixelRatio = Math.min(dpr, 1.25);
  if (longestEdge > 2560 || dpr > 1.5) return { renderScale: pixelRatio * 0.38, maxFps: 24 };
  if (longestEdge > 1920) return { renderScale: pixelRatio * 0.46, maxFps: 27 };
  return { renderScale: pixelRatio * 0.55, maxFps: 30 };
};

/**
 * 为连续切歌使用更短的过渡，正常换歌保留更舒缓的节奏
 * @param elapsed - 距离上次封面切换的毫秒数
 * @returns 过渡时长（毫秒）
 */
export const getOriginalBackgroundTransitionDuration = (elapsed: number): number =>
  elapsed < 1200 ? 420 : 700;

/**
 * 将 0 到 255 的 RGB 值归一化为 WebGL uniform 使用的颜色
 * @param color - RGB 颜色
 * @returns 归一化 RGB 颜色
 */
export const normalizeRgb = (color: RgbColor): RgbColor => [
  clamp(color[0] / 255, 0, 1),
  clamp(color[1] / 255, 0, 1),
  clamp(color[2] / 255, 0, 1),
];
