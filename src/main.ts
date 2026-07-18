/**
 * Browser bootstrap. Hosts the throwaway DemoScene that showcases the Phase A
 * engine (sprites, font, particles, input, fixed-step loop); later phases
 * replace it with the real title scene.
 */

import { VIEW_H, VIEW_W } from './constants';
import { measureText } from './engine/font';
import { burstSparkle, ParticleSystem } from './engine/particles';
import { Rng } from './engine/rng';
import { Renderer } from './engine/renderer';
import { PALETTE, SPRITE_NAMES, SPRITES } from './engine/sprites';
import { Game } from './game';
import type { Scene } from './game';

declare global {
  interface Window {
    /** Dev hook for automated driving (hidden tabs suspend RAF). */
    __pq?: { game: Game };
  }
}

class DemoScene implements Scene {
  private readonly rng = new Rng(Date.now() >>> 0);
  private readonly particles = new ParticleSystem();
  private t = 0;
  private ticks = 0;
  private sparkleTimer = 0.4;
  private frames = 0;
  private fps = 0;
  private lastFpsMs = 0;

  update(dt: number, _game: Game): void {
    this.t += dt;
    this.ticks++;
    this.sparkleTimer -= dt;
    if (this.sparkleTimer <= 0) {
      this.sparkleTimer = 0.55;
      burstSparkle(
        this.particles,
        this.rng.float(16, VIEW_W - 16),
        this.rng.float(24, VIEW_H - 24),
      );
    }
    this.particles.update(dt);
  }

  render(r: Renderer, _game: Game): void {
    r.setCamera(0, 0);
    r.clear('#0B1120');

    r.textCentered('PIXEL QUEST - ENGINE DEMO', VIEW_W / 2, 5, PALETTE.C);

    // Every sprite in a labeled flow grid.
    let x = 8;
    let y = 20;
    let rowH = 0;
    for (const name of SPRITE_NAMES) {
      const rows = SPRITES[name];
      const w = rows[0].length;
      const h = rows.length;
      const cellW = Math.max(w, measureText(name)) + 9;
      if (x + cellW > VIEW_W - 8) {
        x = 8;
        y += rowH;
        rowH = 0;
      }
      const cx = x + Math.floor((cellW - 9) / 2);
      r.sprite(name, Math.round(cx - w / 2), y, { ui: true });
      r.textCentered(name, cx, y + h + 2, PALETTE.t);
      rowH = Math.max(rowH, h + 14);
      x += cellW;
    }

    // Bouncing player 1 (sine bounce, flip + leg animation).
    const bounce = Math.abs(Math.sin(this.t * 3.2));
    const px = VIEW_W / 2 - 6;
    const py = VIEW_H - 34 - bounce * 22;
    const runFrame = Math.floor(this.t * 8) % 2 === 0 ? 'player1Run1' : 'player1Run2';
    const flipX = Math.sin(this.t * 1.6) < 0;
    r.sprite(bounce > 0.85 ? 'player1Jump' : runFrame, Math.round(px), Math.round(py), {
      ui: true,
      flipX,
    });

    this.particles.render(r.ctx, 0, 0);

    // FPS-ish counters (render frames vs. fixed ticks).
    this.frames++;
    const now = performance.now();
    if (now - this.lastFpsMs >= 1000) {
      this.fps = this.frames;
      this.frames = 0;
      this.lastFpsMs = now;
    }
    r.text(`FPS ${this.fps}`, 8, VIEW_H - 16, PALETTE.t);
    r.text(`TICKS ${this.ticks}`, 8, VIEW_H - 8, PALETTE.t);
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
game.input.attach(window);

// Refit only on real size changes. A ResizeObserver on the root element also
// fires once immediately, which covers embedded panes that lay out after load
// (a plain 'resize' listener can miss that first sizing entirely).
let lastW = -1;
let lastH = -1;
const fit = (): void => {
  if (window.innerWidth !== lastW || window.innerHeight !== lastH) {
    lastW = window.innerWidth;
    lastH = window.innerHeight;
    game.renderer.fitToWindow(window);
  }
};
window.addEventListener('resize', fit);
new ResizeObserver(fit).observe(document.documentElement);
fit();

game.setScene(new DemoScene());
game.start();
window.__pq = { game };
