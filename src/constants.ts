/**
 * All global tuning constants live here, commented with units.
 * Values are the GAME-DESIGN §6 design targets; the phase that owns a block
 * appends it. Angular constants arrive with the rigid-body solver (phase 4).
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
