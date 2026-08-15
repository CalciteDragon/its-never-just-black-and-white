/**
 * Player controller: run accel/friction, coyote time, jump buffering, and
 * variable jump height. Input arrives as plain booleans so tests drive the
 * controller directly.
 *
 * TEMPORARY, like the solver underneath it. Phase 5 rewrites this against the
 * rigid body: the flip and its charge, spin impulses, pad response and
 * out-of-bounds death all land there. Right now it is a square that runs and
 * jumps, and that is deliberately all it is.
 */

import {
  AIR_ACCEL,
  COYOTE_TIME,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JUMP_BUFFER,
  JUMP_CUT_FACTOR,
  JUMP_VELOCITY,
  PLAYER_SIZE,
  RUN_SPEED,
} from '../constants';
import { palette } from '../engine/palette';
import { burstDust } from '../engine/particles';
import type { Renderer } from '../engine/renderer';
import { applyGravity, moveBody } from '../world/physics';
import type { Body } from '../world/physics';
import type { EntityWorld } from './context';

export interface PlayerInputs {
  left: boolean;
  right: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
}

export const NO_INPUTS: PlayerInputs = {
  left: false,
  right: false,
  jumpHeld: false,
  jumpPressed: false,
};

export class Player {
  readonly body: Body;
  onGround = false;

  private coyote = 0;
  private buffer = 0;
  private jumpCutDone = true;

  constructor(x: number, y: number) {
    this.body = { x, y, w: PLAYER_SIZE, h: PLAYER_SIZE, vx: 0, vy: 0 };
  }

  get centerX(): number {
    return this.body.x + this.body.w / 2;
  }

  get centerY(): number {
    return this.body.y + this.body.h / 2;
  }

  /** Place the player with feet on the given world-space y, at rest. */
  spawnAt(x: number, feetY: number): void {
    this.body.x = x;
    this.body.y = feetY - this.body.h;
    this.body.vx = 0;
    this.body.vy = 0;
    this.onGround = false;
    this.coyote = 0;
    this.buffer = 0;
    this.jumpCutDone = true;
  }

  update(dt: number, inp: PlayerInputs, world: EntityWorld): void {
    const b = this.body;

    // Horizontal control is arcade, and stays that way at every angle (§5).
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const accel = this.onGround ? GROUND_ACCEL : AIR_ACCEL;
    if (dir !== 0) {
      b.vx += dir * accel * dt;
      b.vx = Math.min(Math.max(b.vx, -RUN_SPEED), RUN_SPEED);
    } else if (this.onGround) {
      const drop = GROUND_FRICTION * dt;
      b.vx = Math.abs(b.vx) <= drop ? 0 : b.vx - Math.sign(b.vx) * drop;
    }

    // Jump timers.
    this.coyote = this.onGround ? COYOTE_TIME : Math.max(0, this.coyote - dt);
    this.buffer = inp.jumpPressed ? JUMP_BUFFER : Math.max(0, this.buffer - dt);

    if (this.buffer > 0 && this.coyote > 0) {
      b.vy = -JUMP_VELOCITY;
      this.buffer = 0;
      this.coyote = 0;
      this.jumpCutDone = false;
      world.sfx('jump');
      burstDust(world.particles, this.centerX, b.y + b.h);
    }

    // Variable jump height: releasing jump while rising cuts the ascent once.
    if (!inp.jumpHeld && b.vy < 0 && !this.jumpCutDone) {
      b.vy *= JUMP_CUT_FACTOR;
      this.jumpCutDone = true;
    }

    applyGravity(b, dt);
    const res = moveBody(b, world.map, dt);
    if (res.landed) {
      world.sfx('land');
      burstDust(world.particles, this.centerX, b.y + b.h);
    }
    this.onGround = res.onGround;
  }

  render(r: Renderer): void {
    r.rect(this.body.x, this.body.y, this.body.w, this.body.h, palette.ink);
  }
}
