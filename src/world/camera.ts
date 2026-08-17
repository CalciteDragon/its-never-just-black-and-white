/**
 * Follow camera: a smoothed lead in the direction of travel, a hard horizontal
 * clamp, a deliberately soft vertical one, and the speed-driven screen bounce.
 * Pure logic; scenes read viewX/viewY and pass them to Renderer.setCamera.
 *
 * There is no shake — impacts spin the player, they don't rattle the screen.
 */

import {
  BOUNCE_AMP,
  BOUNCE_FREQ,
  CAMERA_FOLLOW_RATE,
  CAMERA_VSLACK,
  LOOKAHEAD_MAX,
  LOOKAHEAD_RATE,
  LOOKAHEAD_TIME,
  VIEW_H,
  VIEW_W,
} from '../constants';

const TAU = Math.PI * 2;

export class Camera {
  /** Top-left of the view in world px (floats). */
  x = 0;
  y = 0;

  /** Smoothed horizontal lead (px). Lags the raw target by LOOKAHEAD_RATE. */
  private lookahead = 0;
  /** Integrated bounce phase (rad). State, never a function of wall-clock time. */
  private bouncePhase = 0;
  /** Cosmetic vertical offset (px), applied in viewY only. */
  private bounceOffset = 0;

  /** Centre the view on (cx, cy) immediately, from rest: no lead, no wobble. */
  snapTo(cx: number, cy: number): void {
    this.lookahead = 0;
    this.bouncePhase = 0;
    this.bounceOffset = 0;
    this.x = cx - VIEW_W / 2;
    this.y = cy - VIEW_H / 2;
  }

  /**
   * Advance one fixed step: smooth the lead, follow the target plus that lead,
   * then integrate the bounce phase.
   */
  update(cx: number, cy: number, vx: number, speedNorm: number, dt: number): void {
    // The raw lead jumps ~2·LOOKAHEAD_MAX on a direction reversal. Smoothing the
    // offset itself — not just the target — is what turns that whip into a slide.
    const raw = clamp(vx * LOOKAHEAD_TIME, -LOOKAHEAD_MAX, LOOKAHEAD_MAX);
    this.lookahead += (raw - this.lookahead) * Math.min(1, LOOKAHEAD_RATE * dt);

    const t = Math.min(1, CAMERA_FOLLOW_RATE * dt);
    this.x += (cx + this.lookahead - VIEW_W / 2 - this.x) * t;
    this.y += (cy - VIEW_H / 2 - this.y) * t;

    // speedNorm modulates the *frequency*, so it is integrated into the phase.
    // Multiplying it into the sine's argument (GAME-DESIGN §7's literal form)
    // would make a 0.01 speed change jump the phase by t · BOUNCE_FREQ · 0.01 —
    // several radians deep into a run, i.e. a snap. See PHASES.md decision 2.
    this.bouncePhase = (this.bouncePhase + BOUNCE_FREQ * speedNorm * dt) % TAU;
    this.bounceOffset = Math.sin(this.bouncePhase) * BOUNCE_AMP * speedNorm;
  }

  /** Hard clamp to the map's width; centres a map narrower than the view. */
  clampX(mapWpx: number): void {
    if (mapWpx <= VIEW_W) {
      this.x = (mapWpx - VIEW_W) / 2;
      return;
    }
    this.x = clamp(this.x, 0, mapWpx - VIEW_W);
  }

  /**
   * Vertical bound with CAMERA_VSLACK px of allowed overshoot past each edge:
   * gravity flips, so both are lethal, and the frame before an out-of-bounds
   * death has to stay legible instead of clipping off a pinned edge. A map
   * shorter than the view centres — pinning to 0 would assume down is down.
   */
  clampY(mapHpx: number): void {
    if (mapHpx <= VIEW_H) {
      this.y = (mapHpx - VIEW_H) / 2;
      return;
    }
    this.y = clamp(this.y, -CAMERA_VSLACK, mapHpx - VIEW_H + CAMERA_VSLACK);
  }

  /** View origin the renderer should use. The bounce is here and nowhere else. */
  get viewX(): number {
    return this.x;
  }

  get viewY(): number {
    return this.y + this.bounceOffset;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
