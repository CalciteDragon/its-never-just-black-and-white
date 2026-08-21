import { describe, expect, it } from 'vitest';
import {
  OUT_OF_BOUNDS_DOT_ALPHA,
  OUT_OF_BOUNDS_DOT_SIZE,
  OUT_OF_BOUNDS_DOT_SPACING,
  VIEW_H,
  VIEW_W,
} from '../src/constants';
import { palette } from '../src/engine/palette';
import type { Renderer } from '../src/engine/renderer';
import { drawOutOfBounds } from '../src/scenes/tiledraw';
import { TileMap } from '../src/world/tiles';

interface Dot {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: string;
}

function record(map: TileMap, viewX: number, viewY: number): Dot[] {
  const dots: Dot[] = [];
  const r = {
    rect(x: number, y: number, w: number, h: number, color: string) {
      dots.push({ x, y, w, h, color });
    },
  } as unknown as Renderer;
  drawOutOfBounds(r, map, viewX, viewY);
  return dots;
}

describe('out-of-bounds pattern', () => {
  it('draws nothing while the whole view is inside a large level', () => {
    const map = new TileMap(60, 30);
    expect(record(map, 100, 100)).toEqual([]);
  });

  it('marks every exterior side of a small centred level and never its interior', () => {
    const map = new TileMap(5, 5);
    const viewX = (map.widthPx - VIEW_W) / 2;
    const viewY = (map.heightPx - VIEW_H) / 2;
    const dots = record(map, viewX, viewY);

    expect(dots.length).toBeGreaterThan(0);
    expect(dots.some((d) => d.x < 0 && d.y >= 0 && d.y < map.heightPx)).toBe(true);
    expect(dots.some((d) => d.x >= map.widthPx && d.y >= 0 && d.y < map.heightPx)).toBe(true);
    expect(dots.some((d) => d.y < 0)).toBe(true);
    expect(dots.some((d) => d.y >= map.heightPx)).toBe(true);
    for (const dot of dots) {
      expect(
        dot.x < 0 || dot.x >= map.widthPx || dot.y < 0 || dot.y >= map.heightPx,
      ).toBe(true);
      expect(dot.w).toBe(OUT_OF_BOUNDS_DOT_SIZE);
      expect(dot.h).toBe(OUT_OF_BOUNDS_DOT_SIZE);
      expect(dot.color).toBe(palette.inkRgba(OUT_OF_BOUNDS_DOT_ALPHA));
    }
  });

  it('anchors the staggered lattice in world space across camera movement', () => {
    const map = new TileMap(40, 30);
    const before = record(map, 0, -64);
    const after = record(map, 7, -57);
    const overlap = new Set(after.map((d) => `${d.x},${d.y}`));

    expect(before.some((d) => overlap.has(`${d.x},${d.y}`))).toBe(true);
    for (const dot of [...before, ...after]) {
      expect(Math.abs(dot.y % OUT_OF_BOUNDS_DOT_SPACING)).toBe(0);
      const row = dot.y / OUT_OF_BOUNDS_DOT_SPACING;
      const offset = Math.abs(row % 2) * (OUT_OF_BOUNDS_DOT_SPACING / 2);
      expect((dot.x - offset) % OUT_OF_BOUNDS_DOT_SPACING).toBe(0);
    }
  });

  it('follows the palette when gravity flips', () => {
    const map = new TileMap(40, 30);
    palette.reset();
    const phaseA = record(map, 0, -64);
    palette.flip();
    const phaseB = record(map, 0, -64);

    expect(phaseA[0].color).not.toBe(phaseB[0].color);
    expect(phaseB[0].color).toBe(palette.inkRgba(OUT_OF_BOUNDS_DOT_ALPHA));
    palette.reset();
  });
});
