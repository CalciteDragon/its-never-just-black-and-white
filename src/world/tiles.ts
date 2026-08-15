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
