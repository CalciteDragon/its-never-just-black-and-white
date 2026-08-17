import { describe, expect, it } from 'vitest';
import {
  CA_MAX_OFFSET,
  CA_THRESHOLD,
  VIGNETTE_MAX,
  VIGNETTE_MIN,
  VIGNETTE_TINT_MAX,
} from '../src/constants';
import { caOffset, computeScale, tintAmount, vignetteAlpha } from '../src/engine/renderer';

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
