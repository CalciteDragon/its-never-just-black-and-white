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
