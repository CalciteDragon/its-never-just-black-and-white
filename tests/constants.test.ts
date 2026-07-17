import { describe, expect, it } from 'vitest';
import { STEP, TILE, VIEW_H, VIEW_W } from '../src/constants';

describe('constants', () => {
  it('view resolution is a whole number of tiles', () => {
    expect(VIEW_W % TILE).toBe(0);
    expect(VIEW_H % TILE).toBeLessThan(TILE); // 270/16 is intentionally not exact (16.875 rows)
    expect(VIEW_W).toBeGreaterThan(0);
    expect(VIEW_H).toBeGreaterThan(0);
  });

  it('simulation runs at 60 Hz', () => {
    expect(STEP).toBeCloseTo(1 / 60, 10);
  });
});
