/**
 * LIVE TUNING — the wind-up numbers, held in a mutable record instead of read
 * straight off `constants.ts`.
 *
 * Everything in this project is a constant on purpose, and this is the one
 * exception, for one reason: the wind-up (GAME-DESIGN §7) is authored by FEEL.
 * There is no derivation that says the gate should open at two seconds rather
 * than at one and a half — only a run that either escalates when it should or
 * doesn't. So the three numbers get a dev tuner (`src/devtuner.ts`), and a
 * tuner needs somewhere to write.
 *
 * The defaults still live in `constants.ts` and are still the shipped values;
 * this module only holds what a session has moved them to, and `windupSource`
 * emits the constants.ts lines to paste back once the feel is right. Node-safe
 * and dependency-free — the tuner is the browser half, and it is not this file.
 */

import {
  SPEED_WINDUP_DELAY,
  SPEED_WINDUP_DRAIN_DELAY,
  SPEED_WINDUP_DRAIN_RATE,
  SPEED_WINDUP_FILL_BIAS,
  SPEED_WINDUP_MIN,
  SPEED_WINDUP_RAMP,
} from '../constants';

export interface WindupTuning {
  /** speedNorm at or above which the bank fills rather than drains. */
  min: number;
  /** Seconds banked before any speed effect is non-zero. */
  delay: number;
  /** Seconds from the gate opening to full strength. */
  ramp: number;
  /** Fill rate at full speed, ×real time; 1× at the threshold. */
  fillBias: number;
  /** Seconds below the threshold before the bank drains at all. */
  drainDelay: number;
  /** Drain rate once that grace is spent, ×real time. */
  drainRate: number;
}

/** The shipped values, and what `reset` restores. */
export const WINDUP_DEFAULTS: Readonly<WindupTuning> = {
  min: SPEED_WINDUP_MIN,
  delay: SPEED_WINDUP_DELAY,
  ramp: SPEED_WINDUP_RAMP,
  fillBias: SPEED_WINDUP_FILL_BIAS,
  drainDelay: SPEED_WINDUP_DRAIN_DELAY,
  drainRate: SPEED_WINDUP_DRAIN_RATE,
};

/**
 * The live values. Read every frame by `PlayScene`, written only by the tuner.
 * Mutated in place rather than reassigned so importers hold one object and no
 * one has to remember to re-read it.
 */
export const windup: WindupTuning = { ...WINDUP_DEFAULTS };

/**
 * Legal ranges, enforced on the way in so a slider cannot produce a state the
 * gate can't evaluate. `ramp` is the load-bearing one: it is a divisor, and a
 * ramp of exactly 0 would make the gate NaN at the delay and hand an invalid
 * alpha to the canvas, where it voids the whole draw.
 */
export function clampWindup(t: Readonly<WindupTuning>): WindupTuning {
  const num = (n: number, lo: number, hi: number, fallback: number): number =>
    Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  return {
    min: num(t.min, 0, 1, WINDUP_DEFAULTS.min),
    delay: num(t.delay, 0, 20, WINDUP_DEFAULTS.delay),
    ramp: num(t.ramp, 0.05, 20, WINDUP_DEFAULTS.ramp),
    // Floors at 0, never below: a negative bias would run the bank BACKWARDS
    // while you are fast, which is not a feel, it is a bug with a slider.
    fillBias: num(t.fillBias, 0, 8, WINDUP_DEFAULTS.fillBias),
    drainDelay: num(t.drainDelay, 0, 20, WINDUP_DEFAULTS.drainDelay),
    drainRate: num(t.drainRate, 0, 8, WINDUP_DEFAULTS.drainRate),
  };
}

/** Replace the live values, clamped. */
export function setWindup(t: Readonly<WindupTuning>): void {
  Object.assign(windup, clampWindup(t));
}

export function resetWindup(): void {
  Object.assign(windup, WINDUP_DEFAULTS);
}

/** Two decimals, but never a bare integer — these are seconds and ratios. */
function fmt(n: number): string {
  const s = n.toFixed(2).replace(/0$/, '');
  return s.endsWith('.') ? `${s}0` : s;
}

/**
 * The `constants.ts` lines these values would become — the whole point of the
 * tuner. Paste-ready, in the file's own order, so making a session permanent is
 * a copy and a replace rather than three careful edits.
 */
export function windupSource(t: Readonly<WindupTuning> = windup): string {
  return [
    `export const SPEED_WINDUP_MIN = ${fmt(t.min)};`,
    `export const SPEED_WINDUP_DELAY = ${fmt(t.delay)};`,
    `export const SPEED_WINDUP_RAMP = ${fmt(t.ramp)};`,
    `export const SPEED_WINDUP_FILL_BIAS = ${fmt(t.fillBias)};`,
    `export const SPEED_WINDUP_DRAIN_DELAY = ${fmt(t.drainDelay)};`,
    `export const SPEED_WINDUP_DRAIN_RATE = ${fmt(t.drainRate)};`,
  ].join('\n');
}
