/**
 * The gameplay scene, reduced to the smallest thing that proves the engine
 * boots: one hardcoded grid, one player, one camera.
 *
 * EVERYTHING HERE IS THROWAWAY. Phase 5 replaces the grid with a parsed level
 * and this scene with the real one (level lifecycle, death fades, goal, timer).
 * Do not grow features on it — a grid that accumulates features is a grid
 * someone will try to keep.
 */

import { TILE, VIEW_H, VIEW_W } from '../constants';
import type { Input } from '../engine/input';
import { palette } from '../engine/palette';
import { ParticleSystem } from '../engine/particles';
import type { Renderer } from '../engine/renderer';
import { Rng } from '../engine/rng';
import type { EntityWorld } from '../entities/context';
import { Player } from '../entities/player';
import type { PlayerInputs } from '../entities/player';
import type { Game, Scene } from '../game';
import { Camera } from '../world/camera';
import { Tile, TileMap, toTile } from '../world/tiles';
import { TitleScene } from './title';

/** 40 × 17 scratch grid: a few ledges, and one 4-tile gap to fall into. */
const TEST_GRID: readonly string[] = [
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '........................................',
  '..............................####......',
  '........................................',
  '.......................###..............',
  '........................................',
  '................####....................',
  '........................................',
  '.........####...........................',
  '........................................',
  '........................................',
  '####################....################',
  '####################....################',
];

/** Spawn tile column, and the row whose top edge the feet rest on. */
const SPAWN_TX = 3;
const SPAWN_FEET_TY = 15;

function buildTestMap(): TileMap {
  const map = new TileMap(TEST_GRID[0].length, TEST_GRID.length);
  TEST_GRID.forEach((row, ty) => {
    for (let tx = 0; tx < row.length; tx++) {
      if (row[tx] === '#') {
        map.set(tx, ty, Tile.Solid);
      }
    }
  });
  return map;
}

export class PlayScene implements Scene {
  private readonly map = buildTestMap();
  private readonly player = new Player(0, 0);
  private readonly camera = new Camera();
  private readonly particles = new ParticleSystem();
  private readonly rng = new Rng(0xfeed);

  enter(): void {
    this.respawn();
    this.camera.snapTo(this.player.centerX, this.player.centerY);
    this.camera.clampTo(this.map.widthPx, this.map.heightPx);
  }

  private respawn(): void {
    this.player.spawnAt(SPAWN_TX * TILE, SPAWN_FEET_TY * TILE);
    this.particles.clear();
  }

  private world(game: Game): EntityWorld {
    return {
      map: this.map,
      particles: this.particles,
      rng: this.rng,
      sfx: (n) => game.audio.play(n),
    };
  }

  update(dt: number, game: Game): void {
    const input = game.input;
    if (input.pressed('mute')) {
      game.toggleMute();
    }
    if (input.pressed('back')) {
      game.setScene(new TitleScene());
      return;
    }
    if (input.pressed('restart')) {
      this.respawn();
    }

    this.player.update(dt, readInputs(input), this.world(game));

    // No death yet (phase 5 owns it): leaving the world just puts you back.
    const b = this.player.body;
    if (b.y > this.map.heightPx + TILE || b.y + b.h < -TILE) {
      this.respawn();
    }

    this.camera.follow(this.player.centerX, this.player.centerY, dt);
    this.camera.clampTo(this.map.widthPx, this.map.heightPx);
    this.particles.update(dt);
  }

  render(r: Renderer, game: Game): void {
    const vx = this.camera.viewX;
    const vy = this.camera.viewY;
    r.setCamera(vx, vy);
    r.clear(palette.paper);
    this.renderTiles(r, vx, vy);
    this.player.render(r);
    this.particles.render(r.ctx, Math.round(vx), Math.round(vy));

    r.text('PHASE 2 TEST GRID', 16, 16, palette.ink, 2);
    r.text('AD/ARROWS MOVE  W/UP JUMP  R RESET  ESC TITLE', 16, 40, palette.ink);
    if (game.audio.muted) {
      r.text('MUTED', 16, VIEW_H - 24, palette.ink);
    }
  }

  /** One fillRect per tile. Phase 3 merges runs; this is the dumb version. */
  private renderTiles(r: Renderer, vx: number, vy: number): void {
    const x0 = Math.max(0, toTile(vx));
    const y0 = Math.max(0, toTile(vy));
    const x1 = Math.min(this.map.w - 1, toTile(vx + VIEW_W));
    const y1 = Math.min(this.map.h - 1, toTile(vy + VIEW_H));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.map.isSolid(tx, ty)) {
          r.rect(tx * TILE, ty * TILE, TILE, TILE, palette.ink);
        }
      }
    }
  }
}

function readInputs(input: Input): PlayerInputs {
  return {
    left: input.down('left'),
    right: input.down('right'),
    jumpHeld: input.down('jump'),
    jumpPressed: input.pressed('jump'),
  };
}
