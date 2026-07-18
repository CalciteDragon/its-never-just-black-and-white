import { describe, expect, it } from 'vitest';
import {
  decodeGrid,
  PALETTE,
  PALETTE_CHARS,
  paletteIndex,
  SPRITE_NAMES,
  SPRITES,
} from '../src/engine/sprites';
import type { SpriteName } from '../src/engine/sprites';

describe('PALETTE', () => {
  it('matches the GAME-DESIGN §2 table exactly', () => {
    expect(PALETTE).toEqual({
      B: '#020617',
      K: '#0F172A',
      S: '#1E293B',
      s: '#475569',
      t: '#94A3B8',
      C: '#22D3EE',
      c: '#0E7490',
      O: '#FB923C',
      o: '#F59E0B',
      y: '#FDE68A',
      W: '#F1F5F9',
      R: '#EF4444',
      V: '#A78BFA',
      v: '#6D28D9',
    });
  });

  it('PALETTE_CHARS enumerates every palette char once', () => {
    expect(PALETTE_CHARS.split('').sort()).toEqual(Object.keys(PALETTE).sort());
    expect(new Set(PALETTE_CHARS).size).toBe(PALETTE_CHARS.length);
  });
});

describe('decodeGrid', () => {
  it('decodes a tiny fixture to exact palette indices', () => {
    const grid = decodeGrid(['B.', '.C']);
    expect(grid.w).toBe(2);
    expect(grid.h).toBe(2);
    expect(Array.from(grid.px)).toEqual([
      paletteIndex('B'),
      0,
      0,
      paletteIndex('C'),
    ]);
    expect(paletteIndex('B')).toBe(1); // first palette char, 0 = transparent
  });

  it('treats space like a dot (transparent)', () => {
    const grid = decodeGrid(['W ', ' W']);
    expect(Array.from(grid.px)).toEqual([paletteIndex('W'), 0, 0, paletteIndex('W')]);
  });

  it('throws on ragged rows', () => {
    expect(() => decodeGrid(['BB', 'B'])).toThrow(/ragged/);
  });

  it('throws on unknown chars and empty grids', () => {
    expect(() => decodeGrid(['BZ'])).toThrow(/unknown/);
    expect(() => decodeGrid([])).toThrow();
  });
});

describe('SPRITES', () => {
  const expectedSizes: Record<SpriteName, [number, number]> = {
    player1Idle: [12, 14],
    player1Run1: [12, 14],
    player1Run2: [12, 14],
    player1Jump: [12, 14],
    player2Idle: [12, 14],
    player2Run1: [12, 14],
    player2Run2: [12, 14],
    player2Jump: [12, 14],
    slime1: [14, 10],
    slime2: [14, 10],
    coin1: [8, 8],
    coin2: [8, 8],
    coin3: [8, 8],
    coin4: [8, 8],
    spike: [16, 8],
    doorClosed: [16, 32],
    doorOpen: [16, 32],
    torch1: [6, 12],
    torch2: [6, 12],
    heartFull: [9, 8],
    heartEmpty: [9, 8],
  };

  it('registry names match the expected set exactly', () => {
    expect([...SPRITE_NAMES].sort()).toEqual(Object.keys(expectedSizes).sort());
  });

  it('every sprite decodes at its contract dimensions', () => {
    for (const name of SPRITE_NAMES) {
      const grid = decodeGrid(SPRITES[name]);
      const [w, h] = expectedSizes[name];
      expect(grid.w, `${name} width`).toBe(w);
      expect(grid.h, `${name} height`).toBe(h);
    }
  });

  it('every non-transparent char of every sprite is in PALETTE', () => {
    for (const name of SPRITE_NAMES) {
      for (const row of SPRITES[name]) {
        for (const ch of row) {
          if (ch === '.' || ch === ' ') {
            continue;
          }
          expect(PALETTE[ch], `${name} uses unknown char '${ch}'`).toBeDefined();
        }
      }
    }
  });

  it('player sprites keep white eyes and player colors', () => {
    const p1 = SPRITES.player1Idle.join('\n');
    const p2 = SPRITES.player2Idle.join('\n');
    expect(p1).toContain('W');
    expect(p1).toContain('C');
    expect(p1).not.toContain('O');
    expect(p2).toContain('W');
    expect(p2).toContain('O');
    expect(p2).not.toContain('C');
  });

  it('slime frame 2 is squashed by one pixel (empty top row)', () => {
    expect(SPRITES.slime1[0]).not.toMatch(/^\.+$/);
    expect(SPRITES.slime2[0]).toMatch(/^\.+$/);
  });

  it('doors differ only in interior treatment; open door has a white slit', () => {
    expect(SPRITES.doorClosed.join('')).toContain('K');
    expect(SPRITES.doorOpen.join('')).toContain('W');
    expect(SPRITES.doorClosed.join('')).not.toContain('W');
  });
});
