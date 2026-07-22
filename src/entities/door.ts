/**
 * Level-exit door (GAME-DESIGN §9): 16×32, stands on the exit tile. Any
 * player overlapping it clears the level. Glows open when someone is near.
 */

import { TILE } from '../constants';
import type { Renderer } from '../engine/renderer';
import type { Body } from '../world/physics';

export const DOOR_W = 16;
export const DOOR_H = 32;

export class Door {
  /** Top-left of the 16×32 door area (px). */
  readonly x: number;
  readonly y: number;
  /** Cosmetic: swaps to the glowing sprite when a player is close. */
  open = false;

  /** exitTile is the feet tile from the generator (door art fills it + above). */
  constructor(exitTx: number, exitTy: number) {
    this.x = exitTx * TILE;
    this.y = (exitTy - 1) * TILE;
  }

  get centerX(): number {
    return this.x + DOOR_W / 2;
  }

  overlaps(b: Body): boolean {
    return b.x < this.x + DOOR_W && b.x + b.w > this.x && b.y < this.y + DOOR_H && b.y + b.h > this.y;
  }

  /** Near = within 2.5 tiles of the door center (for the open-glow). */
  isNear(px: number, py: number): boolean {
    const dx = px - this.centerX;
    const dy = py - (this.y + DOOR_H / 2);
    return dx * dx + dy * dy <= (TILE * 2.5) * (TILE * 2.5);
  }

  render(r: Renderer): void {
    r.sprite(this.open ? 'doorOpen' : 'doorClosed', this.x, this.y);
  }
}
