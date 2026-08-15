/**
 * Smooth-follow camera with map clamping. Pure logic; scenes read viewX/viewY
 * and pass them to Renderer.setCamera.
 *
 * There is no shake — impacts spin the player, they don't rattle the screen.
 * Phase 3 adds lookahead, vertical freedom, and the speed-driven bounce.
 */

import { CAMERA_FOLLOW_RATE, VIEW_H, VIEW_W } from '../constants';

export class Camera {
  /** Top-left of the view in world px (floats). */
  x = 0;
  y = 0;

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

  /** View origin the renderer should use. */
  get viewX(): number {
    return this.x;
  }

  get viewY(): number {
    return this.y;
  }
}
