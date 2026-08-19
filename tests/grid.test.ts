/**
 * The grid model, which is the whole of the editor that can be tested without
 * a scene. It edits **characters**, not tiles (PHASES phase 7, decision 1), so
 * `S` and `G` are cells like any other and `world/level.ts` is its entire
 * format layer: validation is `validateLevel(rows)` verbatim, saving is
 * `JSON.stringify({ id, name, rows })`, and playtesting is `parseLevel`.
 *
 * The assertions worth writing are the ones that fail against the obvious
 * alternative implementations — a per-cell undo snapshot, and a `TileMap` with
 * a spawn and a goal beside it.
 */

import { describe, expect, it } from 'vitest';
import { EDITOR_MAX_H, EDITOR_MAX_W, EDITOR_UNDO_MAX } from '../src/constants';
import {
  EditorGrid,
  GRID_CHARS,
  blankRows,
  forEachCharRun,
  gridWarnings,
  isGridChar,
  parseSizeInput,
} from '../src/editor/grid';
import { parseLevel, validateLevel } from '../src/world/level';

/** A small stage with one of everything, so a change anywhere is visible. */
const STAGE: readonly string[] = [
  '..........',
  '..S....G..',
  '..###..##.',
  '.....^....',
  '##########',
];

function g(rows: readonly string[] = STAGE): EditorGrid {
  return new EditorGrid(rows);
}

/** One drag, frame by frame, exactly as EditorScene feeds it. */
function stroke(grid: EditorGrid, cells: readonly (readonly [number, number])[], ch: string): void {
  grid.beginStroke();
  for (const [tx, ty] of cells) {
    grid.paint(tx, ty, ch);
  }
  grid.endStroke();
}

describe('the palette', () => {
  it('is NINE characters: the tile enum, the pickup, and the two markers', () => {
    // GAME-DESIGN §10 said "1-7", which is neither the six-value tile enum nor
    // the things an author actually paints. Amended in phase 7, and again after
    // 0.2 when the pickup arrived: it is a character in the grid and a cell in
    // the palette, but it is not a tile, because nothing collides with it.
    expect(GRID_CHARS.join(' ')).toBe('. # ^ v < > o S G');
    expect(GRID_CHARS).toHaveLength(9);
  });

  it('recognises exactly those and nothing else', () => {
    for (const ch of GRID_CHARS) {
      expect(isGridChar(ch)).toBe(true);
    }
    for (const ch of ['x', 'A', '', '##', ' ', 's', 'g']) {
      expect(isGridChar(ch), ch).toBe(false);
    }
  });

  it('a blank grid is legal the instant it is made', () => {
    const rows = blankRows(12, 5);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveLength(12);
    // Not merely rectangular: it already has its S and its G, so a fresh
    // editor never opens onto a level that fails validation.
    expect(validateLevel(rows)).toEqual([]);
  });
});

describe('painting', () => {
  it('writes a character and reports whether anything changed', () => {
    const grid = g();
    expect(grid.paint(0, 0, '#')).toBe(true);
    expect(grid.charAt(0, 0)).toBe('#');
    expect(grid.paint(0, 0, '#')).toBe(false); // already that
  });

  it('ignores out-of-bounds writes, like TileMap.set', () => {
    const grid = g();
    expect(grid.paint(-1, 0, '#')).toBe(false);
    expect(grid.paint(0, -1, '#')).toBe(false);
    expect(grid.paint(grid.w, 0, '#')).toBe(false);
    expect(grid.paint(0, grid.h, '#')).toBe(false);
    expect(grid.rows).toEqual(STAGE);
  });

  it('refuses a character that is not in the palette', () => {
    const grid = g();
    expect(grid.paint(0, 0, 'x')).toBe(false);
    expect(grid.rows).toEqual(STAGE);
  });

  it('PAINTING S MOVES THE SPAWN rather than adding a second one', () => {
    // The edit the model makes unrepresentable, and worth more than any
    // validation panel: there is no way to end up with two spawns.
    const grid = g();
    expect(grid.paint(5, 0, 'S')).toBe(true);
    expect(grid.charAt(5, 0)).toBe('S');
    expect(grid.charAt(2, 1)).toBe('.'); // the old one is gone
    expect(validateLevel(grid.rows)).toEqual([]);
    expect(grid.rows.join('').split('S')).toHaveLength(2); // exactly one
  });

  it('painting G moves the goal the same way', () => {
    const grid = g();
    grid.paint(0, 0, 'G');
    expect(grid.charAt(7, 1)).toBe('.');
    expect(validateLevel(grid.rows)).toEqual([]);
  });

  it('WILL NOT ERASE the spawn or the goal, only relocate them', () => {
    // This is what makes "found 0 spawn markers" unreachable from a paint, and
    // leaves exactly one reachable error in validateLevel's whole list.
    const grid = g();
    expect(grid.paint(2, 1, '#')).toBe(false);
    expect(grid.charAt(2, 1)).toBe('S');
    expect(grid.paint(7, 1, '.')).toBe(false);
    expect(grid.charAt(7, 1)).toBe('G');
  });

  it('will not drop the spawn on top of the goal either', () => {
    // Same rule from the other side. Landing one singleton on the other would
    // delete the other, which is a level with no goal.
    const grid = g();
    expect(grid.paint(7, 1, 'S')).toBe(false);
    expect(grid.charAt(7, 1)).toBe('G');
    expect(grid.charAt(2, 1)).toBe('S');
    expect(validateLevel(grid.rows)).toEqual([]);
  });

  it('erase is paint with a dot, and cannot go ragged', () => {
    const grid = g();
    stroke(
      grid,
      [
        [2, 2],
        [3, 2],
        [4, 2],
      ],
      '.',
    );
    expect(grid.rows[2]).toBe('.......##.');
    for (const row of grid.rows) {
      expect(row).toHaveLength(grid.w);
    }
  });
});

describe('the undo stack', () => {
  it('ONE Ctrl+Z UNDOES A WHOLE STROKE', () => {
    // Against a per-cell snapshot this takes twenty undos, so the assertion
    // fails with nineteen cells still painted. That is the prediction.
    const grid = g();
    const before = grid.rows;
    const cells: [number, number][] = Array.from({ length: 20 }, (_, i) => [i % 10, i < 10 ? 0 : 3]);
    stroke(grid, cells, '#');
    expect(grid.rows).not.toEqual(before);
    expect(grid.undoDepth).toBe(1);
    expect(grid.undo()).toBe(true);
    expect(grid.rows).toEqual(before);
  });

  it('A NO-OP STROKE PUSHES NOTHING, and undo still reaches past it', () => {
    // The half of the rule a stack-depth assertion alone would miss: dragging
    // across cells that already hold the selected character must not fill the
    // stack with identical snapshots.
    const grid = g();
    const original = grid.rows;
    stroke(
      grid,
      [
        [0, 0],
        [1, 0],
      ],
      '#',
    ); // a real edit
    const afterReal = grid.rows;
    expect(grid.undoDepth).toBe(1);

    stroke(
      grid,
      [
        [0, 0],
        [1, 0],
      ],
      '#',
    ); // the same cells, already '#'
    expect(grid.undoDepth).toBe(1);
    expect(grid.rows).toEqual(afterReal);

    expect(grid.undo()).toBe(true);
    expect(grid.rows).toEqual(original);
  });

  it('a stroke that changes one cell of twenty still pushes exactly one', () => {
    const grid = g();
    grid.beginStroke();
    for (let tx = 0; tx < 10; tx++) {
      grid.paint(tx, 4, '#'); // row 4 is already solid...
    }
    grid.paint(0, 0, '#'); // ...except this one cell, which is not
    grid.endStroke();
    expect(grid.undoDepth).toBe(1);
  });

  it('redo replays, and ANY NEW EDIT CLEARS IT', () => {
    const grid = g();
    stroke(grid, [[0, 0]], '#');
    const painted = grid.rows;
    grid.undo();
    expect(grid.redoDepth).toBe(1);
    expect(grid.redo()).toBe(true);
    expect(grid.rows).toEqual(painted);

    grid.undo();
    expect(grid.redoDepth).toBe(1);
    stroke(grid, [[9, 0]], '#'); // a different edit from the undone state
    expect(grid.redoDepth).toBe(0);
    expect(grid.redo()).toBe(false);
  });

  it('undo and redo on an untouched grid are no-ops, not crashes', () => {
    const grid = g();
    expect(grid.undo()).toBe(false);
    expect(grid.redo()).toBe(false);
    expect(grid.rows).toEqual(STAGE);
  });

  it('is bounded at EDITOR_UNDO_MAX, dropping the OLDEST', () => {
    const grid = new EditorGrid(blankRows(EDITOR_UNDO_MAX + 20, 3));
    for (let i = 0; i < EDITOR_UNDO_MAX + 10; i++) {
      stroke(grid, [[i, 0]], '#');
    }
    expect(grid.undoDepth).toBe(EDITOR_UNDO_MAX);
    for (let i = 0; i < EDITOR_UNDO_MAX; i++) {
      grid.undo();
    }
    expect(grid.undo()).toBe(false);
    // The ten oldest edits are gone, so the grid does NOT come back blank.
    expect(grid.rows[0].startsWith('##########')).toBe(true);
  });
});

describe('flood fill', () => {
  const ROOM: readonly string[] = ['#####', '#S..#', '#.#.#', '#..G#', '#####'];

  it('fills the 4-connected region of equal character', () => {
    const grid = new EditorGrid(ROOM);
    grid.flood(2, 1, '#');
    expect(grid.charAt(2, 1)).toBe('#');
    expect(grid.charAt(3, 1)).toBe('#');
    expect(grid.charAt(3, 2)).toBe('#');
    // S, G and the wall are different characters, so they bound the region --
    // and the dots on the far side of the S are a separate region entirely.
    expect(grid.charAt(1, 1)).toBe('S');
    expect(grid.charAt(3, 3)).toBe('G');
    expect(grid.charAt(1, 2)).toBe('.');
  });

  it('is 4-connected, not 8-connected', () => {
    const grid = new EditorGrid(['.#.', '#.#', '.#.']);
    grid.flood(1, 1, '^');
    expect(grid.charAt(1, 1)).toBe('^');
    expect(grid.charAt(0, 0)).toBe('.'); // diagonal, so out of the region
    expect(grid.charAt(2, 2)).toBe('.');
  });

  it('is one undo step, and a fill onto its own character does nothing', () => {
    const grid = new EditorGrid(ROOM);
    const before = grid.rows;
    grid.flood(2, 1, '#');
    expect(grid.undoDepth).toBe(1);
    grid.undo();
    expect(grid.rows).toEqual(before);

    grid.flood(0, 0, '#'); // the wall, already '#'
    expect(grid.undoDepth).toBe(0);
  });

  it('flooding WITH S or G places one, never a region of them', () => {
    // The singleton rule outranks the fill: a flood of spawns is not a level.
    const grid = new EditorGrid(ROOM);
    grid.flood(2, 1, 'S');
    expect(grid.rows.join('').split('S')).toHaveLength(2);
    expect(validateLevel(grid.rows)).toEqual([]);
  });

  it('flooding a region that starts ON the spawn refuses, rather than erasing it', () => {
    const grid = new EditorGrid(ROOM);
    const before = grid.rows;
    grid.flood(1, 1, '#');
    expect(grid.rows).toEqual(before);
    expect(grid.undoDepth).toBe(0);
  });

  it('ignores a flood outside the grid', () => {
    const grid = new EditorGrid(ROOM);
    expect(() => grid.flood(-1, 99, '#')).not.toThrow();
    expect(grid.rows).toEqual(ROOM);
  });
});

describe('resizing', () => {
  it('A RESIZE FROM THE LEFT CARRIES THE SPAWN AND THE GOAL WITH IT', () => {
    // Free under this model, because S and G are characters in the rows being
    // shifted. Under a TileMap-plus-coordinates model they are two pairs that
    // have to be fixed up by hand at every edge, and the one that gets
    // forgotten is the one nobody notices until a level spawns you in a wall.
    const grid = g();
    grid.resize('left', 2);
    expect(grid.w).toBe(12);
    expect(grid.charAt(4, 1)).toBe('S'); // was column 2
    expect(grid.charAt(9, 1)).toBe('G'); // was column 7
    expect(grid.charAt(7, 3)).toBe('^'); // and the pad too
    expect(validateLevel(grid.rows)).toEqual([]);
  });

  it('a resize from the top carries them down', () => {
    const grid = g();
    grid.resize('top', 3);
    expect(grid.h).toBe(8);
    expect(grid.charAt(2, 4)).toBe('S');
    expect(grid.rows[0]).toBe('.'.repeat(10));
  });

  it('growing right and bottom appends empty, leaving everything where it was', () => {
    const grid = g();
    grid.resize('right', 4);
    grid.resize('bottom', 1);
    expect(grid.w).toBe(14);
    expect(grid.h).toBe(6);
    expect(grid.charAt(2, 1)).toBe('S');
    expect(grid.rows[5]).toBe('.'.repeat(14));
    expect(grid.rows[0]).toBe('.'.repeat(14));
  });

  it('shrinking crops from the named edge', () => {
    const grid = g();
    grid.resize('right', -2);
    expect(grid.w).toBe(8);
    expect(grid.rows[4]).toBe('########');
    expect(validateLevel(grid.rows)).toEqual([]);
  });

  it('A CROP THAT LOSES THE SPAWN IS AN ERROR — reported, not prevented', () => {
    // The ONE reachable member of validateLevel's error list, and therefore
    // the whole reason the panel exists.
    const grid = g();
    grid.resize('left', -3); // columns 0..2 go, and the S is at column 2
    expect(grid.charAt(0, 1)).toBe('.');
    const errors = validateLevel(grid.rows);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('found 0 spawn markers');
    // Still a rectangle: it is a CONTENT error, which is exactly why the
    // editor can show it and carry on rather than having to refuse the resize.
    for (const row of grid.rows) {
      expect(row).toHaveLength(grid.w);
    }
  });

  it('clamps at the size cap rather than refusing outright', () => {
    const grid = new EditorGrid(blankRows(EDITOR_MAX_W - 1, EDITOR_MAX_H - 1));
    grid.resize('right', 10);
    expect(grid.w).toBe(EDITOR_MAX_W);
    grid.resize('bottom', 10);
    expect(grid.h).toBe(EDITOR_MAX_H);
    // Already at the cap: nothing changes, and nothing is pushed onto undo.
    const depth = grid.undoDepth;
    grid.resize('right', 5);
    expect(grid.w).toBe(EDITOR_MAX_W);
    expect(grid.undoDepth).toBe(depth);
  });

  it('never shrinks below a single row or column', () => {
    const grid = new EditorGrid(blankRows(3, 3));
    grid.resize('left', -99);
    grid.resize('top', -99);
    expect(grid.w).toBe(1);
    expect(grid.h).toBe(1);
  });

  it('is one undo step whichever edge moved', () => {
    const grid = g();
    const before = grid.rows;
    grid.resize('left', 2);
    grid.resize('top', 2);
    expect(grid.undoDepth).toBe(2);
    grid.undo();
    grid.undo();
    expect(grid.rows).toEqual(before);
  });

  it('a zero-delta resize is not an edit', () => {
    const grid = g();
    grid.resize('left', 0);
    expect(grid.undoDepth).toBe(0);
  });
});

describe('gridWarnings', () => {
  it('THE DOWN-PAD TRAP IS A WARNING AND NOT AN ERROR', () => {
    // A pad whose facing points into its own geometry re-fires every step and
    // pins the body. The grid is well-formed, parseLevel must accept it, and
    // src/levels/index.ts throws on anything validateLevel rejects -- so
    // promoting a level-design footgun to a format error would make a shipped
    // level a build failure. All three assertions, because that is the failure
    // mode: a warning that quietly became a build break.
    const rows = ['..........', '..S....G..', '....v.....', '##########'];
    const warnings = gridWarnings(rows);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('row 2');
    expect(warnings[0]).toContain('column 4');
    expect(validateLevel(rows)).toEqual([]);
    expect(parseLevel({ id: 'x', name: 'X', rows }).ok).toBe(true);
  });

  it('catches all four facings, including into the sealed sides', () => {
    // The left and right edges read as Solid out of bounds, so a pad on the
    // border facing outward fires into a wall exactly like an interior one.
    expect(gridWarnings(['........', '<S....G>', '########'])).toHaveLength(2);

    const up = gridWarnings(['..####..', '..^.....', '.S....G.', '########']);
    expect(up).toHaveLength(1);
    expect(up[0]).toContain('column 2');

    const down = gridWarnings(['........', '.S....G.', '..v.....', '..####..', '########']);
    expect(down).toHaveLength(1);
  });

  it('says nothing about a pad with somewhere to fire', () => {
    expect(gridWarnings(['..........', '..S....G..', '....^.....'])).toEqual([]);
    expect(gridWarnings(['..........', '..S....G..', '####^#####', '..........'])).toEqual([]);
  });

  it('warns when the spawn or the goal sits on a death plane', () => {
    // The top and bottom rows read as Empty out of bounds, so both are lethal.
    const top = gridWarnings(['..S....G..', '##########', '..........']);
    expect(top).toHaveLength(2);
    expect(top.join(' ')).toContain('top row');
    const bottom = gridWarnings(['..........', '##########', '..S....G..']);
    expect(bottom.join(' ')).toContain('bottom row');
  });

  it('warns when the spawn is walled in on every side', () => {
    // "Inside a solid tile" is unrepresentable -- S IS the cell -- so the
    // reachable version of that mistake is a marker with nowhere to go.
    const rows = ['.....', '..#..', '.#S#.', '..#..', '..G..'];
    expect(gridWarnings(rows).join(' ')).toContain('enclosed');
  });

  it('is silent on a level with nothing wrong with it', () => {
    expect(gridWarnings(STAGE)).toEqual([]);
  });

  it('never throws on a grid that validateLevel would reject', () => {
    // It runs beside validateLevel on every keystroke, not after it, so it has
    // to survive a ragged or spawn-less grid rather than assuming one.
    expect(() => gridWarnings([])).not.toThrow();
    expect(() => gridWarnings(['###', '#'])).not.toThrow();
    expect(() => gridWarnings(['....'])).not.toThrow();
  });
});

describe('the round trip that everything else rests on', () => {
  it('what the editor holds is what parseLevel accepts', () => {
    const grid = g();
    grid.paint(5, 0, '#');
    grid.resize('left', 1);
    const res = parseLevel({ id: 'round-trip', name: 'ROUND TRIP', rows: grid.rows });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.level.map.w).toBe(grid.w);
      expect(res.level.map.h).toBe(grid.h);
      expect(res.level.spawn).toEqual({ tx: 3, ty: 1 });
    }
  });

  it('rows are a snapshot: mutating what you got back cannot reach the grid', () => {
    const grid = g();
    const rows = grid.rows as string[];
    rows[0] = 'XXXXXXXXXX';
    expect(grid.rows[0]).toBe('..........');
  });
});

describe('forEachCharRun', () => {
  it('merges equal characters into one run, and skips empty', () => {
    const runs: [number, number, number, string][] = [];
    forEachCharRun(['..###.^^..'], 0, 0, 9, 0, (tx, ty, len, ch) => runs.push([tx, ty, len, ch]));
    expect(runs).toEqual([
      [2, 0, 3, '#'],
      [6, 0, 2, '^'],
    ]);
  });

  it('DOES NOT merge different characters, so a pad never joins its floor', () => {
    // The same rule forEachRun has, and for the same reason: a merged pad would
    // draw as plain floor and lose its chevron.
    const runs: string[] = [];
    forEachCharRun(['###^###'], 0, 0, 6, 0, (tx, _ty, len, ch) => runs.push(`${ch}x${len}@${tx}`));
    expect(runs).toEqual(['#x3@0', '^x1@3', '#x3@4']);
  });

  it('CLIPS runs to the window rather than to the grid', () => {
    // Emitting off-screen geometry is the cost this function exists to avoid.
    const runs: [number, number][] = [];
    forEachCharRun(['##########'], 3, 0, 6, 0, (tx, _ty, len) => runs.push([tx, len]));
    expect(runs).toEqual([[3, 4]]);
  });

  it('intersects the window with the grid, and never invents a run off it', () => {
    const runs: unknown[] = [];
    forEachCharRun(['###'], -50, -50, 500, 500, (tx, ty, len) => runs.push([tx, ty, len]));
    expect(runs).toEqual([[0, 0, 3]]);
    forEachCharRun([], 0, 0, 9, 9, () => runs.push('never'));
    forEachCharRun(['###'], 10, 0, 20, 0, () => runs.push('never'));
    forEachCharRun(['###'], 0, 5, 2, 9, () => runs.push('never'));
    expect(runs).toHaveLength(1);
  });

  it('floors fractional bounds instead of trusting the caller', () => {
    // The editor passes `panX / cell`, which is fractional whenever the view is
    // mid-pan — and a fractional bound would emit runs at fractional columns.
    const runs: [number, number][] = [];
    forEachCharRun(['.####.'], 1.7, 0.4, 4.2, 0.9, (tx, _ty, len) => runs.push([tx, len]));
    expect(runs).toEqual([[1, 4]]);
  });

  it('turns the worst case from 2040 callbacks into 34', () => {
    // The measured overrun and its fix, as an assertion: 60 x 34 visible cells
    // of solid is one run per row, not one per cell.
    const rows = Array.from({ length: 34 }, () => '#'.repeat(60));
    let calls = 0;
    forEachCharRun(rows, 0, 0, 59, 33, () => calls++);
    expect(calls).toBe(34);
  });
});

describe('setting an absolute size', () => {
  // The delta resize is the right verb for nudging an edge and the wrong one
  // for authoring: reaching EDITOR_MAX_W from the default is 160 keypresses.
  // `setSize` is the same edit expressed as a destination, and it has to agree
  // with `resize` cell for cell or the editor has two different resizes.

  it('grows right and down, leaving the existing content where it was', () => {
    const grid = g();
    expect(grid.setSize(14, 8)).toBe(true);
    expect(grid.w).toBe(14);
    expect(grid.h).toBe(8);
    expect(grid.charAt(2, 1)).toBe('S');
    expect(grid.charAt(7, 1)).toBe('G');
    expect(grid.rows[7]).toBe('.'.repeat(14));
    expect(validateLevel(grid.rows)).toEqual([]);
  });

  it('crops from the right and the bottom', () => {
    const grid = g();
    expect(grid.setSize(8, 3)).toBe(true);
    expect(grid.w).toBe(8);
    expect(grid.h).toBe(3);
    for (const row of grid.rows) {
      expect(row).toHaveLength(8);
    }
  });

  it('agrees with the equivalent pair of delta resizes', () => {
    const viaDelta = g();
    viaDelta.resize('right', 5);
    viaDelta.resize('bottom', -2);
    const viaSize = g();
    viaSize.setSize(15, 3);
    expect(viaSize.rows).toEqual(viaDelta.rows);
  });

  it('is ONE undo step, not two, however many axes moved', () => {
    // The whole point of the destination form: growing wider and shorter in one
    // command must not cost two Ctrl+Z to take back.
    const grid = g();
    const before = grid.rows;
    grid.setSize(20, 4);
    expect(grid.undoDepth).toBe(1);
    grid.undo();
    expect(grid.rows).toEqual(before);
  });

  it('clamps to the caps and to a single row or column', () => {
    const grid = g();
    grid.setSize(EDITOR_MAX_W + 50, EDITOR_MAX_H + 50);
    expect(grid.w).toBe(EDITOR_MAX_W);
    expect(grid.h).toBe(EDITOR_MAX_H);
    grid.setSize(0, -4);
    expect(grid.w).toBe(1);
    expect(grid.h).toBe(1);
  });

  it('reports a size that is already the current one as no edit at all', () => {
    const grid = g();
    expect(grid.setSize(grid.w, grid.h)).toBe(false);
    expect(grid.undoDepth).toBe(0);
  });

  it('refuses a non-finite or fractional size rather than producing a ragged grid', () => {
    const grid = g();
    expect(grid.setSize(Number.NaN, 5)).toBe(false);
    expect(grid.setSize(10, Number.POSITIVE_INFINITY)).toBe(false);
    expect(grid.w).toBe(10);
    expect(grid.h).toBe(5);
    // Fractional is floored, not refused: it is a real destination.
    expect(grid.setSize(12.9, 6.2)).toBe(true);
    expect(grid.w).toBe(12);
    expect(grid.h).toBe(6);
  });

  it('a crop that loses a marker is reported, not prevented — same as a delta resize', () => {
    const grid = g();
    grid.setSize(2, 5);
    const errors = validateLevel(grid.rows);
    expect(errors.some((e) => e.includes('found 0 goal markers'))).toBe(true);
  });
});

describe('parsing a typed size', () => {
  // The editor's size field. Pure, so the scene owns no parsing of its own.

  it('reads the W X H the status line prints', () => {
    expect(parseSizeInput('60X20')).toEqual({ w: 60, h: 20 });
  });

  it('accepts the separators an author will actually type', () => {
    for (const text of ['60x20', '60 X 20', '60*20', '60,20', ' 60 20 ']) {
      expect(parseSizeInput(text)).toEqual({ w: 60, h: 20 });
    }
  });

  it('rejects anything that is not two whole numbers', () => {
    for (const text of ['', '60', 'X', '60X', 'AXB', '60X20X5', '-6X20', '6.5X20']) {
      expect(parseSizeInput(text)).toBeNull();
    }
  });
});

describe('rectangle fill', () => {
  const ROOM: readonly string[] = ['#####', '#S..#', '#...#', '#..G#', '#####'];

  it('fills the whole rectangle, both corners INCLUSIVE', () => {
    const grid = new EditorGrid(ROOM);
    expect(grid.fillRect(1, 1, 2, 2, '^')).toBe(true);
    expect(grid.rows[1]).toBe('#S^.#'); // the S is untouched; (2,1) filled
    expect(grid.rows[2]).toBe('#^^.#');
    expect(grid.rows[3]).toBe('#..G#'); // row 3 is outside the rectangle
  });

  it('normalises a drag made in any direction', () => {
    // The anchor is wherever the pointer went down, so three of the four drags
    // an author can make arrive with a corner reversed.
    const rows = ['.....', '.....', '.....'];
    const filled = ['.....', '.###.', '.###.'];
    for (const [x0, y0, x1, y1] of [
      [1, 1, 3, 2],
      [3, 2, 1, 1],
      [1, 2, 3, 1],
      [3, 1, 1, 2],
    ] as const) {
      const grid = new EditorGrid(rows);
      grid.fillRect(x0, y0, x1, y1, '#');
      expect(grid.rows).toEqual(filled);
    }
  });

  it('clips to the grid rather than refusing, so a drag off the edge still fills', () => {
    const grid = new EditorGrid(['...', '...']);
    expect(grid.fillRect(-4, -4, 1, 0, '#')).toBe(true);
    expect(grid.rows).toEqual(['##.', '...']);
    expect(() => grid.fillRect(50, 50, 99, 99, '#')).not.toThrow();
  });

  it('is ONE undo step for the whole rectangle', () => {
    const grid = new EditorGrid(ROOM);
    const before = grid.rows;
    grid.fillRect(1, 1, 3, 3, '#');
    expect(grid.undoDepth).toBe(1);
    grid.undo();
    expect(grid.rows).toEqual(before);
  });

  it('a rectangle that changes nothing pushes nothing', () => {
    const grid = new EditorGrid(ROOM);
    expect(grid.fillRect(0, 0, 4, 0, '#')).toBe(false); // the top wall, already #
    expect(grid.undoDepth).toBe(0);
  });

  it('paints AROUND the markers, and never over them', () => {
    const grid = new EditorGrid(ROOM);
    grid.fillRect(0, 0, 4, 4, '#');
    expect(grid.charAt(1, 1)).toBe('S');
    expect(grid.charAt(3, 3)).toBe('G');
    expect(validateLevel(grid.rows)).toEqual([]);
  });

  it('filling WITH S or G places exactly one, at the anchor corner', () => {
    // The singleton rule outranks the rectangle, exactly as it outranks a flood.
    const grid = new EditorGrid(ROOM);
    grid.fillRect(3, 2, 1, 2, 'S');
    expect(grid.rows.join('').split('S')).toHaveLength(2);
    expect(grid.charAt(3, 2)).toBe('S'); // the anchor, not the normalised corner
    expect(grid.charAt(1, 1)).toBe('.'); // the old spawn, moved rather than copied
    expect(validateLevel(grid.rows)).toEqual([]);
  });

  it('erases a rectangle when the character is the empty one', () => {
    const grid = new EditorGrid(ROOM);
    grid.fillRect(0, 4, 4, 4, '.');
    expect(grid.rows[4]).toBe('.....');
  });

  it('refuses a character that is not in the palette', () => {
    const grid = new EditorGrid(ROOM);
    expect(grid.fillRect(1, 1, 2, 2, 'x')).toBe(false);
    expect(grid.rows).toEqual(ROOM);
  });
});

describe('moving a region', () => {
  const ROOM: readonly string[] = ['.....', '.##..', '.##..', '.....', '#####'];

  it('lifts the region and stamps it at the offset, leaving empty behind', () => {
    const grid = new EditorGrid(ROOM);
    expect(grid.moveRect(1, 1, 2, 2, 2, 1)).toBe(true);
    expect(grid.rows).toEqual(['.....', '.....', '...##', '...##', '#####']);
  });

  it('lifts BEFORE it stamps, so an overlapping move does not copy itself', () => {
    const grid = new EditorGrid(ROOM);
    grid.moveRect(1, 1, 2, 2, 1, 0);
    expect(grid.rows).toEqual(['.....', '..##.', '..##.', '.....', '#####']);
  });

  it('is one undo step, and a zero offset changes nothing', () => {
    const grid = new EditorGrid(ROOM);
    const before = grid.rows;
    grid.moveRect(1, 1, 2, 2, 2, 1);
    expect(grid.undoDepth).toBe(1);
    grid.undo();
    expect(grid.rows).toEqual(before);

    expect(grid.moveRect(1, 1, 2, 2, 0, 0)).toBe(false);
    expect(grid.undoDepth).toBe(0);
  });

  it('CARRIES THE MARKERS: a region holding the spawn moves it', () => {
    const grid = new EditorGrid(['....G', '.S#..', '.....', '#####']);
    grid.moveRect(1, 1, 2, 1, 2, 1);
    expect(grid.rows).toEqual(['....G', '.....', '...S#', '#####']);
    expect(validateLevel(grid.rows)).toEqual([]);
  });

  it('drops whatever lands off the grid rather than wrapping it', () => {
    const grid = new EditorGrid(['.....', '.##..', '.....']);
    grid.moveRect(1, 1, 2, 1, -2, 0);
    expect(grid.rows).toEqual(['.....', '#....', '.....']);
  });

  it('does not stamp over a marker that stayed put', () => {
    // The moved block is lifted first, so the only markers left to protect are
    // the ones outside it — and those outrank the stamp, like every other paint.
    const grid = new EditorGrid(['.....', '.##S.', 'G....', '#####']);
    grid.moveRect(1, 1, 2, 1, 1, 0);
    expect(grid.charAt(3, 1)).toBe('S');
    expect(grid.rows[1]).toBe('..#S.');
    expect(validateLevel(grid.rows)).toEqual([]);
  });

  it('normalises the rectangle and clips it, like a fill does', () => {
    const grid = new EditorGrid(ROOM);
    grid.moveRect(2, 2, 1, 1, 0, 1); // corners reversed
    expect(grid.rows).toEqual(['.....', '.....', '.##..', '.##..', '#####']);
  });
});

describe('pickups in the grid model', () => {
  it('paints like any ordinary character — there is no singleton rule', () => {
    const grid = new EditorGrid(['....', '.SG.', '####']);
    expect(grid.paint(0, 0, 'o')).toBe(true);
    expect(grid.paint(1, 0, 'o')).toBe(true);
    expect(grid.rows[0]).toBe('oo..');
    expect(validateLevel(grid.rows)).toEqual([]);
  });

  it('IS NOT GEOMETRY: a pad firing into one is not firing into a wall', () => {
    // The warning exists because a pad firing into blocking geometry re-fires
    // every step and pins the body. A pickup blocks nothing, so a pad pointed
    // at one is a pad pointed at open air with something to collect in it —
    // which is a line an author draws on purpose.
    expect(gridWarnings(['.o..', '.^..', 'S..G', '####'])).toEqual([]);
    expect(gridWarnings(['.#..', '.^..', 'S..G', '####'])).toHaveLength(1);
  });

  it('does not enclose a marker either', () => {
    expect(gridWarnings(['.o..', 'oSo.', '.o.G', '####'])).toEqual([]);
  });
});

describe('a move that would destroy a marker', () => {
  it('IS REFUSED WHOLE when a marker would land off the grid', () => {
    // The lift erases and the stamp can refuse, so without this the one thing
    // the character model promises — a marker can be relocated but never
    // destroyed — is one drag away from being false.
    const grid = new EditorGrid(['.....', '.S#..', '...G.', '#####']);
    const before = grid.rows;
    expect(grid.moveRect(1, 1, 2, 1, -3, 0)).toBe(false);
    expect(grid.rows).toEqual(before);
    expect(grid.undoDepth).toBe(0);
    expect(validateLevel(grid.rows)).toEqual([]);
  });

  it('IS REFUSED WHOLE when a marker would land on the other marker', () => {
    const grid = new EditorGrid(['.....', '.S.G.', '.....', '#####']);
    const before = grid.rows;
    expect(grid.moveRect(1, 1, 1, 1, 2, 0)).toBe(false);
    expect(grid.rows).toEqual(before);
    expect(validateLevel(grid.rows)).toEqual([]);
  });

  it('still moves a marker onto a cell the SELECTION itself vacated', () => {
    // The destination is judged after the lift, not before it, so sliding a
    // region along by one is not a collision with its own old contents.
    const grid = new EditorGrid(['.....', '.SG..', '.....', '#####']);
    expect(grid.moveRect(1, 1, 2, 1, 1, 0)).toBe(true);
    expect(grid.rows[1]).toBe('..SG.');
  });

  it('drops an ordinary character off the edge, as before', () => {
    const grid = new EditorGrid(['.....', '.##..', '..S.G', '#####']);
    expect(grid.moveRect(1, 1, 2, 1, -2, 0)).toBe(true);
    expect(grid.rows[1]).toBe('#....');
  });
});

