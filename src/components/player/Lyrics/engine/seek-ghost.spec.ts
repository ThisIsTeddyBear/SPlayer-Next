/**
 * Lyric engine post-seek line position regression tests.
 * Simulates rapid long-distance progress bar scrubbing to verify that all lines settle in strict sequential order
 * with no overlaps or lingering ghost artifacts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LyricRenderer } from "./index";
import type { LyricLine } from "@shared/types/lyrics";

/** Manually stepped rAF queue */
let rafQueue: { id: number; cb: (t: number) => void }[] = [];
let rafNextId = 0;
let frameClock = 0;

const stepFrame = (ms = 16) => {
  frameClock += ms;
  const queue = rafQueue;
  rafQueue = [];
  for (const { cb } of queue) cb(frameClock);
};

const makeLines = (count: number): LyricLine[] => {
  const lines: LyricLine[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * 3000;
    lines.push({
      startTime: start,
      endTime: start + 2800,
      words: [
        { word: `word${i}a`, startTime: start, endTime: start + 1400 },
        { word: `word${i}b`, startTime: start + 1400, endTime: start + 2800 },
      ],
      translatedLyric: "",
      romanLyric: "",
      isBG: false,
      isDuet: false,
    });
  }
  return lines;
};

const createContainer = () => {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 900 });
  Object.defineProperty(container, "clientHeight", { value: 800 });
  document.body.appendChild(container);
  return container;
};

const VIEW_HEIGHT = 800;
const LINE_HEIGHT = 40;

/**
 * Verify there are no visible ghost lines in viewport:
 * - Visible lines do not overlap
 * - DOM position of visible lines must match current spring position (unsynced lines must be culled outside viewport)
 */
const expectNoVisibleGhost = (renderer: LyricRenderer) => {
  const engine = renderer as unknown as {
    lineElements: HTMLDivElement[];
    positionSprings: { getCurrentPosition(): number }[];
  };
  const visible: number[] = [];
  const offenders: string[] = [];
  for (let i = 0; i < engine.lineElements.length; i++) {
    const match = engine.lineElements[i].style.transform.match(/translateY\((-?[\d.]+)px\)/);
    const domY = match ? Number.parseFloat(match[1]) : Number.NaN;
    const springY = engine.positionSprings[i].getCurrentPosition();
    if (Math.abs(domY - springY) > 1 && domY > -LINE_HEIGHT && domY < VIEW_HEIGHT) {
      offenders.push(`Line ${i} DOM=${domY} lingering in viewport (spring=${springY.toFixed(1)})`);
    }
    if (domY > -LINE_HEIGHT && domY < VIEW_HEIGHT) visible.push(domY);
  }
  expect(offenders, offenders.join("; ")).toHaveLength(0);

  visible.sort((a, b) => a - b);
  const overlaps: string[] = [];
  for (let i = 1; i < visible.length; i++) {
    if (visible[i] - visible[i - 1] < LINE_HEIGHT - 1) {
      overlaps.push(`${visible[i - 1]} ~ ${visible[i]}`);
    }
  }
  expect(overlaps, `Visible lines overlap: ${overlaps.join(", ")}`).toHaveLength(0);
};

const runToSettle = (renderer: LyricRenderer, frames = 2000) => {
  for (let i = 0; i < frames; i++) stepFrame();
  expect(renderer).toBeTruthy();
};

describe("LyricRenderer layout after seek", () => {
  beforeEach(() => {
    rafQueue = [];
    rafNextId = 0;
    frameClock = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
      rafQueue.push({ id: ++rafNextId, cb });
      return rafNextId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafQueue = rafQueue.filter((r) => r.id !== id);
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
      },
    );
  });

  it("no overlap after fast long-distance forward scrub", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, { playing: true });
    renderer.setLyrics(makeLines(400));

    // Play normally for a short duration so entrance animation and first line activate
    let time = 0;
    for (let i = 0; i < 600; i++) {
      time += 30;
      renderer.setCurrentTime(time);
      stepFrame();
    }

    // Fast long-distance forward jump: ~200 lines per frame (600s)
    for (let jump = 0; jump < 2; jump++) {
      time += 600000;
      renderer.setCurrentTime(time);
      stepFrame();
    }

    runToSettle(renderer);
    expectNoVisibleGhost(renderer);
    renderer.dispose();
  });

  it("no overlap after fast long-distance backward scrub", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, { playing: true });
    renderer.setLyrics(makeLines(400));

    let time = 1200000;
    for (let i = 0; i < 600; i++) {
      time += 30;
      renderer.setCurrentTime(time);
      stepFrame();
    }

    for (let jump = 0; jump < 2; jump++) {
      time -= 600000;
      renderer.setCurrentTime(time);
      stepFrame();
    }

    runToSettle(renderer);
    expectNoVisibleGhost(renderer);
    renderer.dispose();
  });

  it("no overlap after slow scrub (below seek threshold)", () => {
    const container = createContainer();
    const renderer = new LyricRenderer(container, { playing: true });
    renderer.setLyrics(makeLines(400));

    let time = 0;
    for (let i = 0; i < 600; i++) {
      time += 30;
      renderer.setCurrentTime(time);
      stepFrame();
    }

    // 1500ms per frame, below the 2000ms seek threshold, exercises activation/deactivation path
    for (let i = 0; i < 40; i++) {
      time += 1500;
      renderer.setCurrentTime(time);
      stepFrame();
    }

    runToSettle(renderer);
    expectNoVisibleGhost(renderer);
    renderer.dispose();
  });
});
