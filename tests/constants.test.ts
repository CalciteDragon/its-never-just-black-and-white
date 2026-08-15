import { describe, expect, it } from 'vitest';
import { PLAYER_SIZE, STEP, TILE, VIEW_H, VIEW_W } from '../src/constants';

describe('constants', () => {
  it('the viewport is 30 tiles wide (height is deliberately fractional)', () => {
    expect(VIEW_W).toBe(960);
    expect(VIEW_H).toBe(540);
    expect(VIEW_W / TILE).toBe(30);
    expect(VIEW_H / TILE).toBeCloseTo(16.875, 6);
  });

  it('simulation runs at 60 Hz', () => {
    expect(STEP).toBeCloseTo(1 / 60, 10);
  });

  it('the player fits a one-tile gap at every angle (GAME-DESIGN §5)', () => {
    // Above TILE/√2 the diagonal no longer clears, and every level breaks.
    expect(PLAYER_SIZE).toBeLessThanOrEqual(TILE / Math.SQRT2);
    // 3.7 px of clearance at the worst angle: tight, but never angle-dependent.
    expect(TILE - PLAYER_SIZE * Math.SQRT2).toBeGreaterThan(3.5);
  });
});
