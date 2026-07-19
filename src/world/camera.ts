/**
 * Smooth-follow camera with map clamping and decaying shake. Pure logic;
 * scenes read viewX/viewY and pass them to Renderer.setCamera.
 */

import { CAMERA_FOLLOW_RATE, VIEW_H, VIEW_W } from '../constants';
import { Rng } from '../engine/rng';

export class Camera {
  /** Top-left of the view in world px (pre-shake, floats). */
  x = 0;
  y = 0;

  private shakeMag = 0;
  private shakeLeft = 0;
  private shakeDur = 0;
  private jx = 0;
  private jy = 0;
  /** Cosmetic only — a fixed seed keeps replays looking identical. */
  private readonly rng = new Rng(0x5eed);

  /** Center the view on (cx, cy) immediately. */
  snapTo(cx: number, cy: number): void {
    this.x = cx - VIEW_W / 2;
    this.y = cy - VIEW_H / 2;
  }

  /** Exponentially approach centering on (cx, cy). Call once per fixed step. */
  follow(cx: number, cy: number, dt: number): void {
    const t = Math.min(1, CAMERA_FOLLOW_RATE * dt);
    this.x += (cx - VIEW_W / 2 - this.x) * t;
    this.y += (cy - VIEW_H / 2 - this.y) * t;
  }

  /** Keep the view inside the map (centers if the map is smaller than the view). */
  clampTo(mapWpx: number, mapHpx: number): void {
    const maxX = Math.max(0, mapWpx - VIEW_W);
    const maxY = Math.max(0, mapHpx - VIEW_H);
    this.x = Math.min(Math.max(this.x, 0), maxX);
    this.y = Math.min(Math.max(this.y, 0), maxY);
  }

  /** Kick off (or extend) a shake of ±mag px lasting dur seconds. */
  shake(mag: number, dur: number): void {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeLeft = Math.max(this.shakeLeft, dur);
    this.shakeDur = Math.max(this.shakeDur, dur);
  }

  /** Advance shake decay. Call once per fixed step. */
  update(dt: number): void {
    if (this.shakeLeft <= 0) {
      this.jx = 0;
      this.jy = 0;
      return;
    }
    this.shakeLeft = Math.max(0, this.shakeLeft - dt);
    const falloff = this.shakeDur > 0 ? this.shakeLeft / this.shakeDur : 0;
    const m = this.shakeMag * falloff;
    this.jx = this.rng.float(-m, m);
    this.jy = this.rng.float(-m, m);
    if (this.shakeLeft === 0) {
      this.shakeMag = 0;
      this.shakeDur = 0;
    }
  }

  /** Final view origin including shake jitter (what the renderer should use). */
  get viewX(): number {
    return this.x + this.jx;
  }

  get viewY(): number {
    return this.y + this.jy;
  }
}
