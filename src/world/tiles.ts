/**
 * Tile grid + the production tile renderer. TileMap is pure logic (node-safe);
 * drawTileMap only calls Renderer methods and is exercised in the browser.
 *
 * Out-of-bounds semantics: left/right/top read as Solid (sealed dungeon walls),
 * below the bottom reads as Empty so bodies can fall out of the map (pits).
 */

import { TILE } from '../constants';
import type { Renderer } from '../engine/renderer';

export enum Tile {
  Empty = 0,
  Solid = 1,
  /** One-way platform: collides only when landing on it from above. */
  Platform = 2,
  /** Hazard tile: never blocks movement; overlap is queried separately. */
  Spike = 3,
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

  /** OOB: sides/top → Solid, below bottom → Empty (fall-out death). */
  get(tx: number, ty: number): Tile {
    if (ty >= this.h) {
      return Tile.Empty;
    }
    if (tx < 0 || tx >= this.w || ty < 0) {
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

// --- Rendering (browser path; colors per GAME-DESIGN §2) ---

const COLOR_FILL = '#1E293B'; // S slate
const COLOR_EDGE = '#22D3EE'; // C cyan top edges
const COLOR_SHADE = '#020617'; // B bottom/side shading
const COLOR_FLECK = '#475569'; // s texture flecks

/** Deterministic per-tile hash for texture flecks (no Rng: purely positional). */
function tileHash(tx: number, ty: number): number {
  let h = (tx * 73856093) ^ (ty * 19349663);
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Draw all tiles overlapping the current view. Caller must have set the
 * renderer camera; viewX/viewY are the camera's top-left in world px (used
 * only for culling).
 */
export function drawTileMap(r: Renderer, map: TileMap, viewX: number, viewY: number): void {
  const x0 = Math.max(0, toTile(viewX) - 1);
  const y0 = Math.max(0, toTile(viewY) - 1);
  const x1 = Math.min(map.w - 1, toTile(viewX) + Math.ceil(480 / TILE) + 1);
  const y1 = Math.min(map.h - 1, toTile(viewY) + Math.ceil(270 / TILE) + 1);

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const t = map.get(tx, ty);
      if (t === Tile.Empty) {
        continue;
      }
      const px = tx * TILE;
      const py = ty * TILE;
      if (t === Tile.Solid) {
        r.rect(px, py, TILE, TILE, COLOR_FILL);
        if (map.get(tx, ty - 1) !== Tile.Solid) {
          r.rect(px, py, TILE, 1, COLOR_EDGE);
        }
        if (map.get(tx, ty + 1) !== Tile.Solid) {
          r.rect(px, py + TILE - 1, TILE, 1, COLOR_SHADE);
        }
        if (map.get(tx - 1, ty) !== Tile.Solid) {
          r.rect(px, py, 1, TILE, COLOR_SHADE);
        }
        if (map.get(tx + 1, ty) !== Tile.Solid) {
          r.rect(px + TILE - 1, py, 1, TILE, COLOR_SHADE);
        }
        const hash = tileHash(tx, ty);
        if (hash % 5 === 0) {
          r.rect(px + 3 + (hash % 9), py + 4 + ((hash >>> 4) % 8), 1, 1, COLOR_FLECK);
        }
      } else if (t === Tile.Platform) {
        r.rect(px, py, TILE, 4, COLOR_FILL);
        r.rect(px, py, TILE, 1, COLOR_EDGE);
      } else {
        // Spike sprite sits in the lower half of its tile.
        r.sprite('spike', px, py + 8);
      }
    }
  }
}
