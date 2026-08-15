import { describe, expect, it } from 'vitest';
import { computeScale } from '../src/engine/renderer';

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
