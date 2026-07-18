import { describe, expect, it } from 'vitest';
import { STEP } from '../src/constants';
import { FixedStepper } from '../src/game';

describe('FixedStepper', () => {
  it('advance(0.05) at 1/60 step yields exactly 3 calls of exactly STEP', () => {
    const stepper = new FixedStepper(STEP);
    const dts: number[] = [];
    stepper.advance(0.05, (dt) => dts.push(dt));
    expect(dts.length).toBe(3);
    for (const dt of dts) {
      expect(dt).toBe(STEP);
    }
  });

  it('carries leftover so calls average out exactly over time', () => {
    const stepper = new FixedStepper(STEP);
    let calls = 0;
    // 0.025 s = 1.5 steps: first advance fires 1, second fires 2.
    const leftover1 = stepper.advance(0.025, () => calls++);
    expect(calls).toBe(1);
    expect(leftover1).toBeCloseTo(0.5, 6);
    stepper.advance(0.025, () => calls++);
    expect(calls).toBe(3); // 0.05 s total = exactly 3 steps
  });

  it('feeding exactly one step per advance never drifts', () => {
    const stepper = new FixedStepper(STEP);
    let calls = 0;
    for (let i = 0; i < 600; i++) {
      stepper.advance(STEP, () => calls++);
    }
    expect(calls).toBe(600);
  });

  it('clamps huge frames to maxFrame (default 0.25 s)', () => {
    const stepper = new FixedStepper(STEP);
    let calls = 0;
    stepper.advance(10, () => calls++);
    expect(calls).toBe(15); // 0.25 * 60
  });

  it('honors a custom maxFrame', () => {
    const stepper = new FixedStepper(STEP, 0.1);
    let calls = 0;
    stepper.advance(5, () => calls++);
    expect(calls).toBe(6); // 0.1 * 60
  });

  it('zero and negative elapsed cause no calls and no state damage', () => {
    const stepper = new FixedStepper(STEP);
    let calls = 0;
    expect(stepper.advance(0, () => calls++)).toBe(0);
    expect(stepper.advance(-1, () => calls++)).toBe(0);
    expect(calls).toBe(0);
    // Still behaves normally afterwards.
    stepper.advance(STEP, () => calls++);
    expect(calls).toBe(1);
  });

  it('returns the leftover as a fraction of a step in [0, 1)', () => {
    const stepper = new FixedStepper(1 / 60);
    const f = stepper.advance(0.01, () => undefined); // less than one step
    expect(f).toBeCloseTo(0.01 / (1 / 60), 10);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThan(1);
  });

  it('exposes its configuration', () => {
    const stepper = new FixedStepper(1 / 30, 0.5);
    expect(stepper.step).toBeCloseTo(1 / 30, 12);
    expect(stepper.maxFrame).toBe(0.5);
  });
});
