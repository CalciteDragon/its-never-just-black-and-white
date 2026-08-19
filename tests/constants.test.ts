import { describe, expect, it } from 'vitest';
import { MAX_PARTICLES } from '../src/engine/particles';
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
  CORE_OUTLINE_WIDTH,
  DEATH_FADE_IN,
  DEATH_FADE_OUT,
  DUST_COUNT,
  EDITOR_DEFAULT_H,
  EDITOR_DEFAULT_W,
  EDITOR_GRID_ALPHA,
  EDITOR_MAX_H,
  EDITOR_MAX_W,
  EDITOR_PAN_SPEED,
  EDITOR_UNDO_MAX,
  EDITOR_ZOOM_STEPS,
  FLIP_RING_COUNT,
  FLIP_SPIN_KICK,
  GRAVITY_FALL,
  GRAVITY_RISE,
  GROUND_NORMAL_DOT,
  IMPACT_SPEED_MIN,
  JUMP_SPIN_BASE,
  JUMP_SPIN_PER_SPEED,
  JUMP_VELOCITY,
  LOOKAHEAD_MAX,
  LOOKAHEAD_RATE,
  LOOKAHEAD_TIME,
  MAX_ANG_SPEED,
  MAX_CONTACT_ITERS,
  JUMP_BURST_COUNT,
  MAX_FALL_SPEED,
  MAX_SUBSTEP,
  MUSIC_BAR,
  MUSIC_BAR_STEPS,
  MUSIC_FADE,
  MUSIC_GAIN_MAX,
  MUSIC_GAIN_MIN,
  MUSIC_GATE_ARP,
  MUSIC_GATE_BASS,
  MUSIC_GATE_EPS,
  MUSIC_GATE_HATS,
  MUSIC_LOOKAHEAD,
  MUSIC_PATTERN_STEPS,
  MUSIC_SIXTEENTH,
  PAD_IMPULSE,
  PAD_SPIN_MAX,
  PAD_STREAM_INTERVAL,
  PAD_STREAM_LIFE,
  PAD_STREAM_SPEED,
  PAUSE_DIM,
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
  SPLASH_COUNT_MAX,
  SPLASH_COUNT_MIN,
  STEP,
  STEP_SFX_DIST,
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

describe('the jump pad (phase 5)', () => {
  it('an up-pad out-climbs and out-flies the plain jump, by the design margins', () => {
    const padPeak = (PAD_IMPULSE * PAD_IMPULSE) / (2 * GRAVITY_RISE);
    const jumpPeak = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY_RISE);
    expect(padPeak).toBeCloseTo(152.8, 1);
    expect(padPeak / TILE).toBeCloseTo(4.78, 2);
    expect(jumpPeak / TILE).toBeCloseTo(3.48, 2);

    // Airtime is rise + fall, and the fall is 1.6× heavier so it is shorter.
    const rise = PAD_IMPULSE / GRAVITY_RISE;
    const fall = Math.sqrt((2 * padPeak) / GRAVITY_FALL);
    expect(rise).toBeCloseTo(0.373, 3);
    expect(fall).toBeCloseTo(0.295, 3);
    expect(rise + fall).toBeCloseTo(0.667, 3);
    expect((rise + fall) / STEP).toBeCloseTo(40.0, 1);

    // Five tiles is the smallest gap the plain jump cannot answer, which is
    // what the example stage's pad section is sized against.
    const padReach = (rise + fall) * RUN_SPEED;
    const jumpReach = (JUMP_VELOCITY / GRAVITY_RISE + Math.sqrt((2 * jumpPeak) / GRAVITY_FALL)) * RUN_SPEED;
    expect(padReach / TILE).toBeCloseTo(5.34, 2);
    expect(jumpReach / TILE).toBeCloseTo(4.56, 2);
    expect(jumpReach).toBeLessThan(5 * TILE);
    expect(padReach).toBeGreaterThan(5 * TILE);
  });

  it('a down-pad along gravity is a slam, not a launch — terminal velocity is terminal', () => {
    // Pointing WITH gravity the directional clamp catches it on the next step;
    // pointing against it, the full impulse survives. Not a bug to fix.
    expect(MAX_FALL_SPEED).toBeLessThan(PAD_IMPULSE);
    expect(MAX_FALL_SPEED / PAD_IMPULSE).toBeCloseTo(0.937, 3);
  });

  it('PAD_SPIN_MAX exists because the physical impulse form saturates', () => {
    // Reusing the solver's torque with j = PAD_IMPULSE at a full corner arm.
    // 73.8, not the brief's 73.7 — that number was taken against the rounded
    // 66.7 rather than PLAYER_INERTIA's exact 400/6. Same conclusion.
    const physical = (SPIN_TRANSFER * PAD_IMPULSE * (PLAYER_SIZE / 2)) / PLAYER_INERTIA;
    expect(physical).toBeCloseTo(73.8, 1);
    expect(physical).toBeGreaterThan(5 * MAX_ANG_SPEED);
    // Anything past ~2 px off centre would clamp, so every hit would look the
    // same. PAD_SPIN_MAX keeps the whole arm range distinguishable instead.
    expect((physical * 2) / (PLAYER_SIZE / 2)).toBeGreaterThan(MAX_ANG_SPEED);
    expect(PAD_SPIN_MAX).toBeLessThan(MAX_ANG_SPEED);

    // A full-corner pad hit turns the square ~268° over its own airtime —
    // three quarters of a turn, against 178° for a full-speed jump.
    const airtime = PAD_IMPULSE / GRAVITY_RISE + Math.sqrt(PAD_IMPULSE ** 2 / GRAVITY_RISE / GRAVITY_FALL);
    const turn = ((PAD_SPIN_MAX / ANG_DAMP_AIR) * (1 - Math.exp(-ANG_DAMP_AIR * airtime)) * 180) / Math.PI;
    expect(turn).toBeCloseTo(268, 0);
  });

  it("the flip's kick is a legible tilt across a ceiling crossing, not a tumble", () => {
    // 0.3 s is about what a ceiling crossing takes; the flip's drama is the
    // world inverting, not the square spinning.
    const cross = 0.3;
    const turn =
      ((FLIP_SPIN_KICK / ANG_DAMP_AIR) * (1 - Math.exp(-ANG_DAMP_AIR * cross)) * 180) / Math.PI;
    expect(turn).toBeCloseTo(49, 0);
  });

  it('the beat grid is 128 BPM in sixteenths, and the bar is NOT a whole frame count', () => {
    expect(MUSIC_SIXTEENTH).toBeCloseTo(0.1171875, 12);
    expect(MUSIC_BAR).toBeCloseTo(1.875, 12);
    expect(MUSIC_BAR_STEPS * MUSIC_SIXTEENTH).toBeCloseTo(MUSIC_BAR, 12);
    expect(MUSIC_PATTERN_STEPS).toBe(2 * MUSIC_BAR_STEPS); // the arp needs two
    // 7.03 frames to a sixteenth, 112.5 to a bar. The music runs on the audio
    // clock and the simulation on STEP; the two are unrelated ON PURPOSE, and a
    // bar that landed on a whole frame count would be an invitation to couple
    // them. Nothing in the simulation may ever read the music clock.
    expect(MUSIC_SIXTEENTH / STEP).toBeCloseTo(7.03125, 6);
    expect(Number.isInteger(MUSIC_BAR / STEP)).toBe(false);
  });

  it('the lookahead survives a five-frame hitch and sits under the frame clamp', () => {
    // THIS is the relation that forces the scheduler's resync rather than
    // merely recommending it: FixedStepper clamps a long frame to 250 ms, which
    // is 2.5x the window, so a stalled cursor can fall arbitrarily far behind.
    expect(MUSIC_LOOKAHEAD).toBeGreaterThanOrEqual(5 * STEP);
    expect(MUSIC_LOOKAHEAD).toBeLessThan(0.25);
    expect(0.25 / MUSIC_LOOKAHEAD).toBeCloseTo(2.5, 6);
    // A three-second stall is 25.6 sixteenths — what the naive loop would dump
    // into a single instant.
    expect(3 / MUSIC_SIXTEENTH).toBeCloseTo(25.6, 1);
    // The cross-fade is slower than the window, so no note can be scheduled
    // with a gain that is already stale by the time it sounds.
    expect(MUSIC_FADE).toBeGreaterThan(MUSIC_LOOKAHEAD);
    expect(STEP / MUSIC_FADE).toBeCloseTo(0.0476, 4);
  });

  it('the gates are ordered, distinct, and the master swells between them', () => {
    expect(MUSIC_GATE_HATS).toBeLessThan(MUSIC_GATE_BASS);
    expect(MUSIC_GATE_BASS).toBeLessThan(MUSIC_GATE_ARP);
    expect(MUSIC_GATE_ARP).toBeLessThan(1); // reachable — 0.7 is 224 px/s
    expect(MUSIC_GATE_ARP * SPEED_REF).toBeLessThan(RUN_SPEED);
    // The arp is the reward for moving faster than running: flat-out running is
    // 0.8, and terminal fall is what saturates the whole range.
    expect(RUN_SPEED / SPEED_REF).toBeCloseTo(0.8, 6);
    expect(MUSIC_GAIN_MIN).toBeLessThan(MUSIC_GAIN_MAX);
    expect(MUSIC_GAIN_MAX).toBeLessThan(1);
    // Well below any layer gain the scheduler would call audible.
    expect(MUSIC_GATE_EPS).toBeLessThan(0.05);
  });

  it('footfalls are five to the beat at RUN_SPEED — and only there', () => {
    // STEP_SFX_DIST is a DISTANCE, so the cadence scales with speed for free.
    // At flat-out running it lands 256/24 = 10.67 Hz against a 0.46875 s beat,
    // exactly 5.0: a quintuplet over a 4/4 grid. Any other speed phases against
    // the bed, which is the point — worth knowing before deciding it sounds
    // wrong.
    const beat = MUSIC_SIXTEENTH * 4;
    expect(beat).toBeCloseTo(0.46875, 12);
    expect((RUN_SPEED / STEP_SFX_DIST) * beat).toBeCloseTo(5, 6);
    // A stride is comfortably under a tile, so a footfall is a footfall and not
    // a punctuation mark.
    expect(STEP_SFX_DIST).toBeLessThan(TILE);
  });

  it('the pad stream travels under two tiles, and the pool has a 4x margin', () => {
    // 90 px/s for 0.45 s = 40.5 px = 1.27 tiles: it reads as an arrow leaving
    // the pad, not as a jet reaching the far wall.
    expect(PAD_STREAM_SPEED * PAD_STREAM_LIFE).toBeCloseTo(40.5, 6);
    expect((PAD_STREAM_SPEED * PAD_STREAM_LIFE) / TILE).toBeCloseTo(1.27, 2);
    expect(PAD_STREAM_SPEED * PAD_STREAM_LIFE).toBeLessThan(2 * TILE);

    // Predicted peak occupancy, and the whole basis of the drop-newest overflow
    // policy: a pool that starts evicting live sparks looks worse than one that
    // quietly emits fewer, and this says it never has to.
    const perPad = PAD_STREAM_LIFE / PAD_STREAM_INTERVAL;
    expect(perPad).toBeCloseTo(6.43, 2);
    const peak = perPad * 8 + SPLASH_COUNT_MAX + FLIP_RING_COUNT + JUMP_BURST_COUNT + 5 * DUST_COUNT;
    expect(peak).toBeLessThan(MAX_PARTICLES / 2);
    expect(MAX_PARTICLES / peak).toBeGreaterThan(4);
  });

  it('the splash ramp spans a landing worth the name to a terminal slam', () => {
    // Impulse is per unit mass with RESTITUTION 0, so it IS the approach speed:
    // the ramp's ends are the slowest contact that counts as an impact and the
    // fastest the game can produce.
    expect(SPLASH_COUNT_MIN).toBeLessThan(SPLASH_COUNT_MAX);
    expect(SPLASH_COUNT_MAX / SPLASH_COUNT_MIN).toBe(10);
    expect(IMPACT_SPEED_MIN).toBeLessThan(MAX_FALL_SPEED);
  });

  it('the charge tell and the fades are visible without being slow', () => {
    // The core is 10 px square; a 1 px outline is not readable at speed.
    expect(PLAYER_SIZE - 2 * PLAYER_CORE_INSET).toBe(10);
    expect(CORE_OUTLINE_WIDTH).toBeGreaterThan(1);
    expect(CORE_OUTLINE_WIDTH).toBeLessThan(PLAYER_SIZE / 2 - PLAYER_CORE_INSET);
    // Death is punctuation, not punishment: the whole round trip is under 1 s.
    expect(DEATH_FADE_OUT + DEATH_FADE_IN).toBeLessThan(1);
    expect(DEATH_FADE_OUT).toBeGreaterThan(DEATH_FADE_IN);
  });
});

describe('the editor block (phase 7)', () => {
  it('half zoom is exactly one screen per sixty tiles', () => {
    // Not one rung among many. 60 x 32 x 1/2 = 960 = VIEW_W, and the example
    // stage is 60 wide, so half zoom is precisely "one screen per sixty tiles".
    expect(EDITOR_ZOOM_STEPS).toEqual([0.25, 0.5, 1, 2, 4]);
    expect(60 * TILE * 0.5).toBe(VIEW_W);
    // At 1x the same level is two screens wide, which is the problem zoom exists
    // to answer -- and is why pan alone would not have been enough.
    expect((60 * TILE * 1) / VIEW_W).toBe(2);
  });

  it('the ladder ascends, in whole-pixel cells', () => {
    // A fractional cell seams between adjacent cells at every non-integer
    // scale, which is the exact problem the coordinate policy was written to
    // avoid. 8, 16, 32, 64, 128 px, and nothing between them.
    for (let i = 0; i < EDITOR_ZOOM_STEPS.length; i++) {
      const z = EDITOR_ZOOM_STEPS[i];
      expect(Number.isInteger(TILE * z)).toBe(true);
      expect(z).toBeGreaterThan(0);
      // Ascending, because `+` steps up the array and `-` steps down it: a
      // ladder out of order would put the two keys the wrong way round.
      if (i > 0) {
        expect(z).toBeGreaterThan(EDITOR_ZOOM_STEPS[i - 1]);
      }
    }
    // 1x and 2x are the two the range rule names by value, so they must exist.
    expect(EDITOR_ZOOM_STEPS).toContain(1);
    expect(EDITOR_ZOOM_STEPS).toContain(2);
  });

  it('a default grid fits the frame at half zoom, and the cap deliberately does not', () => {
    // The default is a level you can see all of while you learn the tool.
    expect(EDITOR_DEFAULT_W * TILE * 0.5).toBeLessThanOrEqual(VIEW_W);
    expect(EDITOR_DEFAULT_H * TILE * 0.5).toBeLessThanOrEqual(VIEW_H);
    expect(EDITOR_DEFAULT_W).toBeLessThan(EDITOR_MAX_W);
    expect(EDITOR_DEFAULT_H).toBeLessThan(EDITOR_MAX_H);
    // The cap is not a memory argument: 200 tiles is 3.3 screens even at half
    // zoom, and a level you cannot see a third of is one the tool has stopped
    // helping with.
    expect((EDITOR_MAX_W * TILE * 0.5) / VIEW_W).toBeCloseTo(3.33, 2);
  });

  it('the undo stack is bounded, and its worst case is kilobytes not megabytes', () => {
    // An unbounded stack is a leak nobody measures. A snapshot is one character
    // per cell; the ceiling is EDITOR_UNDO_MAX of them at the largest grid.
    expect(EDITOR_UNDO_MAX).toBe(64);
    const typicalChars = 60 * 20 * EDITOR_UNDO_MAX;
    const worstChars = EDITOR_MAX_W * EDITOR_MAX_H * EDITOR_UNDO_MAX;
    expect((typicalChars * 2) / 1024).toBeCloseTo(150, 0); // ~154 KB at 2 bytes/char
    expect((worstChars * 2) / (1024 * 1024)).toBeCloseTo(1.46, 1); // ~1.5 MB
  });

  it('the grid overlay and the pause dim are both legible, in opposite directions', () => {
    // The grid is an aid, not a texture: it has to be visible over paper and
    // invisible over a wall of ink.
    expect(EDITOR_GRID_ALPHA).toBeGreaterThan(0);
    expect(EDITOR_GRID_ALPHA).toBeLessThan(0.25);
    // The pause veil has the opposite job -- it is `paper` flooding back in over
    // the frame, and it must beat the strongest vignette the frame can already
    // be wearing or a pause at speed would not read as one, while still leaving
    // the frozen frame visible underneath.
    expect(PAUSE_DIM).toBeGreaterThan(VIGNETTE_MAX);
    expect(PAUSE_DIM).toBeLessThan(0.75);
  });

  it('the keyboard pan crosses a screen in a second and a half', () => {
    // Faster than running, because navigating a level you are building is not
    // the same act as playing it.
    expect(EDITOR_PAN_SPEED).toBeGreaterThan(RUN_SPEED);
    expect(VIEW_W / EDITOR_PAN_SPEED).toBeCloseTo(1.5, 2);
    expect(EDITOR_PAN_SPEED / TILE).toBe(20); // 20 tiles/s at 1x
  });
});
