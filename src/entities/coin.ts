/**
 * Spinning coin (GAME-DESIGN §9). Pickup detection lives here; scoring lives
 * in the play scene / RunState.
 */

import { COIN_RADIUS, TILE } from '../constants';
import { burstSparkle } from '../engine/particles';
import type { Renderer } from '../engine/renderer';
import type { SpriteName } from '../engine/sprites';
import type { EntityWorld } from './context';

export class Coin {
  readonly cx: number;
  readonly cy: number;
  taken = false;
  private animT: number;

  constructor(cx: number, cy: number, phase = 0) {
    this.cx = cx;
    this.cy = cy;
    this.animT = phase;
  }

  update(dt: number): void {
    this.animT += dt;
  }

  /** Is a player center within pickup range? */
  inRange(px: number, py: number): boolean {
    const dx = px - this.cx;
    const dy = py - this.cy;
    return dx * dx + dy * dy <= COIN_RADIUS * COIN_RADIUS;
  }

  collect(world: EntityWorld): void {
    if (this.taken) {
      return;
    }
    this.taken = true;
    world.sfx('coin');
    burstSparkle(world.particles, this.cx, this.cy);
  }

  render(r: Renderer): void {
    if (this.taken) {
      return;
    }
    const frame = (Math.floor(this.animT * 8) % 4) + 1;
    r.sprite(`coin${frame}` as SpriteName, Math.round(this.cx) - 4, Math.round(this.cy) - 4);
  }
}

/** Tile-space point → coin centered in that tile. */
export function coinAtTile(tx: number, ty: number, phase = 0): Coin {
  return new Coin(tx * TILE + TILE / 2, ty * TILE + TILE / 2, phase);
}
