/**
 * One vertical menu, shared by the title, the level select, the results screen
 * and the pause overlay. Four copies of "up, down, wrap, blip, confirm" is four
 * places for the wrap to be off by one and four places for the blip to be
 * forgotten — and phase 6 synthesised `menuMove` and `menuPick` for a screen
 * that only ever picked, so this is where the first of those two finally has a
 * call site.
 *
 * Pure but for the two sound effects, and node-safe like everything a scene
 * calls: `AudioSys` under node is a total no-op.
 */

import { MOUSE_LEFT } from '../engine/input';
import type { Game } from '../game';

/** View-space geometry for the currently visible slice of a vertical menu. */
export interface MenuRows {
  readonly top: number;
  readonly rowHeight: number;
  readonly left: number;
  readonly right: number;
  readonly first?: number;
  readonly visible?: number;
}

export interface MenuStep {
  /** The selection after this frame, wrapped into range. */
  readonly index: number;
  /** Did `confirm` fire this frame? */
  readonly picked: boolean;
}

/**
 * Advance a menu by one frame. Wraps at both ends, because a menu of three
 * that stops at the bottom makes the third item the awkward one.
 *
 * `up` and `down` rather than raw codes, so WASD and the arrows both work and
 * the binding table stays the single source of truth. `confirm` is Enter and
 * Space; Space is also `flip`, which is harmless on every screen that has no
 * player to flip.
 */
export function updateMenu(
  game: Game,
  index: number,
  count: number,
  rows?: MenuRows,
): MenuStep {
  const input = game.input;
  let next = index;
  let moved = false;
  let picked = false;

  if (
    count > 0 &&
    input.controlSource === 'keyboard' &&
    (input.pressed('up') || input.pressed('down'))
  ) {
    const dir = input.pressed('up') ? -1 : 1;
    next = (index + dir + count) % count;
    moved = true;
  } else if (count > 0 && input.controlSource === 'pointer') {
    if (input.wheelSteps !== 0) {
      const dir = input.wheelSteps < 0 ? -1 : 1;
      next = (index + dir + count) % count;
      moved = true;
    } else if (rows && (input.pointerMoved || input.pointerPressed(MOUSE_LEFT))) {
      const hot = menuRowAt(input.pointerX, input.pointerY, count, rows);
      if (hot !== -1) {
        moved = hot !== index;
        next = hot;
        picked = input.pointerPressed(MOUSE_LEFT);
      }
    }
  }
  if (moved) {
    game.audio.play('menuMove');
  }
  if (input.controlSource === 'keyboard' && input.pressed('confirm')) {
    picked = true;
  }
  if (picked) {
    game.audio.play('menuPick');
  }
  return { index: next, picked };
}

/** The visible row containing a point, using mid-gaps as row boundaries. */
export function menuRowAt(x: number, y: number, count: number, rows: MenuRows): number {
  if (x < rows.left || x >= rows.right) {
    return -1;
  }
  const first = rows.first ?? 0;
  const visible = Math.min(rows.visible ?? count, count - first);
  const slot = Math.floor((y - rows.top + rows.rowHeight / 2) / rows.rowHeight);
  return slot >= 0 && slot < visible ? first + slot : -1;
}
