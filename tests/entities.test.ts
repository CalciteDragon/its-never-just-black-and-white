import { describe, expect, it } from 'vitest';
import { SLIME_SPEED, STEP, TILE } from '../src/constants';
import { ParticleSystem } from '../src/engine/particles';
import { Rng } from '../src/engine/rng';
import { coinAtTile } from '../src/entities/coin';
import { nullWorldParts } from '../src/entities/context';
import type { EntityWorld } from '../src/entities/context';
import { Door } from '../src/entities/door';
import { slimeAtTile } from '../src/entities/slime';
import { Torch } from '../src/entities/torch';
import { Tile, TileMap } from '../src/world/tiles';

function world(map: TileMap): EntityWorld {
  return { map, particles: new ParticleSystem(), rng: new Rng(7), ...nullWorldParts() };
}

/** Ledge: floor row 6 spans cols 2..12 only; walls at cols 0..1. */
function ledgeMap(): TileMap {
  const m = new TileMap(20, 10);
  m.fillRect(2, 6, 11, 1, Tile.Solid);
  m.fillRect(0, 0, 2, 10, Tile.Solid);
  return m;
}

describe('Slime', () => {
  it('patrols and turns at a ledge edge instead of walking off', () => {
    const m = ledgeMap();
    const w = world(m);
    const s = slimeAtTile(7, 5, new Rng(1));
    for (let i = 0; i < 60 * 8; i++) {
      s.update(STEP, w);
    }
    // Eight seconds is far longer than one ledge crossing: it must have turned.
    expect(s.body.x).toBeGreaterThan(2 * TILE - 2);
    expect(s.body.x + s.body.w).toBeLessThan(13 * TILE + 2);
    expect(s.alive).toBe(true);
    expect(Math.abs(s.body.vx)).toBeCloseTo(SLIME_SPEED, 3);
  });

  it('turns around at walls', () => {
    const m = ledgeMap();
    const w = world(m);
    const s = slimeAtTile(3, 5, new Rng(2)); // near the left wall
    let sawRightward = false;
    for (let i = 0; i < 60 * 4; i++) {
      s.update(STEP, w);
      if (s.body.vx > 0) {
        sawRightward = true;
      }
      expect(s.body.x).toBeGreaterThanOrEqual(2 * TILE - 1);
    }
    expect(sawRightward).toBe(true);
  });

  it('stomp kills it and emits a poof', () => {
    const m = ledgeMap();
    const w = world(m);
    const s = slimeAtTile(7, 5, new Rng(3));
    s.stomp(w);
    expect(s.alive).toBe(false);
    expect(w.particles.aliveCount).toBeGreaterThan(0);
    const count = w.particles.aliveCount;
    s.stomp(w); // idempotent
    expect(w.particles.aliveCount).toBe(count);
  });
});

describe('Coin', () => {
  it('detects pickup range from its center and collects once', () => {
    const m = ledgeMap();
    const w = world(m);
    const c = coinAtTile(5, 5);
    const cx = 5 * TILE + TILE / 2;
    const cy = 5 * TILE + TILE / 2;
    expect(c.inRange(cx + 8, cy)).toBe(true);
    expect(c.inRange(cx + 30, cy)).toBe(false);
    c.collect(w);
    expect(c.taken).toBe(true);
    const particles = w.particles.aliveCount;
    c.collect(w);
    expect(w.particles.aliveCount).toBe(particles);
  });
});

describe('Door', () => {
  it('covers a 16×32 area above its exit tile and detects overlap', () => {
    const d = new Door(10, 8);
    expect(d.x).toBe(10 * TILE);
    expect(d.y).toBe(7 * TILE);
    expect(d.overlaps({ x: 10 * TILE + 2, y: 8 * TILE - 5, w: 10, h: 13, vx: 0, vy: 0 })).toBe(
      true,
    );
    expect(d.overlaps({ x: 14 * TILE, y: 8 * TILE, w: 10, h: 13, vx: 0, vy: 0 })).toBe(false);
  });

  it('reports nearness for the open-glow', () => {
    const d = new Door(10, 8);
    expect(d.isNear(d.centerX + TILE, d.y + 16)).toBe(true);
    expect(d.isNear(d.centerX + TILE * 6, d.y + 16)).toBe(false);
  });
});

describe('Torch', () => {
  it('emits embers over time', () => {
    const m = ledgeMap();
    const w = world(m);
    const t = new Torch(5, 3);
    for (let i = 0; i < 60 * 3; i++) {
      t.update(STEP, w);
      w.particles.update(STEP);
    }
    // Ran for 3 s with ember intervals ≤ 0.9 s — something must be alive now.
    expect(w.particles.aliveCount).toBeGreaterThan(0);
  });
});
