/**
 * The tile grid. Pure logic, node-safe — tile *rendering* lives in the scene
 * layer now (phase 3 draws row-merged runs; nothing here knows about a canvas).
 *
 * Out-of-bounds semantics (GAME-DESIGN §8): the left and right edges read as
 * Solid so the sides seal the level; above the top row and below the bottom row
 * read as Empty, because gravity flips and leaving through the ceiling has to
 * be as lethal as falling out the floor.
 */

import { TILE } from '../constants';

export enum Tile {
  Empty = 0,
  Solid = 1,
  PadUp = 2,
  PadDown = 3,
  PadLeft = 4,
  PadRight = 5,
}

/** The four pad tiles, in enum order. */
export const PAD_TILES: readonly Tile[] = [Tile.PadUp, Tile.PadDown, Tile.PadLeft, Tile.PadRight];

/**
 * Is this tile geometry the solver collides with?
 *
 * Pads are, and that is the whole of decision 1: GAME-DESIGN §5 gives them an
 * off-centre contact torque and §2 draws them as an `ink` slab, and both need a
 * real contact point. A pad is a tile, not a trigger volume. The predicate has
 * to reach the interior-face test in the broadphase as well as the collision
 * test — masking only one of the two rebuilds phase 4's tile-seam bug at every
 * pad in the game.
 */
export function isBlocking(t: Tile): boolean {
  return t !== Tile.Empty;
}

/** Is this tile a jump pad? Separate from isBlocking: the flip's recharge reads it. */
export function isPad(t: Tile): boolean {
  return t >= Tile.PadUp;
}

/** A pad's facing, as a unit vector in canvas orientation (negative y is up). */
export interface PadDir {
  readonly dx: number;
  readonly dy: number;
}

// Shared, so reading a direction per contact allocates nothing.
const DIR_UP: PadDir = { dx: 0, dy: -1 };
const DIR_DOWN: PadDir = { dx: 0, dy: 1 };
const DIR_LEFT: PadDir = { dx: -1, dy: 0 };
const DIR_RIGHT: PadDir = { dx: 1, dy: 0 };

/** The pad's facing, or null if the tile is not a pad. */
export function padDirection(t: Tile): PadDir | null {
  switch (t) {
    case Tile.PadUp:
      return DIR_UP;
    case Tile.PadDown:
      return DIR_DOWN;
    case Tile.PadLeft:
      return DIR_LEFT;
    case Tile.PadRight:
      return DIR_RIGHT;
    default:
      return null;
  }
}

/**
 * The level format's grid characters (GAME-DESIGN §8), indexed by tile value.
 * The table lives beside the enum because the phase 7 editor's palette needs
 * exactly this one. `S` and `G` are NOT here: they are level metadata written
 * onto an empty cell, and `level.ts` owns them — the enum does not grow.
 */
const TILE_CHARS = '.#^v<>';

/** Grid character → tile, or null if the character is not one of the six. */
export function tileFromChar(ch: string): Tile | null {
  const i = TILE_CHARS.indexOf(ch);
  return i < 0 || ch.length !== 1 ? null : (i as Tile);
}

export function charFromTile(t: Tile): string {
  return TILE_CHARS[t];
}

/** px → tile coordinate. */
export function toTile(px: number): number {
  return Math.floor(px / TILE);
}

export class TileMap {
  readonly w: number;
  readonly h: number;
  private readonly tiles: Uint8Array;

  constructor(w: number, h: number, fill: Tile = Tile.Empty) {
    if (w <= 0 || h <= 0) {
      throw new Error(`TileMap: invalid size ${w}x${h}`);
    }
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h).fill(fill);
  }

  get widthPx(): number {
    return this.w * TILE;
  }

  get heightPx(): number {
    return this.h * TILE;
  }

  /**
   * OOB: top and bottom → Empty, sides → Solid. The vertical check comes FIRST
   * on purpose — a body hugging a wall on its way out of the top must escape
   * rather than catch on the sealed side.
   */
  get(tx: number, ty: number): Tile {
    if (ty < 0 || ty >= this.h) {
      return Tile.Empty;
    }
    if (tx < 0 || tx >= this.w) {
      return Tile.Solid;
    }
    return this.tiles[ty * this.w + tx] as Tile;
  }

  /** Writes outside the grid are ignored. */
  set(tx: number, ty: number, t: Tile): void {
    if (tx < 0 || tx >= this.w || ty < 0 || ty >= this.h) {
      return;
    }
    this.tiles[ty * this.w + tx] = t;
  }

  fillRect(tx: number, ty: number, w: number, h: number, t: Tile): void {
    for (let y = ty; y < ty + h; y++) {
      for (let x = tx; x < tx + w; x++) {
        this.set(x, y, t);
      }
    }
  }

  isSolid(tx: number, ty: number): boolean {
    return this.get(tx, ty) === Tile.Solid;
  }

  /** Raw byte view for determinism tests / structural comparison. */
  bytes(): Uint8Array {
    return this.tiles.slice();
  }
}

/**
 * Walks the visible tiles as merged horizontal runs, so a 40-tile floor draws
 * as one rect instead of forty. `tx0..tx1` / `ty0..ty1` are *inclusive* tile
 * coordinates describing the window.
 *
 * Three decisions worth keeping:
 * - Runs merge over equal tile *values*, not over solidity, so a pad never
 *   merges into the floor it sits in — it would draw in the floor's colour.
 * - The window clips runs to itself, not to the map: a floor spanning 0..39
 *   seen through 5..10 emits `tx = 5, len = 6`. Emitting off-screen geometry
 *   is the cost this whole function exists to avoid.
 * - The window is first intersected with the map, because `get` reports OOB
 *   sides as Solid to seal the level; iterating there would invent phantom
 *   floor runs off the edge of the map.
 *
 * Callback-based rather than array-returning on purpose: ~100 runs x 60 fps of
 * throwaway objects is churn for nothing. Nothing is allocated per run.
 * A degenerate or off-map window simply never invokes the callback.
 */
export function forEachRun(
  map: TileMap,
  tx0: number,
  ty0: number,
  tx1: number,
  ty1: number,
  cb: (tx: number, ty: number, len: number, tile: Tile) => void,
): void {
  // Floor rather than trust the caller: a fractional bound from a sloppy px
  // conversion would otherwise emit runs at fractional tile coordinates.
  const x0 = Math.max(0, Math.floor(tx0));
  const x1 = Math.min(map.w - 1, Math.floor(tx1));
  const y0 = Math.max(0, Math.floor(ty0));
  const y1 = Math.min(map.h - 1, Math.floor(ty1));

  for (let ty = y0; ty <= y1; ty++) {
    let tx = x0;
    while (tx <= x1) {
      const tile = map.get(tx, ty);
      if (tile === Tile.Empty) {
        tx++;
        continue;
      }
      let len = 1;
      while (tx + len <= x1 && map.get(tx + len, ty) === tile) {
        len++;
      }
      cb(tx, ty, len, tile);
      tx += len;
    }
  }
}
