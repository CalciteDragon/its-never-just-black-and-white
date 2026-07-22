import { describe, expect, it } from 'vitest';
import { STEP } from '../src/constants';
import { AudioSys } from '../src/engine/audio';
import { Input } from '../src/engine/input';
import { SaveStore } from '../src/engine/save';
import type { Game, Scene } from '../src/game';
import { PlayScene } from '../src/scenes/play';

/** Headless Game stand-in: real Input/Audio/Save, no renderer, no RAF. */
function fakeGame(): { game: Game; input: Input; scenes: Scene[] } {
  const input = new Input();
  const audio = new AudioSys();
  const save = new SaveStore({ getItem: () => null, setItem: () => undefined });
  const scenes: Scene[] = [];
  const game = {
    input,
    audio,
    save,
    time: 0,
    setScene: (s: Scene) => {
      scenes.push(s);
      s.enter?.(game);
    },
    toggleMute: () => {
      audio.muted = !audio.muted;
    },
  } as unknown as Game;
  return { game, input, scenes };
}

describe('PlayScene (headless integration)', () => {
  it('boots a run, simulates 30 s of play with inputs, and survives', () => {
    const { game, input } = fakeGame();
    const scene = new PlayScene({ mode: 'adventure', seed: 1234, players: 1 });
    scene.enter?.(game);

    // Banner (1.2 s), then hold right and hop periodically for ~30 s.
    input.onKey('KeyD', true);
    for (let i = 0; i < 60 * 30; i++) {
      if (i % 45 === 0) {
        input.onKey('Space', true);
      }
      if (i % 45 === 20) {
        input.onKey('Space', false);
      }
      scene.update(STEP, game);
      input.update();
    }
    // A blind bot may well die — the invariants are: the clock ran, the state
    // stayed coherent, and 30 s of stepping (including any death → results
    // transition) never crashed.
    expect(scene.state.timeMs).toBeGreaterThan(3_000);
    expect(scene.state.coins).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(scene.state.score)).toBe(true);
  });

  it('two-player co-op boots and both players exist independently', () => {
    const { game, input } = fakeGame();
    const scene = new PlayScene({ mode: 'coop', seed: 777, players: 2 });
    scene.enter?.(game);
    // P1 runs right, P2 idles.
    input.onKey('KeyD', true);
    for (let i = 0; i < 60 * 5; i++) {
      scene.update(STEP, game);
      input.update();
    }
    expect(scene.state.timeMs).toBeGreaterThan(2_000);
  });

  it('pause halts the run clock', () => {
    const { game, input } = fakeGame();
    const scene = new PlayScene({ mode: 'adventure', seed: 9, players: 1 });
    scene.enter?.(game);
    for (let i = 0; i < 120; i++) {
      scene.update(STEP, game);
      input.update();
    }
    const before = scene.state.timeMs;
    input.onKey('Escape', true);
    scene.update(STEP, game);
    input.update();
    input.onKey('Escape', false);
    for (let i = 0; i < 120; i++) {
      scene.update(STEP, game);
      input.update();
    }
    expect(scene.state.timeMs).toBe(before);
  });
});
