/**
 * All global tuning constants live here, commented with units.
 * Values are the GAME-DESIGN §6 design targets; the phase that owns a block
 * appends it. Angular constants arrive with the rigid-body solver (phase 4),
 * feel/effect constants with the post-processing pass (phase 3).
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

// --- Camera (world/camera.ts). Lookahead and bounce arrive in phase 3. ---

/** Exponential follow rate (1/s): higher = tighter tracking. */
export const CAMERA_FOLLOW_RATE = 8;
