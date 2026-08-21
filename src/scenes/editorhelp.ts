/**
 * The editor's CONTROLS AND TOOLS panel: every key, every tool and every
 * shortcut, on demand.
 *
 * It replaces a hint on the status line that an author read once and then never
 * saw again — which is the worst possible schedule for a reference, because the
 * moment you need "what does shift+click do" is not the moment you first opened
 * the tool. `H` and the button on the bar both open it; it is one screen and it
 * closes on anything.
 *
 * **The content is data, not draw calls.** `HELP_SECTIONS` is a table, so a
 * test can assert that every key the editor binds appears in it — a reference
 * that silently falls behind the thing it describes is worse than none, and
 * this is the one file that can go stale without any other test noticing.
 *
 * Nothing here names a colour or a character the 5x7 font cannot draw: `^` has
 * no glyph (see `tiledraw.ts`), so the pads are described in words and their
 * pictures live on the palette bar, which is drawn from the tiles themselves.
 */

import { VIEW_H, VIEW_W } from '../constants';
import { measureText } from '../engine/font';
import { palette } from '../engine/palette';
import type { Renderer } from '../engine/renderer';
import { plate } from './tiledraw';

/** One line of the panel: what you press, and what it does. */
export interface HelpEntry {
  readonly keys: string;
  readonly text: string;
}

export interface HelpSection {
  readonly title: string;
  readonly entries: readonly HelpEntry[];
}

/**
 * Everything the editor listens for, grouped the way an author looks for it.
 * The order within a section is the order the keys sit on the keyboard or the
 * order the acts happen in, never alphabetical.
 */
export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    title: 'TOOLS',
    entries: [
      { keys: 'B', text: 'BRUSH. PAINT CELLS ONE AT A TIME, DRAG TO KEEP PAINTING.' },
      { keys: 'X', text: 'RECT. DRAG A BOX; IT FILLS WHEN YOU LET GO, NOT BEFORE.' },
      { keys: 'V', text: 'SELECT. DRAG TO MARK CELLS OUT, THEN DRAG INSIDE TO MOVE THEM.' },
    ],
  },
  {
    title: 'PAINTING',
    entries: [
      { keys: 'LEFT', text: 'PAINT THE SELECTED CHARACTER.' },
      { keys: 'RIGHT', text: 'ERASE. WITH SELECT, DROP THE SELECTION INSTEAD.' },
      { keys: 'SHIFT+LEFT', text: 'FLOOD FILL EVERYTHING JOINED AND ALIKE. BRUSH ONLY.' },
      { keys: '1 - 9', text: 'PICK A PALETTE CHARACTER. THE BAR SHOWS WHAT EACH ONE IS.' },
      { keys: 'CLICK BAR', text: 'THE SAME, BY PICTURE. THE THICK BORDER IS THE SELECTED ONE.' },
    ],
  },
  {
    title: 'THE PALETTE',
    entries: [
      { keys: '1', text: 'EMPTY. AIR, AND WHAT AN ERASE PAINTS.' },
      { keys: '2', text: 'SOLID. FLOORS, WALLS, CEILINGS - EVERYTHING YOU LAND ON.' },
      { keys: '3 - 6', text: 'JUMP PADS: UP, DOWN, LEFT, RIGHT. THEY FIRE ALONG THE ARROW.' },
      { keys: '7', text: 'FLIP PICKUP. RECHARGES THE FLIP, THEN GOES SPENT FOR THE RUN.' },
      { keys: '8', text: 'SPAWN. ONE PER LEVEL: PAINTING IT MOVES IT RATHER THAN ADDING.' },
      { keys: '9', text: 'GOAL. ONE PER LEVEL, AND IT MOVES THE SAME WAY.' },
    ],
  },
  {
    title: 'THE VIEW',
    entries: [
      { keys: 'ARROWS', text: 'PAN. WASD DOES THE SAME.' },
      { keys: 'MIDDLE DRAG', text: 'PAN. SPACE + LEFT DRAG DOES THE SAME.' },
      { keys: '+ AND -', text: 'ZOOM IN AND OUT. HOW FAR DEPENDS ON THE SIZE OF THE LEVEL.' },
    ],
  },
  {
    title: 'THE GRID',
    entries: [
      { keys: '] AND [', text: 'GROW AND SHRINK THE RIGHT EDGE. SHIFT MOVES THE LEFT EDGE.' },
      { keys: '. AND ,', text: 'GROW AND SHRINK THE BOTTOM EDGE. SHIFT MOVES THE TOP EDGE.' },
      { keys: 'R', text: 'TYPE AN EXACT SIZE, AS W X H.' },
      { keys: 'CTRL+Z', text: 'UNDO ONE STROKE. CTRL+Y REDOES IT.' },
    ],
  },
  {
    title: 'THE LEVEL',
    entries: [
      { keys: 'N', text: 'RENAME: THE ID FIRST, WHICH IS THE FILENAME, THEN THE TITLE.' },
      { keys: 'ENTER', text: 'PLAYTEST. ESC IN PLAY COMES BACK WITH EVERY EDIT INTACT.' },
      { keys: 'CTRL+S', text: 'EXPORT THE .JSON. IF NOTHING DOWNLOADS, CTRL+SHIFT+S COPIES IT AS TEXT.' },
      { keys: 'AUTOSAVE', text: 'EVERY STROKE, TO LEVELS - CUSTOM LEVELS. A BUILT-IN SAVES AS A COPY.' },
      // Two keys on one line: the panel has to fit the frame, and these are the
      // two entries an author needs least often.
      { keys: 'H AND M', text: 'THIS PANEL - THE BAR BUTTON OPENS IT TOO - AND MUTE.' },
      { keys: 'ESC', text: 'DROP THE DRAG, THEN THE SELECTION, THEN LEAVE. WORK IS KEPT.' },
    ],
  },
];

/** Where the keys column ends, measured so no description overlaps a key. */
const KEYS_COLS = Math.max(
  ...HELP_SECTIONS.flatMap((s) => s.entries.map((e) => measureText(e.keys, 1))),
);

const MARGIN = 24;
const LINE = 11;
const HEADING = 16;

/**
 * The panel, one column, over a full-frame plate. One column rather than two
 * because the descriptions are sentences: two columns of sentences at this size
 * would be 38 characters wide each, and a reference that wraps every line is
 * one nobody reads to the end of.
 */
export function renderHelp(r: Renderer, closeHint: string): void {
  plate(r, MARGIN, MARGIN, VIEW_W - MARGIN * 2, VIEW_H - MARGIN * 2);
  const x = MARGIN + 16;
  r.text('CONTROLS AND TOOLS', x, MARGIN + 12, palette.ink, 2);
  r.text(closeHint, VIEW_W - MARGIN - 16 - measureText(closeHint, 1), MARGIN + 18, palette.ink);

  let y = MARGIN + 38;
  for (const section of HELP_SECTIONS) {
    r.text(section.title, x, y, palette.ink);
    y += HEADING - 4;
    // A rule under each heading: with no second colour to group by, the line is
    // what tells six lists apart from one list of thirty.
    r.rect(x, y, VIEW_W - MARGIN * 2 - 32, 1, palette.inkRgba(0.35), true);
    y += 5;
    for (const entry of section.entries) {
      r.text(entry.keys, x, y, palette.ink);
      r.text(entry.text, x + KEYS_COLS + 12, y, palette.inkRgba(0.75));
      y += LINE;
    }
    y += 6;
  }
}
