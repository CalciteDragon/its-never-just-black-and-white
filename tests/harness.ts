/**
 * The headless game harness, shared by every scene test.
 *
 * `Scene.update` touches only `game.input`, `game.audio`, `game.save` and
 * `game.setScene`, all of which construct fine under node, and `render` is
 * never called — so a ~20-line `fakeGame()` cast through `unknown` is the
 * entire thing. It lived in `tests/playscene.test.ts` until phase 7 gave it
 * four consumers.
 *
 * Presses go in as real `KeyboardEvent.code` strings through `Input.onKey`, and
 * the mouse goes in as view-space coordinates through `Input.onPointerDown` —
 * so the binding table and the letterbox inverse are both on the tested path
 * rather than being assumed.
 */

import { AudioSys } from '../src/engine/audio';
import type { SfxName } from '../src/engine/audio';
import { Input } from '../src/engine/input';
import { FileDropbox } from '../src/engine/levelio';
import { SaveStore } from '../src/engine/save';
import type { StorageLike } from '../src/engine/save';
import { STEP } from '../src/constants';
import type { Game, Scene } from '../src/game';
import { parseLevel } from '../src/world/level';
import type { Level } from '../src/world/level';

/**
 * The REAL AudioSys, given a factory that returns no context — so under node it
 * is a total no-op — with every call recorded on the way through. Driving the
 * real class matters: the bed's lifecycle and the intensity ducking are
 * assertions about what a scene calls, and a hand-written stub would let the
 * scene call something the class does not have.
 */
export class SpyAudio extends AudioSys {
  readonly intensities: number[] = [];
  readonly calls: string[] = [];

  constructor() {
    super(() => null);
  }

  override setIntensity(n: number): void {
    this.intensities.push(n);
    super.setIntensity(n);
  }

  override startMusic(): void {
    this.calls.push('start');
    super.startMusic();
  }

  override stopMusic(): void {
    this.calls.push('stop');
    super.stopMusic();
  }

  override play(name: SfxName): void {
    this.calls.push(`sfx:${name}`);
    super.play(name);
  }
}

/** An in-memory StorageLike, so a test can inspect the raw strings written. */
export class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();

  /**
   * How this storage refuses a write, or null for one that works. **Both shapes
   * are real browsers**: `throw` is a quota error, and `silent` is the private
   * mode that accepts every write and keeps none. The second is the reason
   * `SaveStore.setText` reads the value back instead of trusting `setItem` to
   * have thrown — a draft that silently failed to save is a level's worth of
   * work gone with the tab.
   */
  refuse: 'throw' | 'silent' | null = null;

  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }

  setItem(k: string, v: string): void {
    if (this.refuse === 'throw') {
      throw new Error('quota exceeded');
    }
    if (this.refuse === 'silent') {
      return;
    }
    this.map.set(k, v);
  }
}

export interface Harness {
  game: Game;
  input: Input;
  /** The drop queue. A test pushes onto it; no DOM event is involved. */
  files: FileDropbox;
  save: SaveStore;
  storage: FakeStorage;
  audio: SpyAudio;
  /** Scenes handed to setScene, in order. Nothing is entered — just recorded. */
  scenes: Scene[];
}

export function fakeGame(): Harness {
  const input = new Input();
  const audio = new SpyAudio();
  // An explicit FakeStorage rather than SaveStore's node fallback, so tests can
  // assert on the bytes rather than only on the accessors.
  const storage = new FakeStorage();
  const save = new SaveStore(storage);
  const files = new FileDropbox();
  const scenes: Scene[] = [];
  const game = {
    input,
    audio,
    save,
    files,
    time: 0,
    setScene(s: Scene): void {
      scenes.push(s);
    },
    toggleMute(): void {
      audio.muted = !audio.muted;
    },
  };
  return { game: game as unknown as Game, input, files, save, storage, audio, scenes };
}

/** One frame: update, then clear the edges exactly as Game.stepFrame does. */
export function step(h: Harness, scene: Scene, n = 1): void {
  for (let i = 0; i < n; i++) {
    scene.update(STEP, h.game);
    h.input.update();
  }
}

/** Press for exactly one frame, the way a human tap arrives. */
export function tap(h: Harness, scene: Scene, code: string): void {
  h.input.onKey(code, true);
  step(h, scene);
  h.input.onKey(code, false);
}

/** Click at a view-space point for exactly one frame. */
export function click(h: Harness, scene: Scene, vx: number, vy: number, button = 0): void {
  h.input.onPointerDown(vx, vy, button);
  step(h, scene);
  h.input.onPointerUp(vx, vy, button);
  step(h, scene);
}

/** A tiny purpose-built stage, parsed by the real parser. */
export function tinyLevel(rows: string[], id = 'test-stage'): Level {
  const res = parseLevel({ id, name: 'TEST STAGE', rows });
  if (!res.ok) {
    throw new Error(res.errors.join('; '));
  }
  return res.level;
}
