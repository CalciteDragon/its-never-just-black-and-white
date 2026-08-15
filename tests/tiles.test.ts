import { describe, expect, it } from 'vitest';
import { TILE } from '../src/constants';
import { Tile, TileMap, toTile } from '../src/world/tiles';

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
