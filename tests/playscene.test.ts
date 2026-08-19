/**
 * The level lifecycle, driven headlessly through `tests/harness.ts`.
 *
 * Extracting the lifecycle into a pure "session" module and testing that
 * instead was rejected: the editor's playtest hands a level to the REAL
 * PlayScene, and a second owner of the level lifecycle is exactly what it must
 * not find.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  CAMERA_VSLACK,
  DEATH_FADE_IN,
  DEATH_FADE_OUT,
  GOAL_HOLD,
  PAD_STREAM_INTERVAL,
  PAD_STREAM_LIFE,
  PICKUP_RESPAWN,
  SPEED_REF,
  SPEED_WINDUP_DELAY,
  SPEED_WINDUP_MIN,
  SPEED_WINDUP_RAMP,
  STEP,
  TILE,
  VIEW_H,
  VIEW_W,
} from '../src/constants';
import { palette } from '../src/engine/palette';
import { MAX_PARTICLES } from '../src/engine/particles';
import { SAVE_KEYS } from '../src/engine/save';
import type { Scene } from '../src/game';
import { LEVELS } from '../src/levels/index';
import { PlayScene, formatTime, windupGate } from '../src/scenes/play';
import type { PlayContext } from '../src/scenes/play';
import { ResultsScene } from '../src/scenes/results';
import { TitleScene } from '../src/scenes/title';
import type { Level } from '../src/world/level';
import { fakeGame, step, tap, tinyLevel } from './harness';
import type { Harness } from './harness';

const CAMPAIGN_0: PlayContext = { kind: 'campaign', index: 0 };

function start(
  level: Level = LEVELS[0],
  ctx: PlayContext = CAMPAIGN_0,
): { h: Harness; scene: PlayScene } {
  const h = fakeGame();
  const scene = new PlayScene(level, ctx);
  scene.enter(h.game);
  return { h, scene };
}

beforeEach(() => {
  // The palette is a singleton and the scene drives it, so leaving a test in
  // phase B would silently colour the next one.
  palette.reset();
});

describe('the shipped level set', () => {
  it('every level in LEVELS parses with zero errors', () => {
    // The assertion that stops a broken grid shipping. LEVELS itself throws on
    // a bad file, so reaching this line already proves it — asserting the
    // structure too is what catches a level that parses but is unplayable.
    expect(LEVELS.length).toBeGreaterThan(0);
    for (const level of LEVELS) {
      expect(level.id).toMatch(/^[a-z0-9-]+$/);
      expect(level.map.w).toBeGreaterThan(0);
      expect(level.map.h).toBeGreaterThan(0);
      expect(level.map.get(level.spawn.tx, level.spawn.ty)).toBe(0); // spawn is empty
      expect(level.map.get(level.goal.tx, level.goal.ty)).toBe(0);
    }
  });
});

describe('gravity and palette stay in lockstep', () => {
  // gravitySign === +1 ⟺ palette.phase === 0, maintained only by this scene
  // across flips, deaths, restarts and level advance. Nothing in the type
  // system holds it, which is why it gets a test of its own.
  const inSync = (scene: PlayScene): boolean =>
    (scene.status.gravitySign === 1) === (palette.phase === 0);

  it('holds across a scripted sequence of flips, a death, and a restart', () => {
    const { h, scene } = start(
      tinyLevel(['..........', '..S.....G.', '####..####', '####..####']),
    );
    expect(inSync(scene)).toBe(true);

    // Flip, and flip back after the ceiling contact recharges it.
    tap(h, scene, 'Space');
    expect(scene.status.gravitySign).toBe(-1);
    expect(palette.phase).toBe(1);
    expect(inSync(scene)).toBe(true);

    // Fly up out of the world and die, in phase B.
    let died = false;
    for (let i = 0; i < 600 && !died; i++) {
      step(h, scene);
      died = scene.status.state !== 'running';
    }
    expect(died).toBe(true);
    expect(palette.phase).toBe(1); // the phase is HELD through the fade out

    // The respawn puts both halves back, together.
    step(h, scene, Math.ceil(DEATH_FADE_OUT / STEP) + 2);
    expect(scene.status.gravitySign).toBe(1);
    expect(palette.phase).toBe(0);
    expect(inSync(scene)).toBe(true);

    // And an explicit restart mid-flip does the same.
    tap(h, scene, 'Space');
    expect(palette.phase).toBe(1);
    tap(h, scene, 'KeyR');
    expect(scene.status.gravitySign).toBe(1);
    expect(palette.phase).toBe(0);
  });

  it('a refused flip moves neither gravity nor the palette', () => {
    // The most confusing bug this game could ship: the palette is the only
    // readout of gravity there is, so it must never move without gravity.
    const { h, scene } = start(tinyLevel(['..........', '..S.....G.', '##########']));
    tap(h, scene, 'Space');
    expect(palette.phase).toBe(1);
    const before = palette.phase;
    const gsBefore = scene.status.gravitySign;
    expect(scene.status.flipCharged).toBe(false);
    tap(h, scene, 'Space');
    expect(palette.phase).toBe(before);
    expect(scene.status.gravitySign).toBe(gsBefore);
  });
});

describe('death, respawn and restart', () => {
  const PIT = ['..........', '..S.....G.', '####..####'];

  it('runs Running → Dying → Respawning → Running, and resets the timer', () => {
    const { h, scene } = start(tinyLevel(PIT));
    step(h, scene, 30);
    const before = scene.status.timeSec;
    expect(before).toBeGreaterThan(0);

    // Walk right off into the pit.
    h.input.onKey('KeyD', true);
    let fellIn = false;
    for (let i = 0; i < 600 && !fellIn; i++) {
      step(h, scene);
      fellIn = scene.status.state === 'dying';
    }
    h.input.onKey('KeyD', false);
    expect(fellIn).toBe(true);

    // The body keeps simulating through the fade — it flies out of shot.
    const yAtDeath = scene.status.y;
    step(h, scene, 5);
    expect(scene.status.y).toBeGreaterThan(yAtDeath);

    step(h, scene, Math.ceil(DEATH_FADE_OUT / STEP) + 2);
    expect(scene.status.state).toBe('respawning');
    expect(scene.status.timeSec).toBe(0);

    step(h, scene, Math.ceil(DEATH_FADE_IN / STEP) + 2);
    expect(scene.status.state).toBe('running');
    expect(scene.status.timeSec).toBeGreaterThan(0);
    expect(scene.status.x).toBeCloseTo(2 * TILE + TILE / 2, 6);
  });

  it('R restarts instantly, with no fade at all', () => {
    // The fade is death's punctuation; a restart the player asked for does not
    // need punctuating (§5: failure is not a punishment).
    const { h, scene } = start(tinyLevel(PIT));
    h.input.onKey('KeyD', true);
    step(h, scene, 40);
    h.input.onKey('KeyD', false);
    expect(scene.status.x).toBeGreaterThan(3 * TILE);
    tap(h, scene, 'KeyR');
    expect(scene.status.state).toBe('running');
    expect(scene.status.x).toBeCloseTo(2 * TILE + TILE / 2, 6);
    expect(scene.status.timeSec).toBe(0);
  });
});

describe('the goal, the timer and the best time', () => {
  /** Goal two tiles right of the spawn, on the same floor. */
  const WALK_TO_GOAL = ['..........', '..S.G.....', '##########'];

  function runToGoal(h: Harness, scene: PlayScene): boolean {
    h.input.onKey('KeyD', true);
    let won = false;
    for (let i = 0; i < 600 && !won; i++) {
      step(h, scene);
      won = scene.status.state === 'won';
    }
    h.input.onKey('KeyD', false);
    return won;
  }

  it('fires on the body CENTRE entering the goal tile, and stops the timer', () => {
    const { h, scene } = start(tinyLevel(WALK_TO_GOAL));
    expect(runToGoal(h, scene)).toBe(true);
    const t = scene.status.timeSec;
    expect(t).toBeGreaterThan(0);
    step(h, scene, 20);
    expect(scene.status.timeSec).toBe(t); // frozen
    expect(scene.status.x).toBeGreaterThanOrEqual(4 * TILE);
    expect(scene.status.x).toBeLessThan(5 * TILE);
  });

  it('persists a best time under bw.best.<id>, and only when it beats it', () => {
    const level = tinyLevel(WALK_TO_GOAL, 'walk-stage');
    const { h, scene } = start(level);
    expect(runToGoal(h, scene)).toBe(true);

    const key = SAVE_KEYS.best('walk-stage');
    expect(key).toBe('bw.best.walk-stage');
    const best = h.save.getBest(key);
    expect(best).not.toBeNull();
    expect(best?.timeMs).toBe(Math.round(scene.status.timeSec * 1000));
    expect(best?.dateIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // A slower second run must not overwrite it. Same store, fresh scene.
    const slower = new PlayScene(level, CAMPAIGN_0);
    slower.enter(h.game);
    step(h, slower, 90); // dawdle before setting off
    expect(runToGoal(h, slower)).toBe(true);
    expect(h.save.getBest(key)?.timeMs).toBe(best?.timeMs);
  });

  it('holds the frozen frame, then hands the run to the results screen', () => {
    const { h, scene } = start(tinyLevel(WALK_TO_GOAL));
    expect(runToGoal(h, scene)).toBe(true);
    step(h, scene, Math.ceil((GOAL_HOLD + DEATH_FADE_OUT) / STEP) - 2);
    expect(h.scenes).toHaveLength(0); // still holding
    // One frame at a time from here: the real Game swaps the scene out on
    // setScene, and this harness does not, so it would advance every frame.
    for (let i = 0; i < 5 && h.scenes.length === 0; i++) {
      step(h, scene);
    }
    expect(h.scenes).toHaveLength(1);
    expect(h.scenes[0]).toBeInstanceOf(ResultsScene);
  });
});

/**
 * PHASES phase 7, decision 5. Phase 5's *As built* left `index` defaulting to
 * 0, so a level not in `LEVELS` — exactly what the editor's playtest hands it —
 * advanced into `LEVELS[1]` on completion. The honest fix is not a better
 * default; it is to stop defaulting, and to let the union decide three things
 * at once: where a win goes, whether progress advances, and whether a best time
 * is written at all.
 */
describe('the play context', () => {
  const WALK_TO_GOAL = ['..........', '..S.G.....', '##########'];

  function runToGoal(h: Harness, scene: PlayScene): boolean {
    h.input.onKey('KeyD', true);
    let won = false;
    for (let i = 0; i < 600 && !won; i++) {
      step(h, scene);
      won = scene.status.state === 'won';
    }
    h.input.onKey('KeyD', false);
    return won;
  }

  it('A PLAYTEST WRITES NOTHING — not a best time, not progress', () => {
    // The bug under the bug. A draft carrying the id of a shipped level would
    // otherwise overwrite bw.best.01-first-steps with a time set on a grid that
    // exists only in someone's browser.
    const level = tinyLevel(WALK_TO_GOAL, '01-first-steps');
    const back: Scene = { update: () => undefined, render: () => undefined };
    const h = fakeGame();
    const scene = new PlayScene(level, { kind: 'playtest', back });
    scene.enter(h.game);
    expect(runToGoal(h, scene)).toBe(true);

    expect(h.save.getBest(SAVE_KEYS.best('01-first-steps'))).toBeNull();
    expect(h.storage.map.has(SAVE_KEYS.best('01-first-steps'))).toBe(false);
    expect(h.storage.map.has(SAVE_KEYS.progress)).toBe(false);
    expect(h.save.getProgress()).toBe(0);
  });

  it('and the same run in a campaign context writes both', () => {
    // The other half, because "wrote nothing" is only interesting beside a run
    // that wrote something.
    const level = tinyLevel(WALK_TO_GOAL, '01-first-steps');
    const { h, scene } = start(level, { kind: 'campaign', index: 0 });
    expect(runToGoal(h, scene)).toBe(true);
    expect(h.save.getBest(SAVE_KEYS.best('01-first-steps'))).not.toBeNull();
    expect(h.save.getProgress()).toBe(1);
  });

  it('progress records the level AFTER the one just cleared', () => {
    const level = tinyLevel(WALK_TO_GOAL, 'third');
    const { h, scene } = start(level, { kind: 'campaign', index: 2 });
    expect(runToGoal(h, scene)).toBe(true);
    expect(h.save.getProgress()).toBe(3);
  });

  it('A PLAYTEST RETURNS TO THE VERY SAME SCENE INSTANCE, not a rebuilt one', () => {
    // GAME-DESIGN §10's "returns on Esc with edits intact", stated as an object
    // identity — which is the only form of it a test can actually check.
    const back: Scene = { update: () => undefined, render: () => undefined };
    const h = fakeGame();
    const scene = new PlayScene(tinyLevel(WALK_TO_GOAL, 'draft'), { kind: 'playtest', back });
    scene.enter(h.game);
    expect(runToGoal(h, scene)).toBe(true);
    for (let i = 0; i < Math.ceil((GOAL_HOLD + DEATH_FADE_OUT) / STEP) + 5; i++) {
      step(h, scene);
      if (h.scenes.length > 0) {
        break;
      }
    }
    expect(h.scenes).toHaveLength(1);
    expect(h.scenes[0]).toBe(back);
  });
});

/**
 * PHASES phase 7, decision 8. §4's control table has had `Pause / back` on
 * `Esc`/`P` since phase 1 and nothing implemented it; `PlayScene` read `back`
 * and quit to the title mid-run, silently discarding the attempt. Once there is
 * a shell to quit *to*, that is a bug.
 *
 * Since `back` and `pause` are bound to the same two keys, **PlayScene reads
 * `pause` and nothing else** — a scene that read both would fire twice on one
 * keypress.
 */
describe('pause', () => {
  const PIT = ['..........', '..S.....G.', '####..####'];

  it('Esc toggles it', () => {
    const { h, scene } = start(tinyLevel(PIT));
    expect(scene.status.paused).toBe(false);
    tap(h, scene, 'Escape');
    expect(scene.status.paused).toBe(true);
    tap(h, scene, 'Escape');
    expect(scene.status.paused).toBe(false);
    // And it does NOT also fire `back` and quit the level.
    expect(h.scenes).toHaveLength(0);
  });

  it('IS A FREEZE: ten paused frames move neither the timer nor the body', () => {
    const { h, scene } = start(tinyLevel(PIT));
    h.input.onKey('KeyD', true);
    step(h, scene, 20);
    h.input.onKey('KeyD', false);
    tap(h, scene, 'Escape');

    const frozen = scene.status;
    step(h, scene, 10);
    const after = scene.status;
    expect(after.timeSec).toBe(frozen.timeSec);
    expect(after.x).toBe(frozen.x);
    expect(after.y).toBe(frozen.y);
    expect(after.vx).toBe(frozen.vx);
    expect(after.vy).toBe(frozen.vy);
    expect(after.speedNorm).toBe(frozen.speedNorm);
  });

  it('FEEDS THE BED 0 EXACTLY ONCE PER PAUSED FRAME', () => {
    // Two assertions in one, and the second is the load-bearing one.
    //
    // The brief predicted that a pause implemented as `update(dt = 0)` instead
    // of an early return would be caught by the trajectory diverging. It is
    // not. `subStepCount` floors at 1, so dt = 0 runs one sub-step — but that
    // sub-step integrates a zero displacement, and every exponential smoother
    // in the scene takes its coefficient as `min(1, rate · dt)`, which at
    // dt = 0 is exactly 0. A dt-zero pause really is bit-identical, and the
    // resume test below therefore cannot see it.
    //
    // What DOES see it is the length of this array. A dt-zero pause falls
    // through to the bottom of `update` and calls `setIntensity` a second time,
    // so ten paused frames pump the scheduler twenty times. Measured against
    // that mutation: 20 entries, not 10.
    const { h, scene } = start(tinyLevel(PIT));
    h.input.onKey('KeyD', true);
    step(h, scene, 20);
    h.input.onKey('KeyD', false);
    // The body, not `speedNorm`: twenty frames is far short of the wind-up, so
    // the effect number is legitimately still 0 while the square is at a run.
    expect(Math.abs(scene.status.vx)).toBeGreaterThan(100); // it really was moving
    tap(h, scene, 'Escape');
    const from = h.audio.intensities.length;
    step(h, scene, 10);
    const during = h.audio.intensities.slice(from);
    expect(during).toHaveLength(10);
    for (const n of during) {
      expect(n).toBe(0);
    }
  });

  it('RESUMES BIT-IDENTICALLY, however many frames it was held for', () => {
    // Not an approximation and not a `toBeCloseTo`: the paused run and the
    // straight one must agree to the last bit, because the physics is
    // reproducible (hard rule 5) and a pause is the one thing in the game that
    // interrupts it. Anything that leaks a frame of simulation into the pause —
    // a smoother, a camera update, a particle step — shows up here.
    const level = tinyLevel(PIT);
    const straight = start(level);
    straight.h.input.onKey('KeyD', true);
    step(straight.h, straight.scene, 40);

    const interrupted = start(level);
    interrupted.h.input.onKey('KeyD', true);
    step(interrupted.h, interrupted.scene, 20);
    tap(interrupted.h, interrupted.scene, 'Escape');
    step(interrupted.h, interrupted.scene, 30); // paused, so nothing happens
    tap(interrupted.h, interrupted.scene, 'Escape');
    // The unpausing tap consumed one frame of simulation, so 19 remain.
    step(interrupted.h, interrupted.scene, 19);

    const a = straight.scene.status;
    const b = interrupted.scene.status;
    expect(b.x).toBe(a.x);
    expect(b.y).toBe(a.y);
    expect(b.vx).toBe(a.vx);
    expect(b.vy).toBe(a.vy);
    expect(b.timeSec).toBeCloseTo(a.timeSec, 12);
  });

  it('offers RESUME / RESTART / QUIT, and RESTART is a real reset', () => {
    const { h, scene } = start(tinyLevel(PIT));
    h.input.onKey('KeyD', true);
    step(h, scene, 40);
    h.input.onKey('KeyD', false);
    expect(scene.status.x).toBeGreaterThan(3 * TILE);

    tap(h, scene, 'Escape');
    tap(h, scene, 'ArrowDown'); // RESUME -> RESTART
    tap(h, scene, 'Enter');
    expect(scene.status.paused).toBe(false);
    expect(scene.status.x).toBeCloseTo(2 * TILE + TILE / 2, 6);
    expect(scene.status.timeSec).toBe(0);
  });

  it('QUIT goes to the title from a campaign run', () => {
    const { h, scene } = start(tinyLevel(PIT));
    tap(h, scene, 'Escape');
    tap(h, scene, 'ArrowDown');
    tap(h, scene, 'ArrowDown'); // RESUME -> RESTART -> QUIT
    tap(h, scene, 'Enter');
    expect(h.scenes).toHaveLength(1);
    expect(h.scenes[0]).toBeInstanceOf(TitleScene);
  });

  it('QUIT goes back to the EDITOR INSTANCE from a playtest', () => {
    const back: Scene = { update: () => undefined, render: () => undefined };
    const h = fakeGame();
    const scene = new PlayScene(tinyLevel(PIT, 'draft'), { kind: 'playtest', back });
    scene.enter(h.game);
    tap(h, scene, 'Escape');
    tap(h, scene, 'ArrowDown');
    tap(h, scene, 'ArrowDown');
    tap(h, scene, 'Enter');
    expect(h.scenes[0]).toBe(back);
  });

  it('pauses during the death fade and on the winning frame without desyncing', () => {
    // The two states where a naive freeze desynchronises the fade from the
    // state clock: both run off `stateT`, which must stop with everything else.
    const { h, scene } = start(tinyLevel(PIT));
    h.input.onKey('KeyD', true);
    for (let i = 0; i < 600 && scene.status.state === 'running'; i++) {
      step(h, scene);
    }
    h.input.onKey('KeyD', false);
    expect(scene.status.state).toBe('dying');
    tap(h, scene, 'Escape');
    const held = scene.status;
    step(h, scene, 20);
    expect(scene.status.state).toBe('dying'); // the fade did NOT run to its end
    expect(scene.status.y).toBe(held.y);
    tap(h, scene, 'Escape');
    step(h, scene, Math.ceil(DEATH_FADE_OUT / STEP) + 2);
    expect(scene.status.state).toBe('respawning');
  });
});

describe('formatTime', () => {
  it('renders only characters the 5x7 bitmap font actually has', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(1234)).toBe('0:01.23');
    expect(formatTime(61_050)).toBe('1:01.05');
    expect(formatTime(-5)).toBe('0:00.00');
    expect(formatTime(0)).toMatch(/^[0-9:.]+$/);
  });
});

describe('THE SCRIPTED PLAYTHROUGH', () => {
  /**
   * The direct descendant of the old bot-playthrough test, and the best
   * regression guard in the suite.
   *
   * It asserts COMPLETION, NOT TRAJECTORY. Bit-identity is already pinned by
   * the physics determinism test and does not need pinning twice; what this
   * needs to do is fail when something meaningful changed rather than every
   * time a constant moves by a percent. So the script is a coarse program of
   * one held direction and four presses, each triggered by a position rather
   * than a frame count — which is where all its slack comes from.
   */
  interface Beat {
    /** Fire once the body's centre passes this world x. */
    atX: number;
    code: string;
    /** Frames to hold it. The jump needs holding or the jump cut halves it. */
    hold: number;
    what: string;
  }

  const SCRIPT: readonly Beat[] = [
    { atX: 400, code: 'KeyW', hold: 30, what: 'jump the 3-tile gap' },
    { atX: 620, code: 'Space', hold: 1, what: 'flip up to the ceiling slab' },
    { atX: 900, code: 'Space', hold: 1, what: 'flip back down to the floor' },
    { atX: 1580, code: 'Space', hold: 1, what: 'flip up to the goal' },
  ];

  const MAX_STEPS = 3600; // one minute of simulation

  it('completes the example stage', () => {
    const { h, scene } = start(LEVELS[0]);
    h.input.onKey('KeyD', true); // hold right throughout

    let beat = 0;
    let holding: { code: string; until: number } | null = null;
    let furthest = 0;
    let steps = 0;
    let peakParticles = 0;

    for (; steps < MAX_STEPS; steps++) {
      if (beat < SCRIPT.length && scene.status.x >= SCRIPT[beat].atX) {
        const b = SCRIPT[beat++];
        h.input.onKey(b.code, true);
        holding = { code: b.code, until: steps + b.hold };
      }
      step(h, scene);
      if (holding && steps >= holding.until) {
        h.input.onKey(holding.code, false);
        holding = null;
      }
      furthest = Math.max(furthest, scene.status.x);
      peakParticles = Math.max(peakParticles, scene.status.particles);
      if (scene.status.state === 'won') {
        break;
      }
      // A death mid-run is the interesting failure, so stop and report there
      // rather than letting the respawn quietly retry the same script.
      if (scene.status.state !== 'running') {
        break;
      }
    }

    const s = scene.status;
    const reached = beat === 0 ? 'the start' : SCRIPT[beat - 1].what;
    expect(
      s.state,
      `stopped after ${steps} steps at x=${s.x.toFixed(0)} y=${s.y.toFixed(0)} ` +
        `(furthest x=${furthest.toFixed(0)} of ${LEVELS[0].map.widthPx}), ` +
        `last beat: ${reached}, beats fired ${beat}/${SCRIPT.length}, ` +
        `gravity ${s.gravitySign > 0 ? 'down' : 'up'}, ` +
        `flip ${s.flipCharged ? 'charged' : 'spent'}`,
    ).toBe('won');
    expect(s.timeSec).toBeGreaterThan(0);

    // THE POOL CEILING, under the only workload that is actually the game.
    // The upper bound is what makes the drop-newest overflow policy safe; the
    // LOWER one is phase 4's non-trivial-trajectory guard in a new place —
    // without it the assertion passes on a build where nothing ever emitted a
    // single spark.
    //
    // Measured 49, against the brief's predicted ~120. The prediction budgeted
    // 51 for eight pads streaming at once and THIS STAGE HAS ONE, so the peak
    // is dominated by the transient emitters (a 20-spark ring, a splash, a
    // burst) rather than by the steady state. The margin is 5.2x, not 4.3x.
    expect(peakParticles).toBeGreaterThan(40);
    expect(peakParticles).toBeLessThan(MAX_PARTICLES / 2);
  });
});

describe('the bed, and the one number that drives it', () => {
  const WALK = ['..........', '..S.....G.', '####..####'];
  /** Sixty-four tiles of floor: room to hold a run for the whole wind-up. */
  const RUNWAY = [
    '.'.repeat(64),
    `..S${'.'.repeat(59)}G.`,
    '#'.repeat(64),
  ];

  it('is scene-scoped: enter starts it, exit stops it', () => {
    // `Scene.exit` has existed since phase 2 with no user; this is it. The
    // title screen stays silent but for its menu blips, because a techno bed
    // under a motionless title spends the escalation before it is earned.
    const { h, scene } = start(tinyLevel(WALK));
    expect(h.audio.calls).toContain('start');
    expect(h.audio.calls).not.toContain('stop');
    scene.exit(h.game);
    expect(h.audio.calls[h.audio.calls.length - 1]).toBe('stop');
  });

  it('pumps the scheduler exactly once per update, with the live speedNorm', () => {
    const { h, scene } = start(tinyLevel(WALK));
    const before = h.audio.intensities.length;
    step(h, scene, 30);
    expect(h.audio.intensities.length - before).toBe(30);
    h.input.onKey('KeyD', true);
    step(h, scene, 60);
    h.input.onKey('KeyD', false);
    const last = h.audio.intensities[h.audio.intensities.length - 1];
    expect(last).toBeCloseTo(scene.status.speedNorm, 12);
  });

  it('winds the bed up over seconds of running, not over one fast frame', () => {
    // The escalation is a function of how long you have been fast, not of how
    // fast you are this frame: SPEED_WINDUP_DELAY of silence, then a ramp. A
    // corridor long enough to hold a run is the only fixture that can see it.
    const { h, scene } = start(tinyLevel(RUNWAY));
    h.input.onKey('KeyD', true);
    const secs = (n: number): number => Math.round(n / STEP);

    step(h, scene, secs(SPEED_WINDUP_DELAY - 0.2));
    expect(Math.abs(scene.status.vx)).toBeGreaterThan(SPEED_WINDUP_MIN * SPEED_REF);
    expect(scene.status.speedNorm).toBe(0); // fast, and still silent

    step(h, scene, secs(SPEED_WINDUP_RAMP / 2));
    const half = scene.status.speedNorm;
    expect(half).toBeGreaterThan(0);

    step(h, scene, secs(SPEED_WINDUP_RAMP));
    const full = scene.status.speedNorm;
    expect(full).toBeGreaterThan(half); // it kept climbing
    expect(full).toBeGreaterThan(0.3);
    expect(h.audio.intensities[h.audio.intensities.length - 1]).toBeCloseTo(full, 12);

    // And it unwinds: standing still drains the bank it took to earn.
    h.input.onKey('KeyD', false);
    step(h, scene, secs(SPEED_WINDUP_DELAY + SPEED_WINDUP_RAMP + 1));
    expect(scene.status.speedNorm).toBeLessThan(0.01);
  });

  it('windupGate is flat zero through the delay, then linear to 1', () => {
    expect(windupGate(0)).toBe(0);
    expect(windupGate(SPEED_WINDUP_DELAY)).toBe(0);
    expect(windupGate(SPEED_WINDUP_DELAY + SPEED_WINDUP_RAMP / 2)).toBeCloseTo(0.5, 10);
    expect(windupGate(SPEED_WINDUP_DELAY + SPEED_WINDUP_RAMP)).toBe(1);
    expect(windupGate(1e6)).toBe(1); // clamped, never extrapolated
    expect(windupGate(-1)).toBe(0);
  });

  it('DUCKS TO ZERO while dying, sampled during the fade and not after it', () => {
    // The body keeps simulating through the death fade — it flies out of shot —
    // so the un-ducked version has the music SWELL as the corpse accelerates.
    // The assertion therefore has to be taken while `speedNorm` is high, which
    // is the whole reason this reads the status mid-fade.
    const { h, scene } = start(tinyLevel(['..........', '..S.....G.', '####..####']));
    h.input.onKey('KeyD', true);
    for (let i = 0; i < 600 && scene.status.state === 'running'; i++) {
      step(h, scene);
    }
    h.input.onKey('KeyD', false);
    expect(scene.status.state).toBe('dying');

    let sawFastAndSilent = false;
    for (let i = 0; i < 10; i++) {
      step(h, scene);
      const st = scene.status;
      if (st.state !== 'dying') {
        break;
      }
      const raw = Math.hypot(st.vx, st.vy) / SPEED_REF;
      if (raw > 0.5) {
        expect(h.audio.intensities[h.audio.intensities.length - 1]).toBe(0);
        sawFastAndSilent = true;
      }
    }
    expect(sawFastAndSilent).toBe(true);
  });

  it('ducks on the goal too, so the fanfare is not fighting a swelling arp', () => {
    const { h, scene } = start(tinyLevel(['..........', '..S.G.....', '##########']));
    h.input.onKey('KeyD', true);
    for (let i = 0; i < 600 && scene.status.state !== 'won'; i++) {
      step(h, scene);
    }
    h.input.onKey('KeyD', false);
    expect(scene.status.state).toBe('won');
    step(h, scene, 3);
    expect(h.audio.intensities[h.audio.intensities.length - 1]).toBe(0);
  });

  it('pads stream, and only while they are anywhere near the view', () => {
    // One accumulator drives every visible pad on the same tick — a single
    // number rather than an array, and pads pulsing in unison reads as
    // intentional. `level.pads` exists so this never rescans the grid.
    // 60 frames first: the spawn drops the body 6 px onto the floor, which is
    // a real landing and splashes. Waiting past SPLASH_LIFE leaves the stream
    // as the only thing that could still be alive.
    const settle = 60;
    const near = tinyLevel(['..........', '..S..^..G.', '##########'], 'pad-near');
    const { h, scene } = start(near);
    expect(near.pads.length).toBe(1);
    step(h, scene, settle);
    expect(scene.status.particles).toBeGreaterThan(0);
    // One pad, one spark per interval, one life's worth alive: ~6.4.
    expect(scene.status.particles).toBeLessThan(2 * (PAD_STREAM_LIFE / PAD_STREAM_INTERVAL));

    // The same pad, far off the right-hand end of a long level: culled, and
    // the pool is then EMPTY rather than merely smaller.
    const rows = ['.'.repeat(120), `..S${'.'.repeat(114)}^G.`, '#'.repeat(120)];
    const far = tinyLevel(rows, 'pad-far');
    const r2 = start(far);
    step(r2.h, r2.scene, settle);
    expect(r2.scene.status.particles).toBe(0);
  });
});

describe('PLAY ON A LEVEL OF ANY SIZE', () => {
  /**
   * `PlayScene` never reads a size constant: it takes the map's `widthPx` and
   * `heightPx` and hands them to the camera's two clamps. So the thing worth
   * pinning is that a level far smaller than the view and a level far larger
   * than it both run for a while without throwing, and that the camera lands
   * inside the bound its own map implies — including the sign-flipped one, a
   * map smaller than the view sits at a NEGATIVE origin, which is the case an
   * accidental `Math.max(0, …)` anywhere downstream would quietly destroy.
   *
   * `camera` is private to the scene and stays that way: exposing it for a
   * test would put a second consumer on a field the renderer reads once a
   * frame. Reading it through a cast keeps the assertion honest and the
   * surface unchanged.
   */
  function cameraOf(scene: PlayScene): { x: number; y: number } {
    return (scene as unknown as { camera: { x: number; y: number } }).camera;
  }

  /** Exactly `Camera.clampX`'s contract, restated where a test can see it. */
  function expectClamped(scene: PlayScene, level: Level): void {
    const { x, y } = cameraOf(scene);
    const w = level.map.widthPx;
    const h = level.map.heightPx;
    if (w <= VIEW_W) {
      expect(x).toBe((w - VIEW_W) / 2);
    } else {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(w - VIEW_W);
    }
    if (h <= VIEW_H) {
      expect(y).toBe((h - VIEW_H) / 2);
    } else {
      expect(y).toBeGreaterThanOrEqual(-CAMERA_VSLACK);
      expect(y).toBeLessThanOrEqual(h - VIEW_H + CAMERA_VSLACK);
    }
  }

  /** 200 x 24: both dimensions comfortably past the view. */
  function wideRows(): string[] {
    const w = 200;
    const rows: string[] = [];
    for (let ty = 0; ty < 22; ty++) {
      rows.push('.'.repeat(w));
    }
    rows.push(`..S${'.'.repeat(w - 6)}G..`);
    rows.push('#'.repeat(w));
    return rows;
  }

  it('runs a 5x5 level, with the camera centred on both axes throughout', () => {
    const level = tinyLevel(['.....', '.S.G.', '.....', '#####', '#####'], 'five');
    expect(level.map.widthPx).toBeLessThan(VIEW_W);
    expect(level.map.heightPx).toBeLessThan(VIEW_H);

    const { h, scene } = start(level);
    expectClamped(scene, level); // enter() snaps and clamps before any step
    h.input.onKey('KeyD', true);
    for (let i = 0; i < 240; i++) {
      step(h, scene);
      expectClamped(scene, level);
    }
    h.input.onKey('KeyD', false);

    // A map smaller than the view is pinned dead centre and cannot move, so
    // the assertion above would also hold if the scene had frozen. The body
    // has to have actually gone somewhere.
    expect(cameraOf(scene).x).toBeLessThan(0);
    expect(cameraOf(scene).y).toBeLessThan(0);
    expect(scene.status.timeSec).toBeGreaterThan(0);
  });

  it('runs a 200x24 level, with the camera inside the clamp throughout', () => {
    const level = tinyLevel(wideRows(), 'wide');
    expect(level.map.widthPx).toBeGreaterThan(VIEW_W);
    expect(level.map.heightPx).toBeGreaterThan(VIEW_H);

    const { h, scene } = start(level);
    expectClamped(scene, level);
    h.input.onKey('KeyD', true);
    let moved = 0;
    for (let i = 0; i < 600; i++) {
      step(h, scene);
      expectClamped(scene, level);
      moved = Math.max(moved, cameraOf(scene).x);
    }
    h.input.onKey('KeyD', false);

    // The spawn is at the left edge, so the camera starts pinned at 0 and has
    // to have come off it — otherwise "inside the clamp" is vacuous.
    expect(moved).toBeGreaterThan(0);
    expect(scene.status.x).toBeGreaterThan(TILE * 4);
  });

  it('respawns and restarts on an odd-sized level without leaving the clamp', () => {
    // The reset path re-snaps the camera and re-clamps it, and `snapTo` writes
    // an unclamped centre first — so a reset is the one moment the camera is
    // legitimately out of bounds, and `reset` clamping afterwards is what this
    // catches if it is ever dropped.
    const level = tinyLevel(wideRows(), 'wide-reset');
    const { h, scene } = start(level);
    h.input.onKey('KeyD', true);
    step(h, scene, 200);
    h.input.onKey('KeyD', false);
    expectClamped(scene, level);

    tap(h, scene, 'KeyR');
    expectClamped(scene, level);
    expect(scene.status.timeSec).toBeLessThan(0.1);
    step(h, scene, 60);
    expectClamped(scene, level);
  });

  it('is deterministic at any size: the same steps give a bit-identical body', () => {
    const rows = wideRows();
    const runOnce = (): { x: number; y: number; vx: number; vy: number } => {
      const level = tinyLevel(rows, 'wide-determinism');
      const { h, scene } = start(level);
      h.input.onKey('KeyD', true);
      step(h, scene, 90);
      h.input.onKey('KeyW', true);
      step(h, scene, 20);
      h.input.onKey('KeyW', false);
      step(h, scene, 120);
      const s = scene.status;
      return { x: s.x, y: s.y, vx: s.vx, vy: s.vy };
    };
    expect(runOnce()).toEqual(runOnce());
  });
});

describe('flip pickups', () => {
  /**
   * The flip is the only thing that can spend a charge, and anything the body
   * lands on hands it straight back — so a pickup can only be *seen* to
   * recharge while the body is still in the air. This stage is a shaft: flip on
   * the spawn, rise through the pickup two rows up, and come to rest on the
   * ceiling. Every claim about a spent flip is read mid-flight.
   */
  const SHAFT = [
    '##########',
    '..........',
    '..o.......',
    '..........',
    '..S......G',
    '##########',
  ];
  /** The same shaft with nothing to collect, for the trajectory comparison. */
  const BARE_SHAFT = SHAFT.map((row) => row.replace('o', '.'));
  /** A flat walk into a pickup, for the cases that need no flip at all. */
  const WALK = ['..........', '..So.....G', '##########'];

  /** Walk right for `n` steps, the way a held key actually arrives. */
  function walk(h: Harness, scene: PlayScene, n: number): void {
    h.input.onKey('ArrowRight', true);
    step(h, scene, n);
    h.input.onKey('ArrowRight', false);
    step(h, scene);
  }

  it('recharges a spent flip on contact', () => {
    const { h, scene } = start(tinyLevel(SHAFT));
    tap(h, scene, 'Space'); // spend it: gravity now points up
    expect(scene.status.flipCharged).toBe(false);
    let recharged = false;
    for (let i = 0; i < 20 && !recharged; i++) {
      step(h, scene);
      recharged = scene.status.flipCharged;
      // Mid-flight, so nothing but the pickup can be responsible.
      expect(scene.status.vy).toBeLessThan(0);
    }
    expect(recharged).toBe(true);
    expect(h.audio.calls).toContain('sfx:pickup');
    expect(scene.status.pickupsReady).toBe(0);
  });

  it('IS NOT COLLIDED WITH: the trajectory through one is bit-identical', () => {
    // The whole difference between this and a pad. The same inputs through the
    // same shaft with and without the pickup in it: the only thing that may
    // differ is the charge.
    const withIt = start(tinyLevel(SHAFT));
    const without = start(tinyLevel(BARE_SHAFT));
    for (const { h, scene } of [withIt, without]) {
      tap(h, scene, 'Space');
      step(h, scene, 10);
    }
    expect(withIt.scene.status.x).toBe(without.scene.status.x);
    expect(withIt.scene.status.y).toBe(without.scene.status.y);
    expect(withIt.scene.status.vx).toBe(without.scene.status.vx);
    expect(withIt.scene.status.vy).toBe(without.scene.status.vy);
    expect(withIt.scene.status.flipCharged).toBe(true);
    expect(without.scene.status.flipCharged).toBe(false);
  });

  it('is not spent on a player who had nothing to gain', () => {
    // Spent only when it actually gives something back, so a line run with the
    // flip in hand leaves the pickup standing for the way back.
    const { h, scene } = start(tinyLevel(WALK));
    walk(h, scene, 30);
    expect(scene.status.pickupsReady).toBe(1);
    expect(h.audio.calls).not.toContain('sfx:pickup');
  });

  /** Flip, then step until the pickup is taken. Returns the steps it took. */
  function collect(h: Harness, scene: PlayScene): number {
    tap(h, scene, 'Space');
    for (let i = 1; i < 40; i++) {
      step(h, scene);
      if (scene.status.pickupsReady === 0) {
        return i + 1; // the flip's own step counts
      }
    }
    throw new Error('never collected');
  }

  it('comes back after PICKUP_RESPAWN, and not one step before', () => {
    // Probed against the exact boundary rather than near it: the collection
    // step is found rather than assumed, so a timer wrong by a single step
    // fails this instead of sitting inside the slack.
    const { h, scene } = start(tinyLevel(SHAFT));
    collect(h, scene);
    // One step of slack on the far side and none on the near one: STEP is not
    // exact in binary, so 180 subtractions of it from 3.0 leave a residue and
    // the 181st step is the one that clears it. The tight half is the half that
    // catches a timer that is wrong.
    const ticks = Math.ceil(PICKUP_RESPAWN / STEP);
    step(h, scene, ticks - 1);
    expect(scene.status.pickupsReady).toBe(0);
    step(h, scene, 2);
    expect(scene.status.pickupsReady).toBe(1);
  });

  it('CAN BE TAKEN AGAIN once it is back, which is the whole point of it', () => {
    // The payoff the respawn exists for — a line run in both directions — and
    // the one thing the ready counter alone cannot show.
    const { h, scene } = start(tinyLevel(SHAFT));
    collect(h, scene);
    step(h, scene, Math.ceil(PICKUP_RESPAWN / STEP) + 1);
    expect(scene.status.pickupsReady).toBe(1);
    // The body is resting on the ceiling by now, charged. Spend it and fall
    // back down through the pickup.
    tap(h, scene, 'Space');
    expect(scene.status.flipCharged).toBe(false);
    let recharged = false;
    for (let i = 0; i < 40 && !recharged; i++) {
      step(h, scene);
      recharged = scene.status.flipCharged;
    }
    expect(recharged).toBe(true);
    expect(scene.status.pickupsReady).toBe(0);
  });

  it('a corpse does not collect: the body simulates through the death fade', () => {
    // `dying` keeps stepping the body — it flies out of shot, which reads as a
    // consequence rather than a pause — so the guard is load-bearing.
    const { h, scene } = start(tinyLevel(SHAFT));
    tap(h, scene, 'Space'); // gravity up, and it will leave through the ceiling
    // Break the ceiling open by starting from a level that has none instead.
    const open = start(tinyLevel(['..........', '..o.......', '..S......G', '##########']));
    tap(open.h, open.scene, 'Space');
    let died = false;
    for (let i = 0; i < 200 && !died; i++) {
      step(open.h, open.scene);
      died = open.scene.status.state === 'dying';
    }
    expect(died).toBe(true);
    expect(open.h.audio.calls).toContain('sfx:pickup'); // taken on the way UP
    const taken = open.h.audio.calls.filter((c) => c === 'sfx:pickup').length;
    for (let i = 0; i < 20; i++) {
      step(open.h, open.scene);
    }
    // ...and never a second time on the way out of the world.
    expect(open.h.audio.calls.filter((c) => c === 'sfx:pickup')).toHaveLength(taken);
    expect(scene.status.state).toBe('running');
  });

  it('the respawn timer is frozen by the pause, like everything else', () => {
    const { h, scene } = start(tinyLevel(SHAFT));
    collect(h, scene);
    tap(h, scene, 'Escape');
    expect(scene.status.paused).toBe(true);
    step(h, scene, Math.ceil(PICKUP_RESPAWN / STEP) + 30);
    expect(scene.status.pickupsReady).toBe(0);
  });

  it('a respawn puts every pickup back', () => {
    // Death shares one reset with R, and "a reset that forgets one field" is
    // how the second attempt comes to play differently from the first.
    const { h, scene } = start(tinyLevel(SHAFT));
    tap(h, scene, 'Space');
    step(h, scene, 12);
    expect(scene.status.pickupsReady).toBe(0);
    tap(h, scene, 'KeyR');
    expect(scene.status.pickupsReady).toBe(1);
  });

  it('a level with no pickups behaves exactly as before', () => {
    const level = tinyLevel(['..........', '..S......G', '##########']);
    expect(level.pickups).toEqual([]); // `pickupsReady` is 0 either way
    const { h, scene } = start(level);
    walk(h, scene, 30);
    expect(h.audio.calls).not.toContain('sfx:pickup');
    expect(scene.status.state).toBe('running');
  });
});
