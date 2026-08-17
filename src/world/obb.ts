/**
 * Oriented-box geometry against axis-aligned tiles. Pure, node-safe, and
 * completely ignorant of tilemaps — `physics.ts` owns that. Everything here is
 * allocation-free on the hot path: results are written into caller-supplied
 * buffers.
 *
 * THE CONVENTION THAT DECIDES EVERYTHING DOWNSTREAM: every normal produced here
 * points from the TILE toward the BOX. It is the push-out direction. Invert it
 * and the whole solver still runs, still looks plausible, and is wrong
 * everywhere — which is why it is stated on the module, on each function, and
 * asserted four ways in the tests.
 *
 * Square-only. The projection-radius shortcut r = (s/2)(|a·u| + |a·w|) depends
 * on the box being a square, and there is exactly one body in the game.
 */

import { CLIP_TOL } from '../constants';

/** An oriented square: centre (x, y), `angle` radians, edge `size` px. */
export interface Obb {
  x: number;
  y: number;
  angle: number;
  size: number;
}

/** An axis-aligned square tile: centre (cx, cy), half-edge `half` px. */
export interface Aabb {
  cx: number;
  cy: number;
  half: number;
}

export interface SatResult {
  /** Unit contact normal, tile → box. */
  nx: number;
  ny: number;
  /** Penetration depth along the normal (px, > 0). */
  depth: number;
  /**
   * True when the separating axis of minimum overlap was one of the tile's
   * axes, which decides which feature is incident: a tile axis means a box
   * VERTEX is deepest, a box axis means a tile CORNER is deepest. The second
   * case is the one that makes ledges feel real — it puts the contact point far
   * from the centre and generates the torque that spins you off.
   */
  tileAxis: boolean;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Bit flags marking a tile face as INTERIOR — buried against a neighbour, and
 * therefore not a surface anything can be pushed out of.
 *
 * Without this, a contiguous floor is not a floor: a square landing across a
 * tile seam barely overlaps the second tile horizontally, so that tile's
 * cheapest separating axis is sideways, and the landing answers with a shove
 * along the floor and ~9 rad/s of spin from a single-corner contact. The rule
 * that fixes it is exact rather than heuristic — if the neighbour in the push
 * direction is solid, the push moves the box INTO solid material, so the
 * contact is spurious and the neighbour owns the real one.
 */
export const FACE_LEFT = 1;
export const FACE_RIGHT = 2;
export const FACE_UP = 4;
export const FACE_DOWN = 8;

/**
 * Would pushing the box along (nx, ny) drive it into a neighbouring solid? The
 * dominant component of the normal decides; at exactly 45° both are checked,
 * which needs no threshold constant and no tie-break.
 */
export function faceBlocked(mask: number, nx: number, ny: number): boolean {
  if (mask === 0) {
    return false;
  }
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  if (ax >= ay && (mask & (nx < 0 ? FACE_LEFT : FACE_RIGHT)) !== 0) {
    return true;
  }
  if (ay >= ax && (mask & (ny < 0 ? FACE_UP : FACE_DOWN)) !== 0) {
    return true;
  }
  return false;
}

/**
 * The four corners of the box as x, y pairs, written into `out` (8 numbers) in
 * the order (−u−w), (+u−w), (+u+w), (−u+w) where u is the box's local x axis.
 */
export function vertices(box: Obb, out: number[] = []): number[] {
  const c = Math.cos(box.angle);
  const s = Math.sin(box.angle);
  const h = box.size / 2;
  // u = (c, s) scaled by h; w = (−s, c) scaled by h.
  const ux = c * h;
  const uy = s * h;
  const wx = -s * h;
  const wy = c * h;
  out[0] = box.x - ux - wx;
  out[1] = box.y - uy - wy;
  out[2] = box.x + ux - wx;
  out[3] = box.y + uy - wy;
  out[4] = box.x + ux + wx;
  out[5] = box.y + uy + wy;
  out[6] = box.x - ux + wx;
  out[7] = box.y - uy + wy;
  out.length = 8;
  return out;
}

/**
 * Half-extent of the box projected onto the unit axis (ax, ay). For a square
 * this collapses to (s/2)(|a·u| + |a·w|) — no vertex enumeration needed.
 */
export function projectRadius(box: Obb, ax: number, ay: number): number {
  const c = Math.cos(box.angle);
  const s = Math.sin(box.angle);
  return (box.size / 2) * (Math.abs(ax * c + ay * s) + Math.abs(-ax * s + ay * c));
}

/** Half-extent of an axis-aligned tile projected onto the unit axis (ax, ay). */
export function tileRadius(tile: Aabb, ax: number, ay: number): number {
  return tile.half * (Math.abs(ax) + Math.abs(ay));
}

/**
 * The box vertex deepest into the tile along the normal — the one minimising
 * v · n, since n points tile → box. Written into `out`.
 */
export function deepestVertex(box: Obb, nx: number, ny: number, out: Point): Point {
  vertices(box, vertScratch);
  let best = Infinity;
  for (let i = 0; i < 8; i += 2) {
    const p = vertScratch[i] * nx + vertScratch[i + 1] * ny;
    if (p < best) {
      best = p;
      out.x = vertScratch[i];
      out.y = vertScratch[i + 1];
    }
  }
  return out;
}

/** Reused by deepestVertex and contactCandidates; the module is single-threaded. */
const vertScratch: number[] = new Array<number>(8).fill(0);

/**
 * SAT over four axes: the tile's two, then the box's two. Writes the axis of
 * minimum overlap into `out` and returns whether the shapes overlap at all.
 *
 * Returning a boolean into a caller-supplied result rather than allocating
 * `{ hit, normal, depth } | null` keeps the hot path allocation-free, the same
 * reasoning that made `forEachRun` callback-based. (Amends GAME-DESIGN §12.)
 *
 * Tile axes are tested first and an axis is kept only on STRICT improvement, so
 * a tie goes to the tile axis. That is not a detail: a box lying flush on a
 * floor ties the tile's y axis against its own w axis, and resolving that as a
 * face contact rather than a degenerate box-axis one is what keeps the manifold
 * merge honest. It is also one of the orderings determinism rests on.
 *
 * `interiorFaces` removes push directions buried against a neighbouring solid
 * (see FACE_LEFT and friends). Overlap is still tested on all four axes — only
 * the choice of the *resolution* direction is restricted, so detection stays
 * exact. A tile with every face interior can be overlapped but not resolved
 * against, and reports false.
 */
export function satOverlap(
  box: Obb,
  tile: Aabb,
  out: SatResult,
  interiorFaces = 0,
): boolean {
  const dx = box.x - tile.cx;
  const dy = box.y - tile.cy;
  const c = Math.cos(box.angle);
  const s = Math.sin(box.angle);
  const h = box.size / 2;
  // For a square both tile axes see the same box radius, and both box axes see
  // the same tile radius; only the separations differ.
  const rBoxOnTileAxis = h * (Math.abs(c) + Math.abs(s));
  const rTileOnBoxAxis = tile.half * (Math.abs(c) + Math.abs(s));

  let best = Infinity;
  let bx = 0;
  let by = 0;
  let bestTileAxis = true;

  // Tile axes: (1, 0) then (0, 1).
  let overlap = rBoxOnTileAxis + tile.half - Math.abs(dx);
  if (overlap <= 0) {
    return false;
  }
  let nx = dx < 0 ? -1 : 1;
  if (!faceBlocked(interiorFaces, nx, 0)) {
    best = overlap;
    bx = nx;
    by = 0;
  }

  overlap = rBoxOnTileAxis + tile.half - Math.abs(dy);
  if (overlap <= 0) {
    return false;
  }
  let ny = dy < 0 ? -1 : 1;
  if (overlap < best && !faceBlocked(interiorFaces, 0, ny)) {
    best = overlap;
    bx = 0;
    by = ny;
  }

  // Box axes: u = (c, s) then w = (−s, c).
  let sep = dx * c + dy * s;
  overlap = h + rTileOnBoxAxis - Math.abs(sep);
  if (overlap <= 0) {
    return false;
  }
  let sign = sep < 0 ? -1 : 1;
  nx = c * sign;
  ny = s * sign;
  if (overlap < best && !faceBlocked(interiorFaces, nx, ny)) {
    best = overlap;
    bx = nx;
    by = ny;
    bestTileAxis = false;
  }

  sep = dx * -s + dy * c;
  overlap = h + rTileOnBoxAxis - Math.abs(sep);
  if (overlap <= 0) {
    return false;
  }
  sign = sep < 0 ? -1 : 1;
  nx = -s * sign;
  ny = c * sign;
  if (overlap < best && !faceBlocked(interiorFaces, nx, ny)) {
    best = overlap;
    bx = nx;
    by = ny;
    bestTileAxis = false;
  }

  if (best === Infinity) {
    return false;
  }
  out.nx = bx;
  out.ny = by;
  out.depth = best;
  out.tileAxis = bestTileAxis;
  return true;
}

/**
 * The incident contact feature: every candidate contact point for this one
 * tile, clipped to the incident face. Writes (x, y, penetration) triples into
 * `out` and returns the candidate count (0–4).
 *
 * Clipping is what makes a flat landing flat. The deepest-vertex rule alone
 * cannot rest a square: flush on a floor, both bottom corners tie at equal
 * depth, a tie-break picks one, and the resulting r × n = ∓s/2 injects torque
 * on every single resting step. Here both corners survive clipping, the caller
 * merges them into their centroid, r × n is exactly zero, and the impulse is a
 * clean full stop. Overhang a ledge and only the corner still over the tile is
 * a candidate, so the box tips off; tilt it and one vertex is clearly deepest,
 * so the corner physics is untouched.
 *
 * `pen` is a real penetration measured from the incident surface, so it stays
 * comparable across tiles and the caller can pool candidates from a whole
 * manifold before picking the tied set.
 *
 * The clip carries CONTACT_TOL of slack at each end, and it has to: a box
 * resting on a floor sits CONTACT_SLOP *inside* it, so its lower corner hangs
 * 0.01 px past the bottom of the wall tile beside it. Clipped strictly, that
 * corner vanishes, the wall contact becomes a single top-corner contact, and
 * running into a wall answers with 3.7 rad/s of spin out of nothing but
 * resting slop. The band is the same one the depth filter uses, for the same
 * reason — below it, two positions are the same position.
 */
export function contactCandidates(
  box: Obb,
  tile: Aabb,
  nx: number,
  ny: number,
  tileAxis: boolean,
  out: number[],
): number {
  // Tangent to the contact normal: the direction the incident face runs along.
  const tx = -ny;
  const ty = nx;
  let count = 0;

  if (tileAxis) {
    // A box vertex is deepest. Candidates are box vertices lying within the
    // tile's extent along the tangent; the tile's surface plane along n is at
    // tileCentre · n + half.
    const lo = tile.cx * tx + tile.cy * ty - tile.half - CLIP_TOL;
    const hi = lo + 2 * (tile.half + CLIP_TOL);
    const plane = tile.cx * nx + tile.cy * ny + tile.half;
    vertices(box, vertScratch);
    for (let i = 0; i < 8; i += 2) {
      const vx = vertScratch[i];
      const vy = vertScratch[i + 1];
      const t = vx * tx + vy * ty;
      if (t < lo || t > hi) {
        continue;
      }
      out[count * 3] = vx;
      out[count * 3 + 1] = vy;
      out[count * 3 + 2] = plane - (vx * nx + vy * ny);
      count++;
    }
  } else {
    // A tile corner is deepest. Candidates are tile corners lying within the
    // box face's extent along the tangent; the box's face plane along n is at
    // boxCentre · n − size/2 (n is a box axis, so its radius is exactly s/2).
    const h = box.size / 2;
    const lo = box.x * tx + box.y * ty - h - CLIP_TOL;
    const hi = lo + box.size + 2 * CLIP_TOL;
    const plane = box.x * nx + box.y * ny - h;
    for (let i = 0; i < 4; i++) {
      const cx = tile.cx + (i === 1 || i === 2 ? tile.half : -tile.half);
      const cy = tile.cy + (i >= 2 ? tile.half : -tile.half);
      const t = cx * tx + cy * ty;
      if (t < lo || t > hi) {
        continue;
      }
      out[count * 3] = cx;
      out[count * 3 + 1] = cy;
      out[count * 3 + 2] = cx * nx + cy * ny - plane;
      count++;
    }
  }
  return count;
}
