/**
 * AABB body vs. TileMap collision. Axis-separated and sub-stepped (≤ MAX_SUBSTEP
 * px per axis per sub-step) so fast bodies never tunnel. Pure logic, node-safe.
 *
 * TEMPORARY. Phase 4 replaces this wholesale with the oriented-box SAT solver
 * from PHYSICS.md; it survives only so the game stays playable while the
 * renderer is being built. Nothing here knows about rotation.
 *
 * Conventions: body position is the top-left corner in px (floats). Gravity is
 * applied by callers via applyGravity, since the player controller owns the
 * jump-cut logic. Only Tile.Solid blocks.
 */

import { GRAVITY_FALL, GRAVITY_RISE, MAX_FALL_SPEED, MAX_SUBSTEP, TILE } from '../constants';
import { Tile, TileMap, toTile } from './tiles';

export interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
}

export interface MoveResult {
  /** Standing on solid ground after the move. */
  onGround: boolean;
  /** Blocked horizontally this move: -1 left, 1 right, 0 none. */
  hitWall: -1 | 0 | 1;
  hitCeiling: boolean;
  /** Went from airborne (downward motion) to grounded during this move. */
  landed: boolean;
}

/** Tiny separation kept between a resolved body and the blocking tile edge. */
const SKIN = 0.001;

/** Integrate gravity with the rise/fall split, capped at terminal velocity. */
export function applyGravity(b: Body, dt: number): void {
  const g = b.vy < 0 ? GRAVITY_RISE : GRAVITY_FALL;
  b.vy = Math.min(b.vy + g * dt, MAX_FALL_SPEED);
}

/** Inclusive tile row span covered by [top, bottom) in px. */
function rowSpan(top: number, bottom: number): [number, number] {
  return [toTile(top), toTile(bottom - SKIN)];
}

function colSpan(left: number, right: number): [number, number] {
  return [toTile(left), toTile(right - SKIN)];
}

/** Does any Solid tile intersect the body's row span at column tx? */
function solidInRows(map: TileMap, tx: number, y0: number, y1: number): boolean {
  for (let ty = y0; ty <= y1; ty++) {
    if (map.get(tx, ty) === Tile.Solid) {
      return true;
    }
  }
  return false;
}

/** Does any Solid tile intersect the body's column span at row ty? */
function solidInCols(map: TileMap, ty: number, x0: number, x1: number): boolean {
  for (let tx = x0; tx <= x1; tx++) {
    if (map.get(tx, ty) === Tile.Solid) {
      return true;
    }
  }
  return false;
}

/**
 * Move the body by vx/vy over dt, resolving against the map. Returns contact
 * flags. Velocity components are zeroed on the axes that hit.
 */
export function moveBody(b: Body, map: TileMap, dt: number): MoveResult {
  const result: MoveResult = { onGround: false, hitWall: 0, hitCeiling: false, landed: false };

  const dx = b.vx * dt;
  const dy = b.vy * dt;
  const wasFalling = b.vy > 0;
  // 'landed' means airborne → grounded, so remember how we started.
  const startedGrounded = isSupported(b, map);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_SUBSTEP));
  let sx = dx / steps;
  let sy = dy / steps;

  for (let i = 0; i < steps; i++) {
    // --- X axis ---
    if (sx !== 0) {
      b.x += sx;
      const [y0, y1] = rowSpan(b.y, b.y + b.h);
      if (sx > 0) {
        const edge = colSpan(b.x, b.x + b.w)[1];
        if (solidInRows(map, edge, y0, y1)) {
          b.x = edge * TILE - b.w - SKIN;
          b.vx = 0;
          sx = 0;
          result.hitWall = 1;
        }
      } else {
        const edge = colSpan(b.x, b.x + b.w)[0];
        if (solidInRows(map, edge, y0, y1)) {
          b.x = (edge + 1) * TILE + SKIN;
          b.vx = 0;
          sx = 0;
          result.hitWall = -1;
        }
      }
    }

    // --- Y axis ---
    if (sy !== 0) {
      b.y += sy;
      const [x0, x1] = colSpan(b.x, b.x + b.w);
      if (sy > 0) {
        const edge = rowSpan(b.y, b.y + b.h)[1];
        if (solidInCols(map, edge, x0, x1)) {
          b.y = edge * TILE - b.h - SKIN;
          b.vy = 0;
          sy = 0;
          result.onGround = true;
          if (wasFalling && !startedGrounded) {
            result.landed = true;
          }
        }
      } else {
        const edge = rowSpan(b.y, b.y + b.h)[0];
        if (solidInCols(map, edge, x0, x1)) {
          b.y = (edge + 1) * TILE + SKIN;
          b.vy = 0;
          sy = 0;
          result.hitCeiling = true;
        }
      }
    }

    if (sx === 0 && sy === 0) {
      break;
    }
  }

  if (!result.onGround) {
    result.onGround = isSupported(b, map);
  }
  return result;
}

/** Is the body resting on solid ground? */
export function isSupported(b: Body, map: TileMap): boolean {
  if (b.vy < 0) {
    return false;
  }
  const bottom = b.y + b.h;
  // Support only counts when the feet sit at (or within a hair of) a tile top.
  const ty = toTile(bottom + SKIN * 2);
  const distToRow = ty * TILE - bottom;
  if (distToRow > 0.01 || distToRow < -0.01) {
    return false;
  }
  const [x0, x1] = colSpan(b.x, b.x + b.w);
  return solidInCols(map, ty, x0, x1);
}
