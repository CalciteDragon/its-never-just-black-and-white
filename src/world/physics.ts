/**
 * The rigid-body solver: an oriented square against a tilemap, sub-stepped,
 * SAT-resolved, impulse-answered. Pure logic, node-safe, deterministic — same
 * start state plus the same input sequence gives a bit-identical trajectory.
 *
 * LINEAR MOTION IS ARCADE, ANGULAR MOTION IS SIMULATED (hard rule 7). The
 * impulse runs in full so the spin it produces is the physically exact spin,
 * and then the velocity component into the surface is clamped dead. Spin
 * supplies all the drama and none of the frustration: it never decides where
 * you land, only how you look getting there. See docs/PHYSICS.md.
 *
 * The body's origin is its CENTRE, not its top-left corner.
 */

import {
  ANG_DAMP_AIR,
  ANG_DAMP_GROUND,
  ANG_SETTLE_EPS,
  ANG_SETTLE_VEL,
  CONTACT_SLOP,
  CONTACT_TOL,
  GRAVITY_FALL,
  GRAVITY_RISE,
  GROUND_NORMAL_DOT,
  IMPACT_SPEED_MIN,
  MAX_ANG_SPEED,
  MAX_CONTACT_ITERS,
  MAX_FALL_SPEED,
  MAX_SUBSTEP,
  RESTITUTION,
  RIGHT_DAMPING,
  RIGHT_STIFFNESS,
  SPIN_TRANSFER,
  TILE,
  inertiaOfSquare,
} from '../constants';
import {
  FACE_DOWN,
  FACE_LEFT,
  FACE_RIGHT,
  FACE_UP,
  contactCandidates,
  satOverlap,
} from './obb';
import type { Aabb, Obb, SatResult } from './obb';
import { Tile, isBlocking } from './tiles';
import type { TileMap } from './tiles';

const HALF_PI = Math.PI / 2;

/** Unit-mass oriented square. `x, y` is the CENTRE. */
export interface RigidBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radians. Positive rotates clockwise on screen, since y points down. */
  angle: number;
  /** rad/s. */
  angVel: number;
  /** Edge length (px). */
  size: number;
}

/**
 * A resolved contact, for effects that scale with how hard you hit — and for
 * the two questions the player asks that `grounded` alone cannot answer.
 */
export interface Contact {
  /** World-space contact point. */
  x: number;
  y: number;
  /** Unit normal, tile → box. */
  nx: number;
  ny: number;
  /** Normal impulse magnitude, per unit mass (px/s). */
  impulse: number;
  /**
   * The pad tile that produced this contact, or Tile.Empty for none.
   *
   * Pads are collidable geometry (decision 1), so landing on one IS a
   * ground-normal contact — and the flip's rules key off which TILE was
   * touched, not off the normal alone: a solid recharges only from a
   * ground-normal contact, a pad recharges from any contact at all, and only a
   * pad launches. `grounded` cannot answer any of that, so the contact carries
   * the tile. (The pad recharge was inverted after 0.2 playtesting; the reason
   * this field exists is unchanged, which is the point of it being a fact about
   * geometry rather than about the rule of the week.)
   */
  pad: Tile;
  /** Whether any plain Tile.Solid pooled into this contact. */
  onSolid: boolean;
}

export interface StepResult {
  /** A contact normal opposed gravity by more than GROUND_NORMAL_DOT. */
  grounded: boolean;
  /** A ground-normal contact arrived faster than IMPACT_SPEED_MIN this step. */
  landed: boolean;
  /** A contact normal pointed *along* gravity — head met ceiling. */
  hitCeiling: boolean;
  /**
   * FIXED-CAPACITY BUFFER, REUSED ACROSS CALLS. Valid only until the next
   * stepBody; copy anything you need to keep. One entry per distinct normal,
   * carrying the largest impulse seen on it this step.
   */
  contacts: readonly Contact[];
  contactCount: number;
}

export interface StepOptions {
  /** +1 = gravity pulls toward +y (down), −1 = toward −y. The flip negates it. */
  gravitySign: 1 | -1;
}

/** A body at rest, centred on (x, y). */
export function createBody(x: number, y: number, size: number): RigidBody {
  return { x, y, vx: 0, vy: 0, angle: 0, angVel: 0, size };
}

/** Signed error to the nearest multiple of 90°, in [−π/4, π/4]. */
export function rightAngleError(angle: number): number {
  return angle - Math.round(angle / HALF_PI) * HALF_PI;
}

/**
 * Sub-steps needed so nothing moves more than MAX_SUBSTEP px per sub-step,
 * linearly or arc-wise. `dx`/`dy` are the step's displacement, not velocity.
 *
 * The linear term is the magnitude, NOT the larger component: max-of-components
 * under-counts diagonal motion by up to √2. The rotational term rarely
 * dominates (14 rad/s sweeps a corner 3.3 px per frame) but costs nothing and
 * closes the case where a fast spin whips a corner through a thin wall.
 */
export function subStepCount(
  dx: number,
  dy: number,
  angVel: number,
  size: number,
  dt: number,
): number {
  const arc = Math.abs(angVel) * dt * size * Math.SQRT1_2;
  const linear = Math.hypot(dx, dy);
  return Math.max(1, Math.ceil(Math.max(linear, arc) / MAX_SUBSTEP));
}

// --- Scratch state. There is exactly one body in the game, so the solver is
// deliberately non-reentrant rather than allocating a manifold set per step. ---

const MAX_CONTACTS = 8;
const MAX_MANIFOLDS = 8;
/** 4 broadphase tiles × 4 candidate points, as (x, y, penetration) triples. */
const CAND_STRIDE = 3 * 16;

interface Manifold {
  nx: number;
  ny: number;
  depth: number;
  candCount: number;
  cand: number[];
  /** First pad tile pooled in, Tile.Empty for none. */
  pad: Tile;
  /** Whether any plain solid pooled in. Both bits are needed: a body straddling
   * a pad and the floor beside it must launch AND recharge. */
  onSolid: boolean;
}

const manifolds: Manifold[] = [];
for (let i = 0; i < MAX_MANIFOLDS; i++) {
  manifolds.push({
    nx: 0,
    ny: 0,
    depth: 0,
    candCount: 0,
    cand: new Array<number>(CAND_STRIDE).fill(0),
    pad: Tile.Empty,
    onSolid: false,
  });
}
const order: number[] = new Array<number>(MAX_MANIFOLDS).fill(0);
const contactPool: Contact[] = [];
for (let i = 0; i < MAX_CONTACTS; i++) {
  contactPool.push({ x: 0, y: 0, nx: 0, ny: 0, impulse: 0, pad: Tile.Empty, onSolid: false });
}

const result: StepResult = {
  grounded: false,
  landed: false,
  hitCeiling: false,
  contacts: contactPool,
  contactCount: 0,
};

const sat: SatResult = { nx: 0, ny: 0, depth: 0, tileAxis: true };
const tileBox: Aabb = { cx: 0, cy: 0, half: TILE / 2 };
const candScratch: number[] = new Array<number>(12).fill(0);

let manifoldCount = 0;
let impactThisStep = false;

/**
 * Advance one fixed step. Owns gravity (it needs the gravity sign and the
 * rise/fall split anyway), so callers no longer integrate it themselves.
 */
export function stepBody(
  body: RigidBody,
  map: TileMap,
  dt: number,
  opts: StepOptions,
): StepResult {
  const gs = opts.gravitySign;
  result.grounded = false;
  result.landed = false;
  result.hitCeiling = false;
  result.contactCount = 0;
  impactThisStep = false;

  // --- 1. Gravity, integrated in full; position drifts by the AVERAGE of the
  // pre- and post-gravity velocity. This is not interchangeable with the
  // half-gravity split: kick-drift-kick ends the step having just applied the
  // second half-kick, so a square sitting still on the floor would store
  // vy = GRAVITY_FALL · STEP / 2 = 29.3 px/s forever — speedNorm never falls
  // below 0.09 and nothing in the game ever reads as at rest. Averaging the
  // ACTUAL pair (rather than subtracting g·dt/2) is what keeps it correct at
  // terminal velocity, where the clamp would otherwise desynchronise the two.
  const vy0 = body.vy;
  const rising = body.vy * gs < 0;
  const g = rising ? GRAVITY_RISE : GRAVITY_FALL;
  let vy = body.vy + g * gs * dt;
  // Terminal speed is a limit on FALLING, not a symmetric clamp: a pad launch
  // is faster than terminal and must survive.
  if (vy * gs > MAX_FALL_SPEED) {
    vy = MAX_FALL_SPEED * gs;
  }
  body.vy = vy;
  let driftY = (vy0 + vy) / 2;

  // --- 2. Sub-step, off the real displacement so a clamped entry velocity
  // cannot smuggle a long advance past the anti-tunnelling cap.
  const n = subStepCount(body.vx * dt, driftY * dt, body.angVel, body.size, dt);
  const sdt = dt / n;

  for (let i = 0; i < n; i++) {
    // --- 3. Advance.
    body.x += body.vx * sdt;
    body.y += driftY * sdt;
    body.angle += body.angVel * sdt;

    // --- 4. Resolve, inside the loop. Sub-stepping with resolution outside it
    // is decorative: advancing the same distance in pieces with no test between
    // them lands in exactly the same place.
    if (resolveContacts(body, map, gs)) {
      driftY = body.vy;
    }
  }

  // --- 5. Damp and settle rotation.
  dampAndSettle(body, dt);
  return result;
}

/**
 * Up to MAX_CONTACT_ITERS passes of: collect manifolds, resolve deepest-first,
 * re-broadphase. Returns whether any contact was detected at all — the caller
 * uses that to stop drifting at the pre-collision velocity.
 *
 * Every ordering in here is pinned, and all of them are free if chosen
 * deliberately and unfindable if not: the broadphase iterates row-major,
 * manifolds resolve deepest first, and SAT breaks axis ties toward tile axes.
 */
function resolveContacts(body: RigidBody, map: TileMap, gs: 1 | -1): boolean {
  let touched = false;
  for (let iter = 0; iter < MAX_CONTACT_ITERS; iter++) {
    collectManifolds(body, map);
    if (manifoldCount === 0) {
      break;
    }
    touched = true;

    // Grounded is a property of the contact NORMALS, not a positional query:
    // "the floor" is whichever surface opposes gravity this instant, which is
    // the whole point of the flip. up = (0, −gravitySign).
    for (let i = 0; i < manifoldCount; i++) {
      const dot = -manifolds[i].ny * gs;
      if (dot > GROUND_NORMAL_DOT) {
        result.grounded = true;
      } else if (dot < -GROUND_NORMAL_DOT) {
        result.hitCeiling = true;
      }
    }

    // Deepest first, and only until one of them ACTS — then straight back to
    // the broadphase. Resolving several manifolds off one collection is what
    // turns an inside corner into an oscillator: the wall push moves the body
    // 5 px, and the floor contact behind it is then resolved against candidate
    // points from before the move, losing the corner that had strayed past the
    // floor tile's edge and answering with a single-corner torque. Manifolds
    // that decline to act have not moved anything, so the next one down is
    // still looking at fresh geometry and can be tried in the same pass.
    orderByDepth();
    let acted = false;
    for (let k = 0; k < manifoldCount; k++) {
      if (applyManifold(body, manifolds[order[k]], gs)) {
        acted = true;
        break;
      }
    }
    // Nothing left to correct and nothing left closing: further passes would
    // only re-find the SLOP residual, which is a fixed point by construction.
    if (!acted) {
      break;
    }
  }
  return touched;
}

/**
 * Broadphase over the tiles the box's AABB touches, narrowphase by SAT, then
 * merge by normal. Merging is what lets a flat square rest: straddling two
 * tiles, each contributes one bottom corner, and one impulse at their centroid
 * is a clean full stop instead of two single-corner impulses that between them
 * inject a permanent 250°/s roll.
 */
function collectManifolds(body: RigidBody, map: TileMap): void {
  manifoldCount = 0;
  const box: Obb = body;
  const c = Math.cos(body.angle);
  const s = Math.sin(body.angle);
  const h = (body.size / 2) * (Math.abs(c) + Math.abs(s));
  const tx0 = Math.floor((body.x - h) / TILE);
  const tx1 = Math.floor((body.x + h) / TILE);
  const ty0 = Math.floor((body.y - h) / TILE);
  const ty1 = Math.floor((body.y + h) / TILE);

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const tile = map.get(tx, ty);
      if (!isBlocking(tile)) {
        continue;
      }
      tileBox.cx = tx * TILE + TILE / 2;
      tileBox.cy = ty * TILE + TILE / 2;
      // A face buried against a neighbour is not a surface. Four cheap lookups
      // per tile turn a row of tiles into a floor instead of a row of blocks
      // with sideways-facing edges between them. OOB reads do the right thing
      // for free: the sealed sides mask their own outward faces, and the open
      // top and bottom leave theirs exposed.
      //
      // The neighbour test asks isBlocking, NOT `=== Tile.Solid`. That is the
      // second half of decision 1, and skipping it rebuilds phase 4's tile-seam
      // bug at every pad in the game: a pad set into a floor row would leave
      // its neighbours' faces toward it unmasked, so landing across the seam
      // finds a sideways cheapest-axis and shoves the body along the floor.
      // Measured at 8.32 rad/s before this line said isBlocking.
      let interior = 0;
      if (isBlocking(map.get(tx - 1, ty))) {
        interior |= FACE_LEFT;
      }
      if (isBlocking(map.get(tx + 1, ty))) {
        interior |= FACE_RIGHT;
      }
      if (isBlocking(map.get(tx, ty - 1))) {
        interior |= FACE_UP;
      }
      if (isBlocking(map.get(tx, ty + 1))) {
        interior |= FACE_DOWN;
      }
      if (!satOverlap(box, tileBox, sat, interior)) {
        continue;
      }
      const count = contactCandidates(
        box,
        tileBox,
        sat.nx,
        sat.ny,
        sat.tileAxis,
        candScratch,
      );
      if (count === 0) {
        continue;
      }
      addToManifold(count, tile);
    }
  }
}

/** Pool this tile's candidates into the manifold sharing its normal, or a new one. */
function addToManifold(count: number, tile: Tile): void {
  let m: Manifold | null = null;
  for (let i = 0; i < manifoldCount; i++) {
    const cand = manifolds[i];
    if (cand.nx * sat.nx + cand.ny * sat.ny > 0.9999) {
      m = cand;
      break;
    }
  }
  if (!m) {
    if (manifoldCount >= MAX_MANIFOLDS) {
      return;
    }
    m = manifolds[manifoldCount++];
    m.nx = sat.nx;
    m.ny = sat.ny;
    m.depth = 0;
    m.candCount = 0;
    m.pad = Tile.Empty;
    m.onSolid = false;
  }
  // Tile identity travels with the manifold, because the merge is where a pad
  // and the floor beside it stop being distinguishable by anything else.
  if (tile === Tile.Solid) {
    m.onSolid = true;
  } else if (m.pad === Tile.Empty) {
    m.pad = tile;
  }
  if (sat.depth > m.depth) {
    m.depth = sat.depth;
  }
  for (let i = 0; i < count && m.candCount * 3 + 2 < CAND_STRIDE; i++) {
    const base = m.candCount * 3;
    m.cand[base] = candScratch[i * 3];
    m.cand[base + 1] = candScratch[i * 3 + 1];
    m.cand[base + 2] = candScratch[i * 3 + 2];
    m.candCount++;
  }
}

/** Insertion sort of manifold indices by depth, descending. Stable, so ties keep row-major discovery order. */
function orderByDepth(): void {
  for (let i = 0; i < manifoldCount; i++) {
    let j = i;
    while (j > 0 && manifolds[order[j - 1]].depth < manifolds[i].depth) {
      order[j] = order[j - 1];
      j--;
    }
    order[j] = i;
  }
}

/**
 * Positional correction plus impulse response at the contact point. Returns
 * whether it actually did anything.
 */
function applyManifold(body: RigidBody, m: Manifold, gs: 1 | -1): boolean {
  // Contact point = centroid of every candidate within CONTACT_TOL of the
  // deepest, pooled across every tile in the manifold.
  let deepest = -Infinity;
  for (let i = 0; i < m.candCount; i++) {
    const pen = m.cand[i * 3 + 2];
    if (pen > deepest) {
      deepest = pen;
    }
  }
  let sx = 0;
  let sy = 0;
  let tied = 0;
  for (let i = 0; i < m.candCount; i++) {
    if (m.cand[i * 3 + 2] >= deepest - CONTACT_TOL) {
      sx += m.cand[i * 3];
      sy += m.cand[i * 3 + 1];
      tied++;
    }
  }
  if (tied === 0) {
    return false;
  }
  const px = sx / tied;
  const py = sy / tied;

  const rx = px - body.x;
  const ry = py - body.y;
  let acted = false;

  const corr = m.depth - CONTACT_SLOP;
  if (corr > 0) {
    body.x += m.nx * corr;
    body.y += m.ny * corr;
    acted = true;
  }

  // Velocity of the contact point: v + ω × r, with ω × r = ω·(−r_y, r_x).
  const vpx = body.vx - body.angVel * ry;
  const vpy = body.vy + body.angVel * rx;
  const vn = vpx * m.nx + vpy * m.ny;
  let j = 0;
  if (vn < 0) {
    const rxn = rx * m.ny - ry * m.nx;
    const inertia = inertiaOfSquare(body.size);
    j = (-(1 + RESTITUTION) * vn) / (1 + (rxn * rxn) / inertia);
    body.vx += j * m.nx;
    body.vy += j * m.ny;

    // Impact, not contact (see IMPACT_SPEED_MIN). A resting body re-penetrates
    // by 0.489 px every step, so "a contact happened" is permanently true on
    // the ground; only the approach speed separates arriving from resting. A
    // single-corner resting contact would otherwise inject 2.11 rad/s per step
    // — 2° in one frame, straight past flat and onto the other corner.
    if (-vn > IMPACT_SPEED_MIN) {
      body.angVel += (SPIN_TRANSFER * j * rxn) / inertia;
      clampSpin(body);
      impactThisStep = true;
      if (-m.ny * gs > GROUND_NORMAL_DOT) {
        result.landed = true;
      }
    }

    // THE ARCADE CLAMP — the seam between the two models, and the most
    // important line in the solver. A physically exact response leaves a
    // landing square still sinking: at a vertex contact the denominator is 2.5,
    // so one impulse kills only 40 % of the downward speed. The spin above is
    // the exact physical spin; the linear motion stops dead like a platformer.
    const vdn = body.vx * m.nx + body.vy * m.ny;
    if (vdn < 0) {
      body.vx -= vdn * m.nx;
      body.vy -= vdn * m.ny;
    }
    acted = true;
  }

  if (acted) {
    recordContact(px, py, m, j);
  }
  return acted;
}

/**
 * One entry per distinct normal, keeping the largest impulse seen on it — and
 * accumulating tile identity, since a normal can be re-resolved across
 * sub-steps and passes against a different tile each time.
 */
function recordContact(x: number, y: number, m: Manifold, impulse: number): void {
  for (let i = 0; i < result.contactCount; i++) {
    const c = contactPool[i];
    if (c.nx * m.nx + c.ny * m.ny > 0.9999) {
      c.x = x;
      c.y = y;
      if (impulse > c.impulse) {
        c.impulse = impulse;
      }
      if (c.pad === Tile.Empty) {
        c.pad = m.pad;
      }
      if (m.onSolid) {
        c.onSolid = true;
      }
      return;
    }
  }
  if (result.contactCount >= MAX_CONTACTS) {
    return;
  }
  const c = contactPool[result.contactCount++];
  c.x = x;
  c.y = y;
  c.nx = m.nx;
  c.ny = m.ny;
  c.impulse = impulse;
  c.pad = m.pad;
  c.onSolid = m.onSolid;
}

/**
 * Three mutually exclusive cases, then the settle snap.
 *
 * The impact gate is what makes this split honest: impacts own spin, the spring
 * owns settling. PHYSICS.md originally suppressed the spring whenever a contact
 * resolved, which on a resting body is every step — the spring would never have
 * run in the one place it exists to run.
 */
function dampAndSettle(body: RigidBody, dt: number): void {
  if (!result.grounded) {
    body.angVel *= Math.exp(-ANG_DAMP_AIR * dt);
  } else if (impactThisStep) {
    body.angVel *= Math.exp(-ANG_DAMP_GROUND * dt);
  } else {
    // Critically damped restoring spring toward the nearest multiple of 90°.
    // A square is visually identical at every multiple, so it is always the
    // short way round and never rotates more than 45°.
    const err = rightAngleError(body.angle);
    body.angVel += (-RIGHT_STIFFNESS * err - RIGHT_DAMPING * body.angVel) * dt;
  }
  clampSpin(body);

  // Positional rest is a fixed point, so it needs no sleep threshold; only ω is
  // asymptotic, approaching zero without reaching it and leaving a permanent
  // sub-pixel wobble with no exactly-still state to assert. Snap it.
  if (result.grounded) {
    const err = rightAngleError(body.angle);
    if (Math.abs(body.angVel) < ANG_SETTLE_VEL && Math.abs(err) < ANG_SETTLE_EPS) {
      body.angle -= err;
      body.angVel = 0;
    }
  }
}

function clampSpin(body: RigidBody): void {
  if (body.angVel > MAX_ANG_SPEED) {
    body.angVel = MAX_ANG_SPEED;
  } else if (body.angVel < -MAX_ANG_SPEED) {
    body.angVel = -MAX_ANG_SPEED;
  }
}
