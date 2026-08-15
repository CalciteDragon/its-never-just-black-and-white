/**
 * Deliberately minimal, like the controller it covers. Phase 5 rewrites the
 * player against the rigid body (flip, charge, spin, pads, death); what is
 * asserted here is only the platformer feel that carries over unchanged.
 */

import { describe, expect, it } from 'vitest';
import { COYOTE_TIME, JUMP_VELOCITY, RUN_SPEED, STEP, TILE } from '../src/constants';
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

/** A player settled on the floor at tile column 3. */
function grounded(map: TileMap): Player {
  const p = new Player(0, 0);
  p.spawnAt(3 * TILE, 10 * TILE);
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
    p.spawnAt(3 * TILE, 10 * TILE - 16); // 16 px up: lands within the buffer
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

  it('is a PLAYER_SIZE square that settles flush on the floor', () => {
    const m = room();
    const p = grounded(m);
    expect(p.body.w).toBe(p.body.h);
    expect(p.body.y + p.body.h).toBeCloseTo(10 * TILE, 1);
    expect(p.onGround).toBe(true);
  });
});
