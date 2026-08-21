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
  FINALE_END_DURATION,
  FINALE_GOAL_DWELL,
  FINALE_GOAL_TILES,
  GOAL_HOLD,
  GOAL_PULSE_AMP,
  GOAL_PULSE_FREQ,
  PAD_STREAM_INTERVAL,
  PARTICLE_CULL_MARGIN,
  PICKUP_RADIUS,
  PICKUP_RESPAWN,
  PICKUP_SIZE,
  PAUSE_DIM,
  SPEED_REF,
  SPEED_SMOOTH_RATE,
  TILE,
  VIEW_H,
  VIEW_W,
} from '../constants';
import type { Input } from '../engine/input';
import { INVERT_MASK, palette } from '../engine/palette';
import type { Phase } from '../engine/palette';
import { ParticleSystem, spawnRing, spawnStream } from '../engine/particles';
import { perf } from '../engine/perf';
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
import { drawSigns, signsFor } from './signs';
import type { Sign } from './signs';
import { ResultsScene } from './results';
import type { ResultsStats } from './results';
import { CreditsScene } from './credits';
import { drawFinaleBloom, drawFinaleGoal, drawFinaleVeil, FINALE_LEVEL_ID } from './finale';
import { drawGoal, drawOutOfBounds, drawPickup, drawTileRuns } from './tiledraw';
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
  | { readonly kind: 'playtest'; readonly back: Scene }
  /**
   * A level off the CUSTOM LEVELS shelf — imported, or drawn here and saved as
   * a draft. It sits between the other two on every one of those three
   * questions: a win goes to the results screen (it is a real run, and a time
   * is the point of playing it), a best time IS written (the id cannot collide
   * with a shipped level — the shelf refuses a built-in id — so `bw.best.<id>`
   * is its own), and `bw.progress` is NOT touched, because a custom level is
   * not a rung on the campaign ladder and finishing one must never unlock it.
   */
  | { readonly kind: 'custom'; readonly back: Scene };

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
  /** This level's in-world captions; empty for every level but the tutorial. */
  private readonly signs: readonly Sign[];
  /**
   * Whether this is the last level, which is the only level that ends in
   * colour. Read once at construction rather than compared per frame in three
   * different places — the id is the key to the whole special case (the nine
   * tile trigger, the hold, the spiral, the ending), and one field is what
   * keeps those four from drifting apart.
   */
  private readonly isFinale: boolean;
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
  /**
   * Seconds until each pickup returns, indexed against `level.pickups`. 0 is
   * "ready", and that is the whole state — a parallel array rather than objects
   * because the list is fixed at parse time and a number per entry is all a
   * respawn timer is.
   */
  private readonly pickupTimers: number[] = [];
  /**
   * Seconds the player's centre has been inside the goal region, without
   * leaving it. Fixed steps only, so it is as deterministic as the trajectory
   * that feeds it. Every level but the finale wins at 0 and never reads it.
   */
  private goalHold = 0;
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
    this.signs = signsFor(level.id);
    this.isFinale = level.id === FINALE_LEVEL_ID;
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
    pickupsReady: number;
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
      pickupsReady: this.pickupTimers.reduce((n, t) => (t <= 0 ? n + 1 : n), 0),
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
    // Every pickup back, like everything else here: a reset that forgets one
    // field is how the second attempt comes to play differently from the first.
    this.pickupTimers.length = this.level.pickups.length;
    this.pickupTimers.fill(0);
    this.particles.clear();
    this.speedNorm = 0;
    this.windupState.bank = 0;
    this.windupState.idle = 0;
    this.timeSec = 0;
    this.state = 'running';
    this.stateT = 0;
    this.goalHold = 0;
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
        // Frozen: hold the earned frame, then fade out and hand it over. The
        // finale hands over on its own clock and never touches `fade` — its
        // ending is the colour taking the screen, and an `ink` wash over the top
        // of that would be the game's two colours having the last word after
        // the whole point was that they no longer do.
        this.stateT += dt;
        if (this.isFinale) {
          if (this.stateT >= FINALE_END_DURATION) {
            this.finish(game);
            return;
          }
          break;
        }
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
    this.updatePickups(dt, game);
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

  /** Where `QUIT` goes, which is most of the difference between the contexts. */
  private leave(game: Game): void {
    game.setScene(this.ctx.kind === 'campaign' ? new TitleScene() : this.ctx.back);
  }

  /**
   * The run is over. A campaign or custom run has a results screen to show; a
   * playtest goes straight back to the editor **instance** it came from, edits
   * intact — GAME-DESIGN §10's requirement stated as an object identity.
   *
   * The finale takes one detour on the way: the credits, which come up on the
   * swirl the ending settled on and hand the same stats along when they are
   * done. Keyed by `isFinale`, which is the level id — the same key the ending
   * itself is on, so the two can never disagree about which level ends the
   * game. A playtest is out before this, because the credits of a game are not
   * part of the level you are editing.
   */
  private finish(game: Game): void {
    if (this.ctx.kind === 'playtest') {
      game.setScene(this.ctx.back);
      return;
    }
    const stats: ResultsStats = {
      level: this.level,
      // Null is what "there is no next level and no ladder" looks like, and it
      // is what the results screen branches on rather than on a scene type.
      index: this.ctx.kind === 'campaign' ? this.ctx.index : null,
      back: this.ctx.kind === 'campaign' ? null : this.ctx.back,
      timeMs: this.finishedMs,
      previousBestMs: this.previousBestMs,
      isNewBest: this.isNewBest,
    };
    if (this.isFinale) {
      // `clock`, so the sweep does not restart: it is the one value the two
      // scenes share, and handing it over is what makes the change invisible.
      game.setScene(new CreditsScene(stats, this.clock));
      return;
    }
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

  /**
   * Collect what the body is standing in, and count the collected ones back.
   *
   * **No collision, by construction**: this is a radius test run after the step,
   * and nothing here touches the body. A pickup that pushed, stopped or slowed
   * the player would be a pad with a different sprite — the whole point is that
   * a line through one costs nothing but the line.
   *
   * A pickup is spent only when it actually gives something back, so running
   * through one with the flip already charged leaves it standing for the way
   * back. `recharge` reports that, which is why it returns a boolean.
   */
  private updatePickups(dt: number, game: Game): void {
    const pickups = this.level.pickups;
    const b = this.player.body;
    for (let i = 0; i < pickups.length; i++) {
      if (this.pickupTimers[i] > 0) {
        this.pickupTimers[i] = Math.max(0, this.pickupTimers[i] - dt);
        continue;
      }
      // The body keeps simulating through `dying` — it flies out of shot, which
      // reads as a consequence rather than a pause — so a corpse can cross a
      // pickup and must not collect it. `won` is frozen and never reaches here
      // through `stepPlay`, but it is excluded by the same test rather than by
      // trusting that to stay true.
      if (this.state !== 'running' && this.state !== 'respawning') {
        continue;
      }
      const dx = pickups[i].tx * TILE + TILE / 2 - b.x;
      const dy = pickups[i].ty * TILE + TILE / 2 - b.y;
      // Squared, not `Math.hypot`: the answer is exact rather than
      // implementation-approximated, and a level whose author flooded a region
      // with `o` is thousands of these per step.
      if (dx * dx + dy * dy > PICKUP_RADIUS * PICKUP_RADIUS) {
        continue;
      }
      if (!this.player.recharge()) {
        continue;
      }
      this.pickupTimers[i] = PICKUP_RESPAWN;
      game.audio.play('pickup');
      // The flip's own ring, at the pickup rather than at the body: what just
      // happened is that the flip came back, and that is what the ring means.
      spawnRing(this.particles, b.x + dx, b.y + dy);
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
    // Charged BEFORE the win check and reset the moment the player leaves, so
    // the hold is a hold and not a total: crossing the spiral three times must
    // not add up to standing in it.
    const inside = this.atGoal();
    this.goalHold = inside ? this.goalHold + dt : 0;
    if (ev.died) {
      this.die(game);
    } else if (inside && this.goalHold >= this.goalDwell()) {
      this.win(game);
    }
  }

  /**
   * The goal fires on the body's CENTRE being inside the goal region. Rotation
   * independent, one condition, and it means the goal reads as "get *in* the
   * square" rather than "graze it with a corner".
   *
   * The region is one tile everywhere except the finale, where it is the whole
   * `FINALE_GOAL_TILES` square the spiral is drawn on — the outline that used
   * to say where to stand is painted over, so what the player can see IS the
   * trigger. Odd sizes only: the region is centred on the goal tile, which only
   * lands on the grid if there are as many tiles left of it as right.
   */
  private atGoal(): boolean {
    const { goal } = this.level;
    const b = this.player.body;
    const span = this.isFinale ? FINALE_GOAL_TILES : 1;
    const gx = (goal.tx - (span - 1) / 2) * TILE;
    const gy = (goal.ty - (span - 1) / 2) * TILE;
    return b.x >= gx && b.x < gx + span * TILE && b.y >= gy && b.y < gy + span * TILE;
  }

  /**
   * How long `atGoal` must hold before the level ends. Zero everywhere but the
   * finale, which is the pre-existing behaviour stated as a number: the win
   * lands on the frame the centre crosses in.
   */
  /**
   * The goal's centre in SCREEN space. The camera rounds its origin to whole
   * pixels and the ending is drawn in view space, so this has to round the same
   * way — an unrounded subtraction leaves the bloom a sub-pixel off the goal it
   * is supposed to be growing out of, which is a visible slip on frame one.
   */
  private goalOnScreen(vx: number, vy: number): [number, number] {
    const { goal } = this.level;
    return [
      goal.tx * TILE + TILE / 2 - Math.round(vx),
      goal.ty * TILE + TILE / 2 - Math.round(vy),
    ];
  }

  /** The ending's progress, 0 to 1. Only meaningful while `won` on the finale. */
  private finaleProgress(): number {
    return this.stateT / FINALE_END_DURATION;
  }

  private goalDwell(): number {
    return this.isFinale ? FINALE_GOAL_DWELL : 0;
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
    // A playtest writes NOTHING: the grid it ran on exists only in an editor,
    // and a draft carrying a shipped level's id would otherwise overwrite that
    // level's best time with a run on a map nobody else has.
    if (this.ctx.kind !== 'playtest') {
      const key = SAVE_KEYS.best(this.level.id);
      const previous = game.save.getBest(key);
      this.previousBestMs = previous?.timeMs ?? null;
      // The wall-clock read here is on a PERSISTENCE path, not a logic path —
      // the simulation never sees it, so hard rule 5 is intact.
      this.isNewBest = game.save.submit(key, {
        timeMs: this.finishedMs,
        dateIso: new Date().toISOString(),
      }).isNewBest;
    }
    if (this.ctx.kind === 'campaign') {
      // Monotone, so replaying an early level cannot re-lock the later ones.
      // Campaign only: a custom level is not a rung on this ladder.
      game.save.setProgress(this.ctx.index + 1);
    }
    game.audio.play('goal');
  }

  render(r: Renderer, game: Game): void {
    // Levels the performance monitor watches for. Both are no-ops unless
    // `?perf=1` turned it on, and both are things the frame cost depends on
    // that a frame time alone cannot explain: how much of the post pass is
    // running, and how much of the pool is alive.
    perf.gauge('particles', this.particles.aliveCount);
    perf.gauge('speed', this.speedNorm);
    const vx = this.camera.viewX;
    const vy = this.camera.viewY;
    r.setCamera(vx, vy);
    r.clear(palette.paper);
    if (this.isFinale && this.state === 'won') {
      // UNDER the level, on purpose: the last thing the player sees of the game
      // is their own square and the ground they are standing on, in silhouette
      // against the colour coming up behind them. `drawFinaleVeil`, at the far
      // end of this method, is the half that goes over the top.
      drawFinaleBloom(r, ...this.goalOnScreen(vx, vy), this.clock, this.finaleProgress());
    }
    drawOutOfBounds(r, this.level.map, vx, vy);
    drawTileRuns(r, this.level.map, vx, vy);
    // Under everything that moves: a sign is painted on the level, and the
    // player passing over its text is the reading order that implies.
    drawSigns(r, this.signs);
    this.renderPickups(r);
    this.renderGoal(r);
    this.player.render(r);
    this.particles.render(r.ctx, Math.round(vx), Math.round(vy));
    this.renderHud(r, game);

    // Screen-space, over everything including the UI.
    r.applyPost(this.speedNorm);
    if (this.isFinale && this.state === 'won') {
      // The veil goes over the post pass, because it is not part of the frame
      // the aberration is describing — it is what replaces that frame.
      drawFinaleVeil(r, this.clock, this.finaleProgress());
    }
    if (this.fade > 0) {
      r.rect(0, 0, VIEW_W, VIEW_H, palette.inkRgba(this.fade, this.fadePhase), true);
    }
    if (this.paused) {
      this.renderPause(r);
    }
  }

  /**
   * The pickups, ready or spent. Under the player and over the tiles, because a
   * pickup is a thing in the level rather than a thing on the HUD.
   */
  private renderPickups(r: Renderer): void {
    const pickups = this.level.pickups;
    // Culled against the view like the pad streams, and for the same reason:
    // `o` is not a marker, so `flood` accepts it, and one fill click is a
    // thousand pickups. Every other draw in this scene clips — the tiles by
    // run-merging the visible span — and an uncounted loop here would be the
    // one that does not.
    const x0 = this.camera.viewX - TILE;
    const y0 = this.camera.viewY - TILE;
    const x1 = x0 + VIEW_W + 2 * TILE;
    const y1 = y0 + VIEW_H + 2 * TILE;
    for (let i = 0; i < pickups.length; i++) {
      const cx = pickups[i].tx * TILE + TILE / 2;
      const cy = pickups[i].ty * TILE + TILE / 2;
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) {
        continue;
      }
      drawPickup(r, cx, cy, PICKUP_SIZE, this.pickupTimers[i] <= 0);
    }
  }

  /**
   * An `ink` outline that pulses in scale (GAME-DESIGN §2) — except on the last
   * level, where it is the colour ending: the same outline inside a three-tile
   * swirl of spectrum (`drawFinaleGoal`). Keyed by level id like `signs.ts`,
   * and presentation only — `checkGoal` still fires on the one centre tile, so
   * the finale plays exactly as it did with the outline alone.
   */
  private renderGoal(r: Renderer): void {
    const { goal } = this.level;
    const cx = goal.tx * TILE + TILE / 2;
    const cy = goal.ty * TILE + TILE / 2;
    if (this.isFinale) {
      // Once the ending starts, the bloom IS this draw — it opens at exactly
      // this size, position and hue and grows from there, so drawing both would
      // leave the original sitting on top of its own expansion, sharp, in the
      // one layer the ending is supposed to be behind. Handing over on the
      // frame the win lands is seamless because the two agree at p = 0, which
      // `tests/finalegoal.test.ts` asserts draw for draw.
      if (this.state !== 'won') {
        drawFinaleGoal(r, cx, cy, this.clock);
      }
      return;
    }
    const size = TILE * (1 + Math.sin(this.clock * GOAL_PULSE_FREQ) * GOAL_PULSE_AMP);
    drawGoal(r, cx, cy, size);
  }

  private renderHud(r: Renderer, game: Game): void {
    // Like particles, the run HUD is defined by the frame beneath it rather
    // than by the current palette phase. A white operand under `difference`
    // makes each glyph invert whatever level geometry it crosses.
    r.ctx.globalCompositeOperation = 'difference';
    r.text(this.level.name, 16, 16, INVERT_MASK, 2);
    r.text(formatTime(this.timeSec * 1000), 16, 44, INVERT_MASK, 2);
    r.ctx.globalCompositeOperation = 'source-over';
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
