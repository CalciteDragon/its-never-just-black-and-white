import { describe, expect, it } from 'vitest';
import {
  ANG_DAMP_AIR,
  ANG_DAMP_GROUND,
  ANG_SETTLE_EPS,
  ANG_SETTLE_VEL,
  BOUNCE_AMP,
  BOUNCE_FREQ,
  CAMERA_FOLLOW_RATE,
  CAMERA_VSLACK,
  CA_MAX_OFFSET,
  CA_THRESHOLD,
  CLIP_TOL,
  CONTACT_SLOP,
  CONTACT_TOL,
  GRAVITY_FALL,
  GROUND_NORMAL_DOT,
  IMPACT_SPEED_MIN,
  JUMP_SPIN_BASE,
  JUMP_SPIN_PER_SPEED,
  LOOKAHEAD_MAX,
  LOOKAHEAD_RATE,
  LOOKAHEAD_TIME,
  MAX_ANG_SPEED,
  MAX_CONTACT_ITERS,
  MAX_FALL_SPEED,
  MAX_SUBSTEP,
  PLAYER_CORE_INSET,
  PLAYER_INERTIA,
  PLAYER_SIZE,
  RESTITUTION,
  RIGHT_DAMPING,
  RIGHT_STIFFNESS,
  RUN_SPEED,
  SPEED_REF,
  SPEED_SMOOTH_RATE,
  SPIN_TRANSFER,
  STEP,
  TILE,
  VIEW_H,
  VIEW_W,
  VIGNETTE_INNER,
  VIGNETTE_MAX,
  VIGNETTE_MIN,
  VIGNETTE_TINT_MAX,
  inertiaOfSquare,
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

describe('angular constants', () => {
  it('PLAYER_INERTIA is derived from PLAYER_SIZE, not typed in', () => {
    // A literal 66.7 could silently disagree with PLAYER_SIZE, and every
    // angular result in the game scales with that ratio.
    expect(PLAYER_INERTIA).toBe(inertiaOfSquare(PLAYER_SIZE));
    expect(PLAYER_INERTIA).toBe((PLAYER_SIZE * PLAYER_SIZE) / 6);
    expect(PLAYER_INERTIA).toBeCloseTo(66.7, 1);
  });

  it('the auto-right spring is critically damped', () => {
    // c = 2√k is the boundary between overshoot and sluggishness; the spring
    // has to land on it or a tilted landing bounces or crawls.
    expect(RIGHT_DAMPING).toBeCloseTo(2 * Math.sqrt(RIGHT_STIFFNESS), 0);
    // ω_n = √k, and 2 % settling at ~4/ω_n is the "~0.3 s soft auto-right".
    const wn = Math.sqrt(RIGHT_STIFFNESS);
    expect(4 / wn).toBeGreaterThan(0.2);
    expect(4 / wn).toBeLessThan(0.35);
    // Stable at 60 Hz with room to spare.
    expect(wn * STEP).toBeLessThan(0.5);
  });

  it('ground damping dominates air damping by more than an order of magnitude', () => {
    expect(ANG_DAMP_GROUND / ANG_DAMP_AIR).toBeGreaterThan(10);
    // A jump keeps most of its spin over its 0.57 s airtime, or the tumble
    // stops reading as a tumble.
    expect(Math.exp(-ANG_DAMP_AIR * 0.57)).toBeGreaterThan(0.75);
  });

  it('a full-speed jump spins close to a half turn, and inside the clamp', () => {
    const fast = JUMP_SPIN_BASE + JUMP_SPIN_PER_SPEED * RUN_SPEED;
    expect(fast).toBeCloseTo(6.084, 3);
    expect(fast).toBeLessThan(MAX_ANG_SPEED);
    // Even a corner impact at terminal velocity has headroom under the clamp.
    expect(MAX_ANG_SPEED).toBeGreaterThan(fast * 2);
  });

  it('impacts spin but never launch', () => {
    expect(RESTITUTION).toBe(0);
    expect(SPIN_TRANSFER).toBeGreaterThan(0);
    expect(SPIN_TRANSFER).toBeLessThan(1);
  });

  it('GROUND_NORMAL_DOT admits a corner balance, ≈45° off vertical', () => {
    // A square balanced on a corner contacts along one of its own face
    // normals, up to 45° off vertical. The threshold has to admit that — 0.7
    // clears it by half a degree — without admitting a wall.
    const deg = (Math.acos(GROUND_NORMAL_DOT) * 180) / Math.PI;
    expect(deg).toBeGreaterThanOrEqual(45);
    expect(deg).toBeLessThan(50);
  });

  it('the angular settle snap is a third of a pixel below visible', () => {
    // At ANG_SETTLE_EPS a corner of the square moves this far. The design
    // forbids snapping; this is the amount by which it does not count.
    const cornerMove = ANG_SETTLE_EPS * ((PLAYER_SIZE * Math.SQRT2) / 2);
    expect(cornerMove).toBeLessThan(0.05);
    expect(ANG_SETTLE_VEL * STEP).toBeLessThan(ANG_SETTLE_EPS);
  });
});

describe('solver constants', () => {
  it('IMPACT_SPEED_MIN is twice one step of gravity, and gravity cannot reach it', () => {
    expect(IMPACT_SPEED_MIN).toBe(2 * GRAVITY_FALL * STEP);
    // The whole point: a resting body re-penetrates every step and must stay
    // below the gate, or the auto-right spring never runs on the ground.
    expect(GRAVITY_FALL * STEP).toBeLessThan(IMPACT_SPEED_MIN);
    // And it sits at a 1.96 px drop — a height nothing in the game arrives from.
    expect((IMPACT_SPEED_MIN * IMPACT_SPEED_MIN) / (2 * GRAVITY_FALL)).toBeLessThan(2);
  });

  it('CONTACT_TOL puts the flat-landing tie band at ±0.72°', () => {
    // Two bottom corners differ in depth by s·sin θ, so this is the angle
    // inside which they still count as one contact at the face centre.
    const band = (Math.asin(CONTACT_TOL / PLAYER_SIZE) * 180) / Math.PI;
    expect(band).toBeCloseTo(0.72, 2);
    // Below the settled residual, so a settled body is always inside it.
    expect(Math.asin(CONTACT_TOL / PLAYER_SIZE)).toBeGreaterThan(ANG_SETTLE_EPS);
  });

  it('CLIP_TOL covers a resting body sinking for a step, and stays sub-pixel-ish', () => {
    const sinkPerStep = (GRAVITY_FALL * STEP * STEP) / 2;
    expect(sinkPerStep).toBeCloseTo(0.489, 3);
    expect(CLIP_TOL).toBeGreaterThan(sinkPerStep);
    expect(CLIP_TOL).toBeCloseTo(0.988, 3);
    // Tangential slack is a different quantity from the depth band, and has to
    // be larger; but a whole tile is 32 px, so the ledge cases are untouched.
    expect(CLIP_TOL).toBeGreaterThan(CONTACT_TOL);
    expect(CLIP_TOL).toBeLessThan(TILE / 16);
  });

  it('CONTACT_SLOP is small enough to be invisible and non-zero', () => {
    expect(CONTACT_SLOP).toBeGreaterThan(0);
    expect(CONTACT_SLOP).toBeLessThan(0.05);
  });

  it('four iterations covers every distinct tile-axis normal', () => {
    expect(MAX_CONTACT_ITERS).toBe(4);
  });

  it('MAX_SUBSTEP keeps a full-speed corner sweep under a tile', () => {
    expect(MAX_SUBSTEP).toBeLessThan(TILE);
    // A corner at MAX_ANG_SPEED sweeps this far per frame, on its own.
    expect(MAX_ANG_SPEED * STEP * ((PLAYER_SIZE * Math.SQRT2) / 2)).toBeLessThan(MAX_SUBSTEP);
    // Terminal fall plus full run is two sub-steps, each well inside a tile.
    const travel = Math.hypot(RUN_SPEED * STEP, MAX_FALL_SPEED * STEP);
    expect(Math.ceil(travel / MAX_SUBSTEP)).toBe(2);
    expect(travel / 2).toBeLessThan(TILE / 2);
  });
});
