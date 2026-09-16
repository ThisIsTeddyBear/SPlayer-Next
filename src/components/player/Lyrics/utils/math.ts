/**
 * General math and easing utility functions.
 */

/**
 * Clamp a value between min and max bounds.
 *
 * @param min - Lower bound
 * @param value - Input value
 * @param max - Upper bound
 * @returns Clamped value
 */
export const clamp = (min: number, value: number, max: number) =>
  value < min ? min : value > max ? max : value;

/**
 * Easing function with overshoot anticipation and rebound (ease-in-out-back).
 *
 * @param progress - Progress between 0 and 1
 * @returns Eased value
 */
export const easeInOutBack = (progress: number): number => {
  const overshoot = 1.70158 * 1.525;
  return progress < 0.5
    ? ((2 * progress) ** 2 * ((overshoot + 1) * 2 * progress - overshoot)) / 2
    : ((2 * progress - 2) ** 2 * ((overshoot + 1) * (progress * 2 - 2) + overshoot) + 2) / 2;
};

/**
 * Exponential ease-out curve.
 *
 * @param progress - Progress between 0 and 1
 * @returns Eased value
 */
export const easeOutExpo = (progress: number): number =>
  progress === 1 ? 1 : 1 - 2 ** (-10 * progress);

/**
 * Find the minimum number in a Set<number>.
 * Avoids the spread overhead of Math.min(...set) on large sets.
 *
 * @param set - Set of numbers
 * @returns Minimum value, or -1 if empty
 */
export const setMin = (set: Set<number>): number => {
  let minValue = Infinity;
  for (const value of set) {
    if (value < minValue) minValue = value;
  }
  return minValue === Infinity ? -1 : minValue;
};
