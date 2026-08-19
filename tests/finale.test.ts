import { describe, expect, it } from 'vitest';
import {
  FINALE_END_BLUR,
  FINALE_END_COVER,
  FINALE_END_GROW_AT,
  FINALE_END_SETTLE_AT,
  FINALE_GOAL_CELLS,
  FINALE_GOAL_HALO_SPREAD,
  FINALE_GOAL_TILES,
  TILE,
} from '../src/constants';
import { palette, spectrum } from '../src/engine/palette';
import { VIEW_H, VIEW_W } from '../src/constants';
import type { Renderer } from '../src/engine/renderer';
import {
  drawFinaleBloom,
  drawFinaleGoal,
  drawFinaleVeil,
  finaleStage,
  FINALE_LEVEL_ID,
} from '../src/scenes/finale';

/**
 * The finale goal is the one place in the game where a colour is neither
 * `paper` nor `ink`, and it is drawn three tiles wide over hand-authored
 * geometry. Both are exactly the sort of thing that drifts when the constants
 * are retuned: a wider cell or a longer spread silently starts covering the
 * tiles beside the goal, and there is no test-visible symptom.
 *
 * So these tests record the draws through a stub renderer and re-derive the
 * invariants from the constants — the spiral stays inside its 3×3 footprint,
 * the goal outline is still in it, and the whole thing is a pure function of
 * `t` with no `Math.random` anywhere near the one screen that ends the game.
 */

type Kind = 'rect' | 'rotated' | 'outline' | 'glow' | 'blur' | 'conic';

interface Draw {
  readonly kind: Kind;
  /** Centre, for every kind — `rect`'s x/y/w/h are converted on the way in. */
  readonly cx: number;
  readonly cy: number;
  /** Half-extents; for a glow both are the radius. */
  readonly hw: number;
  readonly hh: number;
  readonly color: string;
}

function recorder(): { draws: Draw[]; r: Renderer } {
  const draws: Draw[] = [];
  const r = {
    rect(x: number, y: number, w: number, h: number, color: string) {
      draws.push({ kind: 'rect', cx: x + w / 2, cy: y + h / 2, hw: w / 2, hh: h / 2, color });
    },
    rectRotated(cx: number, cy: number, w: number, h: number, _a: number, color: string) {
      draws.push({ kind: 'rotated', cx, cy, hw: w / 2, hh: h / 2, color });
    },
    rectRotatedOutline(cx: number, cy: number, w: number, h: number, _a: number, color: string) {
      draws.push({ kind: 'outline', cx, cy, hw: w / 2, hh: h / 2, color });
    },
    glow(cx: number, cy: number, radius: number, inner: string) {
      draws.push({ kind: 'glow', cx, cy, hw: radius, hh: radius, color: inner });
    },
    blurScreen(px: number) {
      // The real one is a no-op at 0, and a test that counted those would be
      // asserting the call site rather than the picture.
      if (px > 0) {
        draws.push({ kind: 'blur', cx: 0, cy: 0, hw: px, hh: px, color: '' });
      }
    },
    conic(cx: number, cy: number, _a: number, stops: readonly string[], alpha: number) {
      if (alpha > 0) {
        draws.push({ kind: 'conic', cx, cy, hw: alpha, hh: stops.length, color: stops[0] });
      }
    },
  } as unknown as Renderer;
  return { draws, r };
}

function record(t: number): Draw[] {
  const { draws, r } = recorder();
  drawFinaleGoal(r, 0, 0, t);
  return draws;
}

function of(draws: Draw[], kind: Kind): Draw[] {
  return draws.filter((d) => d.kind === kind);
}

/** Sampled across a full drift, not just t = 0 where the spiral is at rest. */
const TIMES = [0, 0.37, 1.5, 4.25, 11, 60.125];
/**
 * The footprint, which is now FIXED — the bloom does not breathe, and this is
 * also the region `PlayScene.atGoal` triggers on. The drawing and the trigger
 * being the same square is the point: the outline that used to mark the goal is
 * painted over, so what the player sees has to be exactly what fires.
 */
const SPAN = TILE * FINALE_GOAL_TILES;

describe('the finale goal', () => {
  it('is keyed to the last level', () => {
    expect(FINALE_LEVEL_ID).toBe('black-and-white');
  });

  it('draws the halo and every spiral cell, and nothing else', () => {
    const draws = record(2);
    expect(of(draws, 'glow').length).toBe(1);
    expect(of(draws, 'rect').length).toBe(FINALE_GOAL_CELLS * FINALE_GOAL_CELLS);
    // The ordinary goal is not drawn under here. It would be invisible beneath
    // the opaque cells anyway, and a draw nobody can see is a draw that rots.
    expect(of(draws, 'rotated').length).toBe(0);
    expect(of(draws, 'outline').length).toBe(0);
  });

  it('is chromatic in every single draw — no paper, no ink, anywhere', () => {
    for (const t of TIMES) {
      const draws = record(t);
      expect(draws.every((d) => d.color.startsWith('hsla('))).toBe(true);
      expect(draws.some((d) => d.color === palette.paper || d.color === palette.ink)).toBe(false);
    }
  });

  it('paints the spiral edge to edge, with no gap and no cell outside the 3x3', () => {
    for (const t of TIMES) {
      const cells = of(record(t), 'rect');
      const reach = Math.max(...cells.map((d) => Math.max(Math.abs(d.cx), Math.abs(d.cy)) + d.hw));
      // Covers the footprint, bar the half-pixel the cells overlap by, and
      // never spills past it.
      expect(reach).toBeGreaterThanOrEqual(SPAN / 2);
      expect(reach).toBeLessThanOrEqual(SPAN / 2 + 1);
    }
  });

  it('lets only the halo past the footprint, and only as far as its spread', () => {
    for (const t of TIMES) {
      const halo = of(record(t), 'glow')[0];
      expect(halo.cx).toBe(0);
      expect(halo.cy).toBe(0);
      expect(halo.hw).toBeLessThanOrEqual((SPAN / 2) * FINALE_GOAL_HALO_SPREAD);
    }
  });

  it('does not breathe: the footprint is the same square on every frame', () => {
    const spans = TIMES.map((t) => {
      const cells = of(record(t), 'rect');
      return Math.max(...cells.map((d) => Math.max(Math.abs(d.cx), Math.abs(d.cy)) + d.hw));
    });
    expect(new Set(spans).size).toBe(1);
  });

  it('actually moves — no two sampled frames are the same picture', () => {
    const seen = TIMES.map((t) => JSON.stringify(record(t)));
    expect(new Set(seen).size).toBe(TIMES.length);
  });

  it('is a pure function of t, with no randomness to break determinism', () => {
    expect(record(3.75)).toEqual(record(3.75));
  });
});

describe('spectrum', () => {
  it('wraps the hue in both directions rather than clamping it', () => {
    expect(spectrum(1.25)).toBe(spectrum(0.25));
    expect(spectrum(-0.75)).toBe(spectrum(0.25));
  });

  it('clamps alpha the way the palette tokens do', () => {
    expect(spectrum(0, 4)).toBe(spectrum(0, 1));
    expect(spectrum(0, -2)).toContain('0)');
    expect(spectrum(0, Number.NaN)).toContain('0)');
  });

  it('does not move with the phase — the twist is that colour has arrived', () => {
    const a = spectrum(0.4, 0.5);
    palette.flip();
    expect(spectrum(0.4, 0.5)).toBe(a);
    palette.reset();
  });
});

/**
 * The ending is six seconds long and cannot be asserted by watching it, so the
 * curve is tested where it lives: `finaleStage` is pure, and everything that
 * makes the sequence read — that it starts from the frame the player earned,
 * that it never runs backwards, that it finishes covered — is a property of
 * three numbers over p.
 */
describe('finaleStage', () => {
  const P = Array.from({ length: 101 }, (_, i) => i / 100);

  it('starts exactly where the goal already was: full size, sharp, uncovered', () => {
    const st = finaleStage(0);
    expect(st.scale).toBe(1);
    expect(st.drift).toBe(0);
    expect(st.blur).toBe(0);
    expect(st.settle).toBe(0);
  });

  it('ends fully grown, fully soft and fully covered', () => {
    const st = finaleStage(1);
    expect(st.scale).toBeCloseTo(FINALE_END_COVER, 10);
    expect(st.drift).toBe(1);
    expect(st.blur).toBeCloseTo(FINALE_END_BLUR, 10);
    expect(st.settle).toBe(1);
  });

  it('never runs backwards on any of its three stages', () => {
    for (let i = 1; i < P.length; i++) {
      const a = finaleStage(P[i - 1]);
      const b = finaleStage(P[i]);
      expect(b.scale).toBeGreaterThanOrEqual(a.scale);
      expect(b.blur).toBeGreaterThanOrEqual(a.blur);
      expect(b.settle).toBeGreaterThanOrEqual(a.settle);
    }
  });

  it('clamps outside 0..1 rather than extrapolating off the end of the run', () => {
    expect(finaleStage(-5)).toEqual(finaleStage(0));
    expect(finaleStage(9)).toEqual(finaleStage(1));
  });

  it('covers the view from any corner once it has grown', () => {
    // The spiral is centred on the goal and only drifts to the middle as it
    // grows, so at worst it starts in a corner: half its span has to reach the
    // far one for the level never to show around the edge of the ending.
    const span = TILE * FINALE_GOAL_TILES * finaleStage(FINALE_END_GROW_AT).scale;
    expect(span / 2).toBeGreaterThan(Math.hypot(VIEW_W, VIEW_H));
  });

  it('overlaps its stages — the sweep begins while the frame is still moving', () => {
    // If the sweep waited for the growth, the ending would read as three
    // transitions in a row rather than as one thing happening.
    expect(FINALE_END_SETTLE_AT).toBeLessThan(FINALE_END_GROW_AT);
    const mid = finaleStage((FINALE_END_SETTLE_AT + FINALE_END_GROW_AT) / 2);
    expect(mid.settle).toBeGreaterThan(0);
    expect(mid.scale).toBeLessThan(FINALE_END_COVER);
  });
});

/**
 * The ending is drawn in two halves at opposite ends of `PlayScene.render`, and
 * which half draws what is the entire reason the player is still visible in it.
 * A stray blur in the bloom would go under the level and soften nothing; a
 * stray spiral cell in the veil would paint over the square the player is
 * watching. Neither has a symptom that a passing glance at six seconds of
 * moving colour would catch, so they are pinned here.
 */
describe('the ending, in two layers', () => {
  function bloom(p: number): Draw[] {
    const { draws, r } = recorder();
    drawFinaleBloom(r, 100, 80, 3, p);
    return draws;
  }

  function veil(p: number): Draw[] {
    const { draws, r } = recorder();
    drawFinaleVeil(r, 3, p);
    return draws;
  }

  it('puts the growing spiral in the layer that goes UNDER the level', () => {
    const draws = bloom(0.5);
    expect(of(draws, 'rect').length).toBe(FINALE_GOAL_CELLS * FINALE_GOAL_CELLS);
    expect(of(draws, 'glow').length).toBe(1);
    // Nothing that would soften or cover the level it is drawn behind.
    expect(of(draws, 'blur')).toEqual([]);
    expect(of(draws, 'conic')).toEqual([]);
  });

  it('puts the blur and the sweep in the layer that goes OVER everything', () => {
    const draws = veil(0.9);
    expect(of(draws, 'blur').length).toBeGreaterThan(0);
    expect(of(draws, 'conic').length).toBe(1);
    // Not one cell of spiral: the veil never repaints what the bloom drew.
    expect(of(draws, 'rect')).toEqual([]);
    expect(of(draws, 'glow')).toEqual([]);
  });

  it('opens as the goal itself, draw for draw, so the handover is seamless', () => {
    // p = 0 is the frame the player earned, and it must look exactly like the
    // frame before it — the veil does nothing, and the bloom is the goal.
    // `PlayScene` STOPS drawing the goal the moment the ending starts and lets
    // the bloom take over, which is only invisible because these are equal.
    expect(veil(0)).toEqual([]);
    const { draws, r } = recorder();
    drawFinaleGoal(r, 100, 80, 3, true);
    expect(bloom(0)).toEqual(draws);
  });

  it('grows the bloom toward the middle of the view as it takes the screen', () => {
    const near = of(bloom(0.1), 'glow')[0];
    const far = of(bloom(1), 'glow')[0];
    expect(far.hw).toBeGreaterThan(near.hw);
    // Started at the goal, ends centred on the view.
    expect(Math.abs(far.cx - VIEW_W / 2)).toBeLessThan(1);
    expect(Math.abs(far.cy - VIEW_H / 2)).toBeLessThan(1);
    expect(Math.abs(near.cx - VIEW_W / 2)).toBeGreaterThan(Math.abs(far.cx - VIEW_W / 2));
  });
});
