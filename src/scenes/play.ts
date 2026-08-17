/**
 * The gameplay scene: one level, one body, and the lifecycle around them —
 * spawn, run, die, respawn, finish, advance.
 *
 * It is the only owner of two things, and both are here because nothing in the
 * type system can hold them:
 *
 * - **Gravity and palette phase are one piece of state in two places.**
 *   `player.gravitySign === +1` ⟺ `palette.phase === 0`, maintained across
 *   flips, deaths, restarts and level advance. `Player.update` reports that a
 *   flip fired; this scene is what turns that into `palette.flip()`, so a
 *   refused flip can never invert the world's colours.
 * - **The reset.** Death and `R` share one path, because "a reset that forgets
 *   one field" is the classic source of "the second attempt plays differently
 *   from the first". `Player.spawnAt` owns the body half of it.
 *
 * `update` touches only `game.input`, `game.audio`, `game.save` and
 * `game.setScene`, all of which construct fine under node, so the whole
 * lifecycle unit-tests headlessly and `render` is simply never called.
 *
 * The completion readout and the level advance are SHELL PLACEHOLDERS and look
 * it: phase 7 replaces them with `ResultsScene`, and `GOAL_HOLD` goes with them.
 */

import {
  DEATH_FADE_IN,
  DEATH_FADE_OUT,
  GOAL_HOLD,
  GOAL_OUTLINE_WIDTH,
  GOAL_PULSE_AMP,
  GOAL_PULSE_FREQ,
  PAD_CHEVRON_LEN,
  PAD_CHEVRON_WIDTH,
  SPEED_REF,
  SPEED_SMOOTH_RATE,
  TILE,
  VIEW_H,
  VIEW_W,
} from '../constants';
import type { Input } from '../engine/input';
import { palette } from '../engine/palette';
import type { Phase } from '../engine/palette';
import { ParticleSystem } from '../engine/particles';
import type { Renderer } from '../engine/renderer';
import { Rng } from '../engine/rng';
import { SAVE_KEYS } from '../engine/save';
import type { EntityWorld } from '../entities/context';
import { NO_INPUTS, Player } from '../entities/player';
import type { PlayerInputs } from '../entities/player';
import type { Game, Scene } from '../game';
import { nextLevel } from '../levels/index';
import { Camera } from '../world/camera';
import type { Level } from '../world/level';
import { forEachRun, padDirection, toTile } from '../world/tiles';
import { TitleScene } from './title';

/**
 * `Running → Dying → Respawning → Running`, plus the terminal `Won`. The body
 * keeps simulating through `Dying` — it flies out of shot, which reads as a
 * consequence rather than a pause — and plays normally through `Respawning`,
 * where the fade is purely cosmetic.
 */
type PlayState = 'running' | 'dying' | 'respawning' | 'won';

export class PlayScene implements Scene {
  private readonly level: Level;
  private readonly index: number;
  private readonly player = new Player(0, 0);
  private readonly camera = new Camera();
  private readonly particles = new ParticleSystem();
  private readonly rng = new Rng(0xfeed);

  /** The one number every effect reads (GAME-DESIGN §7). */
  private speedNorm = 0;
  private state: PlayState = 'running';
  /** Seconds inside the current state. */
  private stateT = 0;
  /** Accumulated fixed steps in `running` only — never a wall-clock read. */
  private timeSec = 0;
  /** Presentation clock, for the goal's pulse. */
  private clock = 0;
  /** 0 = clear, 1 = fully covered by `ink`. */
  private fade = 0;
  /** The phase the fade colour was sampled in, held across the palette reset. */
  private fadePhase: Phase = 0;
  private finishedMs = 0;
  private previousBestMs: number | null = null;
  private isNewBest = false;

  constructor(level: Level, index = 0) {
    this.level = level;
    this.index = index;
  }

  enter(): void {
    this.reset();
  }

  /**
   * Where the attempt has got to. Read by the headless playthrough test, which
   * has to be able to say *how far* it got and why it stopped — a bare
   * `expect(won).toBe(true)` on a forty-second simulation is close to
   * undebuggable. Not on a hot path; nothing in `render` uses it.
   */
  get status(): {
    state: PlayState;
    timeSec: number;
    x: number;
    y: number;
    gravitySign: 1 | -1;
    flipCharged: boolean;
  } {
    const b = this.player.body;
    return {
      state: this.state,
      timeSec: this.timeSec,
      x: b.x,
      y: b.y,
      gravitySign: this.player.gravitySign,
      flipCharged: this.player.flipCharged,
    };
  }

  /**
   * Everything a fresh attempt needs, in one place: body, gravity, palette,
   * charge, timer, camera, particles and speedNorm.
   */
  private reset(): void {
    const { spawn } = this.level;
    // The spawn tile's centre, at rest and square — not "feet on the floor",
    // which would mean knowing where the floor is. The 6 px drop onto it costs
    // two frames and is invisible.
    this.player.spawnAt(spawn.tx * TILE + TILE / 2, spawn.ty * TILE + TILE / 2);
    palette.reset(); // the other half of gravitySign = +1
    this.particles.clear();
    this.speedNorm = 0;
    this.timeSec = 0;
    this.state = 'running';
    this.stateT = 0;
    this.fade = 0;
    this.camera.snapTo(this.player.centerX, this.player.centerY);
    this.clampCamera();
  }

  private clampCamera(): void {
    this.camera.clampX(this.level.map.widthPx);
    this.camera.clampY(this.level.map.heightPx);
  }

  private world(game: Game): EntityWorld {
    return {
      map: this.level.map,
      particles: this.particles,
      rng: this.rng,
      sfx: (n) => game.audio.play(n),
    };
  }

  update(dt: number, game: Game): void {
    this.clock += dt;
    const input = game.input;
    if (input.pressed('mute')) {
      game.toggleMute();
    }
    if (input.pressed('back')) {
      game.setScene(new TitleScene());
      return;
    }
    // R restarts instantly, with no fade. The fade is death's punctuation, and
    // a restart the player asked for does not need punctuating (§5: failure is
    // not a punishment).
    if (input.pressed('restart')) {
      this.reset();
      return;
    }

    switch (this.state) {
      case 'running':
        // The timer is charged BEFORE the step, so the frame in which the goal
        // is reached counts toward the time that gets recorded. Charging it
        // after would leave `finishedMs` one step behind the clock the player
        // watched, which is a 16.7 ms lie on every best time.
        this.timeSec += dt;
        this.stepPlay(dt, game, readInputs(input));
        break;
      case 'dying':
        this.stepPlay(dt, game, NO_INPUTS);
        this.stateT += dt;
        this.fade = Math.min(1, this.stateT / DEATH_FADE_OUT);
        if (this.stateT >= DEATH_FADE_OUT) {
          // At the peak, where the palette reset is invisible under the held
          // fade colour. `reset` clears the fade, so put it back at full.
          this.reset();
          this.state = 'respawning';
          this.fade = 1;
        }
        break;
      case 'respawning':
        this.stepPlay(dt, game, readInputs(input));
        this.stateT += dt;
        this.fade = Math.max(0, 1 - this.stateT / DEATH_FADE_IN);
        if (this.stateT >= DEATH_FADE_IN) {
          this.state = 'running';
          this.fade = 0;
        }
        break;
      case 'won':
        // Frozen: hold the readout, then fade out and move on.
        this.stateT += dt;
        this.fade = Math.min(1, Math.max(0, (this.stateT - GOAL_HOLD) / DEATH_FADE_OUT));
        if (this.stateT >= GOAL_HOLD + DEATH_FADE_OUT) {
          const next = nextLevel(this.index);
          game.setScene(next ? new PlayScene(next, this.index + 1) : new TitleScene());
          return;
        }
        break;
    }

    // Exponential lag, so a single frame of wall contact can't strobe the whole
    // screen from a full vignette down to nothing and back.
    const b = this.player.body;
    const target = Math.min(1, Math.hypot(b.vx, b.vy) / SPEED_REF);
    this.speedNorm += (target - this.speedNorm) * Math.min(1, SPEED_SMOOTH_RATE * dt);

    this.camera.update(this.player.centerX, this.player.centerY, b.vx, this.speedNorm, dt);
    this.clampCamera();
    this.particles.update(dt);
  }

  private stepPlay(dt: number, game: Game, inputs: PlayerInputs): void {
    const ev = this.player.update(dt, inputs, this.world(game));
    // The palette is downstream of the charge check: the player decides whether
    // the flip happened, and only then do the colours move.
    if (ev.flipped) {
      palette.flip();
    }
    if (this.state !== 'running') {
      return;
    }
    if (ev.died) {
      this.die(game);
    } else if (this.atGoal()) {
      this.win(game);
    }
  }

  /**
   * The goal fires on the body's CENTRE being inside the goal tile. Rotation
   * independent, one condition, and it means the goal reads as "get *in* the
   * square" rather than "graze it with a corner".
   */
  private atGoal(): boolean {
    const { goal } = this.level;
    const b = this.player.body;
    const gx = goal.tx * TILE;
    const gy = goal.ty * TILE;
    return b.x >= gx && b.x < gx + TILE && b.y >= gy && b.y < gy + TILE;
  }

  private die(game: Game): void {
    this.state = 'dying';
    this.stateT = 0;
    this.fadePhase = palette.phase;
    game.audio.play('death');
  }

  private win(game: Game): void {
    this.state = 'won';
    this.stateT = 0;
    this.fadePhase = palette.phase;
    this.finishedMs = Math.round(this.timeSec * 1000);
    const key = SAVE_KEYS.best(this.level.id);
    const previous = game.save.getBest(key);
    this.previousBestMs = previous?.timeMs ?? null;
    // The wall-clock read here is on a PERSISTENCE path, not a logic path — the
    // simulation never sees it, so hard rule 5 is intact.
    this.isNewBest = game.save.submit(key, {
      timeMs: this.finishedMs,
      dateIso: new Date().toISOString(),
    }).isNewBest;
    game.audio.play('goal');
  }

  render(r: Renderer, game: Game): void {
    const vx = this.camera.viewX;
    const vy = this.camera.viewY;
    r.setCamera(vx, vy);
    r.clear(palette.paper);
    this.renderTiles(r, vx, vy);
    this.renderGoal(r);
    this.player.render(r);
    this.particles.render(r.ctx, Math.round(vx), Math.round(vy));
    this.renderHud(r, game);

    // Screen-space, over everything including the UI.
    r.applyPost(this.speedNorm);
    if (this.fade > 0) {
      r.rect(0, 0, VIEW_W, VIEW_H, palette.inkRgba(this.fade, this.fadePhase), true);
    }
  }

  /** Row-merged runs: a 40-tile floor is one fillRect, not forty. */
  private renderTiles(r: Renderer, vx: number, vy: number): void {
    forEachRun(
      this.level.map,
      toTile(vx),
      toTile(vy),
      toTile(vx + VIEW_W),
      toTile(vy + VIEW_H),
      (tx, ty, len, tile) => {
        r.rect(tx * TILE, ty * TILE, len * TILE, TILE, palette.ink);
        const dir = padDirection(tile);
        if (dir) {
          for (let i = 0; i < len; i++) {
            this.renderChevron(r, (tx + i) * TILE + TILE / 2, ty * TILE + TILE / 2, dir);
          }
        }
      },
    );
  }

  /**
   * A pad is an `ink` slab like any other tile, plus two `paper` bars forming a
   * chevron pointing the way it fires. One primitive, one code path, all four
   * directions: the arms are the pad's direction rotated ±135°, so the whole
   * thing follows from `padDirection` with no per-facing branch.
   *
   * Phase 6 replaces the static bars with the animated particle stream §5 calls
   * for; the shape is the same either way.
   */
  private renderChevron(
    r: Renderer,
    cx: number,
    cy: number,
    dir: { readonly dx: number; readonly dy: number },
  ): void {
    const tipX = cx + dir.dx * (PAD_CHEVRON_LEN * 0.35);
    const tipY = cy + dir.dy * (PAD_CHEVRON_LEN * 0.35);
    const base = Math.atan2(dir.dy, dir.dx);
    for (const sweep of [(Math.PI * 3) / 4, (-Math.PI * 3) / 4]) {
      const a = base + sweep;
      r.rectRotated(
        tipX + (Math.cos(a) * PAD_CHEVRON_LEN) / 2,
        tipY + (Math.sin(a) * PAD_CHEVRON_LEN) / 2,
        PAD_CHEVRON_LEN,
        PAD_CHEVRON_WIDTH,
        a,
        palette.paper,
      );
    }
  }

  /** An `ink` outline that pulses in scale (GAME-DESIGN §2). */
  private renderGoal(r: Renderer): void {
    const { goal } = this.level;
    const size = TILE * (1 + Math.sin(this.clock * GOAL_PULSE_FREQ) * GOAL_PULSE_AMP);
    r.rectRotatedOutline(
      goal.tx * TILE + TILE / 2,
      goal.ty * TILE + TILE / 2,
      size,
      size,
      0,
      palette.ink,
      GOAL_OUTLINE_WIDTH,
    );
  }

  private renderHud(r: Renderer, game: Game): void {
    r.text(this.level.name, 16, 16, palette.ink, 2);
    r.text(formatTime(this.timeSec * 1000), 16, 44, palette.ink, 2);
    if (game.audio.muted) {
      r.text('MUTED', 16, VIEW_H - 24, palette.ink);
    }
    if (this.state !== 'won') {
      return;
    }
    // Shell placeholder, and it looks it. Phase 7's ResultsScene replaces it.
    r.textCentered('COMPLETE', VIEW_W / 2, VIEW_H / 2 - 40, palette.ink, 4);
    r.textCentered(formatTime(this.finishedMs), VIEW_W / 2, VIEW_H / 2 + 10, palette.ink, 3);
    const best = this.isNewBest ? 'NEW BEST' : `BEST ${formatTime(this.previousBestMs ?? 0)}`;
    r.textCentered(best, VIEW_W / 2, VIEW_H / 2 + 50, palette.ink, 2);
  }
}

function readInputs(input: Input): PlayerInputs {
  return {
    left: input.down('left'),
    right: input.down('right'),
    jumpHeld: input.down('jump'),
    jumpPressed: input.pressed('jump'),
    flipPressed: input.pressed('flip'),
  };
}

/** `M:SS.hh`. The bitmap font has digits, a colon and a full stop, and no more. */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const hundredths = Math.floor((total % 1000) / 10);
  return `${minutes}:${pad2(seconds)}.${pad2(hundredths)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
