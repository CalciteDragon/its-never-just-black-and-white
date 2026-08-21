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
import whiteAndBlack from './01-white-and-black.json';
import truthsAndLies from './02-truths-and-lies.json';
import rightAndWrong from './03-right-and-wrong.json';
import goodAndBad from './04-good-and-bad.json';
import richAndPoor from './05-rich-and-poor.json';
import loveAndHate from './06-love-and-hate.json';
import successAndFailure from './07-success-and-failure.json';
import orderAndChaos from './08-order-and-chaos.json';
import strengthAndWeakness from './09-strength-and-weakness.json';
import courageAndFear from './10-courage-and-fear.json';
import selfishAndSelfless from './11-selfish-and-selfless.json';
import loyaltyAndBetrayal from './12-loyalty-and-betrayal.json';
import heroAndVillain from './13-hero-and-villain.json';
import innocentAndGuilty from './14-innocent-and-guilty.json';
import freedomAndControl from './15-freedom-and-control.json';
import fateAndChoice from './16-fate-and-choice.json';
import forgiveAndForget from './17-forgive-and-forget.json';
import usAndThem from './18-us-and-them.json';
import blackAndWhite from './19-black-and-white.json';

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
 * `19-black-and-white` is LAST, and has to be: it is the level the colour ending
 * and the credits are keyed to by id (`scenes/finale.ts`), so a level after it
 * would be a level the game has already said goodbye at.
 */
export const LEVELS: readonly Level[] = [
  load(tutorial),
  load(whiteAndBlack),
  load(truthsAndLies),
  load(rightAndWrong),
  load(goodAndBad),
  load(richAndPoor),
  load(loveAndHate),
  load(successAndFailure),
  load(orderAndChaos),
  load(strengthAndWeakness),
  load(courageAndFear),
  load(selfishAndSelfless),
  load(loyaltyAndBetrayal),
  load(heroAndVillain),
  load(innocentAndGuilty),
  load(freedomAndControl),
  load(fateAndChoice),
  load(forgiveAndForget),
  load(usAndThem),
  load(blackAndWhite),
];

/** The level after `index`, or null at the end of the set. */
export function nextLevel(index: number): Level | null {
  return LEVELS[index + 1] ?? null;
}
