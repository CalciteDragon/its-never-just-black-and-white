import { describe, expect, it } from 'vitest';
import {
  DUNGEON_H,
  generateDungeon,
  isSolvable,
  levelParams,
} from '../src/world/dungeon';
import type { Dungeon } from '../src/world/dungeon';
import { Tile } from '../src/world/tiles';

function entitySignature(d: Dungeon): string {
  return JSON.stringify({
    spawn: d.spawn,
    exit: d.exit,
    coins: d.coins,
    slimes: d.slimes,
    torches: d.torches,
  });
}

describe('levelParams', () => {
  it('matches the §8 difficulty table and clamps out-of-range levels', () => {
    expect(levelParams(1).widthTiles).toBe(120);
    expect(levelParams(2).widthTiles).toBe(150);
    expect(levelParams(3).widthTiles).toBe(180);
    expect(levelParams(0)).toEqual(levelParams(1));
    expect(levelParams(9)).toEqual(levelParams(3));
  });
});

describe('generateDungeon', () => {
  it('is fully deterministic: same seed ⇒ identical map bytes and entities', () => {
    for (const level of [1, 2, 3]) {
      const a = generateDungeon({ seed: 12345, level });
      const b = generateDungeon({ seed: 12345, level });
      expect(a.map.bytes()).toEqual(b.map.bytes());
      expect(entitySignature(a)).toBe(entitySignature(b));
    }
  });

  it('different seeds produce different dungeons', () => {
    const a = generateDungeon({ seed: 1, level: 2 });
    const b = generateDungeon({ seed: 2, level: 2 });
    expect(a.map.bytes()).not.toEqual(b.map.bytes());
  });

  it('every dungeon is solvable across seeds 1–40 × levels 1–3', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const level of [1, 2, 3]) {
        const d = generateDungeon({ seed, level });
        expect(isSolvable(d), `seed ${seed} level ${level}`).toBe(true);
      }
    }
  });

  it('seals the outer borders (sides and top; bottom gaps are pits)', () => {
    const d = generateDungeon({ seed: 7, level: 2 });
    for (let ty = 0; ty < d.map.h; ty++) {
      expect(d.map.get(0, ty)).toBe(Tile.Solid);
      expect(d.map.get(d.map.w - 1, ty)).toBe(Tile.Solid);
    }
    for (let tx = 0; tx < d.map.w; tx++) {
      expect(d.map.get(tx, 0)).toBe(Tile.Solid);
    }
  });

  it('spawn and exit stand on solid ground with clear headroom', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const d = generateDungeon({ seed, level: 1 });
      for (const p of [d.spawn, d.exit]) {
        expect(d.map.get(p.tx, p.ty)).toBe(Tile.Empty);
        expect(d.map.get(p.tx, p.ty - 1)).toBe(Tile.Empty);
        expect(d.map.get(p.tx, p.ty + 1)).toBe(Tile.Solid);
      }
    }
  });

  it('keeps spikes away from spawn and exit (≥ 3 columns)', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const d = generateDungeon({ seed, level: 3 });
      for (let ty = 0; ty < d.map.h; ty++) {
        for (let tx = 0; tx < d.map.w; tx++) {
          if (d.map.get(tx, ty) !== Tile.Spike) {
            continue;
          }
          expect(Math.abs(tx - d.spawn.tx)).toBeGreaterThanOrEqual(3);
          expect(Math.abs(tx - d.exit.tx)).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('places entities on empty tiles within bounds; slimes have ground below', () => {
    const d = generateDungeon({ seed: 11, level: 2 });
    for (const list of [d.coins, d.slimes, d.torches]) {
      for (const p of list) {
        expect(p.tx).toBeGreaterThan(0);
        expect(p.tx).toBeLessThan(d.map.w - 1);
        expect(p.ty).toBeGreaterThan(0);
        expect(p.ty).toBeLessThan(d.map.h);
        expect(d.map.get(p.tx, p.ty)).toBe(Tile.Empty);
      }
    }
    for (const s of d.slimes) {
      expect(d.map.get(s.tx, s.ty + 1)).toBe(Tile.Solid);
    }
  });

  it('provides a sensible number of coins and respects entity budgets', () => {
    for (const level of [1, 2, 3]) {
      const params = levelParams(level);
      const d = generateDungeon({ seed: 21, level });
      expect(d.coins.length).toBeGreaterThanOrEqual(10);
      expect(d.coins.length).toBeLessThanOrEqual(params.coins * 2);
      expect(d.slimes.length).toBeLessThanOrEqual(params.slimes);
      expect(d.torches.length).toBeGreaterThan(3);
    }
  });

  it('difficulty rises: level 3 has more spikes and slimes than level 1 on average', () => {
    let spikes1 = 0;
    let spikes3 = 0;
    let slimes1 = 0;
    let slimes3 = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const d1 = generateDungeon({ seed, level: 1 });
      const d3 = generateDungeon({ seed, level: 3 });
      for (let ty = 0; ty < DUNGEON_H; ty++) {
        for (let tx = 0; tx < d1.map.w; tx++) {
          if (d1.map.get(tx, ty) === Tile.Spike) {
            spikes1++;
          }
        }
        for (let tx = 0; tx < d3.map.w; tx++) {
          if (d3.map.get(tx, ty) === Tile.Spike) {
            spikes3++;
          }
        }
      }
      slimes1 += d1.slimes.length;
      slimes3 += d3.slimes.length;
    }
    expect(spikes3).toBeGreaterThan(spikes1);
    expect(slimes3).toBeGreaterThan(slimes1);
  });

  it('uses the level-scaled map width', () => {
    expect(generateDungeon({ seed: 5, level: 1 }).map.w).toBe(120);
    expect(generateDungeon({ seed: 5, level: 3 }).map.w).toBe(180);
  });
});
