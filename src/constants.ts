/**
 * All global tuning constants live here, commented with units.
 * Gameplay-feel constants are appended by the phase that owns them.
 */

/** Internal render resolution (px). The world renders at this size, then integer-scales up. */
export const VIEW_W = 480;
export const VIEW_H = 270;

/** Tile size (px). */
export const TILE = 16;

/** Fixed simulation timestep (seconds). */
export const STEP = 1 / 60;

// --- Player kinematics (GAME-DESIGN §5). Units: px, px/s, px/s², seconds. ---

/** Horizontal run speed (px/s) ≈ 7 tiles/s. */
export const RUN_SPEED = 112;
/** Ground acceleration toward run speed (px/s²) — full speed in ~0.12 s. */
export const GROUND_ACCEL = 900;
/** Air acceleration (px/s²) ≈ 60% of ground control. */
export const AIR_ACCEL = 540;
/** Deceleration when no input is held on the ground (px/s²). */
export const GROUND_FRICTION = 1800;
/** Upward gravity while rising (px/s²). */
export const GRAVITY_RISE = 1000;
/** Downward gravity while falling (px/s²) — 1.6× rise for a snappy arc. */
export const GRAVITY_FALL = 1600;
/** Terminal fall speed (px/s) = 22 tiles/s. */
export const MAX_FALL_SPEED = 352;
/** Initial jump impulse (px/s, upward). Peak = v²/2g ≈ 3.6 tiles. */
export const JUMP_VELOCITY = 340;
/** Grace period after leaving a ledge during which jump still works (s). */
export const COYOTE_TIME = 0.09;
/** Early jump press is honored if landing within this window (s). */
export const JUMP_BUFFER = 0.12;
/** Releasing jump while rising multiplies vy by this (variable jump height). */
export const JUMP_CUT_FACTOR = 0.45;
/** Player collision box (px); sprite is 12×14 with 1 px inset per side. */
export const PLAYER_BODY_W = 10;
export const PLAYER_BODY_H = 13;
/** Max movement per physics sub-step (px) — prevents tunneling. */
export const MAX_SUBSTEP = 4;

// --- Camera (world/camera.ts). ---

/** Exponential follow rate (1/s): higher = tighter tracking. */
export const CAMERA_FOLLOW_RATE = 8;
