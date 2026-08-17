/**
 * The rigid-body solver. Structured around the failures each decision in the
 * phase 4 brief exists to prevent, because a solver that merely "runs" is easy
 * and a solver that rests a flat square is not.
 */

import { describe, expect, it } from 'vitest';
import {
  ANG_DAMP_AIR,
  CONTACT_SLOP,
  GRAVITY_FALL,
  GRAVITY_RISE,
  GROUND_ACCEL,
  IMPACT_SPEED_MIN,
  JUMP_SPIN_BASE,
  JUMP_SPIN_PER_SPEED,
  JUMP_VELOCITY,
  MAX_ANG_SPEED,
  MAX_FALL_SPEED,
  MAX_SUBSTEP,
  PLAYER_INERTIA,
  PLAYER_SIZE,
  RUN_SPEED,
  SPIN_TRANSFER,
  STEP,
  TILE,
} from '../src/constants';
import { Rng } from '../src/engine/rng';
import { createBody, rightAngleError, stepBody, subStepCount } from '../src/world/physics';
import type { RigidBody, StepOptions } from '../src/world/physics';
import { Tile, TileMap, tileFromChar } from '../src/world/tiles';

const DOWN: StepOptions = { gravitySign: 1 };
const UP: StepOptions = { gravitySign: -1 };

/** Build a map from ASCII art, using the level format's own characters. */
function mapFrom(rows: string[]): TileMap {
  const m = new TileMap(rows[0].length, rows.length);
  rows.forEach((row, ty) => {
    for (let tx = 0; tx < row.length; tx++) {
      const t = tileFromChar(row[tx]);
      if (t === null) {
        throw new Error(`mapFrom: unknown char '${row[tx]}' at ${tx},${ty}`);
      }
      m.set(tx, ty, t);
    }
  });
  return m;
}

function body(cx: number, cy: number, vx = 0, vy = 0): RigidBody {
  const b = createBody(cx, cy, PLAYER_SIZE);
  b.vx = vx;
  b.vy = vy;
  return b;
}

/** A wide empty room, for tests that want gravity and nothing else. */
function openSky(): TileMap {
  return new TileMap(120, 120);
}

/** Half-extent of the square along either world axis at `angle`. */
function halfExtent(angle: number): number {
  return (PLAYER_SIZE / 2) * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)));
}

describe('subStepCount (decision 4)', () => {
  it('uses the displacement magnitude, not the larger component', () => {
    // 6 px on each axis is 8.49 px of travel: max-of-components would say one
    // sub-step and under-count diagonal motion by up to √2.
    expect(subStepCount(6, 6, 0, PLAYER_SIZE, STEP)).toBe(2);
    expect(subStepCount(6, 0, 0, PLAYER_SIZE, STEP)).toBe(1);
  });

  it('full run plus terminal fall is 13.5 px, so two sub-steps', () => {
    const n = subStepCount(RUN_SPEED * STEP, MAX_FALL_SPEED * STEP, 0, PLAYER_SIZE, STEP);
    expect(Math.hypot(RUN_SPEED * STEP, MAX_FALL_SPEED * STEP)).toBeCloseTo(13.49, 2);
    expect(n).toBe(2);
  });

  it('a fast spin alone can force sub-steps', () => {
    // A corner at MAX_ANG_SPEED sweeps 3.3 px per frame — under the cap on its
    // own, but the term is there so a thin wall can never be whipped through.
    expect(MAX_ANG_SPEED * STEP * PLAYER_SIZE * Math.SQRT1_2).toBeLessThan(MAX_SUBSTEP);
    expect(subStepCount(0, 0, 60, PLAYER_SIZE, STEP)).toBeGreaterThan(1);
  });

  it('never returns less than one', () => {
    expect(subStepCount(0, 0, 0, PLAYER_SIZE, STEP)).toBe(1);
  });
});

describe('the integrator (decision 1)', () => {
  it('the sampled apex lies ON the parabola, not 5% under it', () => {
    // Average-velocity integration is exact for constant acceleration, so the
    // only error left is that the true apex falls between two samples. Phase
    // 2's Euler step missed by 5.2%; if this is anywhere near that, the
    // integrator is not what the brief says it is.
    const map = openSky();
    const b = body(60 * TILE, 100 * TILE, 0, -JUMP_VELOCITY);
    const startY = b.y;
    let minY = b.y;
    for (let i = 0; i < 60 && b.vy < 0; i++) {
      stepBody(b, map, STEP, DOWN);
      minY = Math.min(minY, b.y);
    }
    const simPeak = startY - minY;
    const analytic = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY_RISE);
    expect(analytic).toBeCloseTo(111.364, 3);
    expect(simPeak).toBeCloseTo(111.361, 3);
    expect(Math.abs(simPeak - analytic) / analytic).toBeLessThan(0.0001);
  });

  it('leaves vy exactly zero at rest, so speedNorm can reach zero', () => {
    // Kick-drift-kick would store GRAVITY_FALL · STEP / 2 = 29.3 px/s forever.
    const map = mapFrom(['....', '....', '####']);
    const b = body(48, 30);
    for (let i = 0; i < 120; i++) {
      stepBody(b, map, STEP, DOWN);
    }
    expect(b.vy).toBe(0);
    expect(GRAVITY_FALL * STEP * 0.5).toBeCloseTo(29.33, 2);
  });

  it('caps falling at terminal velocity but never motion against gravity', () => {
    const map = openSky();
    const b = body(60 * TILE, 10 * TILE);
    for (let i = 0; i < 120; i++) {
      stepBody(b, map, STEP, DOWN);
    }
    expect(b.vy).toBe(MAX_FALL_SPEED);
    // A pad launch is faster than terminal and must survive the clamp.
    const up = body(60 * TILE, 100 * TILE, 0, -820);
    stepBody(up, map, STEP, DOWN);
    expect(up.vy).toBeLessThan(-780);
  });

  it('airtime is 0.570 s — 34 steps and a bit', () => {
    const map = openSky();
    const b = body(60 * TILE, 100 * TILE, 0, -JUMP_VELOCITY);
    const startY = b.y;
    let steps = 0;
    while (steps < 200) {
      stepBody(b, map, STEP, DOWN);
      steps++;
      if (b.y >= startY) {
        break;
      }
    }
    expect(steps).toBe(35); // 34.2 analytic: the crossing lands inside step 35
    const riseT = JUMP_VELOCITY / GRAVITY_RISE;
    const fallT = Math.sqrt((2 * ((JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY_RISE))) / GRAVITY_FALL);
    expect(riseT + fallT).toBeCloseTo(0.5697, 4);
  });
});

describe('the flat rest (decision 2)', () => {
  const floor = mapFrom(['....', '....', '....', '####']);

  it('a flat square lands flat and stays bit-identically still', () => {
    const b = body(48, 60); // within a single tile's width, 36 px above the floor
    const ys: number[] = [];
    const xs: number[] = [];
    // The WHOLE trajectory, not the endpoint. Asserting only the final state
    // has no teeth: the naive single-deepest-vertex contact point kicks the
    // landing to −12.25 rad/s, tumbles visibly, and the auto-right spring then
    // returns it to exactly zero inside 100 steps — so an end-state assertion
    // passes on the very implementation it is named for. A flat landing must
    // produce no rotation at ANY point, and that is what fails against it.
    let maxSpin = 0;
    let maxAngle = 0;
    for (let i = 0; i < 300; i++) {
      stepBody(b, floor, STEP, DOWN);
      maxSpin = Math.max(maxSpin, Math.abs(b.angVel));
      maxAngle = Math.max(maxAngle, Math.abs(b.angle));
      ys.push(b.y);
      xs.push(b.x);
    }
    expect(maxSpin).toBe(0);
    expect(maxAngle).toBe(0);
    expect(Math.abs(b.angVel)).toBeLessThan(1e-6);
    expect(b.angle).toBe(0);
    expect(b.vy).toBe(0);
    // The last 100 samples are the same float, not merely close: positional
    // correction to exactly CONTACT_SLOP makes rest a fixed point.
    const tail = ys.slice(-100);
    expect(new Set(tail).size).toBe(1);
    expect(new Set(xs.slice(-100)).size).toBe(1);
    // Resting means CONTACT_SLOP INSIDE the tile, so the centre sits that much
    // below the surface — the residual is the fixed point, not an error.
    expect(tail[0]).toBeCloseTo(3 * TILE - PLAYER_SIZE / 2 + CONTACT_SLOP, 6);
  });

  it('straddling two tiles rests just as dead as sitting on one', () => {
    const b = body(64, 60); // centred exactly on the seam between two tiles
    for (let i = 0; i < 300; i++) {
      stepBody(b, floor, STEP, DOWN);
    }
    expect(Math.abs(b.angVel)).toBeLessThan(1e-6);
    expect(b.vy).toBe(0);
    expect(b.x).toBe(64);
  });

  it('a fast flat landing produces zero spin, where one vertex would give 14.4 rad/s', () => {
    const b = body(48, 20, 0, 400);
    for (let i = 0; i < 60; i++) {
      stepBody(b, floor, STEP, DOWN);
    }
    expect(Math.abs(b.angVel)).toBeLessThan(1e-6);

    // What the naive deepest-vertex rule would have done instead, from the same
    // numbers: a tie-break picks one bottom corner, r × n = ∓s/2, and the
    // landing answers a perfectly flat approach with a spin over MAX_ANG_SPEED.
    const rxn = PLAYER_SIZE / 2;
    const naiveJ = 400 / (1 + (rxn * rxn) / PLAYER_INERTIA);
    const naiveSpin = (SPIN_TRANSFER * naiveJ * rxn) / PLAYER_INERTIA;
    expect(naiveSpin).toBeCloseTo(14.4, 1);
    expect(naiveSpin).toBeGreaterThan(MAX_ANG_SPEED);
  });

  it('and the same rule would inject 2.11 rad/s on every RESTING step', () => {
    // The failure decision 2 is really about: not the landing, the standing
    // still afterwards. Tapering against ground damping settles at ≈4.4 rad/s —
    // a permanent 250°/s roll, identical on every flat landing in the game.
    const rxn = PLAYER_SIZE / 2;
    const restingApproach = GRAVITY_FALL * STEP;
    const naiveJ = restingApproach / (1 + (rxn * rxn) / PLAYER_INERTIA);
    expect(naiveJ).toBeCloseTo(23.47, 2);
    expect((SPIN_TRANSFER * naiveJ * rxn) / PLAYER_INERTIA).toBeCloseTo(2.11, 2);
  });
});

describe('impact versus contact (decision 3)', () => {
  it('the threshold is twice one step of gravity — a 1.96 px drop', () => {
    expect(IMPACT_SPEED_MIN).toBeCloseTo(117.33, 2);
    expect((IMPACT_SPEED_MIN * IMPACT_SPEED_MIN) / (2 * GRAVITY_FALL)).toBeCloseTo(1.96, 2);
    // A resting body re-penetrates by 0.489 px per step and approaches at half
    // the threshold, so "a contact happened" can never discriminate.
    expect(GRAVITY_FALL * STEP).toBeLessThan(IMPACT_SPEED_MIN);
  });

  it('auto-rights a 25° landing to under 0.02 rad in 24 steps, no overshoot', () => {
    const floor = mapFrom(['....', '....', '....', '####']);
    const angle = (25 * Math.PI) / 180;
    // Set down with its low corner exactly on the surface, so it settles rather
    // than impacts: below IMPACT_SPEED_MIN the spring owns the whole motion.
    const b = body(48, 3 * TILE - halfExtent(angle));
    b.angle = angle;
    const errs: number[] = [];
    for (let i = 0; i < 24; i++) {
      stepBody(b, floor, STEP, DOWN);
      errs.push(rightAngleError(b.angle));
    }
    expect(Math.abs(errs[errs.length - 1])).toBeLessThan(0.02);
    // Critically damped: never crosses zero, never grows.
    for (let i = 0; i < errs.length; i++) {
      expect(errs[i]).toBeGreaterThanOrEqual(0);
      if (i > 0) {
        expect(errs[i]).toBeLessThanOrEqual(errs[i - 1] + 1e-12);
      }
    }
  });

  it('and then snaps to exactly flat and exactly still', () => {
    const floor = mapFrom(['....', '....', '....', '####']);
    const angle = (25 * Math.PI) / 180;
    const b = body(48, 3 * TILE - halfExtent(angle));
    b.angle = angle;
    for (let i = 0; i < 120; i++) {
      stepBody(b, floor, STEP, DOWN);
    }
    expect(b.angle).toBe(0);
    expect(b.angVel).toBe(0);
  });
});

describe('corners', () => {
  it('tips off a ledge with POSITIVE ω — right side down', () => {
    // Floor stops at column 1; the box's centre is 2 px past its edge, so only
    // the left-hand bottom corner is over solid tile: r = (−10, +10),
    // n = (0, −1), r × n = +10.
    const ledge = mapFrom(['....', '....', '....', '##..']);
    const b = body(66, 3 * TILE - PLAYER_SIZE / 2 - 6, 0, 200);
    let spun = 0;
    for (let i = 0; i < 6; i++) {
      const res = stepBody(b, ledge, STEP, DOWN);
      if (res.contactCount > 0) {
        spun = b.angVel;
        break;
      }
    }
    expect(spun).toBeGreaterThan(1);
    expect(spun).toBeLessThanOrEqual(MAX_ANG_SPEED);
  });

  it('reports the contact point, normal and impulse for effects to read', () => {
    const floor = mapFrom(['....', '....', '....', '####']);
    const b = body(48, 20, 0, 400);
    let hit = null as null | { x: number; y: number; nx: number; ny: number; impulse: number };
    for (let i = 0; i < 60; i++) {
      const res = stepBody(b, floor, STEP, DOWN);
      if (res.landed) {
        hit = { ...res.contacts[0] };
        break;
      }
    }
    expect(hit).not.toBeNull();
    expect(hit?.nx).toBe(0);
    expect(hit?.ny).toBe(-1);
    expect(hit?.x).toBeCloseTo(48, 6); // face centre, not a corner
    expect(hit?.impulse).toBeGreaterThan(400);
  });
});

describe('the arcade half of the split (hard rule 7)', () => {
  it('running flat for 300 steps loses exactly zero vx', () => {
    const floor = mapFrom(Array.from({ length: 3 }, () => '.'.repeat(60)).concat(['#'.repeat(60)]));
    const b = body(48, 3 * TILE - PLAYER_SIZE / 2 - CONTACT_SLOP, RUN_SPEED);
    for (let i = 0; i < 300; i++) {
      b.vx = RUN_SPEED; // the controller holds it there; the solver must not fight
      stepBody(b, floor, STEP, DOWN);
      expect(b.vx).toBe(RUN_SPEED);
    }
    expect(b.x).toBeGreaterThan(48 + 300 * RUN_SPEED * STEP - 1);
  });

  it('a wall stops you dead without spinning you or sticking', () => {
    const room = mapFrom(['#....#', '#....#', '#....#', '######']);
    const b = body(3 * TILE, 2 * TILE, RUN_SPEED);
    let hitWall = false;
    for (let i = 0; i < 40; i++) {
      const res = stepBody(b, room, STEP, DOWN);
      for (let c = 0; c < res.contactCount; c++) {
        if (res.contacts[c].nx !== 0) {
          hitWall = true;
        }
      }
      if (hitWall) {
        break;
      }
    }
    expect(hitWall).toBe(true);
    expect(b.vx).toBe(0);
    expect(Math.abs(b.angVel)).toBeLessThan(1e-9);
    // Control returns the instant you press away.
    b.vx = -RUN_SPEED;
    stepBody(b, room, STEP, DOWN);
    expect(b.vx).toBe(-RUN_SPEED);
  });
});

describe('gravity is a sign, not a direction', () => {
  it('with gravitySign = −1 a body falls up, lands on the ceiling, and is grounded', () => {
    const cave = mapFrom(['####', '....', '....', '####']);
    const b = body(48, 2 * TILE + 16);
    let res = stepBody(b, cave, STEP, UP);
    expect(b.vy).toBeLessThan(0);
    for (let i = 0; i < 120; i++) {
      res = stepBody(b, cave, STEP, UP);
    }
    expect(res.grounded).toBe(true);
    expect(res.hitCeiling).toBe(false);
    expect(b.vy).toBe(0);
    // Resting on what was the ceiling: the underside of row 0.
    expect(b.y).toBeCloseTo(TILE + PLAYER_SIZE / 2 - CONTACT_SLOP, 6);
    expect(b.angle).toBe(0);
  });

  it('the same body reports hitCeiling when it meets the floor head-first', () => {
    const cave = mapFrom(['####', '....', '....', '####']);
    // 500 px/s buys 57 px against the 2200 px/s² of upward "rise" gravity; the
    // floor is 22 px away. At 300 it stalls 1.5 px short, which is a fine
    // reminder that "down" here is entirely a matter of sign.
    const b = body(48, 2 * TILE, 0, 500);
    let ceiling = false;
    for (let i = 0; i < 60; i++) {
      if (stepBody(b, cave, STEP, UP).hitCeiling) {
        ceiling = true;
        break;
      }
    }
    expect(ceiling).toBe(true);
  });
});

describe('the one-tile corridor', () => {
  const shaft = mapFrom(['#####', '##.##', '##.##', '##.##', '##.##', '##.##']);

  for (const deg of [0, 22.5, 45]) {
    it(`drops through a vertical shaft at ${deg}° with a 1 px lateral offset`, () => {
      const b = body(81, 48); // shaft centre is 80
      b.angle = (deg * Math.PI) / 180;
      for (let i = 0; i < 90; i++) {
        stepBody(b, shaft, STEP, DOWN);
        expect(Math.abs(b.angVel)).toBeLessThanOrEqual(MAX_ANG_SPEED);
      }
      expect(b.y).toBeGreaterThan(shaft.heightPx);
    });
  }

  it('runs through a horizontal corridor while spinning at 8 rad/s', () => {
    const rows = ['#'.repeat(24), '.'.repeat(24), '#'.repeat(24)];
    const corridor = mapFrom(rows);
    const b = body(48, 48, RUN_SPEED);
    b.angVel = 8;
    for (let i = 0; i < 180; i++) {
      b.vx = RUN_SPEED;
      stepBody(b, corridor, STEP, DOWN);
      expect(Math.abs(b.angVel)).toBeLessThanOrEqual(MAX_ANG_SPEED);
    }
    expect(b.x).toBeGreaterThan(20 * TILE);
  });

  it('3.72 px of clearance at the worst angle, 1.86 per side', () => {
    expect(TILE - PLAYER_SIZE * Math.SQRT2).toBeCloseTo(3.72, 2);
  });
});

describe('degenerate cases', () => {
  it('does not tunnel a one-tile floor entered at 4000 px/s', () => {
    const floor = mapFrom(['....', '....', '....', '####', '....']);
    const b = body(48, 20, 0, 4000);
    for (let i = 0; i < 10; i++) {
      stepBody(b, floor, STEP, DOWN);
    }
    expect(b.y).toBeLessThan(3 * TILE);
    expect(b.vy).toBe(0);
  });

  it('an inside corner is a fixed point, not an oscillator', () => {
    const corner = mapFrom(['#...', '#...', '#...', '####']);
    const b = body(60, 60, -300, 300);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 300; i++) {
      // Held against the wall the whole time, but ACCELERATED there the way a
      // controller does. Teleporting vx back to −300 every step is what would
      // make this buzz: each re-supply is a fresh above-threshold impact, so
      // the tilted corner gets torqued, the spring stays suppressed, and the
      // pair settles into a period-2 limit cycle. Nothing in the game can do
      // that — GROUND_ACCEL · STEP is 35 px/s, comfortably under the impact
      // gate — and the gate is what closes the wedge oscillation this phase
      // was most at risk of.
      b.vx = Math.max(-300, b.vx - GROUND_ACCEL * STEP);
      stepBody(b, corner, STEP, DOWN);
      xs.push(b.x);
      ys.push(b.y);
    }
    expect(new Set(xs.slice(-100)).size).toBe(1);
    expect(new Set(ys.slice(-100)).size).toBe(1);
    // Both residuals point INTO their surface: pushed right off the wall, and
    // sunk into the floor.
    expect(b.x).toBeCloseTo(TILE + PLAYER_SIZE / 2 - CONTACT_SLOP, 6);
    expect(b.y).toBeCloseTo(3 * TILE - PLAYER_SIZE / 2 + CONTACT_SLOP, 6);
  });
});

describe('determinism', () => {
  it('600 steps of scripted input reproduce bit-identically', () => {
    const rows = ['.'.repeat(40), '.'.repeat(40), '.'.repeat(40), '.'.repeat(40)]
      .concat(['####...####..#####.....########..#######'])
      .concat(['.'.repeat(40), '.'.repeat(40)])
      .concat(['########################################']);

    const run = (): { trace: number[]; contacts: number; travel: number; spin: number } => {
      const map = mapFrom(rows);
      const rng = new Rng(0xb1acc);
      const b = body(48, 40);
      const trace: number[] = [];
      let contacts = 0;
      let spin = 0;
      let travel = 0;
      let px = b.x;
      let py = b.y;
      for (let i = 0; i < 600; i++) {
        // A scripted controller: shove horizontally, jump periodically.
        b.vx = (rng.next() * 2 - 1) * RUN_SPEED;
        if (i % 37 === 0) {
          b.vy = -JUMP_VELOCITY;
          b.angVel += JUMP_SPIN_BASE;
        }
        const res = stepBody(b, map, STEP, DOWN);
        contacts += res.contactCount;
        spin = Math.max(spin, Math.abs(b.angle));
        travel += Math.hypot(b.x - px, b.y - py);
        px = b.x;
        py = b.y;
        trace.push(b.x, b.y, b.vx, b.vy, b.angle, b.angVel);
      }
      return { trace, contacts, travel, spin };
    };

    const a = run();
    const c = run();
    expect(a.trace.length).toBe(6 * 600);
    for (let i = 0; i < a.trace.length; i++) {
      expect(a.trace[i]).toBe(c.trace[i]);
    }
    // Without this the assertion above would pass just as happily on a body
    // that never left the spawn. Path length, not net displacement: the
    // scripted vx is a random walk and can land back where it started.
    expect(a.contacts).toBeGreaterThan(20);
    expect(a.travel).toBeGreaterThan(2000);
    expect(a.spin).toBeGreaterThan(1);
  });
});

describe('the §6 derived targets', () => {
  it('fall gravity is 1.6× rise gravity; terminal is 24 tiles/s', () => {
    expect(GRAVITY_FALL / GRAVITY_RISE).toBeCloseTo(1.6, 6);
    expect(MAX_FALL_SPEED / TILE).toBe(24);
  });

  it('jump peak is 3.48 tiles', () => {
    expect((JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY_RISE) / TILE).toBeCloseTo(3.48, 2);
  });

  it('full-speed jump clearance is 4.56 tiles — 4-tile gaps only', () => {
    const riseT = JUMP_VELOCITY / GRAVITY_RISE;
    const peakPx = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY_RISE);
    const fallT = Math.sqrt((2 * peakPx) / GRAVITY_FALL);
    const clearanceTiles = ((riseT + fallT) * RUN_SPEED) / TILE;
    expect(clearanceTiles).toBeCloseTo(4.56, 2);
    expect(clearanceTiles).toBeLessThan(5);
  });

  it('a standing jump turns ≈73° and a full-speed jump ≈178°', () => {
    const map = openSky();
    const airtime =
      JUMP_VELOCITY / GRAVITY_RISE +
      Math.sqrt((JUMP_VELOCITY * JUMP_VELOCITY) / GRAVITY_RISE / GRAVITY_FALL);

    /** Simulated rotation over exactly `airtime` — 34.18 steps, so the last is partial. */
    const turn = (vx: number): number => {
      const b = body(60 * TILE, 100 * TILE, vx, -JUMP_VELOCITY);
      b.angVel = JUMP_SPIN_BASE + JUMP_SPIN_PER_SPEED * Math.abs(vx);
      const whole = Math.floor(airtime / STEP);
      for (let i = 0; i < whole; i++) {
        stepBody(b, map, STEP, DOWN);
      }
      return ((b.angle + b.angVel * (airtime - whole * STEP)) * 180) / Math.PI;
    };
    /** The continuous target: ω₀ · (1 − e^{−λT}) / λ. */
    const analytic = (vx: number): number =>
      (((JUMP_SPIN_BASE + JUMP_SPIN_PER_SPEED * Math.abs(vx)) *
        ((1 - Math.exp(-ANG_DAMP_AIR * airtime)) / ANG_DAMP_AIR) *
        180) /
        Math.PI);

    expect(analytic(0)).toBeCloseTo(73.0, 1);
    expect(analytic(RUN_SPEED)).toBeCloseTo(177.6, 1);
    expect(turn(0)).toBeCloseTo(73.2, 1);
    expect(turn(RUN_SPEED)).toBeCloseTo(178.2, 1);
    // Well inside ±2 %, and the residual is a known, predicted bias rather than
    // slop: applying damping AFTER the advance sums ω₀·h·Σdᵏ instead of the
    // integral, which is high by h·λ/2 = 0.33 %.
    for (const vx of [0, RUN_SPEED]) {
      const bias = turn(vx) / analytic(vx) - 1;
      expect(Math.abs(bias)).toBeLessThan(0.02);
      expect(bias).toBeCloseTo(0.0033, 4);
    }
  });

  it('a fast jump lands on the opposite face, a standing one does not', () => {
    // The design claim behind the two numbers: ≈178° is close enough to a
    // half-turn that a full-speed jump usually lands on the face it took off
    // from, upside down; 73° lands you on an edge and settles.
    const airtime =
      JUMP_VELOCITY / GRAVITY_RISE +
      Math.sqrt((JUMP_VELOCITY * JUMP_VELOCITY) / GRAVITY_RISE / GRAVITY_FALL);
    const factor = (1 - Math.exp(-ANG_DAMP_AIR * airtime)) / ANG_DAMP_AIR;
    const fast = ((JUMP_SPIN_BASE + JUMP_SPIN_PER_SPEED * RUN_SPEED) * factor * 180) / Math.PI;
    expect(Math.abs(fast - 180)).toBeLessThan(5);
    expect(((JUMP_SPIN_BASE * factor * 180) / Math.PI) % 90).toBeGreaterThan(20);
  });
});

describe('the phase exit condition', () => {
  it('drives a body through a hand-built grid and lands it, spinning, on a target tile', () => {
    //             0         1
    //             0123456789012345678
    const grid = [
      '....................',
      '....................',
      '....................',
      '....................',
      '......##########....',
      '....................',
      '.####...............',
      '....................',
      '####################',
    ];
    const map = mapFrom(grid);
    // Start on the low ledge at row 6, run right, jump the gap, land two tiles
    // higher on the wide ledge at row 4 — a 4.1-tile carry, inside the 4.56
    // the §6 numbers promise.
    const b = body(3 * TILE + 16, 6 * TILE - PLAYER_SIZE / 2 - 1);
    let jumped = false;
    let landedOnTarget = false;
    let spinAtTakeoff = 0;
    for (let i = 0; i < 240; i++) {
      b.vx = RUN_SPEED;
      if (!jumped && b.x > 4 * TILE) {
        b.vy = -JUMP_VELOCITY;
        b.angVel += JUMP_SPIN_BASE + JUMP_SPIN_PER_SPEED * Math.abs(b.vx);
        spinAtTakeoff = b.angVel;
        jumped = true;
      }
      const res = stepBody(b, map, STEP, DOWN);
      if (res.landed && b.y < 4 * TILE) {
        landedOnTarget = true;
        break;
      }
    }
    expect(jumped).toBe(true);
    expect(spinAtTakeoff).toBeGreaterThan(6);
    expect(landedOnTarget).toBe(true);
    // Resting on the target tile's surface — on a corner, not flat, so the
    // centre sits somewhere between s/2 and the half-diagonal above it.
    expect(b.y).toBeLessThanOrEqual(4 * TILE - PLAYER_SIZE / 2);
    expect(b.y).toBeGreaterThan(4 * TILE - halfExtent(Math.PI / 4) - 0.5);
    expect(b.x).toBeGreaterThan(7 * TILE);
    expect(b.x).toBeLessThan(16 * TILE);
    // Still spinning when it got there — that is the headline of the phase.
    expect(Math.abs(b.angle)).toBeGreaterThan(2);
  });
});

describe('pads are blocking geometry (phase 5, decision 1)', () => {
  /** A floor with a PadUp set into it at column 10, and open sky above. */
  function padFloor(): TileMap {
    return mapFrom([
      '..................',
      '..................',
      '..................',
      '##########^#######',
      '##################',
    ]);
  }

  const FLOOR_TOP = 3 * TILE;

  /** A body settled flat on that floor, well left of the pad. */
  function settledOnFloor(map: TileMap, tx = 4): RigidBody {
    const b = body(tx * TILE + TILE / 2, FLOOR_TOP - PLAYER_SIZE / 2);
    for (let i = 0; i < 20; i++) {
      stepBody(b, map, STEP, DOWN);
    }
    return b;
  }

  it('THE PAD SEAM: landing across a pad and the floor beside it produces no spin', () => {
    // The assertion the phase exists to protect, and the one that is actually
    // load-bearing: straddle the boundary so the FLOOR tile is the one left
    // with a sliver of horizontal overlap. If its face toward the pad is not
    // masked as interior — because the mask still asks `=== Tile.Solid` and a
    // pad is not Solid — then that tile's cheapest separating axis is sideways,
    // the landing is shoved ALONG the floor from a single corner, and the
    // square leaves spinning. Phase 4 measured the identical failure between
    // two plain tiles at 8.07 rad/s.
    const map = padFloor();
    const b = body(10 * TILE + 9, FLOOR_TOP - 72);
    let worstSpin = 0;
    let worstDrift = 0;
    for (let i = 0; i < 120; i++) {
      stepBody(b, map, STEP, DOWN);
      worstSpin = Math.max(worstSpin, Math.abs(b.angVel));
      worstDrift = Math.max(worstDrift, Math.abs(b.x - (10 * TILE + 9)));
    }
    expect(worstSpin).toBe(0);
    expect(worstDrift).toBe(0); // not shoved sideways either
    expect(b.y + PLAYER_SIZE / 2).toBeCloseTo(FLOOR_TOP + CONTACT_SLOP, 6);
  });

  it('running over a pad set into a floor produces no spin, ever', () => {
    // This is the assertion the phase exists to protect. A pad is collidable,
    // so its neighbours' faces toward it must be masked as interior — exactly
    // as two plain floor tiles mask each other. Miss that and the pad's own
    // cheapest separating axis is sideways: the landing gets shoved ALONG the
    // floor and answers with several rad/s of spin conjured out of a seam.
    // Phase 4 measured the identical failure on plain tiles at 8.07 rad/s.
    const map = padFloor();
    const b = settledOnFloor(map);
    expect(b.angVel).toBe(0);

    let worstSpin = 0;
    let worstSink = 0;
    for (let i = 0; i < 60; i++) {
      b.vx = RUN_SPEED; // the controller holds it; the tangent must be untouched
      stepBody(b, map, STEP, DOWN);
      worstSpin = Math.max(worstSpin, Math.abs(b.angVel));
      worstSink = Math.max(worstSink, b.y + PLAYER_SIZE / 2 - FLOOR_TOP);
    }
    // Crossed the pad and kept going.
    expect(b.x).toBeGreaterThan(12 * TILE);
    expect(worstSpin).toBeLessThan(1e-9);
    expect(b.angle).toBe(0);
    // And it stayed on top of the pad rather than dipping into it: the pad is
    // floor, not a hole in the floor.
    expect(worstSink).toBeLessThan(1);
  });

  it('the seam is masked in both directions — the same run leftward is as clean', () => {
    const map = padFloor();
    const b = settledOnFloor(map, 15);
    for (let i = 0; i < 60; i++) {
      b.vx = -RUN_SPEED;
      stepBody(b, map, STEP, DOWN);
      expect(Math.abs(b.angVel)).toBeLessThan(1e-9);
    }
    expect(b.x + PLAYER_SIZE / 2).toBeLessThan(10 * TILE); // fully past the pad
  });

  it('a free-standing pad stops a falling body like any other tile', () => {
    const map = mapFrom(['....', '....', '....', '.^..']);
    const b = body(TILE + TILE / 2, TILE / 2, 0, 0);
    for (let i = 0; i < 120; i++) {
      stepBody(b, map, STEP, DOWN);
    }
    expect(b.y + PLAYER_SIZE / 2).toBeCloseTo(3 * TILE, 1);
    expect(b.vy).toBe(0);
  });

  it('all four pad kinds block; only Empty does not', () => {
    for (const ch of ['^', 'v', '<', '>', '#']) {
      const map = mapFrom(['....', '....', `.${ch}..`]);
      const b = body(TILE + TILE / 2, TILE / 2);
      for (let i = 0; i < 60; i++) {
        stepBody(b, map, STEP, DOWN);
      }
      expect(b.y + PLAYER_SIZE / 2).toBeCloseTo(2 * TILE, 1);
    }
    const open = mapFrom(['....', '....', '....']);
    const b = body(TILE + TILE / 2, TILE / 2);
    for (let i = 0; i < 60; i++) {
      stepBody(b, open, STEP, DOWN);
    }
    expect(b.y).toBeGreaterThan(3 * TILE); // fell straight out of the world
  });
});

describe('contacts carry tile identity (phase 5, decision 2)', () => {
  /** The contact whose normal opposes gravity, i.e. the one you landed on. */
  function groundContact(res: ReturnType<typeof stepBody>) {
    for (let i = 0; i < res.contactCount; i++) {
      if (res.contacts[i].ny < -0.7) {
        return res.contacts[i];
      }
    }
    return null;
  }

  function dropOnto(rows: string[], cx: number): { pad: Tile; onSolid: boolean } {
    const map = mapFrom(rows);
    const b = body(cx, TILE / 2);
    let seen = { pad: Tile.Empty, onSolid: false };
    for (let i = 0; i < 90; i++) {
      const res = stepBody(b, map, STEP, DOWN);
      const c = groundContact(res);
      if (c) {
        seen = { pad: c.pad, onSolid: c.onSolid };
        break;
      }
    }
    return seen;
  }

  it('landing on plain solid reports onSolid and no pad', () => {
    expect(dropOnto(['....', '....', '####'], TILE + TILE / 2)).toEqual({
      pad: Tile.Empty,
      onSolid: true,
    });
  });

  it('landing on a pad reports the pad and NOT onSolid — pads must not recharge', () => {
    // StepResult.grounded is true either way; that is exactly why one bit is
    // not enough and the contact has to carry which tile produced it.
    expect(dropOnto(['....', '....', '.^..'], TILE + TILE / 2)).toEqual({
      pad: Tile.PadUp,
      onSolid: false,
    });
    expect(dropOnto(['....', '....', '.>..'], TILE + TILE / 2)).toEqual({
      pad: Tile.PadRight,
      onSolid: false,
    });
  });

  it('landing across a pad/floor seam reports BOTH — it launches and recharges', () => {
    // Straddling the boundary between column 1 (solid) and column 2 (pad).
    expect(dropOnto(['.....', '.....', '.#^##'], 2 * TILE)).toEqual({
      pad: Tile.PadUp,
      onSolid: true,
    });
  });

  it('a contact away from any pad keeps pad Empty even while a pad is nearby', () => {
    expect(dropOnto(['......', '......', '###^##'], 1 * TILE + TILE / 2)).toEqual({
      pad: Tile.Empty,
      onSolid: true,
    });
  });
});
