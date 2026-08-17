import { describe, expect, it } from 'vitest';
import { TILE } from '../src/constants';
import {
  PAD_TILES,
  Tile,
  TileMap,
  charFromTile,
  forEachRun,
  isBlocking,
  isPad,
  padDirection,
  tileFromChar,
  toTile,
} from '../src/world/tiles';

interface Run {
  tx: number;
  ty: number;
  len: number;
  tile: Tile;
}

/** Test-side collector. The production path allocates nothing; this doesn't. */
function collect(m: TileMap, tx0: number, ty0: number, tx1: number, ty1: number): Run[] {
  const runs: Run[] = [];
  forEachRun(m, tx0, ty0, tx1, ty1, (tx, ty, len, tile) => {
    runs.push({ tx, ty, len, tile });
  });
  return runs;
}

describe('TileMap', () => {
  it('constructs filled and supports get/set roundtrip', () => {
    const m = new TileMap(10, 8, Tile.Solid);
    expect(m.get(4, 4)).toBe(Tile.Solid);
    m.set(4, 4, Tile.Empty);
    expect(m.get(4, 4)).toBe(Tile.Empty);
    m.set(4, 4, Tile.PadUp);
    expect(m.get(4, 4)).toBe(Tile.PadUp);
    expect(m.isSolid(4, 4)).toBe(false); // a pad is not a wall
  });

  it('the tile enum is exactly the six chars of the level format', () => {
    expect(Tile.Empty).toBe(0);
    expect(Tile.Solid).toBe(1);
    expect(new Set([Tile.PadUp, Tile.PadDown, Tile.PadLeft, Tile.PadRight]).size).toBe(4);
  });

  it('seals the sides and opens the top and bottom', () => {
    const m = new TileMap(10, 8);
    expect(m.get(-1, 3)).toBe(Tile.Solid);
    expect(m.get(10, 3)).toBe(Tile.Solid);
    expect(m.get(3, -1)).toBe(Tile.Empty);
    expect(m.get(3, 8)).toBe(Tile.Empty);
  });

  it('the vertical check wins in the corners, so a wall-hugger still escapes', () => {
    // Both directions of OOB at once: vertical is evaluated first, so leaving
    // through the top while flush against a side wall reads Empty, not Solid.
    const m = new TileMap(10, 8);
    expect(m.get(-1, -1)).toBe(Tile.Empty);
    expect(m.get(10, -1)).toBe(Tile.Empty);
    expect(m.get(-1, 8)).toBe(Tile.Empty);
    expect(m.get(10, 99)).toBe(Tile.Empty);
  });

  it('ignores out-of-bounds writes and clips fillRect', () => {
    const m = new TileMap(4, 4);
    m.set(-1, 0, Tile.Solid);
    m.set(0, 99, Tile.Solid);
    m.fillRect(-2, -2, 100, 100, Tile.PadDown);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(m.get(x, y)).toBe(Tile.PadDown);
      }
    }
  });

  it('exposes px dimensions and converts px to tile coords', () => {
    const m = new TileMap(10, 8);
    expect(m.widthPx).toBe(10 * TILE);
    expect(m.heightPx).toBe(8 * TILE);
    expect(toTile(0)).toBe(0);
    expect(toTile(TILE - 0.01)).toBe(0);
    expect(toTile(TILE)).toBe(1);
  });

  it('bytes() returns an independent copy', () => {
    const m = new TileMap(3, 3);
    const b = m.bytes();
    m.set(1, 1, Tile.Solid);
    expect(b[4]).toBe(Tile.Empty);
    expect(m.bytes()[4]).toBe(Tile.Solid);
  });

  it('rejects degenerate sizes', () => {
    expect(() => new TileMap(0, 5)).toThrow();
    expect(() => new TileMap(5, -1)).toThrow();
  });
});

describe('forEachRun', () => {
  it('merges a 40-wide floor row into a single run', () => {
    const m = new TileMap(40, 4);
    m.fillRect(0, 3, 40, 1, Tile.Solid);
    const runs = collect(m, 0, 0, 39, 3);
    expect(runs).toEqual([{ tx: 0, ty: 3, len: 40, tile: Tile.Solid }]);
  });

  it('one gap in a floor makes two runs', () => {
    const m = new TileMap(40, 4);
    m.fillRect(0, 3, 40, 1, Tile.Solid);
    m.set(17, 3, Tile.Empty);
    const runs = collect(m, 0, 0, 39, 3);
    expect(runs).toEqual([
      { tx: 0, ty: 3, len: 17, tile: Tile.Solid },
      { tx: 18, ty: 3, len: 22, tile: Tile.Solid },
    ]);
  });

  it('a pad mid-floor splits it into three runs of two distinct values', () => {
    // Merging is over equal tile *values*, not over solidity — a pad must never
    // be swallowed into the floor rect or it would draw in the floor's colour.
    const m = new TileMap(40, 4);
    m.fillRect(0, 3, 40, 1, Tile.Solid);
    m.set(20, 3, Tile.PadUp);
    const runs = collect(m, 0, 0, 39, 3);
    expect(runs).toEqual([
      { tx: 0, ty: 3, len: 20, tile: Tile.Solid },
      { tx: 20, ty: 3, len: 1, tile: Tile.PadUp },
      { tx: 21, ty: 3, len: 19, tile: Tile.Solid },
    ]);
    expect(new Set(runs.map((r) => r.tile)).size).toBe(2);
  });

  it('merges adjacent pads of the same kind but not pads of different kinds', () => {
    const m = new TileMap(10, 2);
    m.fillRect(0, 1, 3, 1, Tile.PadUp);
    m.fillRect(3, 1, 2, 1, Tile.PadLeft);
    const runs = collect(m, 0, 0, 9, 1);
    expect(runs).toEqual([
      { tx: 0, ty: 1, len: 3, tile: Tile.PadUp },
      { tx: 3, ty: 1, len: 2, tile: Tile.PadLeft },
    ]);
  });

  it('clips runs to the requested window, not to the map', () => {
    // The whole point: a 40-tile floor seen through a 6-tile window must emit
    // 6 tiles of geometry, not 40. Off-screen rects are the churn we're avoiding.
    const m = new TileMap(40, 4);
    m.fillRect(0, 3, 40, 1, Tile.Solid);
    expect(collect(m, 5, 3, 10, 3)).toEqual([{ tx: 5, ty: 3, len: 6, tile: Tile.Solid }]);
  });

  it('clips the window to the map instead of manufacturing runs off the edge', () => {
    // TileMap.get returns Solid outside the left/right sides to seal the level.
    // Iterating that OOB region would invent phantom floor rects beside the map.
    const m = new TileMap(10, 4);
    m.fillRect(0, 3, 10, 1, Tile.Solid);
    expect(collect(m, -5, -5, 15, 15)).toEqual([{ tx: 0, ty: 3, len: 10, tile: Tile.Solid }]);
  });

  it('emits nothing for empty rows', () => {
    const m = new TileMap(8, 8);
    m.fillRect(0, 7, 8, 1, Tile.Solid);
    expect(collect(m, 0, 0, 7, 6)).toEqual([]);
  });

  it('emits a length-1 run for an isolated tile', () => {
    const m = new TileMap(8, 8);
    m.set(4, 2, Tile.Solid);
    expect(collect(m, 0, 0, 7, 7)).toEqual([{ tx: 4, ty: 2, len: 1, tile: Tile.Solid }]);
  });

  it('never merges vertically — runs are horizontal only', () => {
    const m = new TileMap(8, 8);
    m.fillRect(2, 2, 2, 2, Tile.Solid); // a 2x2 block is two rows, not one rect
    expect(collect(m, 0, 0, 7, 7)).toEqual([
      { tx: 2, ty: 2, len: 2, tile: Tile.Solid },
      { tx: 2, ty: 3, len: 2, tile: Tile.Solid },
    ]);
  });

  it('emits nothing for an inverted or off-map window', () => {
    const m = new TileMap(8, 8, Tile.Solid);
    expect(collect(m, 5, 0, 4, 7)).toEqual([]); // tx1 < tx0
    expect(collect(m, 0, 5, 7, 4)).toEqual([]); // ty1 < ty0
    expect(collect(m, 20, 0, 30, 7)).toEqual([]); // entirely right of the map
    expect(collect(m, -30, 0, -20, 7)).toEqual([]); // entirely left of the map
    expect(collect(m, 0, 20, 7, 30)).toEqual([]); // entirely below the map
  });

  it('visits rows top-to-bottom and runs left-to-right', () => {
    const m = new TileMap(6, 3);
    m.set(0, 0, Tile.Solid);
    m.set(4, 0, Tile.Solid);
    m.set(2, 2, Tile.Solid);
    expect(collect(m, 0, 0, 5, 2).map((r) => [r.tx, r.ty])).toEqual([
      [0, 0],
      [4, 0],
      [2, 2],
    ]);
  });

  it('passes plain numbers to the callback, allocating nothing per run', () => {
    // Callback-based on purpose: ~100 runs x 60 fps of throwaway objects is
    // churn for nothing. If a run ever arrives as an object, that's a regression.
    const m = new TileMap(20, 4);
    m.fillRect(0, 3, 20, 1, Tile.Solid);
    m.set(10, 3, Tile.Empty);
    let calls = 0;
    forEachRun(m, 0, 0, 19, 3, (tx, ty, len, tile) => {
      calls++;
      expect(typeof tx).toBe('number');
      expect(typeof ty).toBe('number');
      expect(typeof len).toBe('number');
      expect(typeof tile).toBe('number');
    });
    expect(calls).toBe(2);
  });

  it('handles a run that ends exactly on the window edge', () => {
    const m = new TileMap(10, 2);
    m.fillRect(3, 1, 4, 1, Tile.Solid); // tiles 3..6
    expect(collect(m, 0, 1, 6, 1)).toEqual([{ tx: 3, ty: 1, len: 4, tile: Tile.Solid }]);
    expect(collect(m, 6, 1, 9, 1)).toEqual([{ tx: 6, ty: 1, len: 1, tile: Tile.Solid }]);
  });
});

describe('the blocking predicate (decision 1)', () => {
  it('every tile but Empty is geometry the solver collides with', () => {
    // Pads have an off-centre contact torque and draw as an ink slab, so they
    // are tiles, not trigger volumes. Only Empty is not there.
    expect(isBlocking(Tile.Empty)).toBe(false);
    expect(isBlocking(Tile.Solid)).toBe(true);
    for (const t of PAD_TILES) {
      expect(isBlocking(t)).toBe(true);
    }
  });

  it('isPad separates pads from plain solid, which is what the recharge reads', () => {
    expect(isPad(Tile.Empty)).toBe(false);
    expect(isPad(Tile.Solid)).toBe(false);
    for (const t of PAD_TILES) {
      expect(isPad(t)).toBe(true);
    }
  });
});

describe('pad directions', () => {
  it('names the four facings as unit vectors in canvas orientation', () => {
    expect(padDirection(Tile.PadUp)).toEqual({ dx: 0, dy: -1 });
    expect(padDirection(Tile.PadDown)).toEqual({ dx: 0, dy: 1 });
    expect(padDirection(Tile.PadLeft)).toEqual({ dx: -1, dy: 0 });
    expect(padDirection(Tile.PadRight)).toEqual({ dx: 1, dy: 0 });
  });

  it('is null for anything that is not a pad', () => {
    expect(padDirection(Tile.Empty)).toBeNull();
    expect(padDirection(Tile.Solid)).toBeNull();
  });

  it('returns shared vectors, so reading one per contact allocates nothing', () => {
    expect(padDirection(Tile.PadUp)).toBe(padDirection(Tile.PadUp));
  });
});

describe('the char <-> tile mapping (GAME-DESIGN §8)', () => {
  it('maps the six grid characters both ways', () => {
    const pairs: readonly [string, Tile][] = [
      ['.', Tile.Empty],
      ['#', Tile.Solid],
      ['^', Tile.PadUp],
      ['v', Tile.PadDown],
      ['<', Tile.PadLeft],
      ['>', Tile.PadRight],
    ];
    for (const [ch, t] of pairs) {
      expect(tileFromChar(ch)).toBe(t);
      expect(charFromTile(t)).toBe(ch);
    }
  });

  it('does not know S or G — those are level metadata on an empty cell', () => {
    expect(tileFromChar('S')).toBeNull();
    expect(tileFromChar('G')).toBeNull();
    expect(tileFromChar('x')).toBeNull();
    expect(tileFromChar('')).toBeNull();
  });
});
