/**
 * Decorative wall torch (GAME-DESIGN §9): 2-frame flicker + drifting embers.
 */

import { TILE } from '../constants';
import { emberDrift } from '../engine/particles';
import type { Renderer } from '../engine/renderer';
import type { EntityWorld } from './context';

export class Torch {
  readonly x: number;
  readonly y: number;
  private animT: number;
  private emberIn: number;

  constructor(tx: number, ty: number, phase = 0) {
    this.x = tx * TILE + 5;
    this.y = ty * TILE + 2;
    this.animT = phase;
    this.emberIn = 0.2 + phase * 0.13;
  }

  update(dt: number, world: EntityWorld): void {
    this.animT += dt;
    this.emberIn -= dt;
    if (this.emberIn <= 0) {
      this.emberIn = world.rng.float(0.35, 0.9);
      emberDrift(world.particles, this.x + 3 + world.rng.float(-1, 1), this.y + 2);
    }
  }

  render(r: Renderer): void {
    const frame = Math.floor(this.animT * 6) % 2 === 0 ? 'torch1' : 'torch2';
    r.sprite(frame, this.x, this.y);
  }
}
