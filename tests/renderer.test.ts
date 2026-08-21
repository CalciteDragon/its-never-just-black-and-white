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

  it('1000×600 → snaps back to 1×, letterboxed on both axes', () => {
    // Fits 1.04×; the quarter below that is 1× exactly.
    expect(computeScale(1000, 600)).toEqual({ scale: 1, offX: 20, offY: 30 });
  });

  it('snaps a magnifying scale down to a quarter step', () => {
    expect(computeScale(1920, 940).scale).toBe(1.5); // fits 1.74
    expect(computeScale(2560, 1253).scale).toBe(2.25); // fits 2.32
    expect(computeScale(1366, 768).scale).toBe(1.25); // fits 1.42
    expect(computeScale(2560, 1440).scale).toBe(2.5); // fits 2.67
  });

  it('leaves sub-1× scales unsnapped — a shrunk frame has no pixels to spare', () => {
    expect(computeScale(480, 270).scale).toBeCloseTo(0.5, 9);
    expect(computeScale(900, 600).scale).toBeCloseTo(900 / VIEW_W, 9);
  });

  it('windows smaller than the view shrink to fit rather than cropping', () => {
    const fit = computeScale(480, 270);
    expect(fit.scale).toBeCloseTo(0.5, 9);
    expect(fit.offX).toBe(0);
    expect(fit.offY).toBe(0);
  });

  it('lands on a whole scale when the window is close to a multiple of the view', () => {
    // The crisp cases: `present` blits these unsmoothed.
    expect(computeScale(1920, 1080).scale).toBe(2); // fullscreen 1080p, on the nose
    expect(computeScale(1000, 600).scale).toBe(1); // fits 1.04
    expect(computeScale(2900, 1650).scale).toBe(3); // fits 3.02
  });

  it('never returns a scale of 0, however degenerate the canvas', () => {
    // screenToView divides by this. A detached or zero-sized canvas must not
    // hand it a divisor of zero.
    expect(computeScale(0, 0).scale).toBeGreaterThan(0);
    expect(computeScale(1, 1).scale).toBeGreaterThan(0);
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
    expect(computeScale(965, 545)).toEqual({ scale: 1, offX: 3, offY: 3 });
  });

  // The bug this function was rewritten for. Flooring to a whole multiple made
  // the frame's size a step function of the window: a browser windowed on a
  // 1080p display (~940 px of viewport height) fits 1.74× and floored to 1,
  // while the same window on a 1440p display fits 2.41× and floored to 2 --
  // half the linear size on one display for no reason a player could see.
  describe('fills the window consistently across displays', () => {
    const COVERAGE = (winW: number, winH: number): number =>
      (VIEW_H * computeScale(winW, winH).scale) / winH;

    it('has no cliff between a 1080p and a 1440p browser window', () => {
      // Floored to whole multiples these were 0.57 and 0.86 -- the same window
      // drawn at half the linear size on one of the two displays. What is left
      // is the quarter-step shortfall, bounded by 0.25/raw and shrinking as the
      // display grows, which is a trim rather than a cliff.
      const hd = COVERAGE(1920, 940);
      const qhd = COVERAGE(2560, 1253);
      expect(hd).toBeGreaterThan(0.85);
      expect(qhd).toBeGreaterThan(0.85);
      expect(Math.abs(hd - qhd)).toBeLessThan(0.15);
    });

    it('never overflows, and never leaves a whole step on the table', () => {
      for (const [w, h] of [
        [1920, 940],
        [1600, 900],
        [1366, 768],
        [1920, 1080],
        [2560, 1440],
        [3440, 1440],
      ] as const) {
        const { scale } = computeScale(w, h);
        expect(VIEW_W * scale).toBeLessThanOrEqual(w);
        expect(VIEW_H * scale).toBeLessThanOrEqual(h);
        // One more quarter step would not have fitted -- the shortfall is the
        // snap, never slack.
        const next = scale + 0.25;
        expect(VIEW_W * next > w || VIEW_H * next > h).toBe(true);
        // And the snap costs at most a seventh of the window.
        expect(Math.max((VIEW_W * scale) / w, (VIEW_H * scale) / h)).toBeGreaterThan(0.85);
      }
    });
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
    // GAME-DESIGN §7: the ink tint fades in over the top half only. The
    // effect is rationed — it may not bleed into the resting frame.
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
  /** What `present` does: blit the buffer at (offX, offY), scaled to fit. */
  function present(winW: number, winH: number, vx: number, vy: number): [number, number] {
    const { scale, offX, offY } = computeScale(winW, winH);
    return [offX + vx * scale, offY + vy * scale];
  }

  const WINDOWS: readonly (readonly [number, number])[] = [
    [960, 540], // exact fit, scale 1
    [1920, 1080], // exact fit, scale 2
    [1920, 1000], // fractional scale, the awkward one
    [1000, 600], // fractional, small letterbox
    [1280, 800], // fractional, both axes odd against the view
    [2560, 1440], // 1440p fullscreen, fractional
    [3840, 1080], // scale 2, offX 960 offY 0 -- pillarbox only
    [1366, 768], // odd numbers on both axes
    [965, 545], // a hair over the view
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
    // The prediction this test is watched failing against. At 3840x1080
    // computeScale gives scale 2 and offX 960 -- so a naive `clientX / scale`
    // lands 480 view px to the right: 15 tiles across, on a 32 px grid.
    const fit = computeScale(3840, 1080);
    expect(fit).toEqual({ scale: 2, offX: 960, offY: 0 });
    const naive = screenToView(3840, 1080, 960, 0);
    expect(naive.vx).toBe(0);
    expect(naive.vy).toBe(0);
    expect(960 / fit.scale / 32).toBe(15);
  });

  it('reports a point in the letterbox as out of frame rather than clamping', () => {
    // Pillarboxed: 3840x1080 fills the height, leaving 960 px bars either side.
    const inBar = screenToView(3840, 1080, 100, 500); // left bar, 860 px in
    expect(inBar.inFrame).toBe(false);
    expect(inBar.vx).toBeLessThan(0); // NOT clamped to 0
    // Letterboxed: 1000x1080 fills the width, leaving 258 px bars top and bottom.
    const below = screenToView(1000, 1080, 500, 1070);
    expect(below.inFrame).toBe(false);
    expect(below.vy).toBeGreaterThan(VIEW_H);
  });

  it('the frame is half-open: the far edge is out, the pixel before it is in', () => {
    const fit = computeScale(1000, 600);
    const w = VIEW_W * fit.scale;
    const h = VIEW_H * fit.scale;
    const last = screenToView(1000, 600, fit.offX + w - 1, fit.offY + h - 1);
    expect(last.inFrame).toBe(true);
    const past = screenToView(1000, 600, fit.offX + w, fit.offY + h);
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
