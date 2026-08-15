/**
 * Deliberately minimal. Phase 4 replaces the solver wholesale with the OBB/SAT
 * one, so these cover only "the temporary AABB solver still works" plus the
 * GAME-DESIGN §6 derived numbers, which outlive the implementation.
 */

import { describe, expect, it } from 'vitest';
import {
  GRAVITY_FALL,
  GRAVITY_RISE,
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  PLAYER_SIZE,
  RUN_SPEED,
  STEP,
  TILE,
} from '../src/constants';
import { applyGravity, isSupported, moveBody } from '../src/world/physics';
import type { Body } from '../src/world/physics';
import { Tile, TileMap } from '../src/world/tiles';

/** Build a map from ASCII art: '#' solid, '.' empty. */
function mapFrom(rows: string[]): TileMap {
  const m = new TileMap(rows[0].length, rows.length);
  rows.forEach((row, ty) => {
    for (let tx = 0; tx < row.length; tx++) {
      if (row[tx] === '#') {
        m.set(tx, ty, Tile.Solid);
      }
    }
  });
  return m;
}

function body(x: number, y: number, vx = 0, vy = 0): Body {
  return { x, y, w: PLAYER_SIZE, h: PLAYER_SIZE, vx, vy };
}

describe('moveBody', () => {
  const floor = mapFrom(['........', '........', '........', '........', '########']);

  it('lands flush on a floor and reports landed exactly once', () => {
    const b = body(2 * TILE, 10, 0, 0);
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
    const right = body(3 * TILE, 2 * TILE, 600, 0);
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

    const left = body(3 * TILE, 2 * TILE, -600, 0);
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
    const b = body(2 * TILE, 2 * TILE + 2, 0, -600);
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
    const b = body(2 * TILE, 0, 0, 4000); // 66 px per frame vs a 32 px tile
    for (let i = 0; i < 5; i++) {
      moveBody(b, floor, STEP);
    }
    expect(b.y + b.h).toBeCloseTo(4 * TILE, 1); // flush on top, never below
    expect(b.vy).toBe(0);
  });

  it('stops flush against an interior block and stays put once vx zeroes', () => {
    const walls = mapFrom(['#......#', '#..##..#', '#......#', '########']);
    const b = body(TILE + 1, TILE + 1, 800, 0); // row 1: runs into the block at col 3
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

describe('the open top and bottom', () => {
  it('falls straight out of the bottom of the map', () => {
    const m = mapFrom(['........', '........', '........']);
    const b = body(2 * TILE, 0, 0, 0);
    for (let i = 0; i < 60; i++) {
      applyGravity(b, STEP);
      moveBody(b, m, STEP);
    }
    expect(b.y).toBeGreaterThan(m.heightPx);
  });

  it('rises straight out of the top, even flush against a side wall', () => {
    const m = mapFrom(['........', '........', '........']);
    const b = body(0.5, 2 * TILE, 0, -JUMP_VELOCITY); // hugging the left wall
    for (let i = 0; i < 60; i++) {
      const r = moveBody(b, m, STEP);
      expect(r.hitCeiling).toBe(false);
    }
    expect(b.y + b.h).toBeLessThan(0);
  });
});

describe('support queries', () => {
  const floor = mapFrom(['........', '........', '########']);

  it('isSupported is true at rest on ground, false mid-air', () => {
    const grounded = body(TILE, 2 * TILE - PLAYER_SIZE, 0, 0);
    expect(isSupported(grounded, floor)).toBe(true);
    const airborne = body(TILE, 4, 0, 0);
    expect(isSupported(airborne, floor)).toBe(false);
  });
});

describe('gravity and the §6 derived targets', () => {
  it('applyGravity uses the rise/fall split and caps at terminal velocity', () => {
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

  it('fall gravity is 1.6× rise gravity; terminal is 24 tiles/s', () => {
    expect(GRAVITY_FALL / GRAVITY_RISE).toBeCloseTo(1.6, 6);
    expect(MAX_FALL_SPEED / TILE).toBe(24);
  });

  it('jump peak is 3.48 tiles', () => {
    const peakTiles = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY_RISE) / TILE;
    expect(peakTiles).toBeCloseTo(3.48, 2);
  });

  it('full-speed jump clearance is 4.56 tiles — 4-tile gaps only', () => {
    const riseT = JUMP_VELOCITY / GRAVITY_RISE;
    const peakPx = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY_RISE);
    const fallT = Math.sqrt((2 * peakPx) / GRAVITY_FALL);
    expect(riseT + fallT).toBeCloseTo(0.57, 2);
    const clearanceTiles = ((riseT + fallT) * RUN_SPEED) / TILE;
    expect(clearanceTiles).toBeCloseTo(4.56, 2);
    // A 5-tile gap must NOT be jumpable — those need a flip or a pad.
    expect(clearanceTiles).toBeLessThan(5);
  });

  /**
   * The apex undershoots the continuous solution by v₀·dt/2 ≈ 5.8 px (5.2 %),
   * because this solver integrates velocity before position. That is a property
   * of the temporary Euler step, not of the tuning — phase 4's sub-stepped
   * solver has to close it to meet its own ±5 % target.
   */
  it('the simulated apex matches the analytic peak within 6%', () => {
    const tall = new TileMap(8, 40);
    tall.fillRect(0, 39, 8, 1, Tile.Solid);
    const startY = 39 * TILE - PLAYER_SIZE;
    const b = body(2 * TILE, startY, 0, -JUMP_VELOCITY);
    let minY = b.y;
    for (let i = 0; i < 200; i++) {
      applyGravity(b, STEP);
      moveBody(b, tall, STEP);
      minY = Math.min(minY, b.y);
      if (b.vy > 0) {
        break;
      }
    }
    const simPeakPx = startY - minY;
    const analyticPx = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY_RISE);
    expect(analyticPx - simPeakPx).toBeCloseTo((JUMP_VELOCITY * STEP) / 2, 0);
    expect(Math.abs(simPeakPx - analyticPx) / analyticPx).toBeLessThan(0.06);
  });
});
