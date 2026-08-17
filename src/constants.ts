/**
 * All global tuning constants live here, commented with units.
 * Values are the GAME-DESIGN §6 design targets; the phase that owns a block
 * appends it.
 */

/** Internal render resolution (px). The world renders at this size, then integer-scales up. */
export const VIEW_W = 960;
export const VIEW_H = 540;

/** Tile size (px). 960×540 is a 30 × 16.875 tile viewport. */
export const TILE = 32;

/** Fixed simulation timestep (seconds). */
export const STEP = 1 / 60;

// --- Player kinematics (GAME-DESIGN §6). Units: px, px/s, px/s², seconds. ---

/**
 * Player square edge (px). Its diagonal is 28.3 px in a 32 px gap — 3.7 px of
 * clearance at the worst angle. Hard ceiling is TILE/√2 = 22.6; above that,
 * one-tile gaps become angle-dependent and every level breaks.
 */
export const PLAYER_SIZE = 20;
/** Horizontal run speed (px/s) = 8 tiles/s. */
export const RUN_SPEED = 256;
/** Ground acceleration toward run speed (px/s²) — full speed in ~0.12 s. */
export const GROUND_ACCEL = 2100;
/** Air acceleration (px/s²) ≈ 62% of ground control. */
export const AIR_ACCEL = 1300;
/** Deceleration when no input is held on the ground (px/s²) — stop in ~0.07 s. */
export const GROUND_FRICTION = 3600;
/** Gravity while rising (px/s², along gravitySign). */
export const GRAVITY_RISE = 2200;
/** Gravity while falling (px/s²) — 1.6× heavier descending. */
export const GRAVITY_FALL = 3520;
/** Terminal fall speed (px/s) = 24 tiles/s. */
export const MAX_FALL_SPEED = 768;
/** Jump impulse (px/s, against gravity). Peak = v²/2g ≈ 3.48 tiles. */
export const JUMP_VELOCITY = 700;
/** Grace period after leaving a ledge during which jump still works (s). */
export const COYOTE_TIME = 0.09;
/** Early jump press is honored if landing within this window (s). */
export const JUMP_BUFFER = 0.12;
/** Releasing jump while rising multiplies vy by this, once. */
export const JUMP_CUT_FACTOR = 0.45;
/** Max movement per physics sub-step (px) — prevents tunneling. */
export const MAX_SUBSTEP = 8;

/**
 * Inset of the player's paper core from each edge (px), rotating with the body
 * (GAME-DESIGN §2). It is what keeps an ink square legible against ink geometry,
 * and the only visual tell of the body's angle.
 */
export const PLAYER_CORE_INSET = 5;

// --- Angular motion (GAME-DESIGN §6). Units: rad, rad/s, rad/s², 1/s. ---

/**
 * Moment of inertia of a square lamina of side `s` about its centre, at unit
 * mass. Exported as a function so PLAYER_INERTIA and the solver share one
 * derivation: a literal 66.7 could silently disagree with PLAYER_SIZE, and
 * every angular result in the game scales with that ratio.
 */
export function inertiaOfSquare(s: number): number {
  return (s * s) / 6;
}

/** Player moment of inertia = PLAYER_SIZE² / 6 ≈ 66.7 at unit mass. */
export const PLAYER_INERTIA = inertiaOfSquare(PLAYER_SIZE);

/**
 * A contact normal within ≈45° of "up" counts as ground. Tiles are axis-aligned
 * but the box is not: balanced on a corner, the box contacts along one of its
 * own face normals, up to 45° off vertical. Standing there is the moment the
 * game is showing off, so it counts.
 */
export const GROUND_NORMAL_DOT = 0.7;
/** Angular velocity imparted by a standing jump (rad/s). */
export const JUMP_SPIN_BASE = 2.5;
/** Extra jump spin per px/s of horizontal speed (rad/s per px/s). */
export const JUMP_SPIN_PER_SPEED = 0.014;
/** Angular velocity imparted by a flip (rad/s). Phase 5 spends it. */
export const FLIP_SPIN_KICK = 3.0;
/** Hard clamp on |angVel| (rad/s). */
export const MAX_ANG_SPEED = 14;
/** Exponential angular damping in flight (1/s) — light: a jump keeps its spin. */
export const ANG_DAMP_AIR = 0.4;
/** Exponential angular damping on a step that landed an impact (1/s). */
export const ANG_DAMP_GROUND = 8;
/** Restoring spring toward the nearest multiple of 90° (rad/s²). */
export const RIGHT_STIFFNESS = 240;
/** Spring damping (1/s) ≈ 2√RIGHT_STIFFNESS — critically damped, no overshoot. */
export const RIGHT_DAMPING = 31;
/**
 * Fraction of the physically exact collision torque actually applied. An
 * admitted cheat: exact torque whirls the square off every graze.
 */
export const SPIN_TRANSFER = 0.6;
/** No bounce. Impacts spin you; they never launch you. */
export const RESTITUTION = 0.0;

// --- Solver internals (world/physics.ts, PHASES phase 4). ---

/**
 * Residual penetration left by positional correction (px). Correcting to
 * exactly this makes rest a fixed point rather than an asymptote.
 */
export const CONTACT_SLOP = 0.01;
/**
 * Depth window (px) within which contact candidates count as tied and merge
 * into their centroid. At PLAYER_SIZE this is a tie band of
 * asin(0.25/20) = ±0.72° — below the settled angular residual, and far below
 * any tilt a player could see. It is what lets a flat square land flat: both
 * bottom corners tie, the contact point is the face centre, r × n is exactly
 * zero, and the landing produces no torque at all.
 */
export const CONTACT_TOL = 0.25;
/**
 * Tangential slack (px) on clipping contact candidates to the incident face.
 *
 * Distinct from CONTACT_TOL, and necessarily larger: that one is a depth band,
 * this one is a tangential one, and it is sized by how far a resting body sinks
 * into the floor before its contact is resolved — GRAVITY_FALL · STEP² / 2 =
 * 0.489 px, every step, forever. Deepest-first can evaluate a wall contact
 * while the box is down there, and the box's lower corner is then that far
 * below the bottom of the wall tile. Clipped strictly it is discarded, the wall
 * contact degenerates to the single upper corner, and walking into a wall
 * answers with 3.7 rad/s of spin conjured out of resting slop alone. Two steps'
 * worth, for margin; at 1 px on a 32 px tile the ledge cases are untouched.
 */
export const CLIP_TOL = GRAVITY_FALL * STEP * STEP + CONTACT_SLOP;
/**
 * Contact resolution passes per sub-step. Four is a natural cap once contacts
 * are merged into manifolds: there are only four tile-axis normals.
 */
export const MAX_CONTACT_ITERS = 4;
/**
 * Approach speed (px/s) above which a contact is a genuine impact rather than
 * resting or scraping. Twice the largest approach speed gravity alone can build
 * in one step, i.e. a 1.96 px drop. One threshold, two jobs: above it, impacts
 * own the spin and the auto-right spring is suppressed for that step; below it,
 * the contact is a linear stop only and the spring owns settling.
 *
 * A resting contact is still a contact — gravity re-penetrates a resting body
 * by 0.489 px every step — so "a contact resolved this step" is permanently
 * true on the ground and cannot be the discriminator.
 */
export const IMPACT_SPEED_MIN = 2 * GRAVITY_FALL * STEP;
/**
 * Angle error (rad) under which a grounded, near-still body snaps to its target
 * angle. At 0.002 rad a corner of the square moves 0.028 px, so the snap the
 * design otherwise forbids is a third of a pixel below visible.
 */
export const ANG_SETTLE_EPS = 0.002;
/** Angular speed (rad/s) under which that snap is allowed. */
export const ANG_SETTLE_VEL = 0.05;

// --- Camera (world/camera.ts). ---

/** Exponential follow rate (1/s): higher = tighter tracking. */
export const CAMERA_FOLLOW_RATE = 8;
/** Lookahead distance is vx × this (s) — the view leads where you're going. */
export const LOOKAHEAD_TIME = 0.35;
/** Cap on the lookahead offset (px). At RUN_SPEED the raw offset saturates. */
export const LOOKAHEAD_MAX = 96;
/**
 * Smoothing rate of the lookahead offset itself (1/s). Deliberately slower than
 * CAMERA_FOLLOW_RATE: a direction reversal is a 192 px swing in the target, and
 * lagging it is what turns a whip into a slide.
 */
export const LOOKAHEAD_RATE = 3;
/**
 * Allowed vertical overshoot past the map's top and bottom (px). Not a hard
 * clamp — gravity flips, so both edges are lethal, and the frame before an
 * out-of-bounds death has to stay legible instead of clipping off a pinned edge.
 */
export const CAMERA_VSLACK = 64;

// --- Feel & effects (GAME-DESIGN §6/§7). One speedNorm drives all of them. ---

/** Speed (px/s) that normalises to speedNorm 1.0 for every effect. */
export const SPEED_REF = 320;
/** Exponential lag on speedNorm (1/s) — one frame of wall contact can't strobe. */
export const SPEED_SMOOTH_RATE = 6;
/** speedNorm below which chromatic aberration is exactly zero. */
export const CA_THRESHOLD = 0.45;
/** Channel split at speedNorm 1 (px). */
export const CA_MAX_OFFSET = 3.0;
/** Vignette alpha at rest / at full speed. */
export const VIGNETTE_MIN = 0.15;
export const VIGNETTE_MAX = 0.55;
/** Fraction of the radius that stays fully clear at the gradient's centre. */
export const VIGNETTE_INNER = 0.45;
/** Peak alpha of the accent tint layered over the vignette at speedNorm 1. */
export const VIGNETTE_TINT_MAX = 0.22;
/** Screen bounce amplitude at full speed (px). */
export const BOUNCE_AMP = 2.5;
/** Screen bounce frequency at full speed (rad/s). */
export const BOUNCE_FREQ = 9.0;

// --- Jump pads, death and the goal (GAME-DESIGN §5/§6, PHASES phase 5). ---

/**
 * Jump pad launch speed (px/s). It OVERRIDES the relevant velocity component
 * rather than adding to it, so a pad's launch is the same however fast you
 * arrived. Up-pad peak = 820²/(2·GRAVITY_RISE) = 152.8 px = 4.78 tiles; airtime
 * 0.667 s, which carries 170.9 px = 5.34 tiles at RUN_SPEED — against the plain
 * jump's 4.56, so five tiles is the smallest gap that *requires* a pad.
 */
export const PAD_IMPULSE = 820;
/**
 * Angular velocity (rad/s) a pad imparts at a full-corner contact, scaled
 * linearly by the torque arm and clamped. It needs its own scale because the
 * physical impulse form saturates: SPIN_TRANSFER · PAD_IMPULSE · (r×n) /
 * PLAYER_INERTIA is 73.7 rad/s at a corner, five times MAX_ANG_SPEED, so every
 * off-centre hit more than ~2 px from centre would clamp and look identical.
 * The arm is measured from the BODY's centre, so a flat landing anywhere on a
 * pad gives exactly zero — "clip it with a corner and you leave spinning" is
 * then a real distinction rather than a constant tumble.
 */
export const PAD_SPIN_MAX = 8.0;
/** Death fade out, then back in after the respawn (s). */
export const DEATH_FADE_OUT = 0.35;
export const DEATH_FADE_IN = 0.25;

// --- Shell placeholders (scenes/play.ts). Phase 7's ResultsScene takes these
// with it; they are here so the numbers are not scattered through a scene. ---

/** How long the completion readout holds before the level advances (s). */
export const GOAL_HOLD = 1.2;
/**
 * Stroke width of the player's paper core when the flip is SPENT (px). The core
 * is PLAYER_SIZE − 2·PLAYER_CORE_INSET = 10 px square, so a 1 px outline is too
 * thin to read at speed; this is the charge tell and there is no HUD behind it.
 */
export const CORE_OUTLINE_WIDTH = 2;
/**
 * Pad chevron arm length and bar thickness (px). Two `paper` bars per pad,
 * drawn at ±135° from its facing. The width was set against a pad flush in a
 * floor row: the arms sit at 45°, so a 3 px bar antialiases almost entirely
 * into mid-grey and the chevron reads as a smudge rather than an arrow.
 */
export const PAD_CHEVRON_LEN = 14;
export const PAD_CHEVRON_WIDTH = 5;
/** Goal outline stroke (px), and the scale pulse it breathes with. */
export const GOAL_OUTLINE_WIDTH = 2;
export const GOAL_PULSE_AMP = 0.12;
export const GOAL_PULSE_FREQ = 3.0;
