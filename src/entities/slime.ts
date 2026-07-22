/**
 * Patrolling slime (GAME-DESIGN §9): walks at SLIME_SPEED, turns at walls and
 * ledge edges. Stomps kill it; side contact hurts the player (resolved by the
 * play scene, which owns cross-entity rules).
 */

import { SLIME_BODY_H, SLIME_BODY_W, SLIME_SPEED, TILE } from '../constants';
import { burstPoof } from '../engine/particles';
import { PALETTE } from '../engine/sprites';
import type { Renderer } from '../engine/renderer';
import { applyGravity, moveBody } from '../world/physics';
import type { Body } from '../world/physics';
import { Tile, toTile } from '../world/tiles';
import type { Rng } from '../engine/rng';
import type { EntityWorld } from './context';

export class Slime {
  readonly body: Body;
  alive = true;
  private dir: 1 | -1;
  private animT = 0;

  constructor(x: number, y: number, rng: Rng) {
    this.body = { x, y, w: SLIME_BODY_W, h: SLIME_BODY_H, vx: 0, vy: 0 };
    this.dir = rng.chance(0.5) ? 1 : -1;
    this.animT = rng.float(0, 1);
  }

  get centerX(): number {
    return this.body.x + this.body.w / 2;
  }

  get centerY(): number {
    return this.body.y + this.body.h / 2;
  }

  update(dt: number, world: EntityWorld): void {
    if (!this.alive) {
      return;
    }
    const b = this.body;
    b.vx = this.dir * SLIME_SPEED;
    applyGravity(b, dt);
    const res = moveBody(b, world.map, dt);
    if (res.hitWall !== 0) {
      this.dir = res.hitWall === 1 ? -1 : 1;
    } else if (res.onGround) {
      // Turn before walking off a ledge: probe the tile below the leading edge.
      const aheadX = this.dir > 0 ? b.x + b.w + 2 : b.x - 2;
      const below = world.map.get(toTile(aheadX), toTile(b.y + b.h + 2));
      if (below !== Tile.Solid && below !== Tile.Platform) {
        this.dir = this.dir === 1 ? -1 : 1;
      }
    }
    this.animT += dt;
  }

  /** Squashed by a player. */
  stomp(world: EntityWorld): void {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    world.sfx('stomp');
    world.shake(2, 0.12);
    burstPoof(world.particles, this.centerX, this.centerY, PALETTE.V);
  }

  render(r: Renderer): void {
    if (!this.alive) {
      return;
    }
    // Sprite is 14×10 around a 12×8 body.
    const frame = Math.floor(this.animT * 4) % 2 === 0 ? 'slime1' : 'slime2';
    r.sprite(frame, Math.round(this.body.x) - 1, Math.round(this.body.y) - 2, {
      flipX: this.dir < 0,
    });
  }
}

/** Convenience: feet-tile spawn point → slime instance (used by PlayScene). */
export function slimeAtTile(tx: number, ty: number, rng: Rng): Slime {
  return new Slime(tx * TILE + (TILE - SLIME_BODY_W) / 2, (ty + 1) * TILE - SLIME_BODY_H, rng);
}
