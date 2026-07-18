/**
 * Fixed-timestep loop + scene management. FixedStepper is pure and
 * node-tested; Game wires it to requestAnimationFrame and therefore only ever
 * runs in the browser (constructing it requires a canvas).
 */

import { STEP } from './constants';
import { Input } from './engine/input';
import { Renderer } from './engine/renderer';
import { SaveStore } from './engine/save';

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
  /** Total simulated seconds (advances in fixed steps). */
  time = 0;

  private scene: Scene | null = null;
  private readonly stepper = new FixedStepper(STEP);
  private running = false;
  private lastMs = 0;

  constructor(canvas: HTMLCanvasElement, opts?: { save?: SaveStore }) {
    this.input = new Input();
    this.renderer = new Renderer(canvas);
    this.save = opts?.save ?? new SaveStore();
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
      });
      // Edges clear once per rendered frame, after all fixed steps.
      this.input.update();
      scene.render(this.renderer, this);
      this.renderer.present();
    } else {
      this.input.update();
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
