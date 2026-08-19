/**
 * The level set, in play order. One JSON file per level, imported directly —
 * Vite handles JSON natively, so there is no loader and no new dependency.
 *
 * Parsing is EAGER and a failure THROWS with the whole error list. A level that
 * fails validation is a build-time bug in a file that lives in this repo, and
 * the alternative — skipping it, or handing the scene a half-built map — puts a
 * blank screen in front of a player instead of a message in front of whoever
 * broke the grid. `tests/level.test.ts` asserts every level here parses clean,
 * so the throw is a backstop and not the first line of defence.
 */

import { parseLevel } from '../world/level';
import type { Level } from '../world/level';
import tutorial from './00-tutorial.json';
import firstSteps from './01-first-steps.json';
import secondNature from './02-second-nature.json';
import blackAndWhite from './black-and-white.json';

function load(raw: unknown): Level {
  const res = parseLevel(raw);
  if (!res.ok) {
    throw new Error(`invalid level:\n  ${res.errors.join('\n  ')}`);
  }
  return res.level;
}

/**
 * Play order. The editor's save writes `src/levels/<id>.json` and stops there —
 * a middleware that rewrote this file to add an import would be codegen against
 * a source file under version control, so the one-line edit is deliberate and
 * the save's on-screen confirmation names it.
 *
 * `black-and-white` is LAST, and has to be: it is the level the colour ending
 * and the credits are keyed to by id (`scenes/finale.ts`), so a level after it
 * would be a level the game has already said goodbye at.
 */
export const LEVELS: readonly Level[] = [
  load(tutorial),
  load(firstSteps),
  load(secondNature),
  load(blackAndWhite),
];

/** The level after `index`, or null at the end of the set. */
export function nextLevel(index: number): Level | null {
  return LEVELS[index + 1] ?? null;
}
