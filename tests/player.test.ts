/**
 * Deliberately minimal, like the controller it covers. Phase 5 rewrites the
 * player against the finished design (flip, charge, pads, death); what is
 * asserted here is the platformer feel that carries over unchanged, plus the
 * two things phase 4 added — the centre origin and the jump's angular impulse.
 */

import { describe, expect, it } from 'vitest';
import {
  COYOTE_TIME,
  JUMP_SPIN_BASE,
  JUMP_SPIN_PER_SPEED,
  JUMP_VELOCITY,
  MAX_ANG_SPEED,
  PLAYER_SIZE,
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

/** 40×12 room with a floor at row 10. */
function room(): TileMap {
  const m = new TileMap(40, 12);
  m.fillRect(0, 10, 40, 2, Tile.Solid);
  return m;
}

function inp(partial: Partial<PlayerInputs>): PlayerInputs {
  return { ...NO_INPUTS, ...partial };
}

/** A player settled on the floor at `tx`. spawnAt takes the CENTRE. */
function grounded(map: TileMap, tx = 3): Player {
  const p = new Player(0, 0);
  p.spawnAt(tx * TILE + TILE / 2, 10 * TILE - PLAYER_SIZE / 2);
  const w = world(map);
  for (let i = 0; i < 10; i++) {
    p.update(STEP, NO_INPUTS, w);
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
    expect(p.body.vy).toBeLessThanOrEqual(-JUMP_VELOCITY + 80); // rising fast
    const vyAfterJump = p.body.vy;
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    expect(p.body.vy).toBeGreaterThan(vyAfterJump - 10); // no double jump boost
  });

  it('honors coyote time but not after it expires', () => {
    const m = room();
    const w = world(m);
    // Hoist high enough to stay airborne while the windows play out.
    const p = grounded(m);
    p.body.y -= 120;
    p.update(STEP, NO_INPUTS, w); // airborne, coyote starts draining
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    expect(p.body.vy).toBeLessThan(-JUMP_VELOCITY * 0.8); // coyote jump fired

    const q = grounded(m);
    q.body.y -= 120;
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
    const p = new Player(0, 0);
    // 16 px up: lands within the buffer window.
    p.spawnAt(3 * TILE + TILE / 2, 10 * TILE - PLAYER_SIZE / 2 - 16);
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

  it('is a PLAYER_SIZE square, centre-origin, that settles flush on the floor', () => {
    const m = room();
    const p = grounded(m);
    expect(p.body.size).toBe(PLAYER_SIZE);
    // x, y is the CENTRE now, so centerX/centerY are the body's own coords.
    expect(p.centerX).toBe(p.body.x);
    expect(p.centerY).toBe(p.body.y);
    expect(p.body.y + PLAYER_SIZE / 2).toBeCloseTo(10 * TILE, 1);
    expect(p.onGround).toBe(true);
    expect(p.body.angle).toBe(0);
  });
});

describe('the jump spin (decision 8)', () => {
  it('a standing jump rolls the square forward at JUMP_SPIN_BASE', () => {
    const m = room();
    const p = grounded(m);
    expect(p.body.angVel).toBe(0);
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), world(m));
    // Positive is clockwise on screen. Standing still there is no travel
    // direction to read, and the design still wants the turn, so it rolls right.
    expect(p.body.angVel).toBeGreaterThan(0);
    expect(p.body.angVel).toBeCloseTo(JUMP_SPIN_BASE * Math.exp(-0.4 * STEP), 4);
  });

  it('scales with speed and signs with travel direction', () => {
    const m = room();
    const w = world(m);
    const fast = grounded(m);
    for (let i = 0; i < 60; i++) {
      fast.update(STEP, inp({ right: true }), w);
    }
    fast.update(STEP, inp({ right: true, jumpPressed: true, jumpHeld: true }), w);
    const expected = JUMP_SPIN_BASE + JUMP_SPIN_PER_SPEED * RUN_SPEED;
    expect(expected).toBeCloseTo(6.084, 3);
    expect(fast.body.angVel).toBeGreaterThan(JUMP_SPIN_BASE);
    expect(fast.body.angVel).toBeCloseTo(expected * Math.exp(-0.4 * STEP), 3);

    // Column 20, or a 60-step run left ends jammed against the sealed map edge
    // and jumps at 35 px/s instead of run speed.
    const left = grounded(m, 20);
    for (let i = 0; i < 60; i++) {
      left.update(STEP, inp({ left: true }), w);
    }
    left.update(STEP, inp({ left: true, jumpPressed: true, jumpHeld: true }), w);
    expect(left.body.angVel).toBeCloseTo(-expected * Math.exp(-0.4 * STEP), 3);
  });

  it('never exceeds MAX_ANG_SPEED, however it is stacked', () => {
    const m = room();
    const p = grounded(m);
    p.body.angVel = MAX_ANG_SPEED;
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), world(m));
    expect(p.body.angVel).toBeLessThanOrEqual(MAX_ANG_SPEED);
  });

  it('lands tilted and settles itself, with no help from the controller', () => {
    const m = room();
    const w = world(m);
    const p = grounded(m);
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    for (let i = 0; i < 200; i++) {
      p.update(STEP, NO_INPUTS, w);
    }
    expect(p.onGround).toBe(true);
    // Settled to an exact multiple of 90°, dead still.
    expect(p.body.angVel).toBe(0);
    expect(Math.abs(p.body.angle % (Math.PI / 2))).toBeLessThan(1e-12);
    expect(p.body.vy).toBe(0);
  });
});
