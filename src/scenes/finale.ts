/**
 * The colour ending: the last level's goal, and what happens when the player
 * finally stands in it. The one place in the game where a colour is neither
 * `paper` nor `ink` (GAME-DESIGN §1, §11 — the final level's ending breaks the
 * two-colour rule deliberately, and only lands because everything before it
 * holds the line).
 *
 * **It is keyed by level id**, exactly the way `signs.ts` is keyed. The level
 * format is a grid of characters and nothing else, and giving one level a
 * different ending is not worth a colour field that the editor, the serialiser,
 * the importer and the warnings panel would all have to carry.
 *
 * Nothing here is sampled from an image — hard rule 1 admits no binary assets,
 * and a generated ending is the better artifact anyway: it is resolution
 * independent, it costs no bytes, and its colours drift instead of looping a
 * fixed number of frames.
 *
 * Node-safe: `finaleStage` is pure arithmetic, and the draws only ever touch
 * the renderer they are handed.
 */

import {
  FINALE_END_BLUR,
  FINALE_END_BLUR_AT,
  FINALE_END_COVER,
  FINALE_END_GROW_AT,
  FINALE_END_SETTLE_AT,
  FINALE_END_SETTLE_END,
  FINALE_END_SOFTEN,
  FINALE_END_STOPS,
  FINALE_END_SWEEP,
  FINALE_GOAL_CELLS,
  FINALE_GOAL_HALO_ALPHA,
  FINALE_GOAL_HALO_SPREAD,
  FINALE_GOAL_HUE_PER_RING,
  FINALE_GOAL_HUE_RATE,
  FINALE_GOAL_TILES,
  TILE,
  VIEW_H,
  VIEW_W,
} from '../constants';
import { spectrum } from '../engine/palette';
import type { Renderer } from '../engine/renderer';

/** The level whose goal is the colour ending. */
export const FINALE_LEVEL_ID = 'black-and-white';

/** 0 below `a`, 1 above `b`, smooth in between. No overshoot, unlike a cubic. */
function smoothstep(a: number, b: number, x: number): number {
  const t = b > a ? (x - a) / (b - a) : x >= b ? 1 : 0;
  const c = t > 0 ? (t < 1 ? t : 1) : 0;
  return c * c * (3 - 2 * c);
}

/** Where the ending has got to. See `finaleStage`. */
export interface FinaleStage {
  /** Multiplier on the goal spiral's three-tile span. */
  readonly scale: number;
  /** How far the spiral has drifted from the goal to the middle of the view. */
  readonly drift: number;
  /** Screen blur, in px. */
  readonly blur: number;
  /** Alpha of the settled conical sweep over the top of it. */
  readonly settle: number;
}

/**
 * The whole ending as a function of `p`, its progress from 0 to 1. Pure, and
 * separate from the draw for exactly that reason — the shape of an ending is
 * the part worth asserting, and asserting it should not need a canvas.
 *
 * The three stages OVERLAP on purpose. The blur starts before the growth
 * finishes and the sweep starts before the blur peaks, so no stage ever hands
 * over to the next on a frame where nothing is happening — a transition that
 * completes one thing at a time reads as three transitions.
 */
export function finaleStage(p: number): FinaleStage {
  const grow = smoothstep(0, FINALE_END_GROW_AT, p);
  const soft = smoothstep(0, FINALE_END_BLUR_AT, p);
  return {
    scale: 1 + (FINALE_END_COVER - 1) * grow,
    drift: grow,
    // Squared, so the frame stays legible while there is still something in it
    // to look at and goes soft only once it is colour and nothing else.
    blur: FINALE_END_BLUR * soft * soft,
    settle: smoothstep(FINALE_END_SETTLE_AT, FINALE_END_SETTLE_END, p),
  };
}

/**
 * The goal: a pixel spiral of spectrum, three tiles across, with a soft halo
 * behind it. `scale` is 1 in play and grows through the ending.
 *
 * The ordinary `ink` goal outline is NOT drawn under it. The cells are opaque
 * and would cover the outline anyway, and a draw nobody can see is a draw that
 * rots — so the finish line stops being a square you aim at and becomes a place
 * you arrive in. `PlayScene` moves the trigger to match: nine tiles and a hold,
 * because a goal you can no longer see the edges of must not fire on an edge.
 *
 * Nothing here breathes. The ordinary goal pulses to say "this is the thing you
 * want"; this one is the size of the room and the only colour in the game, and
 * a pulse on top of that is a second voice saying what the first already said.
 *
 * The arm falls straight out of each cell's polar position: a cell's hue is its
 * CHEBYSHEV ring — which is why the bands are square, like everything else in
 * this game — minus its angle, so following one hue around a turn steps you out
 * exactly one ring. That is what a spiral is. Subtracting the angle is the whole
 * trick; without it the same expression draws concentric squares.
 *
 * `t` is a presentation clock in seconds. A raw accumulator is fine — the hue
 * wraps inside `spectrum` — and nothing here feeds the simulation.
 */
export function drawFinaleGoal(
  r: Renderer,
  cx: number,
  cy: number,
  t: number,
  ui = false,
  scale = 1,
): void {
  const span = TILE * FINALE_GOAL_TILES * scale;
  const hue = t * FINALE_GOAL_HUE_RATE;

  // The halo reaches past the spiral's own square, so the bloom bleeds into the
  // level instead of stopping dead on a pixel edge.
  const halo = (span / 2) * FINALE_GOAL_HALO_SPREAD;
  r.glow(cx, cy, halo, spectrum(hue, FINALE_GOAL_HALO_ALPHA), spectrum(hue, 0), ui);

  const cell = span / FINALE_GOAL_CELLS;
  const half = FINALE_GOAL_CELLS / 2;
  const x0 = cx - span / 2;
  const y0 = cy - span / 2;
  for (let iy = 0; iy < FINALE_GOAL_CELLS; iy++) {
    // Cell centres in cell units, so the ring and the angle are measured from
    // the middle of the cell and the four quadrants come out symmetrical.
    const dy = iy + 0.5 - half;
    for (let ix = 0; ix < FINALE_GOAL_CELLS; ix++) {
      const dx = ix + 0.5 - half;
      const ring = Math.max(Math.abs(dx), Math.abs(dy)) / half;
      const turn = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
      const h = hue + (ring - turn) * FINALE_GOAL_HUE_PER_RING * FINALE_GOAL_CELLS * 0.5;
      // The half-pixel is a seam weld: two saturated cells meeting on a
      // fractional boundary otherwise leave a hairline of whatever is behind.
      r.rect(x0 + ix * cell, y0 + iy * cell, cell + 0.5, cell + 0.5, spectrum(h), ui);
    }
  }
}

/**
 * The ending, in TWO layers, because the two halves of it want opposite things.
 *
 * `drawFinaleBloom` is the spiral growing to take the screen, and it is drawn
 * UNDER the level — the last thing the player sees of the game is their own
 * square and the ground they are standing on, in silhouette against the colour
 * coming up behind them. Drawing it over the top would erase them, and erasing
 * the player at the moment the game rewards them is the ending saying goodbye
 * to the wrong thing.
 *
 * `drawFinaleVeil` is the frame going soft and the smooth sweep coming in, and
 * that one is drawn OVER everything, post pass and HUD included — this is where
 * the level does leave, and it has to leave all at once rather than one layer
 * at a time.
 *
 * So the player is behind the colour, then in it, then gone. `PlayScene` is
 * what puts them in that order, by calling these two at either end of its
 * render.
 */

/**
 * The bloom: the goal's spiral, grown and drifting to the middle of the view so
 * it covers the frame whichever corner the goal sat in. `sx`/`sy` are the
 * goal's position ON SCREEN — the colour leaves from where the player is
 * looking, not from a world coordinate the camera may have stopped following —
 * and `p` is the ending's progress from 0 to 1.
 */
export function drawFinaleBloom(r: Renderer, sx: number, sy: number, t: number, p: number): void {
  const st = finaleStage(p);
  drawFinaleGoal(
    r,
    sx + (VIEW_W / 2 - sx) * st.drift,
    sy + (VIEW_H / 2 - sy) * st.drift,
    t,
    true,
    st.scale,
  );
}

/**
 * The veil: the whole frame blurred — level, player, HUD and bloom together —
 * and then a smooth conical sweep of every hue fading in over it. The sweep is
 * the same spectrum with the pixels finally gone.
 *
 * It is drawn AFTER the frame blur, not through it: it is already smooth, and
 * that pass would only cost it its saturation. Then a second, gentler blur of
 * its own, which is there to take the point out of the middle of it — a conical
 * gradient converges on an exact centre, and a centre is a thing to look at on
 * the one screen in the game that is meant to have nothing to look at.
 *
 * What is left is a screen with nothing on it and every colour in it — which is
 * the answer to the title, and the sheet the credits come up on.
 */
export function drawFinaleVeil(r: Renderer, t: number, p: number): void {
  const st = finaleStage(p);
  r.blurScreen(st.blur);

  const drift = t * FINALE_GOAL_HUE_RATE;
  const stops: string[] = [];
  for (let i = 0; i < FINALE_END_STOPS; i++) {
    // i / (n - 1) ends on the hue it started with, so the sweep closes on
    // itself instead of showing a seam where 359° meets 0°.
    stops.push(spectrum(drift + i / (FINALE_END_STOPS - 1)));
  }
  r.conic(VIEW_W / 2, VIEW_H / 2, t * FINALE_END_SWEEP, stops, st.settle);
  r.blurScreen(FINALE_END_SOFTEN * st.settle);
}
