/**
 * The live wind-up record, and the bank it drives. The tuner itself is DOM and
 * untested; everything that could actually break the game if it were wrong —
 * the clamps, the fill/drain integration, and the constants.ts text a session
 * hands back — is in here, node-safe.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  SPEED_WINDUP_DELAY,
  SPEED_WINDUP_DRAIN_DELAY,
  SPEED_WINDUP_DRAIN_RATE,
  SPEED_WINDUP_FILL_BIAS,
  SPEED_WINDUP_MIN,
  SPEED_WINDUP_RAMP,
} from '../src/constants';
import {
  WINDUP_DEFAULTS,
  clampWindup,
  resetWindup,
  setWindup,
  windup,
  windupSource,
} from '../src/engine/tuning';
import { stepWindup, windupFillRate, windupGate } from '../src/scenes/play';
import type { WindupState } from '../src/scenes/play';

const STEP_DT = 1 / 60;

/** Hold `raw` for `sec` seconds of fixed steps and report where the bank got to. */
function hold(w: WindupState, raw: number, sec: number): WindupState {
  for (let i = 0; i < Math.round(sec / STEP_DT); i++) {
    stepWindup(w, raw, STEP_DT);
  }
  return w;
}

const fresh = (): WindupState => ({ bank: 0, idle: 0 });

afterEach(() => {
  // The record is a singleton the scene reads every frame, so a test that left
  // it moved would quietly retune every test that ran after it.
  resetWindup();
});

describe('the live wind-up record', () => {
  it('ships as the constants, so an untouched build is unchanged', () => {
    expect(WINDUP_DEFAULTS.min).toBe(SPEED_WINDUP_MIN);
    expect(WINDUP_DEFAULTS.delay).toBe(SPEED_WINDUP_DELAY);
    expect(WINDUP_DEFAULTS.ramp).toBe(SPEED_WINDUP_RAMP);
    expect(WINDUP_DEFAULTS.fillBias).toBe(SPEED_WINDUP_FILL_BIAS);
    expect(WINDUP_DEFAULTS.drainDelay).toBe(SPEED_WINDUP_DRAIN_DELAY);
    expect(WINDUP_DEFAULTS.drainRate).toBe(SPEED_WINDUP_DRAIN_RATE);
    expect({ ...windup }).toEqual({ ...WINDUP_DEFAULTS });
  });

  it('drives the gate the scene reads, live', () => {
    expect(windupGate(1)).toBe(0);
    setWindup({ ...windup, delay: 0.5, ramp: 1 });
    expect(windupGate(1)).toBeCloseTo(0.5, 10);
    resetWindup();
    expect(windupGate(1)).toBe(0);
  });

  it('NEVER LETS THE RAMP REACH ZERO, because the gate divides by it', () => {
    // A zero ramp is NaN at the delay, NaN reaches globalAlpha, and a canvas
    // handed an invalid alpha silently drops the draw. The slider's own min
    // says 0.05; this is the assertion that a typed 0 cannot get past it.
    setWindup({ ...windup, delay: 1, ramp: 0 });
    expect(windup.ramp).toBeGreaterThan(0);
    expect(Number.isNaN(windupGate(1))).toBe(false);
    expect(windupGate(1)).toBe(0);
    expect(windupGate(2)).toBe(1);
  });

  it('clamps every field into its legal range, and rejects non-numbers', () => {
    expect(clampWindup({ ...WINDUP_DEFAULTS, min: 5, delay: -3, ramp: 900 })).toMatchObject({
      min: 1,
      delay: 0,
      ramp: 20,
    });
    // Negative rates would run the bank backwards — filling while slow, or
    // draining while fast. Both floor at zero instead.
    expect(clampWindup({ ...WINDUP_DEFAULTS, fillBias: -2, drainRate: -1 })).toMatchObject({
      fillBias: 0,
      drainRate: 0,
    });
    // A number box can hand over an empty string as NaN; that falls back to the
    // shipped value rather than poisoning the record.
    const nan = Number.NaN;
    const bad = clampWindup({
      min: nan,
      delay: nan,
      ramp: nan,
      fillBias: nan,
      drainDelay: nan,
      drainRate: nan,
    });
    expect(bad).toEqual({ ...WINDUP_DEFAULTS });
  });

  it('emits paste-ready constants.ts lines, two decimals, never bare integers', () => {
    expect(windupSource(WINDUP_DEFAULTS)).toBe(
      [
        'export const SPEED_WINDUP_MIN = 0.5;',
        'export const SPEED_WINDUP_DELAY = 2.0;',
        'export const SPEED_WINDUP_RAMP = 3.0;',
        'export const SPEED_WINDUP_FILL_BIAS = 1.0;',
        'export const SPEED_WINDUP_DRAIN_DELAY = 0.0;',
        'export const SPEED_WINDUP_DRAIN_RATE = 1.0;',
      ].join('\n'),
    );
    expect(windupSource({ ...WINDUP_DEFAULTS, delay: 1.25 })).toContain(
      'export const SPEED_WINDUP_DELAY = 1.25;',
    );
  });

  it('defaults to the live values, so COPY reflects the session', () => {
    setWindup({ ...windup, min: 0.4, drainRate: 2.5 });
    expect(windupSource()).toContain('export const SPEED_WINDUP_MIN = 0.4;');
    expect(windupSource()).toContain('export const SPEED_WINDUP_DRAIN_RATE = 2.5;');
  });
});

describe('windupFillRate', () => {
  it('is zero below the threshold and 1× exactly at it, whatever the bias', () => {
    setWindup({ ...windup, fillBias: 4 });
    expect(windupFillRate(windup.min - 0.001)).toBe(0);
    expect(windupFillRate(windup.min)).toBe(1);
  });

  it('lerps from 1× at the threshold to the bias at full speed', () => {
    setWindup({ ...windup, min: 0.5, fillBias: 3 });
    expect(windupFillRate(1)).toBeCloseTo(3, 10);
    expect(windupFillRate(0.75)).toBeCloseTo(2, 10); // halfway across the range
    // A bias below 1 is the other direction: flat out banks SLOWER than a jog
    // over the line, which is a real (if strange) thing to want to try.
    setWindup({ ...windup, fillBias: 0.25 });
    expect(windupFillRate(1)).toBeCloseTo(0.25, 10);
    expect(windupFillRate(0.5)).toBe(1);
  });

  it('is flat 1× at the default bias, so the shipped bank is unchanged', () => {
    for (const raw of [0.5, 0.7, 0.9, 1]) {
      expect(windupFillRate(raw)).toBe(1);
    }
  });

  it('survives a threshold of 1, where there is no range to lerp across', () => {
    setWindup({ ...windup, min: 1, fillBias: 2 });
    expect(windupFillRate(1)).toBe(2);
    expect(windupFillRate(0.99)).toBe(0);
  });
});

describe('stepWindup', () => {
  it('banks real time at the default tuning, and caps at delay + ramp', () => {
    const w = hold(fresh(), 0.8, 2);
    expect(w.bank).toBeCloseTo(2, 6);
    expect(w.idle).toBe(0);
    hold(w, 0.8, 60);
    expect(w.bank).toBe(windup.delay + windup.ramp); // exactly the ceiling
  });

  it('banks faster or slower with the bias, over the same wall-clock run', () => {
    setWindup({ ...windup, fillBias: 3 });
    expect(hold(fresh(), 1, 1).bank).toBeCloseTo(3, 6);
    setWindup({ ...windup, fillBias: 0.5 });
    expect(hold(fresh(), 1, 1).bank).toBeCloseTo(0.5, 6);
  });

  it('HOLDS THE BANK THROUGH THE GRACE, then drains at its own rate', () => {
    // The case the grace exists for: a landing, a wall bump, a moment of air —
    // punctuation in a run, not the end of one — costs nothing at all.
    setWindup({ ...windup, drainDelay: 0.5, drainRate: 2 });
    const w = hold(fresh(), 0.8, 3);
    const banked = w.bank;
    hold(w, 0, 0.4); // slower than the threshold, but inside the grace
    expect(w.bank).toBe(banked);
    expect(w.idle).toBeCloseTo(0.4, 6);
    hold(w, 0, 0.6); // 1.0s slow total: 0.5 of grace, then 0.5 draining at 2×
    expect(w.bank).toBeCloseTo(banked - 1, 4);
  });

  it('resets the grace the instant you are fast again', () => {
    setWindup({ ...windup, drainDelay: 1 });
    const w = hold(fresh(), 0.8, 3);
    hold(w, 0, 0.9);
    expect(w.idle).toBeCloseTo(0.9, 6);
    hold(w, 0.8, 1 / 30); // two steps of speed
    expect(w.idle).toBe(0);
    const banked = w.bank;
    hold(w, 0, 0.9); // the grace starts over, so this is still free
    expect(w.bank).toBe(banked);
  });

  it('does not depend on where the fixed steps land relative to the grace', () => {
    // The boundary is crossed mid-step here (0.55s of grace, 1/60s steps), and
    // the remainder of that step has to drain rather than the whole of it.
    setWindup({ ...windup, drainDelay: 0.55, drainRate: 1 });
    const w = hold(fresh(), 0.8, 4);
    const banked = w.bank;
    hold(w, 0, 1.55);
    expect(w.bank).toBeCloseTo(banked - 1, 4);
  });

  it('a drain rate of 0 banks permanently, and never goes below zero', () => {
    setWindup({ ...windup, drainRate: 0 });
    const w = hold(fresh(), 0.8, 3);
    expect(hold(w, 0, 30).bank).toBeCloseTo(3, 6);
    setWindup({ ...windup, drainRate: 8 });
    expect(hold(w, 0, 30).bank).toBe(0);
  });
});
