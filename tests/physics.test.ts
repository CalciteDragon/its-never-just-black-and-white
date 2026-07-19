import { describe, expect, it } from 'vitest';
import {
  GRAVITY_FALL,
  GRAVITY_RISE,
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  RUN_SPEED,
  STEP,
  TILE,
} from '../src/constants';
import {
  applyGravity,
  isSupported,
  moveBody,
  rectOverlapsSpikes,
  rectOverlapsTile,
} from '../src/world/physics';
import type { Body } from '../src/world/physics';
import { Tile, TileMap } from '../src/world/tiles';

/** Build a map from ASCII art: '#' solid, '=' platform, '^' spike, '.' empty. */
function mapFrom(rows: string[]): TileMap {
  const m = new TileMap(rows[0].length, rows.length);
  const lookup: Record<string, Tile> = { '#': Tile.Solid, '=': Tile.Platform, '^': Tile.Spike };
  rows.forEach((row, ty) => {
    for (let tx = 0; tx < row.length; tx++) {
      const t = lookup[row[tx]];
      if (t !== undefined) {
        m.set(tx, ty, t);
      }
    }
  });
  return m;
}

function body(x: number, y: number, vx = 0, vy = 0): Body {
  return { x, y, w: 10, h: 13, vx, vy };
}

describe('moveBody', () => {
  const floor = mapFrom(['........', '........', '........', '........', '########']);

  it('lands flush on a floor and reports landed exactly once', () => {
    const b = body(20, 10, 0, 0);
    let landedCount = 0;
    for (let i = 0; i < 120; i++) {
      applyGravity(b, STEP);
      const res = moveBody(b, floor, STEP);
      if (res.landed) {
        landedCount++;
      }
    }
    expect(landedCount).toBe(1);
    expect(b.vy).toBe(0);
    expect(b.y + b.h).toBeCloseTo(4 * TILE, 1);
    expect(moveBody(b, floor, STEP).onGround).toBe(true);
  });

  it('stops at walls with the correct hitWall sign and flush snap', () => {
    const walls = mapFrom(['#......#', '#......#', '#......#', '########']);
    const right = body(30, 2 * TILE, 300, 0);
    let hit: -1 | 0 | 1 = 0;
    for (let i = 0; i < 30; i++) {
      const r = moveBody(right, walls, STEP);
      if (r.hitWall !== 0) {
        hit = r.hitWall;
        break;
      }
    }
    expect(hit).toBe(1);
    expect(right.x + right.w).toBeCloseTo(7 * TILE, 1);
    expect(right.vx).toBe(0);

    const left = body(30, 2 * TILE, -300, 0);
    let hitL: -1 | 0 | 1 = 0;
    for (let i = 0; i < 30; i++) {
      const r = moveBody(left, walls, STEP);
      if (r.hitWall !== 0) {
        hitL = r.hitWall;
        break;
      }
    }
    expect(hitL).toBe(-1);
    expect(left.x).toBeCloseTo(TILE, 1);
  });

  it('bumps its head on a ceiling and zeroes vy', () => {
    const cave = mapFrom(['########', '........', '........', '########']);
    const b = body(20, 2 * TILE + 2, 0, -300);
    let bumped = false;
    for (let i = 0; i < 30; i++) {
      const r = moveBody(b, cave, STEP);
      if (r.hitCeiling) {
        bumped = true;
        break;
      }
    }
    expect(bumped).toBe(true);
    expect(b.vy).toBe(0);
    expect(b.y).toBeCloseTo(TILE, 1);
  });

  it('never tunnels through a thin floor at extreme speed', () => {
    const b = body(20, 0, 0, 2000); // 33 px per frame vs a 16 px tile
    for (let i = 0; i < 5; i++) {
      moveBody(b, floor, STEP);
    }
    expect(b.y + b.h).toBeCloseTo(4 * TILE, 1); // flush on top, never below
    expect(b.vy).toBe(0);
  });

  it('passes up through a platform, lands on it, and can drop through', () => {
    const plat = mapFrom(['........', '........', '..====..', '........', '########']);
    // Rising: no ceiling hit.
    const riser = body(36, 3 * TILE + 2, 0, -200);
    const rr = moveBody(riser, plat, STEP);
    expect(rr.hitCeiling).toBe(false);
    expect(riser.y).toBeLessThan(3 * TILE + 2);

    // Falling from above: lands on the platform surface.
    const faller = body(36, 2, 0, 0);
    for (let i = 0; i < 90; i++) {
      applyGravity(faller, STEP);
      moveBody(faller, plat, STEP);
    }
    expect(faller.y + faller.h).toBeCloseTo(2 * TILE, 1);

    // Drop through on request, then land on the real floor.
    for (let i = 0; i < 90; i++) {
      applyGravity(faller, STEP);
      moveBody(faller, plat, STEP, { dropThrough: true });
    }
    expect(faller.y + faller.h).toBeCloseTo(4 * TILE, 1);
  });

  it('stops flush against an interior block and stays put once vx zeroes', () => {
    const walls = mapFrom(['#......#', '#..##..#', '#......#', '########']);
    const b = body(17, TILE + 1, 400, 0); // row 1: runs into the block at col 3
    for (let i = 0; i < 10; i++) {
      moveBody(b, walls, STEP);
    }
    expect(b.x + b.w).toBeCloseTo(3 * TILE, 1);
    expect(b.vx).toBe(0);
    const xRest = b.x;
    moveBody(b, walls, STEP);
    expect(b.x).toBe(xRest);
  });
});

describe('support and overlap queries', () => {
  const floor = mapFrom(['........', '........', '########']);

  it('isSupported is true at rest on ground, false mid-air', () => {
    const grounded = body(10, 2 * TILE - 13, 0, 0);
    expect(isSupported(grounded, floor)).toBe(true);
    const airborne = body(10, 4, 0, 0);
    expect(isSupported(airborne, floor)).toBe(false);
  });

  it('rectOverlapsTile finds tile types in a rect', () => {
    const m = mapFrom(['........', '...^....', '########']);
    expect(rectOverlapsTile(m, 3 * TILE, TILE, 10, 10, Tile.Spike)).toBe(true);
    expect(rectOverlapsTile(m, 0, 0, 10, 10, Tile.Spike)).toBe(false);
  });

  it('spike hurt-box forgives the top half and the 2px side edges', () => {
    const m = mapFrom(['........', '...^....', '########']);
    const sx = 3 * TILE;
    const sy = TILE;
    // Feet resting just above the spike tile's midline: safe.
    expect(rectOverlapsSpikes(m, sx, sy - 13, 10, 13)).toBe(false);
    // Standing inside the lower half: hit.
    expect(rectOverlapsSpikes(m, sx + 3, sy + 10, 10, 6)).toBe(true);
    // Grazing the 2px left edge inset: safe.
    expect(rectOverlapsSpikes(m, sx - 8, sy + 10, 10, 6)).toBe(false);
  });
});

describe('gravity and §5 kinematic targets', () => {
  it('applyGravity uses rise/fall split and caps at terminal velocity', () => {
    const rising = body(0, 0, 0, -100);
    applyGravity(rising, 0.1);
    expect(rising.vy).toBeCloseTo(-100 + GRAVITY_RISE * 0.1, 5);
    const falling = body(0, 0, 0, 50);
    applyGravity(falling, 0.1);
    expect(falling.vy).toBeCloseTo(50 + GRAVITY_FALL * 0.1, 5);
    const terminal = body(0, 0, 0, MAX_FALL_SPEED - 1);
    applyGravity(terminal, 1);
    expect(terminal.vy).toBe(MAX_FALL_SPEED);
  });

  it('jump peak height is 3.2–4.0 tiles (analytic)', () => {
    const peak = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY_RISE) / TILE;
    expect(peak).toBeGreaterThanOrEqual(3.2);
    expect(peak).toBeLessThanOrEqual(4.0);
  });

  it('fall gravity is ~1.6× rise gravity; terminal ≈ 22 tiles/s', () => {
    const ratio = GRAVITY_FALL / GRAVITY_RISE;
    expect(ratio).toBeGreaterThanOrEqual(1.5);
    expect(ratio).toBeLessThanOrEqual(1.7);
    expect(MAX_FALL_SPEED / TILE).toBeGreaterThanOrEqual(20);
    expect(MAX_FALL_SPEED / TILE).toBeLessThanOrEqual(24);
  });

  it('full-speed jump clears at least 3.5 tiles horizontally (analytic)', () => {
    const riseT = JUMP_VELOCITY / GRAVITY_RISE;
    const peakPx = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY_RISE);
    const fallT = Math.sqrt((2 * peakPx) / GRAVITY_FALL);
    const clearanceTiles = ((riseT + fallT) * RUN_SPEED) / TILE;
    expect(clearanceTiles).toBeGreaterThanOrEqual(3.5);
  });

  it('simulated jump apex matches the analytic peak within 5%', () => {
    const tall = new TileMap(8, 40);
    tall.fillRect(0, 39, 8, 1, Tile.Solid);
    const b = body(20, 39 * TILE - 13, 0, -JUMP_VELOCITY);
    let minY = b.y;
    for (let i = 0; i < 200; i++) {
      applyGravity(b, STEP);
      moveBody(b, tall, STEP);
      minY = Math.min(minY, b.y);
      if (b.vy > 0) {
        break;
      }
    }
    const simPeakPx = 39 * TILE - 13 - minY;
    const analyticPx = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY_RISE);
    expect(Math.abs(simPeakPx - analyticPx) / analyticPx).toBeLessThan(0.05);
  });
});
