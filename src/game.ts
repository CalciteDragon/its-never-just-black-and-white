/**
 * Fixed-timestep loop + scene management. FixedStepper is pure and
 * node-tested; Game wires it to requestAnimationFrame and therefore only ever
 * runs in the browser (constructing it requires a canvas).
 */

import { STEP } from './constants';
import { AudioSys } from './engine/audio';
import { Input } from './engine/input';
import { Renderer } from './engine/renderer';
import { SAVE_KEYS, SaveStore } from './engine/save';

export interface Scene {
  enter?(game: Game): void;
  exit?(game: Game): void;
  update(dt: number, game: Game): void;
  render(r: Renderer, game: Game): void;
}

/**
 * Pure fixed-step accumulator. Feed it wall-clock elapsed seconds; it invokes
 * the callback 0..N times with exactly `step`, carrying the remainder so the
 * simulation averages out to real time. Long frames clamp to `maxFrame` so a
 * background tab never triggers a catch-up spiral.
 */
export class FixedStepper {
  readonly step: number;
  readonly maxFrame: number;
  private acc = 0;

  constructor(step: number, maxFrame = 0.25) {
    this.step = step;
    this.maxFrame = maxFrame;
  }

  /**
   * Returns the leftover accumulator as a fraction of one step in [0, 1)
   * (usable for render interpolation).
   */
  advance(elapsedSec: number, cb: (dt: number) => void): number {
    if (elapsedSec > 0) {
      this.acc += Math.min(elapsedSec, this.maxFrame);
    }
    while (this.acc >= this.step) {
      this.acc -= this.step;
      cb(this.step);
    }
    return this.acc / this.step;
  }
}

export class Game {
  readonly input: Input;
  readonly renderer: Renderer;
  readonly save: SaveStore;
  readonly audio: AudioSys;
  /** Total simulated seconds (advances in fixed steps). */
  time = 0;

  private scene: Scene | null = null;
  private readonly stepper = new FixedStepper(STEP);
  private running = false;
  private lastMs = 0;

  constructor(canvas: HTMLCanvasElement, opts?: { save?: SaveStore; audio?: AudioSys }) {
    this.input = new Input();
    this.renderer = new Renderer(canvas);
    this.save = opts?.save ?? new SaveStore();
    this.audio = opts?.audio ?? new AudioSys();
    this.audio.muted = this.save.getFlag(SAVE_KEYS.muted);
  }

  /** Flip mute and persist the choice. */
  toggleMute(): void {
    this.audio.muted = !this.audio.muted;
    this.save.setFlag(SAVE_KEYS.muted, this.audio.muted);
  }

  /**
   * The scene on screen, for the dev tuner's readout — which has to ask a live
   * `PlayScene` what its wind-up bank is up to. Read-only and outside the loop:
   * scenes are still swapped through `setScene` alone.
   */
  get activeScene(): Scene | null {
    return this.scene;
  }

  setScene(s: Scene): void {
    if (this.scene?.exit) {
      this.scene.exit(this);
    }
    this.scene = s;
    if (s.enter) {
      s.enter(this);
    }
  }

  /**
   * Run one full frame: fixed-step updates, input edge clear, render, present.
   * Called by the RAF loop; also drivable manually (e.g. automated checks in
   * hidden tabs, where browsers suspend requestAnimationFrame entirely).
   */
  stepFrame(elapsedSec: number): void {
    const scene = this.scene;
    if (scene) {
      this.stepper.advance(elapsedSec, (dt) => {
        scene.update(dt, this);
        this.time += dt;
        // Edges clear after EACH consumed step: a two-step frame must not
        // double-fire pressed(); a zero-step frame must not drop presses.
        this.input.update();
      });
      scene.render(this.renderer, this);
      this.renderer.present();
    }
  }

  /** Start the requestAnimationFrame loop (browser only; call once). */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastMs = performance.now();
    const frame = (nowMs: number): void => {
      const elapsedSec = (nowMs - this.lastMs) / 1000;
      this.lastMs = nowMs;
      this.stepFrame(elapsedSec);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
