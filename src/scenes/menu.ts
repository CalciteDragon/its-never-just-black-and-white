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

import type { Game } from '../game';

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
export function updateMenu(game: Game, index: number, count: number): MenuStep {
  const input = game.input;
  let next = index;
  if (count > 0 && (input.pressed('up') || input.pressed('down'))) {
    const dir = input.pressed('up') ? -1 : 1;
    next = (index + dir + count) % count;
    game.audio.play('menuMove');
  }
  const picked = input.pressed('confirm');
  if (picked) {
    game.audio.play('menuPick');
  }
  return { index: next, picked };
}
