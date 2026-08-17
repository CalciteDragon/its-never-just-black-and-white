/**
 * The gameplay scene, reduced to the smallest thing that proves the engine
 * boots: one hardcoded grid, one player, one camera.
 *
 * EVERYTHING HERE IS THROWAWAY. Phase 5 replaces the grid with a parsed level
 * and this scene with the real one (level lifecycle, death fades, goal, timer).
 * Do not grow features on it — a grid that accumulates features is a grid
 * someone will try to keep.
 */

import { SPEED_REF, SPEED_SMOOTH_RATE, TILE, VIEW_H, VIEW_W } from '../constants';
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
import { Tile, TileMap, forEachRun, toTile } from '../world/tiles';
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
  /**
   * The one number every effect reads (GAME-DESIGN §7). Computed here from the
   * player's real velocity — not faked — and handed to its two consumers this
   * phase as an argument. Phase 6 adds the other two (particles, audio); it is
   * four lines and a field precisely so there is no `SpeedMeter` abstraction to
   * inherit and regret.
   */
  private speedNorm = 0;

  enter(): void {
    this.respawn();
    this.camera.snapTo(this.player.centerX, this.player.centerY);
    this.camera.clampX(this.map.widthPx);
    this.camera.clampY(this.map.heightPx);
  }

  private respawn(): void {
    this.player.spawnAt(SPAWN_TX * TILE, SPAWN_FEET_TY * TILE);
    this.particles.clear();
    this.speedNorm = 0;
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
    // Colours only. The flip's gravity half is phase 5's — faking it here
    // would leave a second implementation for phase 5 to find and remove.
    if (input.pressed('flip')) {
      palette.flip();
    }

    this.player.update(dt, readInputs(input), this.world(game));

    // No death yet (phase 5 owns it): leaving the world just puts you back.
    const b = this.player.body;
    if (b.y > this.map.heightPx + TILE || b.y + b.h < -TILE) {
      this.respawn();
    }

    // Exponential lag, so a single frame of wall contact can't strobe the
    // whole screen from a full vignette down to nothing and back.
    const target = Math.min(1, Math.hypot(b.vx, b.vy) / SPEED_REF);
    this.speedNorm += (target - this.speedNorm) * Math.min(1, SPEED_SMOOTH_RATE * dt);

    this.camera.update(this.player.centerX, this.player.centerY, b.vx, this.speedNorm, dt);
    this.camera.clampX(this.map.widthPx);
    this.camera.clampY(this.map.heightPx);
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

    r.text('PHASE 3 TEST GRID', 16, 16, palette.ink, 2);
    r.text('AD/ARROWS MOVE  W/UP JUMP  SPACE FLIP  R RESET  ESC TITLE', 16, 40, palette.ink);
    if (game.audio.muted) {
      r.text('MUTED', 16, VIEW_H - 24, palette.ink);
    }

    // Last, and over everything including the UI — it is a screen-space pass.
    r.applyPost(this.speedNorm);
  }

  /** Row-merged runs: a 40-tile floor is one fillRect, not forty. */
  private renderTiles(r: Renderer, vx: number, vy: number): void {
    forEachRun(
      this.map,
      toTile(vx),
      toTile(vy),
      toTile(vx + VIEW_W),
      toTile(vy + VIEW_H),
      (tx, ty, len) => {
        r.rect(tx * TILE, ty * TILE, len * TILE, TILE, palette.ink);
      },
    );
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
