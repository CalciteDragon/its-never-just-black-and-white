import { describe, expect, it } from 'vitest';
import {
  COYOTE_TIME,
  HEART_MAX,
  INVULN_TIME,
  JUMP_VELOCITY,
  RUN_SPEED,
  STEP,
  TILE,
} from '../src/constants';
import { ParticleSystem } from '../src/engine/particles';
import { Rng } from '../src/engine/rng';
import { nullWorldParts } from '../src/entities/context';
import type { EntityWorld } from '../src/entities/context';
import { NO_INPUTS, Player } from '../src/entities/player';
import type { PlayerInputs } from '../src/entities/player';
import { Tile, TileMap } from '../src/world/tiles';

function world(map: TileMap): EntityWorld {
  return { map, particles: new ParticleSystem(), rng: new Rng(1), ...nullWorldParts() };
}

/** 40×12 room: floor at row 10, platform strip at row 6 (cols 10..20). */
function room(): TileMap {
  const m = new TileMap(40, 12);
  m.fillRect(0, 10, 40, 2, Tile.Solid);
  m.fillRect(10, 6, 11, 1, Tile.Platform);
  return m;
}

function inp(partial: Partial<PlayerInputs>): PlayerInputs {
  return { ...NO_INPUTS, ...partial };
}

/** New player standing on the floor (feet at row 10 top = y 160). */
function grounded(map: TileMap): Player {
  const p = new Player(0, 48, 10 * TILE - 13);
  const w = world(map);
  for (let i = 0; i < 10; i++) {
    p.update(STEP, NO_INPUTS, w); // settle onto the ground
  }
  return p;
}

describe('Player movement', () => {
  it('accelerates to run speed and stops with ground friction', () => {
    const m = room();
    const p = grounded(m);
    const w = world(m);
    for (let i = 0; i < 60; i++) {
      p.update(STEP, inp({ right: true }), w);
    }
    expect(p.body.vx).toBeCloseTo(RUN_SPEED, 3);
    expect(p.facing).toBe(1);
    for (let i = 0; i < 30; i++) {
      p.update(STEP, NO_INPUTS, w);
    }
    expect(p.body.vx).toBe(0);
  });

  it('jumps on press when grounded, not in mid-air', () => {
    const m = room();
    const p = grounded(m);
    const w = world(m);
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    expect(p.body.vy).toBeLessThanOrEqual(-JUMP_VELOCITY + 40); // rising fast
    const vyAfterJump = p.body.vy;
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    expect(p.body.vy).toBeGreaterThan(vyAfterJump - 10); // no double jump boost
  });

  it('honors coyote time but not after it expires', () => {
    const m = room();
    const w = world(m);
    // Hoist high enough to stay airborne while the windows play out.
    const p = grounded(m);
    p.body.y -= 60;
    p.update(STEP, NO_INPUTS, w); // airborne, coyote starts draining
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    expect(p.body.vy).toBeLessThan(-JUMP_VELOCITY * 0.8); // coyote jump fired

    const q = grounded(m);
    q.body.y -= 60;
    const drainSteps = Math.ceil((COYOTE_TIME + 0.05) / STEP);
    for (let i = 0; i < drainSteps; i++) {
      q.update(STEP, NO_INPUTS, w);
    }
    const vyBefore = q.body.vy;
    q.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    expect(q.body.vy).toBeGreaterThan(vyBefore); // still falling — no jump
  });

  it('buffers a jump pressed shortly before landing', () => {
    const m = room();
    const w = world(m);
    const p = new Player(0, 48, 10 * TILE - 13 - 8); // 8 px above: lands in ~0.1 s
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w); // press early
    let jumped = false;
    for (let i = 0; i < 30; i++) {
      p.update(STEP, inp({ jumpHeld: true }), w);
      if (p.body.vy < -JUMP_VELOCITY * 0.8) {
        jumped = true;
        break;
      }
    }
    expect(jumped).toBe(true);
  });

  it('cuts the jump short when the button releases mid-rise', () => {
    const m = room();
    const w = world(m);
    const full = grounded(m);
    full.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    const cut = grounded(m);
    cut.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    cut.update(STEP, inp({}), w); // release immediately
    expect(Math.abs(cut.body.vy)).toBeLessThan(Math.abs(full.body.vy));
  });

  it('drops through a platform with down+jump', () => {
    const m = room();
    const w = world(m);
    const p = new Player(0, 15 * TILE, 6 * TILE - 13);
    for (let i = 0; i < 10; i++) {
      p.update(STEP, NO_INPUTS, w); // settle on the platform
    }
    expect(p.body.y + p.body.h).toBeCloseTo(6 * TILE, 1);
    p.update(STEP, inp({ downHeld: true, jumpPressed: true, jumpHeld: true }), w);
    for (let i = 0; i < 90; i++) {
      p.update(STEP, NO_INPUTS, w);
    }
    expect(p.body.y + p.body.h).toBeCloseTo(10 * TILE, 1); // now on the floor
  });
});

describe('Player damage & lives', () => {
  it('takes damage with knockback and i-frames; second hit is ignored', () => {
    const m = room();
    const w = world(m);
    const p = grounded(m);
    expect(p.hurt(w, p.centerX + 5)).toBe(true); // hit from the right
    expect(p.hearts).toBe(HEART_MAX - 1);
    expect(p.body.vx).toBeLessThan(0); // knocked left
    expect(p.body.vy).toBeLessThan(0); // knocked up
    expect(p.invuln).toBeCloseTo(INVULN_TIME, 5);
    expect(p.hurt(w, 0)).toBe(false);
    expect(p.hearts).toBe(HEART_MAX - 1);
  });

  it('dies at zero hearts', () => {
    const m = room();
    const w = world(m);
    const p = grounded(m);
    p.hearts = 1;
    p.hurt(w, 0);
    expect(p.dead).toBe(true);
  });

  it('pit falls teleport back to the last safe ground and cost a heart', () => {
    const m = room();
    const w = world(m);
    const p = grounded(m);
    const safeX = p.body.x;
    const safeY = p.body.y;
    p.body.y = 600; // way below the map
    p.pitFall(w);
    expect(p.hearts).toBe(HEART_MAX - 1);
    expect(p.body.x).toBe(safeX);
    expect(p.body.y).toBe(safeY);
    expect(p.invuln).toBeGreaterThan(0);
  });

  it('co-op revive grants one heart and i-frames', () => {
    const m = room();
    const w = world(m);
    const p = grounded(m);
    p.hearts = 1;
    p.hurt(w, 0);
    expect(p.dead).toBe(true);
    p.reviveAt(64, 100);
    expect(p.dead).toBe(false);
    expect(p.hearts).toBe(1);
    expect(p.invuln).toBeGreaterThan(0);
    expect(p.body.x).toBe(64);
  });

  it('addHeart caps at HEART_MAX', () => {
    const m = room();
    const p = grounded(m);
    p.addHeart();
    expect(p.hearts).toBe(HEART_MAX);
  });
});
