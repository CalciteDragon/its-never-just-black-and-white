/**
 * The controller. The movement block at the top is phase 4's and is asserted
 * UNCHANGED on purpose: decision 3's prediction is that below RUN_SPEED the
 * new one-sided clamp is arithmetically identical to the old symmetric one, so
 * if any of those assertions had to move, the clamp is wrong.
 *
 * Everything below it is phase 5's: the flip and its charge, the pads, the
 * one-sided clamp itself, and out-of-bounds death.
 */

import { describe, expect, it } from 'vitest';
import {
  AIR_ACCEL,
  COYOTE_TIME,
  FLIP_RING_COUNT,
  GROUND_FRICTION,
  IMPACT_SPEED_MIN,
  JUMP_SPIN_BASE,
  JUMP_SPIN_PER_SPEED,
  JUMP_VELOCITY,
  MAX_ANG_SPEED,
  MAX_FALL_SPEED,
  PAD_IMPULSE,
  PAD_SPIN_MAX,
  PLAYER_SIZE,
  RUN_SPEED,
  SPLASH_COUNT_MAX,
  SPLASH_COUNT_MIN,
  STEP,
  STEP_SFX_DIST,
  TILE,
} from '../src/constants';
import { ParticleSystem } from '../src/engine/particles';
import { Rng } from '../src/engine/rng';
import { nullWorldParts } from '../src/entities/context';
import type { EntityWorld } from '../src/entities/context';
import { NO_INPUTS, Player, splashCount } from '../src/entities/player';
import type { PlayerInputs } from '../src/entities/player';
import { Tile, TileMap } from '../src/world/tiles';

function world(map: TileMap): EntityWorld {
  return { map, particles: new ParticleSystem(), rng: new Rng(1), ...nullWorldParts() };
}

/** 40×12 room with a floor at row 10. */
function room(): TileMap {
  const m = new TileMap(40, 12);
  m.fillRect(0, 10, 40, 2, Tile.Solid);
  return m;
}

function inp(partial: Partial<PlayerInputs>): PlayerInputs {
  return { ...NO_INPUTS, ...partial };
}

/** A player settled on the floor at `tx`. spawnAt takes the CENTRE. */
function grounded(map: TileMap, tx = 3): Player {
  const p = new Player(0, 0);
  p.spawnAt(tx * TILE + TILE / 2, 10 * TILE - PLAYER_SIZE / 2);
  const w = world(map);
  for (let i = 0; i < 10; i++) {
    p.update(STEP, NO_INPUTS, w);
  }
  return p;
}

/** Airborne, well clear of the floor, and no longer reporting ground. */
function airborne(map: TileMap): Player {
  const p = grounded(map);
  p.body.y -= 200;
  p.update(STEP, NO_INPUTS, world(map));
  return p;
}

/**
 * Airborne at `vx` in open sky, deep enough inside it to keep falling for ten
 * seconds. The overspeed rules differ in the air and on the ground, so a test
 * of the air ones must not quietly land halfway through.
 */
function flying(map: TileMap, vx: number): Player {
  const p = new Player(0, 0);
  p.spawnAt(200 * TILE, 40 * TILE);
  p.update(STEP, NO_INPUTS, world(map));
  p.body.vx = vx;
  return p;
}

/**
 * Spend the flip the only way the game can — by flipping — and then undo
 * everything else the flip did, so the test is looking at a spent charge and
 * nothing else. The spin kick matters here: a body arriving rotated clips a
 * seam with one corner instead of straddling it, which is a different test.
 */
function spendCharge(p: Player, w: EntityWorld): void {
  const { angle, angVel } = p.body;
  p.update(STEP, inp({ flipPressed: true }), w);
  p.gravitySign = 1;
  p.body.vy = 0;
  p.body.angle = angle;
  p.body.angVel = angVel;
}

describe('Player movement', () => {
  it('accelerates to run speed and stops with ground friction', () => {
    const m = room();
    const p = grounded(m);
    const w = world(m);
    for (let i = 0; i < 60; i++) {
      p.update(STEP, inp({ right: true }), w);
    }
    expect(p.body.vx).toBeCloseTo(RUN_SPEED, 3);
    for (let i = 0; i < 30; i++) {
      p.update(STEP, NO_INPUTS, w);
    }
    expect(p.body.vx).toBe(0);
  });

  it('jumps on press when grounded, not in mid-air', () => {
    const m = room();
    const p = grounded(m);
    const w = world(m);
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    expect(p.body.vy).toBeLessThanOrEqual(-JUMP_VELOCITY + 80); // rising fast
    const vyAfterJump = p.body.vy;
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    expect(p.body.vy).toBeGreaterThan(vyAfterJump - 10); // no double jump boost
  });

  it('honors coyote time but not after it expires', () => {
    const m = room();
    const w = world(m);
    // Hoist high enough to stay airborne while the windows play out.
    const p = grounded(m);
    p.body.y -= 120;
    p.update(STEP, NO_INPUTS, w); // airborne, coyote starts draining
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    expect(p.body.vy).toBeLessThan(-JUMP_VELOCITY * 0.8); // coyote jump fired

    const q = grounded(m);
    q.body.y -= 120;
    const drainSteps = Math.ceil((COYOTE_TIME + 0.05) / STEP);
    for (let i = 0; i < drainSteps; i++) {
      q.update(STEP, NO_INPUTS, w);
    }
    const vyBefore = q.body.vy;
    q.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    expect(q.body.vy).toBeGreaterThan(vyBefore); // still falling — no jump
  });

  it('buffers a jump pressed shortly before landing', () => {
    const m = room();
    const w = world(m);
    const p = new Player(0, 0);
    // 16 px up: lands within the buffer window.
    p.spawnAt(3 * TILE + TILE / 2, 10 * TILE - PLAYER_SIZE / 2 - 16);
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w); // press early
    let jumped = false;
    for (let i = 0; i < 30; i++) {
      p.update(STEP, inp({ jumpHeld: true }), w);
      if (p.body.vy < -JUMP_VELOCITY * 0.8) {
        jumped = true;
        break;
      }
    }
    expect(jumped).toBe(true);
  });

  it('cuts the jump short when the button releases mid-rise', () => {
    const m = room();
    const w = world(m);
    const full = grounded(m);
    full.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    const cut = grounded(m);
    cut.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    cut.update(STEP, inp({}), w); // release immediately
    expect(Math.abs(cut.body.vy)).toBeLessThan(Math.abs(full.body.vy));
  });

  it('is a PLAYER_SIZE square, centre-origin, that settles flush on the floor', () => {
    const m = room();
    const p = grounded(m);
    expect(p.body.size).toBe(PLAYER_SIZE);
    // x, y is the CENTRE now, so centerX/centerY are the body's own coords.
    expect(p.centerX).toBe(p.body.x);
    expect(p.centerY).toBe(p.body.y);
    expect(p.body.y + PLAYER_SIZE / 2).toBeCloseTo(10 * TILE, 1);
    expect(p.onGround).toBe(true);
    expect(p.body.angle).toBe(0);
  });
});

describe('the jump spin (decision 8)', () => {
  it('a standing jump rolls the square forward at JUMP_SPIN_BASE', () => {
    const m = room();
    const p = grounded(m);
    expect(p.body.angVel).toBe(0);
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), world(m));
    // Positive is clockwise on screen. Standing still there is no travel
    // direction to read, and the design still wants the turn, so it rolls right.
    expect(p.body.angVel).toBeGreaterThan(0);
    expect(p.body.angVel).toBeCloseTo(JUMP_SPIN_BASE * Math.exp(-0.4 * STEP), 4);
  });

  it('scales with speed and signs with travel direction', () => {
    const m = room();
    const w = world(m);
    const fast = grounded(m);
    for (let i = 0; i < 60; i++) {
      fast.update(STEP, inp({ right: true }), w);
    }
    fast.update(STEP, inp({ right: true, jumpPressed: true, jumpHeld: true }), w);
    const expected = JUMP_SPIN_BASE + JUMP_SPIN_PER_SPEED * RUN_SPEED;
    expect(expected).toBeCloseTo(6.084, 3);
    expect(fast.body.angVel).toBeGreaterThan(JUMP_SPIN_BASE);
    expect(fast.body.angVel).toBeCloseTo(expected * Math.exp(-0.4 * STEP), 3);

    // Column 20, or a 60-step run left ends jammed against the sealed map edge
    // and jumps at 35 px/s instead of run speed.
    const left = grounded(m, 20);
    for (let i = 0; i < 60; i++) {
      left.update(STEP, inp({ left: true }), w);
    }
    left.update(STEP, inp({ left: true, jumpPressed: true, jumpHeld: true }), w);
    expect(left.body.angVel).toBeCloseTo(-expected * Math.exp(-0.4 * STEP), 3);
  });

  it('never exceeds MAX_ANG_SPEED, however it is stacked', () => {
    const m = room();
    const p = grounded(m);
    p.body.angVel = MAX_ANG_SPEED;
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), world(m));
    expect(p.body.angVel).toBeLessThanOrEqual(MAX_ANG_SPEED);
  });

  it('lands tilted and settles itself, with no help from the controller', () => {
    const m = room();
    const w = world(m);
    const p = grounded(m);
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    for (let i = 0; i < 200; i++) {
      p.update(STEP, NO_INPUTS, w);
    }
    expect(p.onGround).toBe(true);
    // Settled to an exact multiple of 90°, dead still.
    expect(p.body.angVel).toBe(0);
    expect(Math.abs(p.body.angle % (Math.PI / 2))).toBeLessThan(1e-12);
    expect(p.body.vy).toBe(0);
  });
});

describe('the one-sided horizontal clamp (decision 3)', () => {
  // PAD_IMPULSE is 820 and the old controller re-clamped vx to ±RUN_SPEED on
  // every frame a direction was held, so a sideways pad was erased within one
  // frame of firing — and holding TOWARD the launch is what erased it.
  // Suppressing control for a few frames is not available: hard rule 7 says
  // collision response never takes horizontal control away.
  //
  // These sit in the most-played code path in the game, and a sign error here
  // would feel like ice physics and read as a physics bug rather than a
  // controller one. They are cheap, so they are written first.

  it('input alone never pushes past RUN_SPEED', () => {
    const m = room();
    const w = world(m);
    const p = grounded(m);
    // Sixty steps is 256 px — long enough to saturate, short enough that the
    // body never reaches the sealed right edge and has its vx clamped by a wall.
    for (let i = 0; i < 60; i++) {
      p.update(STEP, inp({ right: true }), w);
      expect(p.body.vx).toBeLessThanOrEqual(RUN_SPEED);
    }
    expect(p.body.vx).toBeCloseTo(RUN_SPEED, 6);
  });

  it('input held TOWARD an overspeed preserves it in the air', () => {
    const m = new TileMap(400, 400);
    const p = flying(m, PAD_IMPULSE);
    const w = world(m);
    for (let i = 0; i < 60; i++) {
      p.update(STEP, inp({ right: true }), w);
      expect(p.body.vx).toBe(PAD_IMPULSE);
    }
  });

  it('input held AGAINST an overspeed decelerates at the normal rate', () => {
    const m = new TileMap(400, 400);
    const p = flying(m, PAD_IMPULSE);
    const w = world(m);
    p.update(STEP, inp({ left: true }), w);
    expect(p.body.vx).toBeCloseTo(PAD_IMPULSE - AIR_ACCEL * STEP, 6);

    // And it really does turn around rather than stalling at the cap.
    for (let i = 0; i < 300; i++) {
      p.update(STEP, inp({ left: true }), w);
    }
    expect(p.body.vx).toBeCloseTo(-RUN_SPEED, 3);
  });

  it('grounding bleeds the overspeed off at GROUND_FRICTION, direction held or not', () => {
    // A pad is a launch, not a permanent speed upgrade, and the ground is where
    // the controller is supposed to govern speed.
    const m = room();
    const w = world(m);
    for (const held of [true, false]) {
      const p = grounded(m);
      p.body.vx = PAD_IMPULSE;
      p.update(STEP, inp({ right: held }), w);
      expect(p.body.vx).toBeCloseTo(PAD_IMPULSE - GROUND_FRICTION * STEP, 6);
      for (let i = 0; i < 40; i++) {
        p.update(STEP, inp({ right: held }), w);
      }
      // Settles at RUN_SPEED when held, at rest when not — never above.
      expect(p.body.vx).toBeCloseTo(held ? RUN_SPEED : 0, 3);
    }
  });
});

describe('the flip and its charge (GAME-DESIGN §5)', () => {
  it('inverts gravity, zeroes vy and kicks the spin in the direction of travel', () => {
    const m = room();
    const w = world(m);
    const p = airborne(m);
    expect(p.body.vy).toBeGreaterThan(0); // falling
    const ev = p.update(STEP, inp({ flipPressed: true }), w);
    expect(ev.flipped).toBe(true);
    expect(p.gravitySign).toBe(-1);
    // vy is zeroed at the flip and then one step of inverted gravity applies,
    // so the body comes out of the step already travelling the other way.
    expect(p.body.vy).toBeLessThan(0);
    expect(p.body.angVel).toBeGreaterThan(0);
  });

  it('signs the spin kick by travel direction, like the jump', () => {
    const m = room();
    const p = airborne(m);
    p.body.vx = -RUN_SPEED;
    p.update(STEP, inp({ flipPressed: true }), world(m));
    expect(p.body.angVel).toBeLessThan(0);
  });

  it('THE CHARGE CANNOT BE SPENT TWICE: a refused flip leaves the body untouched', () => {
    // Not merely un-flipped. The failure mode that matters is a PARTLY applied
    // flip, so gravitySign, vy and angVel all have to come through unchanged —
    // compared against a twin stepped with no press at all.
    const m = room();
    const w = world(m);
    const p = airborne(m);
    p.update(STEP, inp({ flipPressed: true }), w);
    expect(p.flipCharged).toBe(false);

    const twin = new Player(0, 0);
    twin.spawnAt(p.body.x, p.body.y);
    twin.gravitySign = p.gravitySign;
    twin.body.vx = p.body.vx;
    twin.body.vy = p.body.vy;
    twin.body.angle = p.body.angle;
    twin.body.angVel = p.body.angVel;

    const ev = p.update(STEP, inp({ flipPressed: true }), w);
    twin.update(STEP, NO_INPUTS, w);
    expect(ev.flipped).toBe(false);
    expect(p.gravitySign).toBe(twin.gravitySign);
    expect(p.body.vy).toBe(twin.body.vy);
    expect(p.body.angVel).toBe(twin.body.angVel);
    expect(p.body.y).toBe(twin.body.y);
  });

  it('recharges on solid ground and NOT on a pad — by tile, not by normal', () => {
    // GAME-DESIGN §5: a pad chain is a real commitment. Landing on a pad is a
    // ground-NORMAL contact either way, so only the contact's tile separates
    // them — which is the whole of decision 2.
    const solid = new TileMap(40, 12);
    solid.fillRect(0, 10, 40, 2, Tile.Solid);
    const padded = new TileMap(40, 12);
    padded.fillRect(0, 10, 40, 2, Tile.Solid);
    padded.set(3, 10, Tile.PadUp);

    for (const [map, expected] of [
      [solid, true],
      [padded, false],
    ] as const) {
      const p = new Player(0, 0);
      p.spawnAt(3 * TILE + TILE / 2, 8 * TILE);
      const w = world(map);
      spendCharge(p, w);
      expect(p.flipCharged).toBe(false);
      // Read it at the ground contact itself: landing on a pad launches you
      // straight back off it, so "thirty steps later" is not on the floor.
      let touched = false;
      for (let i = 0; i < 60 && !touched; i++) {
        p.update(STEP, NO_INPUTS, w);
        touched = p.onGround;
      }
      expect(touched).toBe(true);
      expect(p.flipCharged).toBe(expected);
    }
  });

  it('recharges across a pad/floor seam — it genuinely touched ground', () => {
    const map = new TileMap(40, 12);
    map.fillRect(0, 10, 40, 2, Tile.Solid);
    map.set(3, 10, Tile.PadUp);
    const p = new Player(0, 0);
    p.spawnAt(3 * TILE, 10 * TILE - PLAYER_SIZE / 2 - 4); // straddling cols 2 and 3
    const w = world(map);
    spendCharge(p, w);
    for (let i = 0; i < 10; i++) {
      p.update(STEP, NO_INPUTS, w);
    }
    expect(p.flipCharged).toBe(true);
  });

  it('recharges the moment the solver reports ground, however it got there', () => {
    // The recharge shares GROUND_NORMAL_DOT with `grounded`, so a body balanced
    // on a corner — up to 45° off vertical — counts as standing, per §5.
    const m = room();
    const w = world(m);
    const p = grounded(m);
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    spendCharge(p, w);
    expect(p.flipCharged).toBe(false);
    let rechargedGrounded = false;
    for (let i = 0; i < 300; i++) {
      p.update(STEP, NO_INPUTS, w);
      if (p.flipCharged) {
        rechargedGrounded = p.onGround;
        break;
      }
    }
    expect(rechargedGrounded).toBe(true);
  });

  it('a flip pressed on the exact landing frame is refused (decision 6)', () => {
    // No flip buffer: "flip as soon as I can" would fire you off the floor you
    // just fought to reach. The cost is one frame of strictness, on purpose —
    // the flip is consumed before stepBody and the recharge read after it.
    const m = room();
    const w = world(m);
    const p = grounded(m);
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true }), w);
    spendCharge(p, w);

    let landingFrame = -1;
    for (let i = 0; i < 300 && landingFrame < 0; i++) {
      const wasCharged = p.flipCharged;
      const ev = p.update(STEP, inp({ flipPressed: true }), w);
      expect(ev.flipped).toBe(false); // refused on every frame up to and including landing
      if (!wasCharged && p.flipCharged) {
        landingFrame = i;
      }
    }
    expect(landingFrame).toBeGreaterThan(0);
    expect(p.gravitySign).toBe(1);
    // Pressed again the very next frame, it takes.
    expect(p.update(STEP, inp({ flipPressed: true }), w).flipped).toBe(true);
  });
});

describe('jump pads (GAME-DESIGN §5, decision 4)', () => {
  /** A floor with one up-pad set into it at column 3. */
  function padFloor(tile: Tile = Tile.PadUp): TileMap {
    const m = new TileMap(40, 14);
    m.fillRect(0, 10, 40, 4, Tile.Solid);
    m.set(3, 10, tile);
    return m;
  }

  /** Drop onto the pad from `dropPx` up and return the state at launch. */
  function launch(map: TileMap, dropPx: number, cx = 3 * TILE + TILE / 2): Player {
    const p = new Player(0, 0);
    p.spawnAt(cx, 10 * TILE - PLAYER_SIZE / 2 - dropPx);
    const w = world(map);
    for (let i = 0; i < 200; i++) {
      p.update(STEP, NO_INPUTS, w);
      if (p.body.vy < -100) {
        return p;
      }
    }
    throw new Error('never launched');
  }

  it('OVERRIDES rather than adds: the launch is identical however fast you arrive', () => {
    // A pad's launch height has to be predictable regardless of approach speed.
    const map = padFloor();
    const slow = launch(map, 1);
    const fast = launch(map, 400);
    expect(slow.body.vy).toBe(fast.body.vy);
    // The pad OVERWRITES vy after the step resolves, so it is the impulse
    // itself — not the impulse plus whatever the approach happened to be.
    expect(slow.body.vy).toBe(-PAD_IMPULSE);
  });

  it('a down-pad along gravity is a slam: the clamp catches it at MAX_FALL_SPEED', () => {
    // Struck from below, so the launch carries the body away from the pad
    // rather than back into it. Pointing WITH gravity the pad still hands over
    // the full 820, and the directional clamp takes it back to 768 on the very
    // next step — 93.7% of nominal. Terminal velocity is terminal; not a bug to
    // fix, and level design should read a down-pad as a slam, not a launch.
    const map = new TileMap(40, 40);
    map.fillRect(0, 34, 40, 4, Tile.Solid);
    map.set(3, 4, Tile.PadDown);
    const p = new Player(0, 0);
    p.spawnAt(3 * TILE + TILE / 2, 8 * TILE);
    p.body.vy = -700; // rising into the pad's underside
    const w = world(map);
    let fired = false;
    for (let i = 0; i < 90 && !fired; i++) {
      p.update(STEP, NO_INPUTS, w);
      fired = p.body.vy === PAD_IMPULSE;
    }
    expect(fired).toBe(true);
    p.update(STEP, NO_INPUTS, w);
    expect(p.body.vy).toBe(MAX_FALL_SPEED);
    expect(MAX_FALL_SPEED).toBeLessThan(PAD_IMPULSE);
  });

  it('a flat landing centred on a pad produces exactly zero spin', () => {
    // What makes "clip it with a corner and you leave spinning" a real
    // distinction rather than a constant tumble: the arm is measured from the
    // BODY's centre, so a flat hit anywhere on the slab is r × n = 0.
    const map = padFloor();
    const p = new Player(0, 0);
    p.spawnAt(3 * TILE + TILE / 2, 10 * TILE - PLAYER_SIZE / 2 - 200);
    const w = world(map);
    for (let i = 0; i < 90; i++) {
      p.update(STEP, NO_INPUTS, w);
      expect(p.body.angVel).toBe(0);
    }
  });

  it('PAD SPIN SIGN: contact right of centre on an up-pad sends omega NEGATIVE', () => {
    // n = (0, −1), so r × n = −r_x: a contact right of the centre lifts the
    // right side, counter-clockwise on screen. Stated so it is asserted rather
    // than discovered. A free-standing slab, because a pad set into a floor
    // merges with its neighbours and the contact lands back at the centre.
    const map = new TileMap(40, 14);
    map.set(3, 10, Tile.PadUp);
    const clip = (cx: number): number => {
      const p = new Player(0, 0);
      p.spawnAt(cx, 10 * TILE - PLAYER_SIZE / 2);
      const w = world(map);
      for (let i = 0; i < 20; i++) {
        p.update(STEP, NO_INPUTS, w);
        if (p.body.vy < -100) {
          return p.body.angVel;
        }
      }
      throw new Error('never launched');
    };
    // Body left of the slab: only its right corner is over the pad.
    expect(clip(3 * TILE + 4)).toBeLessThan(0);
    // Body right of the slab: only its left corner is.
    expect(clip(4 * TILE - 4)).toBeGreaterThan(0);
  });

  it('a full-corner clip is exactly PAD_SPIN_MAX, and nothing exceeds it', () => {
    const map = new TileMap(40, 14);
    map.set(3, 10, Tile.PadUp);
    const p = new Player(0, 0);
    p.spawnAt(3 * TILE + 4, 10 * TILE - PLAYER_SIZE / 2);
    const w = world(map);
    for (let i = 0; i < 20 && p.body.vy > -100; i++) {
      p.update(STEP, NO_INPUTS, w);
    }
    // Dropped from rest, so the approach is under IMPACT_SPEED_MIN and the
    // solver contributes no torque of its own: this is the pad's term alone.
    expect(Math.abs(p.body.angVel)).toBeCloseTo(PAD_SPIN_MAX, 6);
    expect(Math.abs(p.body.angVel)).toBeLessThanOrEqual(MAX_ANG_SPEED);
  });

  it('fires AT MOST ONCE per step, however many contacts carry the pad', () => {
    // One tile can be resolved on two different normals inside a single step —
    // a fast corner clip on a free-standing slab does exactly that — and
    // StepResult.contacts is keyed by normal, so the same pad appears twice.
    // The velocity override is idempotent; the spin is not, and firing twice
    // adds a second whole PAD_SPIN_MAX (plus a second sound and dust burst).
    //
    // Counted rather than inferred from angVel: MAX_ANG_SPEED clamps at 14 and
    // 2 x PAD_SPIN_MAX is 16, so a bound on the spin cannot see this at all.
    const map = new TileMap(20, 20);
    map.set(5, 10, Tile.PadUp);
    let worstPerStep = 0;
    let doubles = 0;
    for (let dx = -14; dx <= 14; dx++) {
      const p = new Player(0, 0);
      p.spawnAt(5 * TILE + TILE / 2 + dx, 10 * TILE - PLAYER_SIZE / 2 - 6);
      p.body.vy = 800; // fast enough to clip the corner and resolve twice
      let fires = 0;
      const w: EntityWorld = {
        map,
        particles: new ParticleSystem(),
        rng: new Rng(1),
        sfx: (n) => {
          if (n === 'pad') {
            fires++;
          }
        },
      };
      for (let i = 0; i < 4; i++) {
        fires = 0;
        p.update(STEP, NO_INPUTS, w);
        worstPerStep = Math.max(worstPerStep, fires);
        if (fires > 1) {
          doubles++;
        }
      }
    }
    expect(worstPerStep).toBe(1); // it does fire, and never more than once
    expect(doubles).toBe(0);
  });

  it('does not recharge the flip, however many pads you chain', () => {
    const map = padFloor();
    const p = new Player(0, 0);
    p.spawnAt(3 * TILE + TILE / 2, 10 * TILE - PLAYER_SIZE / 2 - 100);
    const w = world(map);
    spendCharge(p, w);
    for (let i = 0; i < 400; i++) {
      p.update(STEP, NO_INPUTS, w);
      expect(p.flipCharged).toBe(false);
    }
    // ...and it really was bouncing, not sitting somewhere inert.
    expect(p.body.y).toBeLessThan(10 * TILE - PLAYER_SIZE);
  });

  it('fires on contact with any face, since a pad is a tile and not a trigger', () => {
    // §5 fires a pad on contact, not on contact with its facing side. A pad set
    // into geometry has its sides masked as interior faces so the case mostly
    // cannot arise; on a free-standing slab it can, and the simple rule reads.
    const map = new TileMap(40, 14);
    map.fillRect(0, 12, 40, 2, Tile.Solid);
    map.set(3, 11, Tile.PadUp);
    const p = new Player(0, 0);
    p.spawnAt(5 * TILE, 11 * TILE + TILE / 2);
    const w = world(map);
    let launched = false;
    for (let i = 0; i < 120 && !launched; i++) {
      p.update(STEP, inp({ left: true }), w);
      launched = p.body.vy < -100;
    }
    expect(launched).toBe(true);
  });
});

describe('death planes (GAME-DESIGN §5)', () => {
  it('fires only once the body is ENTIRELY past the top or the bottom', () => {
    // The camera's CAMERA_VSLACK exists to keep the last frame legible, so the
    // threshold is "entirely past", not "centre past".
    const m = room();
    const w = world(m);
    const p = new Player(0, 0);

    p.spawnAt(5 * TILE, 0); // straddling the top edge: still on screen, alive
    expect(p.update(STEP, NO_INPUTS, w).died).toBe(false);
    p.spawnAt(5 * TILE, -PLAYER_SIZE);
    expect(p.update(STEP, NO_INPUTS, w).died).toBe(true);

    p.spawnAt(5 * TILE, m.heightPx);
    expect(p.update(STEP, NO_INPUTS, w).died).toBe(false);
    p.spawnAt(5 * TILE, m.heightPx + PLAYER_SIZE);
    expect(p.update(STEP, NO_INPUTS, w).died).toBe(true);
  });

  it('is symmetric under a flip — leaving through the ceiling is as lethal', () => {
    const m = room();
    const w = world(m);
    const p = grounded(m);
    p.update(STEP, inp({ flipPressed: true }), w); // gravity now points up
    let died = false;
    for (let i = 0; i < 600 && !died; i++) {
      died = p.update(STEP, NO_INPUTS, w).died;
    }
    expect(died).toBe(true);
    expect(p.body.y).toBeLessThan(0);
  });

  it('does not fire against a sealed side, or resting on the bottom row', () => {
    const m = room();
    const w = world(m);
    const p = grounded(m);
    for (let i = 0; i < 200; i++) {
      expect(p.update(STEP, inp({ left: true }), w).died).toBe(false);
    }
    expect(p.body.x).toBeLessThan(TILE); // jammed against the sealed edge
    const q = grounded(m);
    for (let i = 0; i < 60; i++) {
      expect(q.update(STEP, NO_INPUTS, w).died).toBe(false);
    }
  });
});

describe('spawnAt is the whole reset', () => {
  it('restores every field a respawn must not carry over', () => {
    // "A reset that forgets one field" is the classic source of "the second
    // attempt plays differently from the first", so the reset lives in one
    // place and the scene owns only the palette beside it.
    const m = room();
    const w = world(m);
    const p = grounded(m);
    p.update(STEP, inp({ jumpPressed: true, jumpHeld: true, right: true }), w);
    p.update(STEP, inp({ flipPressed: true, right: true }), w);
    expect(p.flipCharged).toBe(false);
    expect(p.gravitySign).toBe(-1);

    p.spawnAt(7 * TILE, 4 * TILE);
    expect(p.body.x).toBe(7 * TILE);
    expect(p.body.y).toBe(4 * TILE);
    expect(p.body.vx).toBe(0);
    expect(p.body.vy).toBe(0);
    expect(p.body.angle).toBe(0);
    expect(p.body.angVel).toBe(0);
    expect(p.onGround).toBe(false);
    expect(p.flipCharged).toBe(true);
    expect(p.gravitySign).toBe(1);
  });
});

// --- Phase 6: the emitters the player owns, and the ramp behind the splash.

/** A world that records what it was asked to play. */
function recordingWorld(map: TileMap): { w: EntityWorld; sfx: string[] } {
  const sfx: string[] = [];
  const w: EntityWorld = {
    map,
    particles: new ParticleSystem(),
    rng: new Rng(1),
    sfx: (n) => {
      sfx.push(n);
    },
  };
  return { w, sfx };
}

describe('splashCount', () => {
  it('ramps a barely-an-impact landing to a terminal slam, and clamps outside', () => {
    expect(splashCount(IMPACT_SPEED_MIN)).toBe(SPLASH_COUNT_MIN);
    expect(splashCount(MAX_FALL_SPEED)).toBe(SPLASH_COUNT_MAX);
    expect(splashCount(0)).toBe(SPLASH_COUNT_MIN);
    expect(splashCount(-500)).toBe(SPLASH_COUNT_MIN);
    expect(splashCount(4000)).toBe(SPLASH_COUNT_MAX);
    // Monotone between, and genuinely varying rather than a two-step staircase.
    let prev = -1;
    const seen = new Set<number>();
    for (let v = IMPACT_SPEED_MIN; v <= MAX_FALL_SPEED; v += 5) {
      const c = splashCount(v);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
      seen.add(c);
    }
    expect(seen.size).toBe(SPLASH_COUNT_MAX - SPLASH_COUNT_MIN + 1);
  });
});

describe('the step cadence is DISTANCE-driven', () => {
  /**
   * Sum the path the same way the accumulator does — over steps that both began
   * and ended grounded — reading `onGround`, which is public. The gate is
   * mirrored; the RAMP is the property under test, and it is the thing a timer
   * would get wrong.
   */
  function run(p: Player, w: EntityWorld, steps: number, held: (i: number) => PlayerInputs): {
    path: number;
    footfalls: number;
    sfx: string[];
  } {
    const sfx: string[] = [];
    const inner = { ...w, sfx: (n: string) => sfx.push(n) } as unknown as EntityWorld;
    let path = 0;
    for (let i = 0; i < steps; i++) {
      const was = p.onGround;
      const px = p.body.x;
      const py = p.body.y;
      p.update(STEP, held(i), inner);
      if (was && p.onGround) {
        path += Math.hypot(p.body.x - px, p.body.y - py);
      }
    }
    return { path, footfalls: sfx.filter((n) => n === 'step').length, sfx };
  }

  it('emits exactly floor(distance / STEP_SFX_DIST) footfalls at full speed', () => {
    const m = room();
    const p = grounded(m);
    const { w } = recordingWorld(m);
    const r = run(p, w, 100, () => inp({ right: true }));
    expect(r.footfalls).toBe(Math.floor(r.path / STEP_SFX_DIST));
    expect(r.footfalls).toBeGreaterThan(10); // or the assertion proves nothing
  });

  it('emits proportionally fewer over the same duration when moving slower', () => {
    const m = room();
    const fast = grounded(m);
    const slow = grounded(m, 3);
    const a = run(fast, recordingWorld(m).w, 120, () => inp({ right: true }));
    // Tap-and-coast: the same 120 frames at a fraction of the distance.
    const b = run(slow, recordingWorld(m).w, 120, (i) => inp({ right: i % 10 === 0 }));
    expect(b.path).toBeLessThan(a.path / 2);
    expect(b.footfalls).toBe(Math.floor(b.path / STEP_SFX_DIST));
    expect(b.footfalls).toBeLessThan(a.footfalls / 2);
  });

  it('emits NONE pressed into a wall at full throttle — the case a timer gets wrong', () => {
    const m = room();
    m.fillRect(6, 6, 1, 4, Tile.Solid); // a wall to the right of the spawn
    const p = grounded(m, 5);
    const r = run(p, recordingWorld(m).w, 200, () => inp({ right: true }));
    expect(p.onGround).toBe(true); // still standing, still holding right
    expect(r.path).toBeLessThan(STEP_SFX_DIST);
    expect(r.footfalls).toBe(0);
  });
});

describe('the emitters the player owns', () => {
  it('a flip rings, and a REFUSED flip emits nothing at all', () => {
    const m = room();
    const { w } = recordingWorld(m);
    const p = grounded(m);
    w.particles.clear();
    p.update(STEP, inp({ flipPressed: true }), w);
    expect(w.particles.aliveCount).toBe(FLIP_RING_COUNT);

    w.particles.clear();
    const before = p.update(STEP, inp({ flipPressed: true }), w);
    expect(before.flipped).toBe(false);
    expect(w.particles.aliveCount).toBe(0);
  });

  it('a landing splashes in proportion to the impact', () => {
    const m = room();
    const drop = (fromY: number): number => {
      const { w } = recordingWorld(m);
      const p = new Player(0, 0);
      p.spawnAt(5 * TILE + TILE / 2, fromY);
      let landed = 0;
      for (let i = 0; i < 300 && landed === 0; i++) {
        w.particles.clear();
        p.update(STEP, NO_INPUTS, w);
        landed = w.particles.aliveCount;
      }
      return landed;
    };
    // A short drop is barely an impact; 600 px is long enough to arrive at
    // MAX_FALL_SPEED, which is terminal and should read as a slam.
    const gentle = drop(10 * TILE - PLAYER_SIZE / 2 - 6);
    const slam = drop(10 * TILE - PLAYER_SIZE / 2 - 600);
    expect(gentle).toBeGreaterThanOrEqual(SPLASH_COUNT_MIN);
    expect(slam).toBe(SPLASH_COUNT_MAX);
    expect(slam).toBeGreaterThan(gentle * 3);
  });

  it('PlayerEvents did NOT grow — the landing impulse is still read off the contacts', () => {
    // Phase 5 kept a landing impulse off this object on the grounds that a
    // field with no consumer is a placeholder. The consumer now exists and the
    // object still has two fields, because the player was already walking the
    // contacts for the recharge and the pad.
    const m = room();
    const p = grounded(m);
    const ev = p.update(STEP, NO_INPUTS, recordingWorld(m).w);
    expect(Object.keys(ev).sort()).toEqual(['died', 'flipped']);
  });
});
