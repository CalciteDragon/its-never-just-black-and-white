/**
 * Player controller: run accel/friction, coyote time, jump buffering, variable
 * jump height, and the jump's angular impulse. Input arrives as plain booleans
 * so tests drive the controller directly.
 *
 * ADAPTED, not rewritten. Phase 5 rewrites this against the finished design:
 * the flip and its charge, pad response and out-of-bounds death all land there.
 * What phase 4 owns is the move to the centre-origin rigid body and the jump
 * spin — the latter because it is two lines of final code on an action that
 * already exists, and without it the entire angular half of the solver is dead
 * on screen for a whole phase.
 */

import {
  AIR_ACCEL,
  COYOTE_TIME,
  GROUND_ACCEL,
  GROUND_FRICTION,
  JUMP_BUFFER,
  JUMP_CUT_FACTOR,
  JUMP_SPIN_BASE,
  JUMP_SPIN_PER_SPEED,
  JUMP_VELOCITY,
  MAX_ANG_SPEED,
  PLAYER_CORE_INSET,
  PLAYER_SIZE,
  RUN_SPEED,
} from '../constants';
import { palette } from '../engine/palette';
import { burstDust } from '../engine/particles';
import type { Renderer } from '../engine/renderer';
import { createBody, stepBody } from '../world/physics';
import type { RigidBody } from '../world/physics';
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
  readonly body: RigidBody;
  onGround = false;
  /**
   * +1 = gravity down, −1 = up. Phase 4 never writes it; the flip that negates
   * it is phase 5's, and it needs a charge and a spin kick that do not exist
   * yet. It is a real field rather than a literal because the solver takes it
   * either way and the tests drive both signs through it.
   */
  gravitySign: 1 | -1 = 1;

  private coyote = 0;
  private buffer = 0;
  private jumpCutDone = true;

  constructor(cx: number, cy: number) {
    this.body = createBody(cx, cy, PLAYER_SIZE);
  }

  get centerX(): number {
    return this.body.x;
  }

  get centerY(): number {
    return this.body.y;
  }

  /** Place the player's CENTRE at (cx, cy), at rest and square to the world. */
  spawnAt(cx: number, cy: number): void {
    const b = this.body;
    b.x = cx;
    b.y = cy;
    b.vx = 0;
    b.vy = 0;
    b.angle = 0;
    b.angVel = 0;
    this.onGround = false;
    this.coyote = 0;
    this.buffer = 0;
    this.jumpCutDone = true;
  }

  update(dt: number, inp: PlayerInputs, world: EntityWorld): void {
    const b = this.body;
    const gs = this.gravitySign;

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
      b.vy = -JUMP_VELOCITY * gs;
      // Spin signed by travel direction, so the square appears to roll forward.
      // Standing still there is no direction to read, and the design still
      // wants the ≈73° turn, so it defaults to rolling right.
      const spinDir = b.vx < 0 ? -1 : 1;
      b.angVel += spinDir * (JUMP_SPIN_BASE + JUMP_SPIN_PER_SPEED * Math.abs(b.vx));
      b.angVel = Math.min(Math.max(b.angVel, -MAX_ANG_SPEED), MAX_ANG_SPEED);
      this.buffer = 0;
      this.coyote = 0;
      this.jumpCutDone = false;
      world.sfx('jump');
      burstDust(world.particles, b.x, b.y + (PLAYER_SIZE / 2) * gs);
    }

    // Variable jump height: releasing jump while rising cuts the ascent once.
    if (!inp.jumpHeld && b.vy * gs < 0 && !this.jumpCutDone) {
      b.vy *= JUMP_CUT_FACTOR;
      this.jumpCutDone = true;
    }

    const res = stepBody(b, world.map, dt, { gravitySign: gs });
    if (res.landed) {
      world.sfx('land');
      burstDust(world.particles, b.x, b.y + (PLAYER_SIZE / 2) * gs);
    }
    this.onGround = res.grounded;
  }

  /**
   * An `ink` body with a `paper` core inset from every edge (GAME-DESIGN §2).
   * The body is the same colour as the geometry it touches, so without the core
   * a square flush against a wall would vanish into it — and a plain square
   * gives no cue at all about its angle, where a square with a core reads at a
   * glance. Both rotate with the simulation; neither branches on the phase.
   */
  render(r: Renderer): void {
    const b = this.body;
    r.rectRotated(b.x, b.y, PLAYER_SIZE, PLAYER_SIZE, b.angle, palette.ink);
    const core = PLAYER_SIZE - 2 * PLAYER_CORE_INSET;
    r.rectRotated(b.x, b.y, core, core, b.angle, palette.paper);
  }
}
