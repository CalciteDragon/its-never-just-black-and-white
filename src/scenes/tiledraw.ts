/**
 * The four things that draw a level's contents, shared by `PlayScene` and the
 * editor. Lifted out of `PlayScene` in phase 7 with no behaviour change.
 *
 * The editor's palette bar draws **the tiles themselves** rather than their
 * characters — it is WYSIWYG for free, and it sidesteps the fact that `^` has
 * no glyph in the 5×7 font (`v` resolves to `V`, which is worse: it looks
 * deliberate). That means a second copy of the chevron draw would otherwise
 * exist in the editor, and a second copy is a second thing to retune the next
 * time `PAD_CHEVRON_WIDTH` moves.
 *
 * Every function takes its size explicitly rather than reading `TILE`, because
 * the editor draws at 32 px *and* at 16 px and the play scene draws at 32.
 * Only `drawTileRuns` — which is the world path, in world coordinates — keeps
 * the constant.
 */

import {
  GOAL_OUTLINE_WIDTH,
  PAD_CHEVRON_LEN,
  PAD_CHEVRON_WIDTH,
  PICKUP_CORE_FRACTION,
  PICKUP_OUTLINE_WIDTH,
  PICKUP_SPENT_ALPHA,
  PLAYER_CORE_INSET,
  PLAYER_SIZE,
  TILE,
  VIEW_H,
  VIEW_W,
} from '../constants';
import { palette } from '../engine/palette';
import type { Renderer } from '../engine/renderer';
import { forEachRun, padDirection, toTile } from '../world/tiles';
import type { PadDir, TileMap } from '../world/tiles';

/**
 * A pad's two `paper` bars, forming a chevron pointing the way it fires. One
 * primitive, one code path, all four directions: the arms are the pad's
 * direction rotated ±135°, so the whole thing follows from `padDirection` with
 * no per-facing branch.
 *
 * THE PARTICLE STREAM DOES NOT REPLACE THIS, it is added beside it.
 * `PAD_CHEVRON_WIDTH` got its value from counting pixels against a pad flush in
 * a floor row, because the chevron is what makes a pad identifiable at a glance
 * and AT REST — sparks are transient by construction, and there are none at all
 * on the frame a level loads.
 */
export function drawChevron(
  r: Renderer,
  cx: number,
  cy: number,
  dir: PadDir,
  len = PAD_CHEVRON_LEN,
  width = PAD_CHEVRON_WIDTH,
  ui = false,
): void {
  const tipX = cx + dir.dx * (len * 0.35);
  const tipY = cy + dir.dy * (len * 0.35);
  const base = Math.atan2(dir.dy, dir.dx);
  for (const sweep of [(Math.PI * 3) / 4, (-Math.PI * 3) / 4]) {
    const a = base + sweep;
    r.rectRotated(
      tipX + (Math.cos(a) * len) / 2,
      tipY + (Math.sin(a) * len) / 2,
      len,
      width,
      a,
      palette.paper,
      ui,
    );
  }
}

/**
 * The level's geometry as row-merged runs: a 40-tile floor is one `fillRect`,
 * not forty. World space, clipped to the view — `forEachRun` clips runs to the
 * window it is given, so nothing off-screen is ever emitted.
 */
export function drawTileRuns(r: Renderer, map: TileMap, viewX: number, viewY: number): void {
  forEachRun(
    map,
    toTile(viewX),
    toTile(viewY),
    toTile(viewX + VIEW_W),
    toTile(viewY + VIEW_H),
    (tx, ty, len, tile) => {
      r.rect(tx * TILE, ty * TILE, len * TILE, TILE, palette.ink);
      const dir = padDirection(tile);
      if (dir) {
        for (let i = 0; i < len; i++) {
          drawChevron(r, (tx + i) * TILE + TILE / 2, ty * TILE + TILE / 2, dir);
        }
      }
    },
  );
}

/**
 * The goal: an `ink` outline. `PlayScene` passes a size that breathes; the
 * editor passes a still one, because a palette swatch that pulsed would be the
 * only animated thing in a panel of eight.
 */
export function drawGoal(r: Renderer, cx: number, cy: number, size: number, ui = false): void {
  r.rectRotatedOutline(cx, cy, size, size, 0, palette.ink, GOAL_OUTLINE_WIDTH, ui);
}

/**
 * A flip pickup: a diamond with a `paper` core, which is the player's own charge
 * tell rotated 45°. That is the whole of the visual argument — the thing you
 * collect looks like the thing it gives you, and a player who has learned to
 * read a solid core as "you may flip" needs no second lesson.
 *
 * `ready = false` draws the afterimage instead: the outline alone, faint, so a
 * player who has just spent one can see where it will come back. Drawn in
 * `ink` at an alpha, never in a third colour.
 */
export function drawPickup(
  r: Renderer,
  cx: number,
  cy: number,
  size: number,
  ready: boolean,
  ui = false,
): void {
  const turn = Math.PI / 4;
  if (!ready) {
    r.rectRotatedOutline(
      cx,
      cy,
      size,
      size,
      turn,
      palette.inkRgba(PICKUP_SPENT_ALPHA),
      PICKUP_OUTLINE_WIDTH,
      ui,
    );
    return;
  }
  r.rectRotated(cx, cy, size, size, turn, palette.ink, ui);
  r.rectRotated(cx, cy, size * PICKUP_CORE_FRACTION, size * PICKUP_CORE_FRACTION, turn, palette.paper, ui);
}

/**
 * The spawn, drawn as what will actually stand there: the player's square, at
 * rest and square-on, with its `paper` core. Editor-only — `PlayScene` has a
 * real body to draw — and the reason S is legible in the grid without a letter.
 */
export function drawSpawn(r: Renderer, cx: number, cy: number, size: number, ui = false): void {
  const body = size * (PLAYER_SIZE / TILE);
  const core = body * ((PLAYER_SIZE - 2 * PLAYER_CORE_INSET) / PLAYER_SIZE);
  r.rectRotated(cx, cy, body, body, 0, palette.ink, ui);
  r.rectRotated(cx, cy, core, core, 0, palette.paper, ui);
}

/**
 * A `paper` panel with an `ink` border, in UI space. Every overlay the editor
 * draws sits on one: the grid underneath is `ink`, and ink text on ink geometry
 * is text nobody can read — which is the two-colour version of "the HUD
 * disappeared over the dark bit".
 *
 * It lives here rather than in `editor.ts` because the controls overlay draws
 * its own and importing it back from the scene would close a cycle.
 */
export function plate(r: Renderer, x: number, y: number, w: number, h: number): void {
  r.rect(x, y, w, h, palette.paper, true);
  r.rectRotatedOutline(x + w / 2, y + h / 2, w, h, 0, palette.ink, 1, true);
}
