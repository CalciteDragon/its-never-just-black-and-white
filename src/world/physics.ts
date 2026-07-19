/**
 * AABB body vs. TileMap collision. Axis-separated and sub-stepped (≤ MAX_SUBSTEP
 * px per axis per sub-step) so fast bodies never tunnel. Pure logic, node-safe.
 *
 * Conventions: body position is the top-left corner in px (floats). Gravity is
 * applied by callers via applyGravity (the player controller owns jump-cut
 * logic). One-way platforms block only downward motion, and only when the
 * body's bottom started at or above the platform top.
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
  /** Standing on ground (solid, or platform not being dropped through) after the move. */
  onGround: boolean;
  /** Blocked horizontally this move: -1 left, 1 right, 0 none. */
  hitWall: -1 | 0 | 1;
  hitCeiling: boolean;
  /** Went from airborne (downward motion) to grounded during this move. */
  landed: boolean;
}

export interface MoveOpts {
  /** Fall through one-way platforms (down+jump). */
  dropThrough?: boolean;
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

/**
 * Move the body by vx/vy over dt, resolving against the map. Returns contact
 * flags. Velocity components are zeroed on the axes that hit.
 */
export function moveBody(b: Body, map: TileMap, dt: number, opts?: MoveOpts): MoveResult {
  const drop = opts?.dropThrough === true;
  const result: MoveResult = { onGround: false, hitWall: 0, hitCeiling: false, landed: false };

  const dx = b.vx * dt;
  const dy = b.vy * dt;
  const wasFalling = b.vy > 0;
  // 'landed' means airborne → grounded, so remember how we started.
  const startedGrounded = isSupported(b, map, drop);
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
      const prevBottom = b.y + b.h;
      b.y += sy;
      const [x0, x1] = colSpan(b.x, b.x + b.w);
      if (sy > 0) {
        const edge = rowSpan(b.y, b.y + b.h)[1];
        let blocked = false;
        for (let tx = x0; tx <= x1; tx++) {
          const t = map.get(tx, edge);
          if (t === Tile.Solid) {
            blocked = true;
            break;
          }
          if (t === Tile.Platform && !drop && prevBottom <= edge * TILE + SKIN) {
            blocked = true;
            break;
          }
        }
        if (blocked) {
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
        let blocked = false;
        for (let tx = x0; tx <= x1; tx++) {
          if (map.get(tx, edge) === Tile.Solid) {
            blocked = true;
            break;
          }
        }
        if (blocked) {
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
    result.onGround = isSupported(b, map, drop);
  }
  return result;
}

/** Is the body standing on support (solid always; platform unless dropping)? */
export function isSupported(b: Body, map: TileMap, dropThrough = false): boolean {
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
  for (let tx = x0; tx <= x1; tx++) {
    const t = map.get(tx, ty);
    if (t === Tile.Solid || (t === Tile.Platform && !dropThrough)) {
      return true;
    }
  }
  return false;
}

/** Does the rect overlap any tile of the given type? (Bounding-box test.) */
export function rectOverlapsTile(
  map: TileMap,
  x: number,
  y: number,
  w: number,
  h: number,
  tile: Tile,
): boolean {
  const [x0, x1] = colSpan(x, x + w);
  const [y0, y1] = rowSpan(y, y + h);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (map.get(tx, ty) === tile) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Spike hurt-box: the bottom 7 px of a spike tile, inset 2 px on each side —
 * grazing the tile's edge pixels is forgiven (GAME-DESIGN §8/§9 fairness).
 */
export function rectOverlapsSpikes(
  map: TileMap,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const [x0, x1] = colSpan(x, x + w);
  const [y0, y1] = rowSpan(y, y + h);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (map.get(tx, ty) !== Tile.Spike) {
        continue;
      }
      const hx = tx * TILE + 2;
      const hy = ty * TILE + 9;
      const hw = TILE - 4;
      const hh = 7;
      if (x < hx + hw && x + w > hx && y < hy + hh && y + h > hy) {
        return true;
      }
    }
  }
  return false;
}
