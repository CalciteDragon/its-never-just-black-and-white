/**
 * In-world signs: lines of `ink` text painted into a level's empty space, plus
 * an optional arrow, drawn by `PlayScene` between the tiles and the player.
 *
 * **This is a special case on purpose, and it is keyed by level id.** The level
 * format is a grid of characters and nothing else (`world/level.ts`), and a
 * `text` field would have to survive the editor, the serialiser, the importer
 * and the warnings panel — a whole authoring feature, built so that one level
 * can say PRESS W TO JUMP. The tutorial is the only level that teaches the
 * controls, so its captions live here as data beside the grid rather than in
 * it. A level with no entry draws nothing and pays one map lookup.
 *
 * Positions are world pixels, not tiles, because a caption is placed against
 * the geometry it explains rather than snapped to a cell: `x` centres the
 * lines, `y` is the top of the first one, and `tests/signs.test.ts` asserts
 * every box lands inside the level and clear of its solid tiles.
 *
 * Node-safe like the rest of `scenes/` — `SIGNS` is plain data and `drawSigns`
 * only ever touches the renderer it is handed.
 */

import {
  SIGN_ARROW_BARB,
  SIGN_ARROW_WIDTH,
  SIGN_LINE_H,
  SIGN_TEXT_SCALE,
} from '../constants';
import { palette } from '../engine/palette';
import type { Renderer } from '../engine/renderer';

/** An arrow drawn from `x0,y0` to `x1,y1`, in world pixels. The tip is the end. */
export interface SignArrow {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** One caption. `x` is the centre of the lines; `y` is the top of line 0. */
export interface Sign {
  readonly lines: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly arrow?: SignArrow;
}

/**
 * The tutorial's six captions, in the order the level is played:
 *
 * 1. the run, over the flat opening ground;
 * 2. the jump, over the first gap;
 * 3. the flip, in the shaft under the first upside-down platform — the pit
 *    below it has no floor, so the caption is the only way across;
 * 4. the pickup, above the first diamond;
 * 5. the pads, in the pit facing the padded wall that closes the level;
 * 6. the goal, pointing at it.
 *
 * 5 is the newest and teaches the rule the 0.2 playtest amended in — a pad
 * hands the flip straight back, so a pad chain is a chain of choices
 * (`entities/player.ts`). It is placed in the open pit rather than on the wall
 * because the wall is where the pads are, and a caption drawn over them would
 * be the one bit of ink the player is trying to read the shape of.
 */
const TUTORIAL_SIGNS: readonly Sign[] = [
  { lines: ['USE A AND D TO MOVE LEFT AND RIGHT'], x: 336, y: 544 },
  { lines: ['PRESS W TO JUMP'], x: 752, y: 544 },
  { lines: ['PRESS SPACE TO FLIP YOUR WHOLE WORLD!'], x: 1456, y: 480 },
  {
    lines: ['TOUCH THE DIAMOND TO RECHARGE YOUR FLIP', 'WITHOUT TOUCHING THE GROUND'],
    x: 2640,
    y: 384,
  },
  {
    lines: ['TOUCHING A JUMP PAD', 'ALSO RECHARGES FLIP'],
    x: 3760,
    y: 528,
  },
  {
    lines: ['FINISH THE TUTORIAL'],
    x: 4207,
    y: 400,
    arrow: { x0: 4336, y0: 407, x1: 4368, y1: 407 },
  },
];

/** Level id → its signs. Only the tutorial has any. */
const SIGNS: Readonly<Record<string, readonly Sign[]>> = {
  '00-tutorial': TUTORIAL_SIGNS,
};

/** The signs for a level, or an empty list. Never null — the caller loops. */
export function signsFor(levelId: string): readonly Sign[] {
  return SIGNS[levelId] ?? [];
}

/**
 * A shaft and two barbs, all `ink`. The barbs sweep ±135° off the shaft's
 * heading, which is `drawChevron`'s construction — the same arrowhead the pads
 * wear, so the two read as one vocabulary — but in `ink` rather than `paper`,
 * because a sign sits on the background where a pad sits on a tile.
 */
function drawArrow(r: Renderer, a: SignArrow): void {
  const dx = a.x1 - a.x0;
  const dy = a.y1 - a.y0;
  const len = Math.hypot(dx, dy);
  if (len === 0) {
    return;
  }
  const base = Math.atan2(dy, dx);
  r.rectRotated(
    (a.x0 + a.x1) / 2,
    (a.y0 + a.y1) / 2,
    len,
    SIGN_ARROW_WIDTH,
    base,
    palette.ink,
  );
  for (const sweep of [(Math.PI * 3) / 4, (-Math.PI * 3) / 4]) {
    const ang = base + sweep;
    r.rectRotated(
      a.x1 + (Math.cos(ang) * SIGN_ARROW_BARB) / 2,
      a.y1 + (Math.sin(ang) * SIGN_ARROW_BARB) / 2,
      SIGN_ARROW_BARB,
      SIGN_ARROW_WIDTH,
      ang,
      palette.ink,
    );
  }
}

/** Draws every sign in world space. `PlayScene` has already set the camera. */
export function drawSigns(r: Renderer, signs: readonly Sign[]): void {
  for (const sign of signs) {
    for (let i = 0; i < sign.lines.length; i++) {
      r.textCentered(
        sign.lines[i],
        sign.x,
        sign.y + i * SIGN_LINE_H,
        palette.ink,
        SIGN_TEXT_SCALE,
        false,
      );
    }
    if (sign.arrow) {
      drawArrow(r, sign.arrow);
    }
  }
}
