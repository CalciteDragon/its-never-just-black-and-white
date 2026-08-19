/**
 * The camera's contract, not its arithmetic: the lead is smoothed rather than
 * snapped, the horizontal clamp is hard, the vertical one deliberately is not,
 * and the bounce is an integrated phase (PHASES.md phase 3, decision 2).
 */

import { describe, expect, it } from 'vitest';
import {
  BOUNCE_AMP,
  BOUNCE_FREQ,
  CAMERA_VSLACK,
  LOOKAHEAD_MAX,
  LOOKAHEAD_TIME,
  RUN_SPEED,
  STEP,
  TILE,
  VIEW_H,
  VIEW_W,
} from '../src/constants';
import { Rng } from '../src/engine/rng';
import { Camera } from '../src/world/camera';

/** How far the view leads the point it is following (px, signed). */
function lead(c: Camera, cx: number): number {
  return c.viewX + VIEW_W / 2 - cx;
}

/** The cosmetic bounce, which by contract lives only in viewY. */
function bounce(c: Camera): number {
  return c.viewY - c.y;
}

/** Hold the target still and run to convergence, so only the lead is moving. */
function settle(c: Camera, cx: number, cy: number, vx: number, steps = 900): void {
  for (let i = 0; i < steps; i++) {
    c.update(cx, cy, vx, 0, STEP);
  }
}

describe('Camera.snapTo', () => {
  it('centres the view on the target', () => {
    const c = new Camera();
    c.snapTo(500, 300);
    expect(c.x).toBe(500 - VIEW_W / 2);
    expect(c.y).toBe(300 - VIEW_H / 2);
    expect(c.viewX).toBe(c.x);
    expect(c.viewY).toBe(c.y);
  });

  it('clears the accumulated lead and the bounce phase', () => {
    const c = new Camera();
    c.snapTo(0, 0);
    for (let i = 0; i < 600; i++) {
      c.update(1000, 500, RUN_SPEED, 1, STEP);
    }
    c.snapTo(1000, 500);
    // A respawn starts from rest: nothing carries over, so a still target with
    // no velocity leaves the view exactly where snapTo put it.
    expect(bounce(c)).toBe(0);
    c.update(1000, 500, 0, 0, STEP);
    expect(c.viewX).toBe(1000 - VIEW_W / 2);
    expect(c.viewY).toBe(500 - VIEW_H / 2);
  });
});

describe('Camera lookahead', () => {
  it('leads in the direction of travel', () => {
    const ahead = new Camera();
    ahead.snapTo(1000, 500);
    ahead.update(1000, 500, RUN_SPEED, 0, STEP);
    expect(lead(ahead, 1000)).toBeGreaterThan(0);

    const behind = new Camera();
    behind.snapTo(1000, 500);
    behind.update(1000, 500, -RUN_SPEED, 0, STEP);
    expect(lead(behind, 1000)).toBeLessThan(0);
  });

  it('converges to vx · LOOKAHEAD_TIME ahead of the player', () => {
    const c = new Camera();
    c.snapTo(1000, 500);
    settle(c, 1000, 500, 200);
    expect(lead(c, 1000)).toBeCloseTo(200 * LOOKAHEAD_TIME, 3);

    const back = new Camera();
    back.snapTo(1000, 500);
    settle(back, 1000, 500, -200);
    expect(lead(back, 1000)).toBeCloseTo(-200 * LOOKAHEAD_TIME, 3);
  });

  it('saturates at LOOKAHEAD_MAX however fast the player is going', () => {
    // The cap is a safety limit for pad launches; running flat out stays under
    // it, so ordinary play never has its lead flattened.
    const fast = new Camera();
    fast.snapTo(0, 0);
    settle(fast, 0, 0, 20 * RUN_SPEED);
    expect(lead(fast, 0)).toBeCloseTo(LOOKAHEAD_MAX, 3);

    const running = new Camera();
    running.snapTo(0, 0);
    settle(running, 0, 0, RUN_SPEED);
    expect(lead(running, 0)).toBeLessThan(LOOKAHEAD_MAX);
  });

  it('slides monotonically to the new lead after a reversal, never past it', () => {
    // A direction reversal jumps the raw target by ~180 px. Smoothing the
    // offset (not just the target) makes the response two cascaded first-order
    // lags — a sum of decaying exponentials, so it slides instead of whipping.
    const c = new Camera();
    c.snapTo(1000, 500);
    settle(c, 1000, 500, RUN_SPEED);

    const target = 1000 - RUN_SPEED * LOOKAHEAD_TIME - VIEW_W / 2;
    let prev = c.viewX;
    let monotone = true;
    let overshoot = 0;
    for (let i = 0; i < 600; i++) {
      c.update(1000, 500, -RUN_SPEED, 0, STEP);
      if (c.viewX > prev) {
        monotone = false;
      }
      overshoot = Math.max(overshoot, target - c.viewX);
      prev = c.viewX;
    }
    expect(monotone).toBe(true);
    expect(overshoot).toBeLessThan(1e-9);
    expect(c.viewX).toBeCloseTo(target, 3);
  });
});

describe('Camera horizontal clamp', () => {
  it('keeps the view inside the map — no slack, unlike the vertical', () => {
    const c = new Camera();
    c.snapTo(-100, 300);
    c.clampX(2000);
    expect(c.x).toBe(0);

    c.snapTo(5000, 300);
    c.clampX(2000);
    expect(c.x).toBe(2000 - VIEW_W);
  });

  it('centres a map narrower than the view', () => {
    const mapW = VIEW_W - 100;
    const c = new Camera();
    c.snapTo(9999, 0);
    c.clampX(mapW);
    expect(c.x).toBe((mapW - VIEW_W) / 2);
  });
});

describe('Camera vertical', () => {
  const mapH = 3000;

  it('permits CAMERA_VSLACK of overshoot past each edge, and no more', () => {
    // Gravity flips, so both edges are lethal: the frame before an
    // out-of-bounds death has to stay legible instead of clipping off a pin.
    const inside = new Camera();
    inside.snapTo(0, VIEW_H / 2 - CAMERA_VSLACK / 2);
    inside.clampY(mapH);
    expect(inside.y).toBe(-CAMERA_VSLACK / 2);

    const top = new Camera();
    top.snapTo(0, -10000);
    top.clampY(mapH);
    expect(top.y).toBe(-CAMERA_VSLACK);

    const bottom = new Camera();
    bottom.snapTo(0, 10000);
    bottom.clampY(mapH);
    expect(bottom.y).toBe(mapH - VIEW_H + CAMERA_VSLACK);
  });

  it('centres a map shorter than the view instead of pinning to the top', () => {
    // Pinning to y = 0 is a hidden assumption that down is down, and this
    // game's whole premise is that it isn't.
    const shortH = VIEW_H - 120;
    const c = new Camera();
    c.snapTo(0, 9999);
    c.clampY(shortH);
    expect(c.y).toBe((shortH - VIEW_H) / 2);
    expect(c.y).toBeLessThan(0);
  });
});

describe('Camera bounce', () => {
  it('is exactly zero at speedNorm 0, and the phase does not advance there', () => {
    const c = new Camera();
    c.snapTo(0, 0);
    for (let i = 0; i < 7; i++) {
      c.update(0, 0, 0, 1, STEP); // wind the phase to somewhere mid-cycle
    }
    const wound = bounce(c);
    expect(Math.abs(wound)).toBeGreaterThan(0);

    for (let i = 0; i < 300; i++) {
      c.update(0, 0, 0, 0, STEP);
      expect(bounce(c)).toBe(0); // standing still is dead still
    }
    // A zero-length step re-reads the phase without advancing it: it is exactly
    // where it was parked, so stopping holds the wobble rather than scrambling
    // it — the same reason the phase is state and not a function of the clock.
    c.update(0, 0, 0, 1, 0);
    expect(bounce(c)).toBe(wound);
  });

  it('peaks at BOUNCE_AMP over one full cycle at speedNorm 1', () => {
    const c = new Camera();
    c.snapTo(0, 0);
    const samples = 2000;
    const dt = (2 * Math.PI) / BOUNCE_FREQ / samples; // one period at speedNorm 1
    let max = -Infinity;
    let min = Infinity;
    for (let i = 0; i < samples; i++) {
      c.update(0, 0, 0, 1, dt);
      max = Math.max(max, bounce(c));
      min = Math.min(min, bounce(c));
    }
    expect(max).toBeLessThanOrEqual(BOUNCE_AMP);
    expect(max).toBeCloseTo(BOUNCE_AMP, 4);
    expect(min).toBeGreaterThanOrEqual(-BOUNCE_AMP);
    expect(min).toBeCloseTo(-BOUNCE_AMP, 4);
  });

  it('stays continuous when speedNorm jitters, however long the run', () => {
    // Decision 2. The literal GAME-DESIGN §7 form,
    // sin(t · BOUNCE_FREQ · n) · BOUNCE_AMP · n, moves the sine *argument* by
    // t · BOUNCE_FREQ · Δn: at t = 100 s a 0.04 jitter is 36 rad of phase, and
    // the screen snaps every frame. Integrating the phase makes speedNorm a
    // frequency, so a speed change can only alter the rate of the wobble.
    const c = new Camera();
    c.snapTo(0, 0);
    for (let i = 0; i < 6000; i++) {
      c.update(0, 0, 0, 0.8, STEP); // 100 s in — where the naive form dies
    }

    const rng = new Rng(0x1ce);
    const nMin = 0.78;
    const nMax = 0.82;
    // One step can only move the offset by the phase it advanced plus the
    // amplitude it gained: |Δ(n·sinφ)| ≤ n·Δφ + Δn. The brief's 2 · BOUNCE_AMP
    // is asserted too, but it is a ceiling no bounded sine can breach — this
    // derived bound is the one with teeth.
    const bound = BOUNCE_AMP * (nMax * (BOUNCE_FREQ * nMax * STEP) + (nMax - nMin));
    let prev = bounce(c);
    let maxDelta = 0;
    for (let i = 0; i < 600; i++) {
      c.update(0, 0, 0, rng.float(nMin, nMax), STEP);
      const now = bounce(c);
      maxDelta = Math.max(maxDelta, Math.abs(now - prev));
      prev = now;
    }
    expect(maxDelta).toBeLessThanOrEqual(2 * BOUNCE_AMP);
    expect(maxDelta).toBeLessThanOrEqual(bound);
  });

  it('lives in viewY only — never in y, never in viewX', () => {
    // Writing it into the position would feed it back through follow and clamp,
    // turning a cosmetic wobble into a physical oscillator.
    const c = new Camera();
    c.snapTo(0, 500);
    for (let i = 0; i < 40; i++) {
      c.update(0, 500, 0, 1, STEP);
    }
    expect(Math.abs(bounce(c))).toBeGreaterThan(0);
    expect(c.x).toBe(-VIEW_W / 2);
    expect(c.y).toBe(500 - VIEW_H / 2);
    expect(c.viewX).toBe(c.x);

    // The clamp cannot see it either: it constrains the position, so the view
    // may legitimately ride BOUNCE_AMP past the edge it was clamped to.
    const before = c.y;
    c.clampY(3000);
    expect(c.y).toBe(before);
  });
});

describe('Camera on maps of arbitrary size', () => {
  // The view is 960 x 540 and nothing in the level format bounds a grid to it,
  // so both clamps have to hold at every scale. The three interesting regimes
  // are "smaller than the view", "exactly the view" and "much larger", and the
  // boundary case is the one a `<` instead of a `<=` would silently break.
  const wideW = 200 * TILE;
  const tallH = 60 * TILE;

  it('puts a map exactly VIEW_W wide at x = 0, from either side', () => {
    // mapWpx === VIEW_W satisfies both branches, and they agree: the centring
    // formula gives (VIEW_W - VIEW_W) / 2 = 0 and the clamp gives [0, 0].
    const left = new Camera();
    left.snapTo(-9999, 0);
    left.clampX(VIEW_W);
    expect(left.x).toBe(0);

    const right = new Camera();
    right.snapTo(9999, 0);
    right.clampX(VIEW_W);
    expect(right.x).toBe(0);
  });

  it('puts a map exactly VIEW_H tall at y = 0, with no slack either side', () => {
    // The slack is an allowance to see past a real edge; a map the size of the
    // view has nowhere to see past, so it centres and the slack never applies.
    const up = new Camera();
    up.snapTo(0, -9999);
    up.clampY(VIEW_H);
    expect(up.y).toBe(0);

    const down = new Camera();
    down.snapTo(0, 9999);
    down.clampY(VIEW_H);
    expect(down.y).toBe(0);
  });

  it('clamps a 200-tile-wide map to [0, mapWpx - VIEW_W] and leaves the middle be', () => {
    const before = new Camera();
    before.snapTo(-50000, 0);
    before.clampX(wideW);
    expect(before.x).toBe(0);

    const after = new Camera();
    after.snapTo(50000, 0);
    after.clampX(wideW);
    expect(after.x).toBe(wideW - VIEW_W);

    // Interior: the clamp is a bound, not a snap — it must not move a view that
    // is already legal.
    const inside = new Camera();
    inside.snapTo(wideW / 2, 0);
    const was = inside.x;
    inside.clampX(wideW);
    expect(inside.x).toBe(was);
    expect(inside.x).toBeGreaterThan(0);
    expect(inside.x).toBeLessThan(wideW - VIEW_W);
  });

  it('clamps a 60-tile-tall map to [-CAMERA_VSLACK, mapHpx - VIEW_H + CAMERA_VSLACK]', () => {
    const top = new Camera();
    top.snapTo(0, -50000);
    top.clampY(tallH);
    expect(top.y).toBe(-CAMERA_VSLACK);

    const bottom = new Camera();
    bottom.snapTo(0, 50000);
    bottom.clampY(tallH);
    expect(bottom.y).toBe(tallH - VIEW_H + CAMERA_VSLACK);

    const inside = new Camera();
    inside.snapTo(0, tallH / 2);
    const was = inside.y;
    inside.clampY(tallH);
    expect(inside.y).toBe(was);
  });

  it('centres a one-tile map — the smallest grid the format can express', () => {
    // A 1x1 grid is a legal level (one row, one character); it is also the
    // extreme of the narrower-than-view branch, where the centred origin is
    // nearly half a view negative rather than a rounding error.
    const c = new Camera();
    c.snapTo(9999, 9999);
    c.clampX(TILE);
    c.clampY(TILE);
    expect(c.x).toBe((TILE - VIEW_W) / 2);
    expect(c.y).toBe((TILE - VIEW_H) / 2);
  });
});
