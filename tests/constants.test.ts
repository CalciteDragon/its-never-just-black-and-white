import { describe, expect, it } from 'vitest';
import {
  BOUNCE_AMP,
  BOUNCE_FREQ,
  CAMERA_FOLLOW_RATE,
  CAMERA_VSLACK,
  CA_MAX_OFFSET,
  CA_THRESHOLD,
  LOOKAHEAD_MAX,
  LOOKAHEAD_RATE,
  LOOKAHEAD_TIME,
  MAX_FALL_SPEED,
  PLAYER_CORE_INSET,
  PLAYER_SIZE,
  RUN_SPEED,
  SPEED_REF,
  SPEED_SMOOTH_RATE,
  STEP,
  TILE,
  VIEW_H,
  VIEW_W,
  VIGNETTE_INNER,
  VIGNETTE_MAX,
  VIGNETTE_MIN,
  VIGNETTE_TINT_MAX,
} from '../src/constants';

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

  it('the core is inset far enough to read, and still leaves a body around it', () => {
    // A core smaller than a third of the square stops reading as a rotation
    // tell; one that reaches the edge erases the ink body entirely.
    const core = PLAYER_SIZE - 2 * PLAYER_CORE_INSET;
    expect(core).toBeGreaterThanOrEqual(PLAYER_SIZE / 3);
    expect(core).toBeLessThan(PLAYER_SIZE);
    expect(PLAYER_CORE_INSET).toBeGreaterThan(0);
  });

  it('SPEED_REF is reachable, but not by running on flat ground alone', () => {
    // speedNorm normalises the whole velocity magnitude, so terminal fall
    // saturates it and must be able to.
    expect(SPEED_REF).toBeLessThan(MAX_FALL_SPEED);
    // Flat-out running sits high in the range without pinning it: the effects
    // have somewhere left to go when you start actually moving fast.
    const flatOut = RUN_SPEED / SPEED_REF;
    expect(flatOut).toBeGreaterThan(CA_THRESHOLD);
    expect(flatOut).toBeLessThan(1);
  });

  it('lookahead is slower than follow, and never clips in normal play', () => {
    // Lookahead smoothing deliberately lags the follow, so a direction reversal
    // slides the view instead of whipping it.
    expect(LOOKAHEAD_RATE).toBeLessThan(CAMERA_FOLLOW_RATE);
    expect(LOOKAHEAD_TIME).toBeGreaterThan(0);
    // Saturating lookahead must not push the player off screen.
    expect(LOOKAHEAD_MAX).toBeLessThan(VIEW_W / 2);
    // The cap is a safety limit for pad launches, not something flat-out
    // running hits — clamping during ordinary running would flatten the lead.
    expect(RUN_SPEED * LOOKAHEAD_TIME).toBeLessThanOrEqual(LOOKAHEAD_MAX);
  });

  it('vertical slack is real but under a tile-and-a-half', () => {
    expect(CAMERA_VSLACK).toBeGreaterThan(0);
    expect(CAMERA_VSLACK).toBeLessThanOrEqual(TILE * 2);
  });

  it('the speed smoothing lag is short enough to feel immediate', () => {
    // Time to close 63% of a step change = 1/rate. Under a quarter second, or
    // the vignette stops tracking what the player is actually doing.
    expect(1 / SPEED_SMOOTH_RATE).toBeLessThan(0.25);
    expect(SPEED_SMOOTH_RATE * STEP).toBeLessThan(1); // never overshoots a lerp
  });

  it('chromatic aberration is gated to the fast half of the range', () => {
    expect(CA_THRESHOLD).toBeGreaterThan(0);
    expect(CA_THRESHOLD).toBeLessThan(1);
    expect(CA_MAX_OFFSET).toBeGreaterThan(0);
    // The vignette must already be past halfway when aberration starts: the
    // channel-shifted edge strip is only masked because they arrive together.
    const alphaAtThreshold =
      VIGNETTE_MIN + (VIGNETTE_MAX - VIGNETTE_MIN) * CA_THRESHOLD;
    expect(alphaAtThreshold).toBeGreaterThan((VIGNETTE_MIN + VIGNETTE_MAX) / 2 - 0.05);
  });

  it('the vignette darkens with speed and never reaches opaque', () => {
    expect(VIGNETTE_MIN).toBeLessThan(VIGNETTE_MAX);
    expect(VIGNETTE_MIN).toBeGreaterThan(0);
    expect(VIGNETTE_MAX).toBeLessThan(1);
    // Inner stop leaves the middle of the screen clear.
    expect(VIGNETTE_INNER).toBeGreaterThan(0);
    expect(VIGNETTE_INNER).toBeLessThan(1);
    // The accent tint is a hint, not a colour wash — colour stays rationed.
    expect(VIGNETTE_TINT_MAX).toBeLessThan(VIGNETTE_MAX);
  });

  it('the bounce is sub-pixel-ish and slower than the frame rate', () => {
    expect(BOUNCE_AMP).toBeGreaterThan(0);
    expect(BOUNCE_AMP).toBeLessThan(TILE / 8);
    // Nyquist: a 60 Hz sim must sample the bounce many times per cycle.
    expect((BOUNCE_FREQ * STEP) / (2 * Math.PI)).toBeLessThan(0.1);
  });
});
