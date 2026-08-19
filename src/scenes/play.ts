/**
 * The gameplay scene: one level, one body, and the lifecycle around them —
 * spawn, run, die, respawn, pause, finish.
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
 */

import {
  DEATH_FADE_IN,
  DEATH_FADE_OUT,
  GOAL_HOLD,
  GOAL_PULSE_AMP,
  GOAL_PULSE_FREQ,
  PAD_STREAM_INTERVAL,
  PARTICLE_CULL_MARGIN,
  PAUSE_DIM,
  SPEED_REF,
  SPEED_SMOOTH_RATE,
  TILE,
  VIEW_H,
  VIEW_W,
} from '../constants';
import type { Input } from '../engine/input';
import { palette } from '../engine/palette';
import type { Phase } from '../engine/palette';
import { ParticleSystem, spawnStream } from '../engine/particles';
import type { Renderer } from '../engine/renderer';
import { Rng } from '../engine/rng';
import { SAVE_KEYS } from '../engine/save';
import { windup } from '../engine/tuning';
import type { EntityWorld } from '../entities/context';
import { NO_INPUTS, Player } from '../entities/player';
import type { PlayerInputs } from '../entities/player';
import type { Game, Scene } from '../game';
import { Camera } from '../world/camera';
import type { Level } from '../world/level';
import { padDirection } from '../world/tiles';
import { updateMenu } from './menu';
import { ResultsScene } from './results';
import type { ResultsStats } from './results';
import { drawGoal, drawTileRuns } from './tiledraw';
import { TitleScene } from './title';

/**
 * `Running → Dying → Respawning → Running`, plus the terminal `Won`. The body
 * keeps simulating through `Dying` — it flies out of shot, which reads as a
 * consequence rather than a pause — and plays normally through `Respawning`,
 * where the fade is purely cosmetic.
 */
type PlayState = 'running' | 'dying' | 'respawning' | 'won';

/**
 * Why this attempt is being played, and it decides three things at once
 * (PHASES phase 7, decision 5): where a win goes, whether `bw.progress`
 * advances, and **whether a best time is written at all**.
 *
 * Phase 5 left `index` defaulting to 0, so a level that is not in `LEVELS` —
 * exactly what the editor's playtest hands over — advanced into `LEVELS[1]` on
 * completion. The honest fix is not a better default; it is to stop defaulting.
 * And the bug under that bug is the save: a draft carrying the id of a shipped
 * level would otherwise overwrite `bw.best.01-first-steps` with a time set on a
 * grid that exists only in someone's browser. **A playtest writes nothing.**
 */
export type PlayContext =
  | { readonly kind: 'campaign'; readonly index: number }
  | { readonly kind: 'playtest'; readonly back: Scene };

/** The pause overlay, in order. `Esc` opens it; the sim is frozen behind it. */
const PAUSE_ITEMS: readonly string[] = ['RESUME', 'RESTART', 'QUIT'];

/**
 * The wind-up gate: how much of the speed effect stack `bankedSec` has earned.
 *
 * Flat zero for the delay, then a linear climb to 1 over the ramp. Speed on its
 * own is cheap in this game — every pad chain buys a second of it — so a gate
 * on the *duration* of speed is what separates a fast moment from a fast run,
 * and only the run is worth escalating for.
 *
 * Reads `windup`, not the constants: these numbers are authored by feel through
 * the dev tuner (`src/devtuner.ts`), and the tuner has to be able to move them
 * mid-run. The record's defaults ARE the constants, so nothing about the
 * shipped game changes. Pure in the sense that matters — same tuning and same
 * argument, same answer — and exported so the ramp is testable.
 */
export function windupGate(bankedSec: number): number {
  const t = (bankedSec - windup.delay) / windup.ramp;
  return t > 0 ? (t < 1 ? t : 1) : 0;
}

/**
 * How fast the bank fills at this speed, as a multiple of real time.
 *
 * 1× exactly at the threshold, `fillBias` at full speed, linear between — and
 * flat 0 below the threshold, which is what makes this the *only* thing the
 * caller has to ask about filling. Measuring the lerp from `min` rather than
 * from zero is the point: the interesting range is the part of the speedometer
 * that banks at all, so moving the threshold reshapes the curve with it instead
 * of leaving a bias calibrated against a speed that no longer counts.
 */
export function windupFillRate(raw: number): number {
  if (raw < windup.min) {
    return 0;
  }
  const span = 1 - windup.min;
  // A threshold at 1.0 leaves no range to lerp across; only the top speed
  // banks, and it banks at the bias.
  const u = span > 0 ? Math.min(1, (raw - windup.min) / span) : 1;
  return 1 + (windup.fillBias - 1) * u;
}

/** The wind-up's whole state: seconds banked, and seconds spent slow. */
export interface WindupState {
  /** Seconds of credit, which `windupGate` spends. */
  bank: number;
  /** Consecutive seconds below the threshold. Resets the moment you are fast. */
  idle: number;
}

/**
 * Advance the bank by one step. Mutates, like the solver's manifolds — this
 * runs every frame and returning a fresh pair would allocate for nothing.
 *
 * The asymmetry between the two halves is deliberate and is the tuning surface:
 * filling is scaled by how far over the threshold you are, while draining first
 * has to outlast `drainDelay`. That grace is what buys a landing, a wall bump
 * or a moment of air for free — the events that punctuate a run without ending
 * it — where a symmetric bank charges for every one of them.
 */
export function stepWindup(w: WindupState, raw: number, dt: number): void {
  const ceiling = windup.delay + windup.ramp;
  if (raw >= windup.min) {
    w.idle = 0;
    w.bank = Math.min(ceiling, w.bank + windupFillRate(raw) * dt);
    return;
  }
  w.idle += dt;
  // The grace is spent from THIS step's dt, so crossing the boundary mid-step
  // drains the remainder rather than a whole step: the bank must not depend on
  // where the fixed steps happen to land relative to the delay.
  const draining = Math.min(dt, w.idle - windup.drainDelay);
  if (draining > 0) {
    w.bank = Math.max(0, w.bank - windup.drainRate * draining);
  }
}

export class PlayScene implements Scene {
  private readonly level: Level;
  private readonly ctx: PlayContext;
  private readonly player = new Player(0, 0);
  private readonly camera = new Camera();
  private readonly particles = new ParticleSystem();
  private readonly rng = new Rng(0xfeed);

  /** The one number every effect reads (GAME-DESIGN §7). */
  private speedNorm = 0;
  /**
   * The wind-up bank, and how long it has been slow. Kept apart from
   * `speedNorm` because it must NOT be smoothed: the smoother is an anti-strobe
   * filter on the current frame, and this is a memory of the whole run.
   */
  private readonly windupState: WindupState = { bank: 0, idle: 0 };
  private state: PlayState = 'running';
  /** Seconds inside the current state. */
  private stateT = 0;
  /** Accumulated fixed steps in `running` only — never a wall-clock read. */
  private timeSec = 0;
  /** Presentation clock, for the goal's pulse. */
  private clock = 0;
  /**
   * ONE accumulator drives every visible pad on the same tick — not one per
   * pad. It is a single number instead of an array, it is deterministic, and
   * pads pulsing in unison reads as intentional rather than as a race.
   */
  private streamT = 0;
  /** 0 = clear, 1 = fully covered by `ink`. */
  private fade = 0;
  /** The phase the fade colour was sampled in, held across the palette reset. */
  private fadePhase: Phase = 0;
  private finishedMs = 0;
  private previousBestMs: number | null = null;
  private isNewBest = false;
  private paused = false;
  private pauseIndex = 0;

  constructor(level: Level, ctx: PlayContext) {
    this.level = level;
    this.ctx = ctx;
  }

  /**
   * The bed is SCENE-SCOPED, which is what `Scene.exit` has existed for since
   * phase 2 without a user. The title screen stays silent but for its menu
   * blips: a techno bed under a motionless title screen spends the escalation
   * before the player has done anything to earn it.
   */
  enter(game: Game): void {
    this.reset();
    game.audio.startMusic();
  }

  exit(game: Game): void {
    game.audio.stopMusic();
  }

  /**
   * Where the attempt has got to. Read by the headless playthrough test, which
   * has to be able to say *how far* it got and why it stopped — a bare
   * `expect(won).toBe(true)` on a forty-second simulation is close to
   * undebuggable. Not on a hot path; nothing in `render` uses it.
   */
  get status(): {
    state: PlayState;
    paused: boolean;
    timeSec: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    gravitySign: 1 | -1;
    flipCharged: boolean;
    speedNorm: number;
    windupSec: number;
    windupIdleSec: number;
    particles: number;
  } {
    const b = this.player.body;
    return {
      state: this.state,
      paused: this.paused,
      timeSec: this.timeSec,
      x: b.x,
      y: b.y,
      vx: b.vx,
      vy: b.vy,
      gravitySign: this.player.gravitySign,
      flipCharged: this.player.flipCharged,
      speedNorm: this.speedNorm,
      windupSec: this.windupState.bank,
      windupIdleSec: this.windupState.idle,
      particles: this.particles.aliveCount,
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
    this.windupState.bank = 0;
    this.windupState.idle = 0;
    this.timeSec = 0;
    this.state = 'running';
    this.stateT = 0;
    this.fade = 0;
    this.streamT = 0;
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
    const input = game.input;
    if (input.pressed('mute')) {
      game.toggleMute();
    }
    // `pause` and NOTHING ELSE (PHASES phase 7, decision 8). `back` and `pause`
    // are bound to the same two keys, so a scene reading both would fire twice
    // on one keypress — and the old `back` reader quit mid-run, silently
    // discarding the attempt.
    if (input.pressed('pause')) {
      this.setPaused(!this.paused, game);
    }
    if (this.paused) {
      this.updatePauseMenu(game);
      // A FREEZE, not a step with dt = 0: nothing below this line runs, so no
      // exponential smoother takes a step and the resumed trajectory is
      // bit-identical to the uninterrupted one. The bed is fed 0 through the
      // same duck as `dying` and `won`.
      game.audio.setIntensity(0);
      return;
    }

    this.clock += dt;
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
        // Frozen: hold the earned frame, then fade out and hand it over.
        this.stateT += dt;
        this.fade = Math.min(1, Math.max(0, (this.stateT - GOAL_HOLD) / DEATH_FADE_OUT));
        if (this.stateT >= GOAL_HOLD + DEATH_FADE_OUT) {
          this.finish(game);
          return;
        }
        break;
    }

    // Exponential lag, so a single frame of wall contact can't strobe the whole
    // screen from a full vignette down to nothing and back.
    const b = this.player.body;
    const raw = Math.min(1, Math.hypot(b.vx, b.vy) / SPEED_REF);
    // The bank fills while genuinely moving, at a rate scaled by how fast, and
    // drains once a stretch of slow has outlasted its grace. Clamped at both
    // ends inside `stepWindup`, so a long run can't bank an hour of credit that
    // survives a stop.
    stepWindup(this.windupState, raw, dt);
    const target = raw * windupGate(this.windupState.bank);
    this.speedNorm += (target - this.speedNorm) * Math.min(1, SPEED_SMOOTH_RATE * dt);

    this.camera.update(this.player.centerX, this.player.centerY, b.vx, this.speedNorm, dt);
    this.clampCamera();
    this.padStreams(dt);
    this.particles.update(dt);

    // The third and last consumer of the one number (GAME-DESIGN §7), and the
    // scheduler's pump in the same call. Death and the goal are punctuated by
    // the bed DROPPING OUT — and they have to be fed 0 rather than `speedNorm`,
    // because the body keeps simulating through the death fade, so the
    // un-ducked version would swell the music as the corpse accelerates out of
    // shot.
    const ducked = this.state === 'dying' || this.state === 'won';
    game.audio.setIntensity(ducked ? 0 : this.speedNorm);
  }

  private setPaused(v: boolean, game: Game): void {
    if (this.paused === v) {
      return;
    }
    this.paused = v;
    this.pauseIndex = 0;
    game.audio.play('menuPick');
  }

  private updatePauseMenu(game: Game): void {
    const step = updateMenu(game, this.pauseIndex, PAUSE_ITEMS.length);
    this.pauseIndex = step.index;
    if (!step.picked) {
      return;
    }
    switch (PAUSE_ITEMS[this.pauseIndex]) {
      case 'RESUME':
        this.paused = false;
        break;
      case 'RESTART':
        this.reset();
        this.paused = false;
        break;
      default:
        this.leave(game);
        break;
    }
  }

  /** Where `QUIT` goes, which is the whole difference between the two contexts. */
  private leave(game: Game): void {
    game.setScene(this.ctx.kind === 'playtest' ? this.ctx.back : new TitleScene());
  }

  /**
   * The run is over. A campaign run has a results screen to show; a playtest
   * goes straight back to the editor **instance** it came from, edits intact —
   * which is GAME-DESIGN §10's requirement stated as an object identity.
   */
  private finish(game: Game): void {
    if (this.ctx.kind === 'playtest') {
      game.setScene(this.ctx.back);
      return;
    }
    const stats: ResultsStats = {
      levelId: this.level.id,
      levelName: this.level.name,
      index: this.ctx.index,
      timeMs: this.finishedMs,
      previousBestMs: this.previousBestMs,
      isNewBest: this.isNewBest,
    };
    game.setScene(new ResultsScene(stats));
  }

  /**
   * The pads' idle animation: one spark per visible pad every interval, drifting
   * the way the pad fires. Culled against the view, so a level full of pads
   * costs nothing off-screen — and `level.pads` exists precisely so this does
   * not rescan the grid every frame.
   */
  private padStreams(dt: number): void {
    this.streamT += dt;
    if (this.streamT < PAD_STREAM_INTERVAL) {
      return;
    }
    this.streamT -= PAD_STREAM_INTERVAL;
    const x0 = this.camera.viewX - PARTICLE_CULL_MARGIN;
    const y0 = this.camera.viewY - PARTICLE_CULL_MARGIN;
    const x1 = x0 + VIEW_W + 2 * PARTICLE_CULL_MARGIN;
    const y1 = y0 + VIEW_H + 2 * PARTICLE_CULL_MARGIN;
    for (const pad of this.level.pads) {
      const cx = pad.tx * TILE + TILE / 2;
      const cy = pad.ty * TILE + TILE / 2;
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) {
        continue;
      }
      const dir = padDirection(pad.tile);
      if (dir) {
        spawnStream(this.particles, cx, cy, dir.dx, dir.dy, this.rng);
      }
    }
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
    if (this.ctx.kind === 'campaign') {
      const key = SAVE_KEYS.best(this.level.id);
      const previous = game.save.getBest(key);
      this.previousBestMs = previous?.timeMs ?? null;
      // The wall-clock read here is on a PERSISTENCE path, not a logic path —
      // the simulation never sees it, so hard rule 5 is intact.
      this.isNewBest = game.save.submit(key, {
        timeMs: this.finishedMs,
        dateIso: new Date().toISOString(),
      }).isNewBest;
      // Monotone, so replaying an early level cannot re-lock the later ones.
      game.save.setProgress(this.ctx.index + 1);
    }
    game.audio.play('goal');
  }

  render(r: Renderer, game: Game): void {
    const vx = this.camera.viewX;
    const vy = this.camera.viewY;
    r.setCamera(vx, vy);
    r.clear(palette.paper);
    drawTileRuns(r, this.level.map, vx, vy);
    this.renderGoal(r);
    this.player.render(r);
    this.particles.render(r.ctx, Math.round(vx), Math.round(vy));
    this.renderHud(r, game);

    // Screen-space, over everything including the UI.
    r.applyPost(this.speedNorm);
    if (this.fade > 0) {
      r.rect(0, 0, VIEW_W, VIEW_H, palette.inkRgba(this.fade, this.fadePhase), true);
    }
    if (this.paused) {
      this.renderPause(r);
    }
  }

  /** An `ink` outline that pulses in scale (GAME-DESIGN §2). */
  private renderGoal(r: Renderer): void {
    const { goal } = this.level;
    const size = TILE * (1 + Math.sin(this.clock * GOAL_PULSE_FREQ) * GOAL_PULSE_AMP);
    drawGoal(r, goal.tx * TILE + TILE / 2, goal.ty * TILE + TILE / 2, size);
  }

  private renderHud(r: Renderer, game: Game): void {
    r.text(this.level.name, 16, 16, palette.ink, 2);
    r.text(formatTime(this.timeSec * 1000), 16, 44, palette.ink, 2);
    if (game.audio.muted) {
      r.text('MUTED', 16, VIEW_H - 24, palette.ink);
    }
  }

  /**
   * Drawn AFTER the post pass, so the menu is crisp rather than wearing the
   * chromatic aberration of whatever speed the frozen frame was carrying.
   *
   * The veil is **`paper`**, not `ink` — it is the background flooding back in
   * over the frame, and the menu then reads in `ink` like text on every other
   * screen in the game. `ink` here would be exactly backwards: in phase A ink is
   * near-white, so the "dim" would wash a black frame to grey and leave the
   * white geometry indistinguishable from it. That is the opposite of the
   * DEATH fade, which is `ink` on purpose — fading toward the background is what
   * the vignette already does, so a death dimmed that way would read as a speed
   * effect rather than as dying.
   */
  private renderPause(r: Renderer): void {
    r.rect(0, 0, VIEW_W, VIEW_H, palette.paperRgba(PAUSE_DIM), true);
    r.textCentered('PAUSED', VIEW_W / 2, 150, palette.ink, 4);
    for (let i = 0; i < PAUSE_ITEMS.length; i++) {
      const y = 260 + i * 44;
      const label = i === this.pauseIndex ? `> ${PAUSE_ITEMS[i]} <` : PAUSE_ITEMS[i];
      r.textCentered(label, VIEW_W / 2, y, palette.ink, 3);
    }
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
