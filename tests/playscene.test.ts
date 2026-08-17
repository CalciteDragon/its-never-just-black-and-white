/**
 * The level lifecycle, driven headlessly. `PlayScene.update` touches only
 * `game.input`, `game.audio`, `game.save` and `game.setScene`, all of which
 * construct fine under node, and `render` is never called — so a ~20-line
 * `fakeGame()` cast through `unknown` is the entire harness.
 *
 * Presses go in as real `KeyboardEvent.code` strings through `Input.onKey`, so
 * the binding table is on the tested path too rather than being assumed.
 *
 * Extracting the lifecycle into a pure "session" module and testing that
 * instead was rejected: phase 7's editor playtest hands a level to the REAL
 * PlayScene, and a second owner of the level lifecycle is exactly what it must
 * not find.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { DEATH_FADE_IN, DEATH_FADE_OUT, GOAL_HOLD, STEP, TILE } from '../src/constants';
import { AudioSys } from '../src/engine/audio';
import { Input } from '../src/engine/input';
import { palette } from '../src/engine/palette';
import { SAVE_KEYS, SaveStore } from '../src/engine/save';
import type { Game, Scene } from '../src/game';
import { LEVELS } from '../src/levels/index';
import { PlayScene, formatTime } from '../src/scenes/play';
import { TitleScene } from '../src/scenes/title';
import { parseLevel } from '../src/world/level';
import type { Level } from '../src/world/level';

interface Harness {
  game: Game;
  input: Input;
  save: SaveStore;
  /** Scenes handed to setScene, in order. Nothing is entered — just recorded. */
  scenes: Scene[];
}

function fakeGame(): Harness {
  const input = new Input();
  const audio = new AudioSys();
  // Under node there is no localStorage, so SaveStore already falls back to an
  // in-memory Map — a fresh one per instance, which is what isolation needs.
  const save = new SaveStore();
  const scenes: Scene[] = [];
  const game = {
    input,
    audio,
    save,
    time: 0,
    setScene(s: Scene): void {
      scenes.push(s);
    },
    toggleMute(): void {
      audio.muted = !audio.muted;
    },
  };
  return { game: game as unknown as Game, input, save, scenes };
}

/** One frame: update, then clear the edges exactly as Game.stepFrame does. */
function step(h: Harness, scene: Scene, n = 1): void {
  for (let i = 0; i < n; i++) {
    scene.update(STEP, h.game);
    h.input.update();
  }
}

/** Press for exactly one frame, the way a human tap arrives. */
function tap(h: Harness, scene: Scene, code: string): void {
  h.input.onKey(code, true);
  step(h, scene);
  h.input.onKey(code, false);
}

function start(level: Level = LEVELS[0]): { h: Harness; scene: PlayScene } {
  const h = fakeGame();
  const scene = new PlayScene(level, 0);
  scene.enter();
  return { h, scene };
}

/** A tiny purpose-built stage: floor, a lethal pit, and a goal on the floor. */
function tinyLevel(rows: string[], id = 'test-stage'): Level {
  const res = parseLevel({ id, name: 'TEST STAGE', rows });
  if (!res.ok) {
    throw new Error(res.errors.join('; '));
  }
  return res.level;
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
      tinyLevel([
        '..........',
        '..S.....G.',
        '####..####',
        '####..####',
      ]),
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

  it('Esc leaves for the title', () => {
    const { h, scene } = start(tinyLevel(PIT));
    tap(h, scene, 'Escape');
    expect(h.scenes).toHaveLength(1);
    expect(h.scenes[0]).toBeInstanceOf(TitleScene);
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
    const slower = new PlayScene(level, 0);
    slower.enter();
    step(h, slower, 90); // dawdle before setting off
    expect(runToGoal(h, slower)).toBe(true);
    expect(h.save.getBest(key)?.timeMs).toBe(best?.timeMs);
  });

  it('holds the readout, then advances — to the title when the set runs out', () => {
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
    expect(h.scenes[0]).toBeInstanceOf(TitleScene);
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
  });
});
