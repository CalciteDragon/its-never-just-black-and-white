import { describe, expect, it } from 'vitest';
import {
  CA_MAX_OFFSET,
  CA_THRESHOLD,
  VIEW_H,
  VIEW_W,
  VIGNETTE_MAX,
  VIGNETTE_MIN,
  VIGNETTE_TINT_MAX,
} from '../src/constants';
import {
  caOffset,
  computeScale,
  screenToView,
  tintAmount,
  vignetteAlpha,
} from '../src/engine/renderer';

/** speedNorm sampled across its whole legal range, endpoints included. */
const SAMPLES = Array.from({ length: 101 }, (_, i) => i / 100);

/** Asserts f never decreases across SAMPLES. */
function expectMonotone(f: (n: number) => number): void {
  for (let i = 1; i < SAMPLES.length; i++) {
    expect(f(SAMPLES[i])).toBeGreaterThanOrEqual(f(SAMPLES[i - 1]));
  }
}

describe('computeScale', () => {
  it('960×540 → scale 1, perfectly centered', () => {
    expect(computeScale(960, 540)).toEqual({ scale: 1, offX: 0, offY: 0 });
  });

  it('1000×600 → scale 1 with letterbox offsets (20, 30)', () => {
    expect(computeScale(1000, 600)).toEqual({ scale: 1, offX: 20, offY: 30 });
  });

  it('windows smaller than the view still get scale 1 (never 0)', () => {
    const fit = computeScale(959, 539);
    expect(fit.scale).toBe(1);
    expect(fit.offX).toBeLessThanOrEqual(0);
    expect(fit.offY).toBeLessThanOrEqual(0);
    expect(computeScale(1, 1).scale).toBe(1);
  });

  it('1920×1080 → scale 2 fullscreen', () => {
    expect(computeScale(1920, 1080)).toEqual({ scale: 2, offX: 0, offY: 0 });
  });

  it('3840×2160 → scale 4', () => {
    expect(computeScale(3840, 2160)).toEqual({ scale: 4, offX: 0, offY: 0 });
  });

  it('scale is limited by the tighter axis and offsets stay integers', () => {
    // Width would allow 4×, height only 2×.
    expect(computeScale(3840, 1080)).toEqual({ scale: 2, offX: 960, offY: 0 });
    expect(computeScale(965, 545)).toEqual({ scale: 1, offX: 2, offY: 2 });
  });
});

// The post ramps are stated in terms of the constants, never as literals: a
// retune of CA_THRESHOLD has to move the curve without breaking these.

describe('caOffset', () => {
  it('is exactly zero at and below CA_THRESHOLD', () => {
    expect(caOffset(0)).toBe(0);
    expect(caOffset(CA_THRESHOLD / 2)).toBe(0);
    // The boundary itself, not just below it — a `<` where `<=` belongs would
    // leak a fringe at the exact speed the design calls clean.
    expect(caOffset(CA_THRESHOLD)).toBe(0);
  });

  it('reaches CA_MAX_OFFSET at full speed', () => {
    expect(caOffset(1)).toBeCloseTo(CA_MAX_OFFSET, 10);
  });

  it('leaves the threshold from zero rather than stepping', () => {
    const justOver = caOffset(CA_THRESHOLD + 1e-6);
    expect(justOver).toBeGreaterThan(0);
    expect(justOver).toBeLessThan(CA_MAX_OFFSET / 100);
  });

  it('ramps linearly across the active band', () => {
    expect(caOffset((CA_THRESHOLD + 1) / 2)).toBeCloseTo(CA_MAX_OFFSET / 2, 10);
  });

  it('is monotone across the range', () => {
    expectMonotone(caOffset);
  });

  it('clamps out-of-range input instead of extrapolating', () => {
    expect(caOffset(-1)).toBe(0);
    expect(caOffset(2)).toBeCloseTo(CA_MAX_OFFSET, 10);
    expect(caOffset(1e6)).toBeCloseTo(CA_MAX_OFFSET, 10);
  });
});

describe('vignetteAlpha', () => {
  it('hits VIGNETTE_MIN at rest and VIGNETTE_MAX at full speed', () => {
    expect(vignetteAlpha(0)).toBeCloseTo(VIGNETTE_MIN, 10);
    expect(vignetteAlpha(1)).toBeCloseTo(VIGNETTE_MAX, 10);
  });

  it('lerps linearly between the endpoints', () => {
    expect(vignetteAlpha(0.5)).toBeCloseTo((VIGNETTE_MIN + VIGNETTE_MAX) / 2, 10);
    expect(vignetteAlpha(0.25)).toBeCloseTo(VIGNETTE_MIN + (VIGNETTE_MAX - VIGNETTE_MIN) / 4, 10);
  });

  it('is monotone across the range', () => {
    expectMonotone(vignetteAlpha);
  });

  it('never opens past VIGNETTE_MIN or closes past VIGNETTE_MAX', () => {
    expect(vignetteAlpha(-3)).toBeCloseTo(VIGNETTE_MIN, 10);
    expect(vignetteAlpha(9)).toBeCloseTo(VIGNETTE_MAX, 10);
    for (const n of SAMPLES) {
      expect(vignetteAlpha(n)).toBeGreaterThanOrEqual(VIGNETTE_MIN);
      expect(vignetteAlpha(n)).toBeLessThanOrEqual(VIGNETTE_MAX);
    }
  });
});

describe('tintAmount', () => {
  it('is zero across the whole bottom half of the range', () => {
    // GAME-DESIGN §7: the accent tint fades in over the top half only. Colour
    // is rationed — it may not bleed into the resting frame.
    for (const n of SAMPLES.filter((s) => s <= 0.5)) {
      expect(tintAmount(n)).toBe(0);
    }
  });

  it('is positive everywhere above the halfway point', () => {
    for (const n of SAMPLES.filter((s) => s > 0.5)) {
      expect(tintAmount(n)).toBeGreaterThan(0);
    }
  });

  it('reaches VIGNETTE_TINT_MAX at full speed and half of it at three quarters', () => {
    expect(tintAmount(1)).toBeCloseTo(VIGNETTE_TINT_MAX, 10);
    expect(tintAmount(0.75)).toBeCloseTo(VIGNETTE_TINT_MAX / 2, 10);
  });

  it('is monotone across the range', () => {
    expectMonotone(tintAmount);
  });

  it('clamps out-of-range input instead of extrapolating', () => {
    expect(tintAmount(-1)).toBe(0);
    expect(tintAmount(4)).toBeCloseTo(VIGNETTE_TINT_MAX, 10);
  });
});

/**
 * `screenToView` is the exact inverse of `present`'s blit, and it is this
 * phase's `obb.ts`: the one layer where a wrong constant produces plausible
 * behaviour instead of a crash. Every paint lands on the wrong tile by a fixed
 * offset, which reads as "the editor feels off" and not as an arithmetic bug --
 * until the window is a size where the offset is fifteen tiles.
 *
 * So the window sizes below deliberately DO NOT fit exactly. A grid of sizes
 * that happen to letterbox at zero would let the naive `clientX / scale` pass.
 */
describe('screenToView', () => {
  /** What `present` does: blit the buffer at (offX, offY) at integer scale. */
  function present(winW: number, winH: number, vx: number, vy: number): [number, number] {
    const { scale, offX, offY } = computeScale(winW, winH);
    return [offX + vx * scale, offY + vy * scale];
  }

  const WINDOWS: readonly (readonly [number, number])[] = [
    [960, 540], // exact fit, scale 1
    [1920, 1080], // exact fit, scale 2
    [1920, 1000], // scale 1, offX 480 offY 230 -- the loud one
    [1000, 600], // scale 1, small letterbox
    [1280, 800], // scale 1, offX 160 offY 130
    [2560, 1440], // scale 2, offX 320 offY 180
    [3840, 1080], // scale 2, offX 960 offY 0 -- pillarbox only
    [1366, 768], // scale 1, odd numbers on both axes
    [965, 545], // scale 1, a 2px border
  ];

  const POINTS: readonly (readonly [number, number])[] = [
    [0, 0],
    [1, 1],
    [479, 269],
    [VIEW_W / 2, VIEW_H / 2],
    [VIEW_W - 1, VIEW_H - 1],
  ];

  it('round-trips every view point through present, at every window size', () => {
    for (const [winW, winH] of WINDOWS) {
      for (const [vx, vy] of POINTS) {
        const [sx, sy] = present(winW, winH, vx, vy);
        const back = screenToView(winW, winH, sx, sy);
        expect(back.vx, `${winW}x${winH} @ ${vx},${vy}`).toBeCloseTo(vx, 9);
        expect(back.vy, `${winW}x${winH} @ ${vx},${vy}`).toBeCloseTo(vy, 9);
        expect(back.inFrame, `${winW}x${winH} @ ${vx},${vy}`).toBe(true);
      }
    }
  });

  it('THE LETTERBOX OFFSET IS A 15-TILE ERROR, not a sub-pixel one', () => {
    // The prediction this test is watched failing against. At 1920x1000
    // computeScale gives scale 1, offX 480, offY 230 -- so a naive
    // `clientX / scale` lands 480 px right and 230 px down: 15 tiles across and
    // 7.2 rows down, on a 32 px grid.
    const fit = computeScale(1920, 1000);
    expect(fit).toEqual({ scale: 1, offX: 480, offY: 230 });
    const naive = screenToView(1920, 1000, 480, 230);
    expect(naive.vx).toBe(0);
    expect(naive.vy).toBe(0);
    expect(480 / 32).toBe(15);
    expect(230 / 32).toBeCloseTo(7.1875, 4);
  });

  it('reports a point in the letterbox as out of frame rather than clamping', () => {
    const inBar = screenToView(1920, 1000, 100, 500); // left bar, 380 px in
    expect(inBar.inFrame).toBe(false);
    expect(inBar.vx).toBeLessThan(0); // NOT clamped to 0
    const below = screenToView(1920, 1000, 960, 990);
    expect(below.inFrame).toBe(false);
    expect(below.vy).toBeGreaterThan(VIEW_H);
  });

  it('the frame is half-open: the far edge is out, the pixel before it is in', () => {
    const fit = computeScale(1000, 600);
    const last = screenToView(1000, 600, fit.offX + VIEW_W - 1, fit.offY + VIEW_H - 1);
    expect(last.inFrame).toBe(true);
    const past = screenToView(1000, 600, fit.offX + VIEW_W, fit.offY + VIEW_H);
    expect(past.inFrame).toBe(false);
  });

  it('divides by the same scale computeScale returned, at every scale', () => {
    for (const [winW, winH] of WINDOWS) {
      const { scale, offX, offY } = computeScale(winW, winH);
      const p = screenToView(winW, winH, offX + 10 * scale, offY + 20 * scale);
      expect(p.vx).toBeCloseTo(10, 9);
      expect(p.vy).toBeCloseTo(20, 9);
    }
  });
});
