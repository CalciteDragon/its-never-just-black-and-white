/**
 * Browser bootstrap. Hosts a throwaway dungeon fly-through demo that showcases
 * the Phase B world layer (generator, tile renderer, camera); the gameplay
 * phase replaces it with the real title scene.
 */

import { PALETTE } from './engine/sprites';
import { dailySeed } from './engine/rng';
import { Renderer } from './engine/renderer';
import { VIEW_H, VIEW_W } from './constants';
import { Game } from './game';
import type { Scene } from './game';
import { Camera } from './world/camera';
import { generateDungeon } from './world/dungeon';
import type { Dungeon } from './world/dungeon';
import { drawTileMap } from './world/tiles';
import { TILE } from './constants';

declare global {
  interface Window {
    /** Dev hook for automated driving (hidden tabs suspend RAF). */
    __pq?: { game: Game };
  }
}

class DungeonDemoScene implements Scene {
  private readonly dungeon: Dungeon;
  private readonly camera = new Camera();
  private t = 0;
  private dir = 1;

  constructor() {
    this.dungeon = generateDungeon({ seed: dailySeed(), level: 2 });
    const { spawn } = this.dungeon;
    this.camera.snapTo(spawn.tx * TILE, spawn.ty * TILE);
  }

  update(dt: number, _game: Game): void {
    this.t += dt;
    // Ping-pong pan across the whole dungeon.
    const speed = 90; // px/s
    this.camera.x += speed * dt * this.dir;
    const maxX = this.dungeon.map.widthPx - VIEW_W;
    if (this.camera.x > maxX || this.camera.x < 0) {
      this.dir *= -1;
      this.camera.x = Math.min(Math.max(this.camera.x, 0), maxX);
    }
    // Track the floor surface (solid with air above) near the view center.
    const map = this.dungeon.map;
    const midCol = Math.floor((this.camera.x + VIEW_W / 2) / TILE);
    for (let ty = map.h - 1; ty > 0; ty--) {
      if (map.isSolid(midCol, ty) && !map.isSolid(midCol, ty - 1)) {
        const targetY = ty * TILE - VIEW_H * 0.65;
        const clamped = Math.min(Math.max(targetY, 0), map.heightPx - VIEW_H);
        this.camera.y += (clamped - this.camera.y) * Math.min(1, 3 * dt);
        break;
      }
    }
    this.camera.clampTo(this.dungeon.map.widthPx, this.dungeon.map.heightPx);
    this.camera.update(dt);
  }

  render(r: Renderer, _game: Game): void {
    const d = this.dungeon;
    r.setCamera(this.camera.viewX, this.camera.viewY);
    r.clear('#0B1120');
    drawTileMap(r, d.map, this.camera.viewX, this.camera.viewY);

    // Entity markers straight from the generator output.
    const frame = Math.floor(this.t * 8);
    for (const c of d.coins) {
      r.sprite(`coin${(frame % 4) + 1}` as 'coin1', c.tx * TILE + 4, c.ty * TILE + 4);
    }
    for (const s of d.slimes) {
      r.sprite(frame % 2 === 0 ? 'slime1' : 'slime2', s.tx * TILE + 1, s.ty * TILE + 6);
    }
    for (const t of d.torches) {
      r.sprite(frame % 2 === 0 ? 'torch1' : 'torch2', t.tx * TILE + 5, t.ty * TILE + 2);
    }
    r.sprite('player1Idle', d.spawn.tx * TILE + 2, d.spawn.ty * TILE + 2);
    r.sprite('doorClosed', d.exit.tx * TILE, (d.exit.ty - 1) * TILE);

    r.textCentered('PIXEL QUEST - DUNGEON DEMO', VIEW_W / 2, 5, PALETTE.C);
    r.text(`SEED ${d.seed}`, 8, VIEW_H - 16, PALETTE.t);
    r.text(`LEVEL ${d.level}  ${d.map.w}x${d.map.h}`, 8, VIEW_H - 8, PALETTE.t);
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

game.setScene(new DungeonDemoScene());
game.start();
window.__pq = { game };
