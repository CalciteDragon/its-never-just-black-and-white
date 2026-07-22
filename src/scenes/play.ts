/**
 * The gameplay scene: owns entities, camera, HUD, pause, level flow, and the
 * cross-entity rules (stomps, spikes, pits, door, co-op respawn). All scoring
 * and progression bookkeeping delegates to RunState (pure, tested).
 */

import {
  COOP_RESPAWN_DELAY,
  HEART_MAX,
  JUMP_VELOCITY,
  LEVEL_BANNER_TIME,
  LEVELS_PER_RUN,
  STOMP_BOUNCE,
  STOMP_MIN_VY,
  TILE,
  VIEW_H,
  VIEW_W,
} from '../constants';
import { ParticleSystem } from '../engine/particles';
import { mixSeeds, Rng } from '../engine/rng';
import type { Renderer } from '../engine/renderer';
import { PALETTE } from '../engine/sprites';
import type { Input } from '../engine/input';
import type { Game, Scene } from '../game';
import { Coin, coinAtTile } from '../entities/coin';
import type { EntityWorld } from '../entities/context';
import { Door } from '../entities/door';
import { NO_INPUTS, Player } from '../entities/player';
import type { PlayerInputs } from '../entities/player';
import { Slime, slimeAtTile } from '../entities/slime';
import { Torch } from '../entities/torch';
import { formatTime, RunState } from '../run';
import type { RunConfig } from '../run';
import { Camera } from '../world/camera';
import { generateDungeon } from '../world/dungeon';
import type { Dungeon } from '../world/dungeon';
import { rectOverlapsSpikes } from '../world/physics';
import { drawTileMap } from '../world/tiles';
import { drawBackdrop } from './backdrop';
import { ResultsScene } from './results';
import { TitleScene } from './title';

const PAUSE_MENU = ['RESUME', 'RESTART RUN', 'QUIT TO TITLE'] as const;

export class PlayScene implements Scene {
  readonly state: RunState;
  private dungeon!: Dungeon;
  private players: Player[] = [];
  private slimes: Slime[] = [];
  private coins: Coin[] = [];
  private torches: Torch[] = [];
  private door!: Door;
  private readonly camera = new Camera();
  private readonly particles = new ParticleSystem();
  private cosmeticRng = new Rng(0xfeed);
  private banner = 0;
  private paused = false;
  private pauseSel = 0;
  private endTimer = -1;
  private respawnTimers: number[] = [0, 0];

  constructor(cfg: RunConfig) {
    this.state = new RunState(cfg);
  }

  enter(_game: Game): void {
    this.loadLevel();
  }

  private loadLevel(): void {
    const cfg = this.state.config;
    this.dungeon = generateDungeon({
      seed: mixSeeds(cfg.seed, this.state.level),
      level: this.state.level,
    });
    const d = this.dungeon;
    this.cosmeticRng = new Rng(mixSeeds(cfg.seed, this.state.level * 977));
    this.particles.clear();

    const feetX = d.spawn.tx * TILE + 3;
    const feetY = (d.spawn.ty + 1) * TILE;
    if (this.players.length === 0) {
      this.players.push(new Player(0, feetX, feetY - 13));
      if (cfg.players === 2) {
        this.players.push(new Player(1, feetX + 14, feetY - 13));
      }
    }
    this.players.forEach((p, i) => {
      if (!p.dead) {
        p.spawnAt(feetX + i * 14, feetY);
      }
    });

    this.slimes = d.slimes.map((s) => slimeAtTile(s.tx, s.ty, this.cosmeticRng));
    this.coins = d.coins.map((c, i) => coinAtTile(c.tx, c.ty, i * 0.13));
    this.torches = d.torches.map((t, i) => new Torch(t.tx, t.ty, i * 0.37));
    this.door = new Door(d.exit.tx, d.exit.ty);

    const p0 = this.players[0];
    this.camera.snapTo(p0.centerX, p0.centerY - 24);
    this.camera.clampTo(d.map.widthPx, d.map.heightPx);
    this.banner = LEVEL_BANNER_TIME;
    this.respawnTimers = [COOP_RESPAWN_DELAY, COOP_RESPAWN_DELAY];
  }

  private world(game: Game): EntityWorld {
    return {
      map: this.dungeon.map,
      particles: this.particles,
      rng: this.cosmeticRng,
      sfx: (n) => game.audio.play(n),
      shake: (m, dur) => this.camera.shake(m, dur),
    };
  }

  update(dt: number, game: Game): void {
    const input = game.input;
    if (input.anyPressed('mute')) {
      game.toggleMute();
    }

    if (this.paused) {
      this.updatePause(game);
      return;
    }
    if (input.anyPressed('pause') && this.endTimer < 0) {
      this.paused = true;
      this.pauseSel = 0;
      game.audio.play('menuMove');
      return;
    }

    if (this.banner > 0) {
      this.banner -= dt;
      this.particles.update(dt);
      return;
    }

    const world = this.world(game);
    this.state.tick(dt);

    // Players.
    for (const p of this.players) {
      if (p.dead) {
        continue;
      }
      p.update(dt, this.inputsFor(input, p.index), world);
      if (p.body.y > this.dungeon.map.heightPx + 24) {
        p.pitFall(world);
      }
      if (
        p.invuln <= 0 &&
        rectOverlapsSpikes(world.map, p.body.x, p.body.y, p.body.w, p.body.h)
      ) {
        p.hurt(world, p.centerX + (p.body.vx >= 0 ? 1 : -1));
      }
    }

    // Coins.
    for (const c of this.coins) {
      if (c.taken) {
        continue;
      }
      c.update(dt);
      for (const p of this.players) {
        if (!p.dead && c.inRange(p.centerX, p.centerY)) {
          c.collect(world);
          this.state.addCoin();
          break;
        }
      }
    }

    // Slimes & stomps.
    for (const s of this.slimes) {
      if (!s.alive) {
        continue;
      }
      s.update(dt, world);
      for (const p of this.players) {
        if (p.dead || !s.alive) {
          continue;
        }
        const pb = p.body;
        const sb = s.body;
        const overlap =
          pb.x < sb.x + sb.w && pb.x + pb.w > sb.x && pb.y < sb.y + sb.h && pb.y + pb.h > sb.y;
        if (!overlap) {
          continue;
        }
        if (pb.vy > STOMP_MIN_VY && pb.y + pb.h < s.centerY + 3) {
          s.stomp(world);
          p.bounce(-JUMP_VELOCITY * STOMP_BOUNCE);
          this.state.addStomp();
        } else {
          p.hurt(world, s.centerX);
        }
      }
    }

    // Torches (decorative).
    for (const t of this.torches) {
      t.update(dt, world);
    }

    // Door: cosmetic glow + level clear.
    const alive = this.players.filter((p) => !p.dead);
    this.door.open = alive.some((p) => this.door.isNear(p.centerX, p.centerY));
    if (this.endTimer < 0 && alive.some((p) => this.door.overlaps(p.body))) {
      game.audio.play('door');
      if (this.state.clearLevel() === 'victory') {
        game.audio.play('victory');
        this.endTimer = 1.0;
      } else {
        for (const p of this.players) {
          p.addHeart();
        }
        this.loadLevel();
        return;
      }
    }

    // Co-op respawn + game over.
    for (const p of this.players) {
      if (!p.dead) {
        this.respawnTimers[p.index] = COOP_RESPAWN_DELAY;
        continue;
      }
      const partner = this.players.find((q) => q !== p && !q.dead);
      if (partner) {
        this.respawnTimers[p.index] -= dt;
        if (this.respawnTimers[p.index] <= 0) {
          p.reviveAt(partner.body.x, partner.body.y - 8);
          this.respawnTimers[p.index] = COOP_RESPAWN_DELAY;
        }
      }
    }
    if (this.endTimer < 0 && !this.state.finished && this.players.every((p) => p.dead)) {
      this.state.gameOver();
      game.audio.play('gameover');
      this.endTimer = 1.2;
    }

    // Run end → results.
    if (this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer < 0) {
        game.setScene(new ResultsScene(this.state));
        return;
      }
    }

    // Camera follows the midpoint of living players.
    if (alive.length > 0) {
      const mx = alive.reduce((a, p) => a + p.centerX, 0) / alive.length;
      const my = alive.reduce((a, p) => a + p.centerY, 0) / alive.length;
      this.camera.follow(mx, my - 16, dt);
    }
    this.camera.clampTo(this.dungeon.map.widthPx, this.dungeon.map.heightPx);
    this.camera.update(dt);
    this.particles.update(dt);
  }

  /** In solo modes BOTH binding sets drive player 0 (GAME-DESIGN §4). */
  private inputsFor(input: Input, index: 0 | 1): PlayerInputs {
    if (this.state.config.players === 1) {
      if (index !== 0) {
        return NO_INPUTS;
      }
      return {
        left: input.down(0, 'left') || input.down(1, 'left'),
        right: input.down(0, 'right') || input.down(1, 'right'),
        jumpHeld: input.down(0, 'jump') || input.down(1, 'jump'),
        jumpPressed: input.pressed(0, 'jump') || input.pressed(1, 'jump'),
        downHeld: input.down(0, 'down') || input.down(1, 'down'),
      };
    }
    return {
      left: input.down(index, 'left'),
      right: input.down(index, 'right'),
      jumpHeld: input.down(index, 'jump'),
      jumpPressed: input.pressed(index, 'jump'),
      downHeld: input.down(index, 'down'),
    };
  }

  private updatePause(game: Game): void {
    const input = game.input;
    if (input.anyPressed('up')) {
      this.pauseSel = (this.pauseSel + PAUSE_MENU.length - 1) % PAUSE_MENU.length;
      game.audio.play('menuMove');
    }
    if (input.anyPressed('down')) {
      this.pauseSel = (this.pauseSel + 1) % PAUSE_MENU.length;
      game.audio.play('menuMove');
    }
    if (input.anyPressed('pause')) {
      this.paused = false;
      return;
    }
    if (input.anyPressed('confirm')) {
      game.audio.play('menuPick');
      switch (this.pauseSel) {
        case 0:
          this.paused = false;
          break;
        case 1:
          game.setScene(new PlayScene(this.state.config));
          break;
        case 2:
          game.setScene(new TitleScene());
          break;
      }
    }
  }

  render(r: Renderer, game: Game): void {
    const vx = this.camera.viewX;
    const vy = this.camera.viewY;
    r.setCamera(vx, vy);
    drawBackdrop(r, vx, vy);
    drawTileMap(r, this.dungeon.map, vx, vy);

    for (const t of this.torches) {
      t.render(r);
    }
    this.door.render(r);
    for (const c of this.coins) {
      c.render(r);
    }
    for (const s of this.slimes) {
      s.render(r);
    }
    for (const p of this.players) {
      p.render(r);
    }
    this.particles.render(r.ctx, Math.round(vx), Math.round(vy));

    this.renderHud(r, game);

    if (this.banner > 0) {
      const label =
        this.state.config.mode === 'daily'
          ? `DAILY ${this.state.config.dateKey ?? ''}`
          : `LEVEL ${this.state.level}`;
      r.textCentered(`LEVEL ${this.state.level} / ${LEVELS_PER_RUN}`, VIEW_W / 2, 104, PALETTE.t);
      r.textCentered(label, VIEW_W / 2, 118, PALETTE.C, 2);
    }
    if (this.paused) {
      const ctx = r.ctx;
      ctx.globalAlpha = 0.65;
      r.rect(0, 0, VIEW_W, VIEW_H, '#0B1120', true);
      ctx.globalAlpha = 1;
      r.textCentered('PAUSED', VIEW_W / 2, 92, PALETTE.C, 2);
      PAUSE_MENU.forEach((item, i) => {
        const y = 126 + i * 14;
        if (i === this.pauseSel) {
          r.textCentered(`> ${item} <`, VIEW_W / 2, y, PALETTE.W);
        } else {
          r.textCentered(item, VIEW_W / 2, y, PALETTE.t);
        }
      });
    }
  }

  private renderHud(r: Renderer, game: Game): void {
    // P1 hearts top-left; P2 top-right.
    for (let i = 0; i < HEART_MAX; i++) {
      const p0 = this.players[0];
      r.sprite(i < p0.hearts && !p0.dead ? 'heartFull' : 'heartEmpty', 5 + i * 11, 5, {
        ui: true,
      });
    }
    if (this.players.length > 1) {
      const p1 = this.players[1];
      for (let i = 0; i < HEART_MAX; i++) {
        r.sprite(i < p1.hearts && !p1.dead ? 'heartFull' : 'heartEmpty', VIEW_W - 16 - i * 11, 5, {
          ui: true,
        });
      }
      if (p1.dead && this.players.some((q) => !q.dead)) {
        r.text(`P2 IN ${Math.ceil(this.respawnTimers[1])}`, VIEW_W - 64, 16, PALETTE.O);
      }
    }

    r.sprite('coin1', 5, 17, { ui: true });
    r.text(`×${this.state.coins}`, 16, 18, PALETTE.o);
    r.textCentered(formatTime(this.state.timeMs), VIEW_W / 2, 6, PALETTE.W);
    const levelLabel =
      this.state.config.mode === 'daily'
        ? `DAILY ${this.state.config.dateKey ?? ''}`
        : `LEVEL ${this.state.level}/${LEVELS_PER_RUN}`;
    r.textCentered(levelLabel, VIEW_W / 2, 16, PALETTE.t);
    r.text(`SEED ${this.state.config.seed}`, VIEW_W - 92, VIEW_H - 8, PALETTE.s);
    if (game.audio.muted) {
      r.text('MUTED', 5, VIEW_H - 8, PALETTE.R);
    }
  }
}
