/**
 * Shared parallax backdrop (GAME-DESIGN §2): star field + two silhouette
 * skylines, all position-hashed (deterministic, camera-parallaxed).
 */

import { VIEW_H, VIEW_W } from '../constants';
import type { Renderer } from '../engine/renderer';

const STAR_COLOR = '#334155';
const FAR_COLOR = '#111B33';
const NEAR_COLOR = '#162240';

function hash(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return (h ^= h >>> 16) >>> 0;
}

/** Draw below everything, after clear(). camX/camY parallax the layers. */
export function drawBackdrop(r: Renderer, camX: number, camY: number): void {
  r.clear('#0B1120');

  // Stars (slowest layer), wrapped over a virtual 512px tile.
  for (let i = 0; i < 36; i++) {
    const hx = hash(i * 3 + 1);
    const sx = (((hx % 512) - camX * 0.1) % 512 + 512) % 512;
    if (sx < VIEW_W) {
      const sy = (hash(i * 7 + 2) % (VIEW_H - 80)) - camY * 0.05;
      const bright = hash(i) % 3 === 0;
      r.rect(sx, ((sy % VIEW_H) + VIEW_H) % VIEW_H, 1, 1, bright ? '#475569' : STAR_COLOR, true);
    }
  }

  // Two bottom-anchored skylines, drawn as 24px-wide columns.
  drawSkyline(r, camX * 0.2, 70, 40, FAR_COLOR, 11);
  drawSkyline(r, camX * 0.35, 44, 30, NEAR_COLOR, 29);
}

function drawSkyline(
  r: Renderer,
  scrollX: number,
  base: number,
  vary: number,
  color: string,
  salt: number,
): void {
  const colW = 24;
  const first = Math.floor(scrollX / colW);
  for (let k = first; k <= first + Math.ceil(VIEW_W / colW) + 1; k++) {
    const h = base + (hash(k * 31 + salt) % vary);
    const x = k * colW - scrollX;
    r.rect(x, VIEW_H - h, colW, h, color, true);
    // Occasional antenna/battlement detail.
    if (hash(k * 17 + salt) % 4 === 0) {
      r.rect(x + (hash(k) % (colW - 4)) + 2, VIEW_H - h - 5, 2, 5, color, true);
    }
  }
}
