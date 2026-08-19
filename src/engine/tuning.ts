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
  LEAD_ATTACK,
  LEAD_BRIGHT,
  LEAD_DARK,
  LEAD_DETUNE,
  LEAD_GATE,
  LEAD_LEVEL,
  LEAD_OCTAVE,
  LEAD_Q,
  LEAD_RELEASE,
  LEAD_SAT_DRIVE,
  LEAD_SEND,
  LEAD_VIB_DEPTH,
  LEAD_VIB_RATE,
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

// ---------------------------------------------------------------------------
// The lead synth — the second thing in the game authored by feel. Same shape
// as the wind-up record: constants.ts ships the defaults, this holds what a
// session moved them to, `engine/audio.ts` reads it per note, and the tuner
// writes it and copies the paste-back lines.
// ---------------------------------------------------------------------------

export interface LeadTuning {
  /** Riff register, octaves from the authored A3 root (-1 = A2, 1 = A4). */
  octave: number;
  /** Peak envelope level of a full-velocity note, pre-saturation. */
  level: number;
  /** Multiplier on the riff's authored gate lengths. */
  gate: number;
  /** Envelope (s): swell in, hold, release out. */
  attack: number;
  release: number;
  /** Detune of the saw pair, ± cents. */
  detune: number;
  /** Vibrato rate (Hz) and depth as a fraction of the pitch. */
  vibRate: number;
  vibDepth: number;
  /** Filter: cutoff opens near bright × pitch, eases shut to dark × pitch. */
  bright: number;
  dark: number;
  q: number;
  /** tanh drive of the lead bus saturation. */
  drive: number;
  /** How much of the lead feeds the shared delay send. */
  send: number;
}

/** The shipped values, and what `resetLead` restores. */
export const LEAD_DEFAULTS: Readonly<LeadTuning> = {
  octave: LEAD_OCTAVE,
  level: LEAD_LEVEL,
  gate: LEAD_GATE,
  attack: LEAD_ATTACK,
  release: LEAD_RELEASE,
  detune: LEAD_DETUNE,
  vibRate: LEAD_VIB_RATE,
  vibDepth: LEAD_VIB_DEPTH,
  bright: LEAD_BRIGHT,
  dark: LEAD_DARK,
  q: LEAD_Q,
  drive: LEAD_SAT_DRIVE,
  send: LEAD_SEND,
};

/** The live values. Read per scheduled note by `AudioSys`, written by the tuner. */
export const lead: LeadTuning = { ...LEAD_DEFAULTS };

/**
 * Legal ranges. The load-bearing ones: `attack` and `release` floor above zero
 * because both are ramp lengths (a zero-length exponential ramp is a click at
 * best), `q` stays under self-oscillation territory, and `drive` stays off
 * zero because the curve normalises by tanh(drive).
 */
export function clampLead(t: Readonly<LeadTuning>): LeadTuning {
  const num = (n: number, lo: number, hi: number, fallback: number): number =>
    Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
  return {
    octave: Math.round(num(t.octave, -1, 1, LEAD_DEFAULTS.octave)),
    level: num(t.level, 0, 0.5, LEAD_DEFAULTS.level),
    gate: num(t.gate, 0.25, 4, LEAD_DEFAULTS.gate),
    attack: num(t.attack, 0.001, 0.3, LEAD_DEFAULTS.attack),
    release: num(t.release, 0.02, 1, LEAD_DEFAULTS.release),
    detune: num(t.detune, 0, 30, LEAD_DEFAULTS.detune),
    vibRate: num(t.vibRate, 0, 15, LEAD_DEFAULTS.vibRate),
    vibDepth: num(t.vibDepth, 0, 0.02, LEAD_DEFAULTS.vibDepth),
    bright: num(t.bright, 1.5, 10, LEAD_DEFAULTS.bright),
    dark: num(t.dark, 1, 3, LEAD_DEFAULTS.dark),
    q: num(t.q, 0.3, 8, LEAD_DEFAULTS.q),
    drive: num(t.drive, 0.5, 8, LEAD_DEFAULTS.drive),
    send: num(t.send, 0, 1, LEAD_DEFAULTS.send),
  };
}

/** Replace the live values, clamped. */
export function setLead(t: Readonly<LeadTuning>): void {
  Object.assign(lead, clampLead(t));
}

export function resetLead(): void {
  Object.assign(lead, LEAD_DEFAULTS);
}

/** Like `fmt`, but four decimals of headroom — vibrato depth is 0.004. */
function fmt4(n: number): string {
  const s = n.toFixed(4).replace(/0+$/, '');
  return s.endsWith('.') ? `${s}0` : s;
}

/** The `constants.ts` lines the live lead values would become. Paste-ready. */
export function leadSource(t: Readonly<LeadTuning> = lead): string {
  return [
    `export const LEAD_OCTAVE = ${t.octave};`,
    `export const LEAD_LEVEL = ${fmt4(t.level)};`,
    `export const LEAD_GATE = ${fmt4(t.gate)};`,
    `export const LEAD_ATTACK = ${fmt4(t.attack)};`,
    `export const LEAD_RELEASE = ${fmt4(t.release)};`,
    `export const LEAD_DETUNE = ${fmt4(t.detune)};`,
    `export const LEAD_VIB_RATE = ${fmt4(t.vibRate)};`,
    `export const LEAD_VIB_DEPTH = ${fmt4(t.vibDepth)};`,
    `export const LEAD_BRIGHT = ${fmt4(t.bright)};`,
    `export const LEAD_DARK = ${fmt4(t.dark)};`,
    `export const LEAD_Q = ${fmt4(t.q)};`,
    `export const LEAD_SAT_DRIVE = ${fmt4(t.drive)};`,
    `export const LEAD_SEND = ${fmt4(t.send)};`,
  ].join('\n');
}
