/**
 * Player controller (GAME-DESIGN §5/§6): run accel/friction, coyote time,
 * jump buffering, variable jump height, platform drop-through, hearts,
 * invulnerability, last-safe-ground tracking for pit falls. Input arrives as
 * plain booleans so tests drive the controller directly.
 */

import {
  AIR_ACCEL,
  COYOTE_TIME,
  DROP_THROUGH_TIME,
  GROUND_ACCEL,
  GROUND_FRICTION,
  HEART_MAX,
  HURT_KNOCKBACK_X,
  HURT_KNOCKBACK_Y,
  INVULN_TIME,
  JUMP_BUFFER,
  JUMP_CUT_FACTOR,
  JUMP_VELOCITY,
  PLAYER_BODY_H,
  PLAYER_BODY_W,
  RESPAWN_INVULN,
  RUN_SPEED,
} from '../constants';
import { burstDust, burstPoof } from '../engine/particles';
import { PALETTE } from '../engine/sprites';
import type { SpriteName } from '../engine/sprites';
import type { Renderer } from '../engine/renderer';
import { applyGravity, isSupported, moveBody, rectOverlapsSpikes } from '../world/physics';
import type { Body } from '../world/physics';
import type { EntityWorld } from './context';

export interface PlayerInputs {
  left: boolean;
  right: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  downHeld: boolean;
}

export const NO_INPUTS: PlayerInputs = {
  left: false,
  right: false,
  jumpHeld: false,
  jumpPressed: false,
  downHeld: false,
};

export class Player {
  readonly index: 0 | 1;
  readonly body: Body;
  facing: 1 | -1 = 1;
  hearts = HEART_MAX;
  dead = false;
  onGround = false;
  /** Counts down while invulnerable (flicker + immune to damage). */
  invuln = 0;

  private coyote = 0;
  private buffer = 0;
  private dropTimer = 0;
  private jumpCutDone = true;
  private animT = 0;
  private squash = 0;
  private lastSafe = { x: 0, y: 0 };

  constructor(index: 0 | 1, x: number, y: number) {
    this.index = index;
    this.body = { x, y, w: PLAYER_BODY_W, h: PLAYER_BODY_H, vx: 0, vy: 0 };
    this.lastSafe = { x, y };
  }

  get centerX(): number {
    return this.body.x + this.body.w / 2;
  }

  get centerY(): number {
    return this.body.y + this.body.h / 2;
  }

  /** Place the player with feet on top of the given tile-space pixel point. */
  spawnAt(x: number, feetY: number): void {
    this.body.x = x;
    this.body.y = feetY - this.body.h;
    this.body.vx = 0;
    this.body.vy = 0;
    this.lastSafe = { x: this.body.x, y: this.body.y };
    this.onGround = false;
    this.coyote = 0;
    this.buffer = 0;
  }

  update(dt: number, inp: PlayerInputs, world: EntityWorld): void {
    if (this.dead) {
      return;
    }
    const b = this.body;

    // Horizontal control.
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const accel = this.onGround ? GROUND_ACCEL : AIR_ACCEL;
    if (dir !== 0) {
      b.vx += dir * accel * dt;
      b.vx = Math.min(Math.max(b.vx, -RUN_SPEED), RUN_SPEED);
      this.facing = dir > 0 ? 1 : -1;
    } else if (this.onGround) {
      const drop = GROUND_FRICTION * dt;
      b.vx = Math.abs(b.vx) <= drop ? 0 : b.vx - Math.sign(b.vx) * drop;
    }

    // Jump timers.
    this.coyote = this.onGround ? COYOTE_TIME : Math.max(0, this.coyote - dt);
    this.buffer = inp.jumpPressed ? JUMP_BUFFER : Math.max(0, this.buffer - dt);
    this.dropTimer = Math.max(0, this.dropTimer - dt);

    // Drop through a platform (down + jump) takes priority over jumping.
    if (this.onGround && inp.downHeld && inp.jumpPressed) {
      this.dropTimer = DROP_THROUGH_TIME;
      this.buffer = 0;
    } else if (this.buffer > 0 && this.coyote > 0) {
      b.vy = -JUMP_VELOCITY;
      this.buffer = 0;
      this.coyote = 0;
      this.jumpCutDone = false;
      this.squash = -0.1; // stretch
      world.sfx('jump');
      burstDust(world.particles, this.centerX, b.y + b.h);
    }

    // Variable jump height: releasing jump while rising cuts the ascent once.
    if (!inp.jumpHeld && b.vy < 0 && !this.jumpCutDone) {
      b.vy *= JUMP_CUT_FACTOR;
      this.jumpCutDone = true;
    }

    applyGravity(b, dt);
    const res = moveBody(b, world.map, dt, { dropThrough: this.dropTimer > 0 });
    if (res.landed) {
      this.squash = 0.12;
      world.sfx('land');
      burstDust(world.particles, this.centerX, b.y + b.h);
    }
    this.onGround = res.onGround;

    // Track the last safe spot: grounded and clear of spikes around the feet.
    if (
      this.onGround &&
      isSupported(b, world.map) &&
      !rectOverlapsSpikes(world.map, b.x - 6, b.y - 2, b.w + 12, b.h + 10)
    ) {
      this.lastSafe = { x: b.x, y: b.y };
    }

    this.invuln = Math.max(0, this.invuln - dt);
    this.squash = this.squash > 0 ? Math.max(0, this.squash - dt) : Math.min(0, this.squash + dt);
    this.animT += dt;
  }

  /**
   * Take a hit from a source at fromX. Returns false while invulnerable/dead.
   */
  hurt(world: EntityWorld, fromX: number): boolean {
    if (this.invuln > 0 || this.dead) {
      return false;
    }
    this.hearts--;
    this.invuln = INVULN_TIME;
    this.body.vx = (this.centerX >= fromX ? 1 : -1) * HURT_KNOCKBACK_X;
    this.body.vy = HURT_KNOCKBACK_Y;
    world.sfx('hurt');
    world.shake(3, 0.2);
    if (this.hearts <= 0) {
      this.die(world);
    }
    return true;
  }

  /** Fell below the map: damage + teleport back to the last safe ground. */
  pitFall(world: EntityWorld): void {
    if (this.dead) {
      return;
    }
    this.hearts--;
    world.sfx('hurt');
    world.shake(3, 0.2);
    if (this.hearts <= 0) {
      this.die(world);
      return;
    }
    this.body.x = this.lastSafe.x;
    this.body.y = this.lastSafe.y;
    this.body.vx = 0;
    this.body.vy = 0;
    this.invuln = INVULN_TIME;
  }

  private die(world: EntityWorld): void {
    this.dead = true;
    burstPoof(world.particles, this.centerX, this.centerY, this.index === 0 ? PALETTE.C : PALETTE.O);
  }

  /** Co-op respawn beside the living partner. */
  reviveAt(x: number, y: number): void {
    this.dead = false;
    this.hearts = 1;
    this.invuln = RESPAWN_INVULN;
    this.body.x = x;
    this.body.y = y;
    this.body.vx = 0;
    this.body.vy = 0;
  }

  /** Level clear reward (cap HEART_MAX). */
  addHeart(): void {
    if (!this.dead) {
      this.hearts = Math.min(HEART_MAX, this.hearts + 1);
    }
  }

  /** Forced vertical impulse (stomp bounce) — not cuttable by jump release. */
  bounce(vy: number): void {
    this.body.vy = vy;
    this.jumpCutDone = true;
  }

  render(r: Renderer): void {
    if (this.dead) {
      return;
    }
    // Invulnerability flicker: skip every other 50 ms slice.
    if (this.invuln > 0 && Math.floor(this.animT * 20) % 2 === 0) {
      return;
    }
    const p = this.index === 0 ? 'player1' : 'player2';
    let pose: string;
    if (!this.onGround) {
      pose = 'Jump';
    } else if (Math.abs(this.body.vx) > 8) {
      pose = Math.floor(this.animT * 10) % 2 === 0 ? 'Run1' : 'Run2';
    } else {
      pose = 'Idle';
    }
    // Sprite is 12×14 around a 10×13 body (1 px inset each side).
    r.sprite(`${p}${pose}` as SpriteName, Math.round(this.body.x) - 1, Math.round(this.body.y) - 1, {
      flipX: this.facing < 0,
    });
  }
}
