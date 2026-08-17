/**
 * The controller, and the only entity. Input arrives as plain booleans and the
 * world arrives as an interface, so the whole thing drives from a unit test
 * with no canvas anywhere.
 *
 * It owns the two verbs the level design is built around — the flip and the
 * pad — plus the platformer scaffolding (accel/friction, coyote time, jump
 * buffering, jump cut) that keeps a rigid body feeling like a platformer.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN: the palette. A refused flip that still
 * inverted every colour in the world would be the most confusing bug this game
 * could ship, because the palette is the only readout of gravity there is. So
 * `update` reports what actually happened and `PlayScene` turns `flipped` into
 * `palette.flip()`. It also keeps a global singleton off the logic path, so a
 * headless test cannot recolour the world by stepping a body.
 */

import {
  AIR_ACCEL,
  CORE_OUTLINE_WIDTH,
  COYOTE_TIME,
  FLIP_SPIN_KICK,
  GROUND_ACCEL,
  GROUND_FRICTION,
  GROUND_NORMAL_DOT,
  JUMP_BUFFER,
  JUMP_CUT_FACTOR,
  JUMP_SPIN_BASE,
  JUMP_SPIN_PER_SPEED,
  JUMP_VELOCITY,
  MAX_ANG_SPEED,
  PAD_IMPULSE,
  PAD_SPIN_MAX,
  PLAYER_CORE_INSET,
  PLAYER_SIZE,
  RUN_SPEED,
} from '../constants';
import { palette } from '../engine/palette';
import { burstDust } from '../engine/particles';
import type { Renderer } from '../engine/renderer';
import { createBody, stepBody } from '../world/physics';
import type { Contact, RigidBody } from '../world/physics';
import { Tile, padDirection } from '../world/tiles';
import type { EntityWorld } from './context';

export interface PlayerInputs {
  left: boolean;
  right: boolean;
  jumpHeld: boolean;
  jumpPressed: boolean;
  flipPressed: boolean;
}

export const NO_INPUTS: PlayerInputs = {
  left: false,
  right: false,
  jumpHeld: false,
  jumpPressed: false,
  flipPressed: false,
};

/**
 * What the step actually did, for the scene to act on. Reused across calls —
 * read it before the next `update`.
 *
 * Deliberately NOT here: a landing impulse for phase 6's splash. Nothing in
 * phase 5 would read it, `StepResult.contacts` already carries impulse per
 * contact, and a field with no consumer is exactly the placeholder the phase
 * 3/4 rule exists to forbid.
 */
export interface PlayerEvents {
  /** The flip was charged and fired. The scene owes the palette a flip. */
  flipped: boolean;
  /** The body left the world vertically (GAME-DESIGN §5). */
  died: boolean;
}

export class Player {
  readonly body: RigidBody;
  onGround = false;
  /** +1 = gravity down, −1 = up. Kept in lockstep with the palette by the scene. */
  gravitySign: 1 | -1 = 1;

  private charged = true;
  private coyote = 0;
  private buffer = 0;
  private jumpCutDone = true;
  private readonly events: PlayerEvents = { flipped: false, died: false };

  constructor(cx: number, cy: number) {
    this.body = createBody(cx, cy, PLAYER_SIZE);
  }

  get centerX(): number {
    return this.body.x;
  }

  get centerY(): number {
    return this.body.y;
  }

  /**
   * Is the flip available? GAME-DESIGN §2 makes this the *only* readout of the
   * charge — a solid paper core when charged, a hollow one when spent. No HUD
   * icon, no meter.
   */
  get flipCharged(): boolean {
    return this.charged;
  }

  /**
   * Place the player's CENTRE at (cx, cy), at rest, square to the world, in
   * phase A gravity with the flip recharged.
   *
   * This is the WHOLE reset, on purpose. Death and `R` share it, and "a reset
   * that forgets one field" is the classic source of "the second attempt plays
   * differently from the first" — so every field a respawn must not carry over
   * is cleared in one place, and the scene owns only the palette beside it.
   */
  spawnAt(cx: number, cy: number): void {
    const b = this.body;
    b.x = cx;
    b.y = cy;
    b.vx = 0;
    b.vy = 0;
    b.angle = 0;
    b.angVel = 0;
    this.onGround = false;
    this.gravitySign = 1;
    this.charged = true;
    this.coyote = 0;
    this.buffer = 0;
    this.jumpCutDone = true;
  }

  update(dt: number, inp: PlayerInputs, world: EntityWorld): PlayerEvents {
    const ev = this.events;
    ev.flipped = false;
    ev.died = false;
    const b = this.body;

    // --- The flip, spent BEFORE the step and recharged from its result, which
    // is decision 6: there is no flip buffer. "Flip as soon as I can" means the
    // moment you land, which fires you off the floor you just fought to reach.
    // The cost is that a flip pressed on the exact landing frame is refused.
    if (inp.flipPressed && this.charged) {
      this.charged = false;
      this.gravitySign = this.gravitySign === 1 ? -1 : 1;
      b.vy = 0; // immediate and predictable, not a deceleration
      b.angVel += (b.vx < 0 ? -1 : 1) * FLIP_SPIN_KICK;
      clampSpin(b);
      ev.flipped = true;
      world.sfx('flip');
    }
    const gs = this.gravitySign;

    this.horizontal(dt, inp);

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
      clampSpin(b);
      this.buffer = 0;
      this.coyote = 0;
      this.jumpCutDone = false;
      world.sfx('jump');
      burstDust(world.particles, b.x, b.y + (PLAYER_SIZE / 2) * gs);
    }

    // Variable jump height: releasing jump while rising cuts the ascent once.
    // A pad launch is not cuttable — `jumpCutDone` is only cleared by a jump.
    if (!inp.jumpHeld && b.vy * gs < 0 && !this.jumpCutDone) {
      b.vy *= JUMP_CUT_FACTOR;
      this.jumpCutDone = true;
    }

    const res = stepBody(b, world.map, dt, { gravitySign: gs });
    // AT MOST ONE PAD PER STEP. One tile can be resolved on two different
    // normals inside a single step — a fast corner clip on a free-standing slab
    // does it — and `StepResult.contacts` is keyed by normal, so the same pad
    // can appear twice. The velocity override is idempotent, but the spin is
    // not: firing twice doubles it, and doubles the sound and the dust with it.
    // Contact order is pinned, so taking the first is deterministic.
    let padFired = false;
    for (let i = 0; i < res.contactCount; i++) {
      const c = res.contacts[i];
      // Ground is whichever surface opposes gravity, so this reads the same
      // predicate the solver does — but only a PLAIN SOLID recharges. A pad is
      // a ground-normal contact too, and §5 says a pad chain is a commitment.
      if (c.onSolid && -c.ny * gs > GROUND_NORMAL_DOT) {
        this.charged = true;
      }
      if (!padFired && c.pad !== Tile.Empty) {
        this.firePad(c, world);
        padFired = true;
      }
    }
    this.onGround = res.grounded;

    if (res.landed) {
      world.sfx('land');
      burstDust(world.particles, b.x, b.y + (PLAYER_SIZE / 2) * gs);
    }

    // Death is leaving the world vertically, and only once the body is ENTIRELY
    // past the edge: the camera's slack exists to keep that last frame legible,
    // so the body flies out of shot rather than popping at the boundary.
    const half = PLAYER_SIZE / 2;
    ev.died = b.y + half < 0 || b.y - half > world.map.heightPx;
    return ev;
  }

  /**
   * Arcade horizontal control, with the clamp made ONE-SIDED.
   *
   * `PAD_IMPULSE` is 820 and `RUN_SPEED` is 256, so a symmetric re-clamp every
   * frame would erase a sideways pad within one frame of firing — and holding
   * *toward* the launch is what would erase it. Suppressing control for a few
   * frames instead is not available: hard rule 7 says nothing takes horizontal
   * control away. So input may never push |vx| *past* `RUN_SPEED`, but it may
   * not brake an existing overspeed either; pressing against one decelerates at
   * the normal rate, so turning around at 820 px/s still works.
   *
   * Below `RUN_SPEED` this is arithmetically identical to a symmetric clamp.
   */
  private horizontal(dt: number, inp: PlayerInputs): void {
    const b = this.body;
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const accel = this.onGround ? GROUND_ACCEL : AIR_ACCEL;
    const entrySpeed = Math.abs(b.vx);

    if (dir !== 0) {
      const cap = Math.max(RUN_SPEED, entrySpeed);
      b.vx += dir * accel * dt;
      b.vx = dir > 0 ? Math.min(b.vx, cap) : Math.max(b.vx, -cap);
    } else if (this.onGround) {
      const drop = GROUND_FRICTION * dt;
      b.vx = entrySpeed <= drop ? 0 : b.vx - Math.sign(b.vx) * drop;
    }

    // Overspeed bleeds off on the ground, held direction or not: a pad is a
    // launch, not a permanent speed upgrade, and the ground is where the
    // controller is supposed to govern speed. In the air it is preserved.
    //
    // Written as a FLOOR on the deceleration rather than an extra subtraction,
    // so the no-input branch above (which already decelerates at exactly this
    // rate) is not charged for it twice.
    if (this.onGround && Math.abs(b.vx) > RUN_SPEED) {
      const limit = Math.max(RUN_SPEED, entrySpeed - GROUND_FRICTION * dt);
      if (Math.abs(b.vx) > limit) {
        b.vx = Math.sign(b.vx) * limit;
      }
    }
  }

  /**
   * A pad OVERRIDES the relevant velocity component rather than adding to it,
   * so its launch height is predictable however fast you arrived, plus a spin
   * proportional to how off-centre the contact was.
   *
   * The arm is measured from the BODY's centre — it is a torque arm, not a
   * measure of where the pad was hit — so a flat landing anywhere on a pad is
   * `r × n = 0` and no spin at all. That is what makes "clip it with a corner
   * and you leave spinning" a real distinction rather than a constant tumble.
   * For an up-pad `n = (0, −1)`, so `r × n = −r_x` and a contact right of
   * centre sends ω negative: counter-clockwise on screen, right side lifting.
   */
  private firePad(c: Contact, world: EntityWorld): void {
    const dir = padDirection(c.pad);
    if (!dir) {
      return;
    }
    const b = this.body;
    if (dir.dx !== 0) {
      b.vx = dir.dx * PAD_IMPULSE;
    }
    if (dir.dy !== 0) {
      b.vy = dir.dy * PAD_IMPULSE;
    }
    const rx = c.x - b.x;
    const ry = c.y - b.y;
    const arm = (rx * c.ny - ry * c.nx) / (PLAYER_SIZE / 2);
    b.angVel += PAD_SPIN_MAX * Math.min(1, Math.max(-1, arm));
    clampSpin(b);
    world.sfx('pad');
    burstDust(world.particles, c.x, c.y);
  }

  /**
   * An `ink` body with a `paper` core inset from every edge (GAME-DESIGN §2).
   * The body is the same colour as the geometry it touches, so without the core
   * a square flush against a wall would vanish into it — and a plain square
   * gives no cue at all about its angle, where a square with a core reads at a
   * glance.
   *
   * The core is also the charge readout: solid when charged, a hollow outline
   * when spent. It branches on the CHARGE and never on the palette phase.
   */
  render(r: Renderer): void {
    const b = this.body;
    r.rectRotated(b.x, b.y, PLAYER_SIZE, PLAYER_SIZE, b.angle, palette.ink);
    const core = PLAYER_SIZE - 2 * PLAYER_CORE_INSET;
    if (this.charged) {
      r.rectRotated(b.x, b.y, core, core, b.angle, palette.paper);
    } else {
      r.rectRotatedOutline(b.x, b.y, core, core, b.angle, palette.paper, CORE_OUTLINE_WIDTH);
    }
  }
}

function clampSpin(b: RigidBody): void {
  b.angVel = Math.min(Math.max(b.angVel, -MAX_ANG_SPEED), MAX_ANG_SPEED);
}
