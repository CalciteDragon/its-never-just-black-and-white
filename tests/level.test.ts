import { describe, expect, it } from 'vitest';
import { TILE } from '../src/constants';
import { levelRows, parseLevel, serializeLevel, validateLevel } from '../src/world/level';
import type { Level } from '../src/world/level';
import { Tile } from '../src/world/tiles';

/**
 * One grid holding every feature the format has: solid, empty, all four pad
 * kinds, S and G — and pads on two different rows, so ordering claims are
 * testable. 9 x 4.
 */
const ROWS: readonly string[] = [
  '..S...G..',
  '.^.v.<.>.',
  '.....>...',
  '#########',
];

const RAW = { id: '01-first-steps', name: 'FIRST STEPS', rows: [...ROWS] };

function parseOrFail(raw: unknown): Level {
  const result = parseLevel(raw);
  if (!result.ok) {
    // A failed parse in a test that assumes success is otherwise reported as
    // "cannot read property of undefined" three lines later.
    throw new Error(`expected a valid level, got: ${result.errors.join(' | ')}`);
  }
  return result.level;
}

/** The errors of a parse that is expected to fail; fails loudly if it didn't. */
function errorsOf(raw: unknown): string[] {
  const result = parseLevel(raw);
  if (result.ok) {
    throw new Error('expected the parse to fail, but it succeeded');
  }
  return result.errors;
}

describe('parseLevel on a valid level', () => {
  it('derives the grid size from rows, with no width or height in the file', () => {
    const level = parseOrFail(RAW);
    expect(level.map.w).toBe(9);
    expect(level.map.h).toBe(4);
    expect(level.id).toBe('01-first-steps');
    expect(level.name).toBe('FIRST STEPS');
  });

  it('lands every character in its own cell', () => {
    const level = parseOrFail(RAW);
    expect(level.map.get(0, 3)).toBe(Tile.Solid);
    expect(level.map.get(8, 3)).toBe(Tile.Solid);
    expect(level.map.get(1, 1)).toBe(Tile.PadUp);
    expect(level.map.get(3, 1)).toBe(Tile.PadDown);
    expect(level.map.get(5, 1)).toBe(Tile.PadLeft);
    expect(level.map.get(7, 1)).toBe(Tile.PadRight);
    expect(level.map.get(0, 0)).toBe(Tile.Empty);
    expect(level.map.get(4, 2)).toBe(Tile.Empty);
  });

  it('reads S and G as tile coordinates', () => {
    const level = parseOrFail(RAW);
    expect(level.spawn).toEqual({ tx: 2, ty: 0 });
    expect(level.goal).toEqual({ tx: 6, ty: 0 });
  });

  it('leaves the S and G cells empty, because they are metadata and not tiles', () => {
    // The enum has six values and never grows: a marker is a note about an
    // empty cell. If either read as anything else, the solver would collide
    // with the spawn point.
    const level = parseOrFail(RAW);
    expect(level.map.get(level.spawn.tx, level.spawn.ty)).toBe(Tile.Empty);
    expect(level.map.get(level.goal.tx, level.goal.ty)).toBe(Tile.Empty);
  });

  it('lists every pad once, in row-major order', () => {
    // The list exists so phase 6's chevron emitters never rescan the grid; the
    // order is asserted because "row-major" is the documented contract, and the
    // last entry is on a later row than the four before it precisely to prove
    // rows are the outer loop.
    const level = parseOrFail(RAW);
    expect(level.pads).toEqual([
      { tx: 1, ty: 1, tile: Tile.PadUp },
      { tx: 3, ty: 1, tile: Tile.PadDown },
      { tx: 5, ty: 1, tile: Tile.PadLeft },
      { tx: 7, ty: 1, tile: Tile.PadRight },
      { tx: 5, ty: 2, tile: Tile.PadRight },
    ]);
  });

  it('lists no pads for a grid without any', () => {
    const level = parseOrFail({ id: 'a', name: 'A', rows: ['.S.G.', '#####'] });
    expect(level.pads).toEqual([]);
  });
});

describe('parseLevel on things that are not a level', () => {
  it('rejects a non-object without throwing', () => {
    for (const raw of [null, 42, 'a level', [], ['..S..']]) {
      const errors = errorsOf(raw);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('JSON object');
    }
  });

  it('rejects a missing, blank or non-string id', () => {
    for (const id of [undefined, '', '   ', 42, null]) {
      const errors = errorsOf({ ...RAW, id });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('id is missing or not a non-empty string');
      expect(errors[0]).toContain('best-time save key');
    }
  });

  it('rejects a missing, blank or non-string name', () => {
    for (const name of [undefined, '', '  ', 42, null]) {
      const errors = errorsOf({ ...RAW, name });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('name is missing or not a non-empty string');
    }
  });

  it('reports metadata and grid problems in the same list', () => {
    // The editor shows the list verbatim, so stopping at the first problem
    // would mean fixing a level one round trip at a time.
    const errors = errorsOf({ rows: ['..S..', '.....'] });
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('id is missing');
    expect(errors[1]).toContain('name is missing');
    expect(errors[2]).toContain('goal markers');
  });

  it('never throws, whatever it is fed', () => {
    for (const raw of [undefined, null, 0, NaN, true, 'x', [], [[]], {}, { rows: {} }]) {
      expect(() => parseLevel(raw)).not.toThrow();
      expect(parseLevel(raw).ok).toBe(false);
    }
  });
});

describe('validateLevel: the rows array itself', () => {
  it('accepts a valid grid with no errors at all', () => {
    expect(validateLevel(ROWS)).toEqual([]);
  });

  it('names rows as missing when it is absent or null', () => {
    for (const rows of [undefined, null]) {
      const errors = validateLevel(rows);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('rows is missing');
    }
  });

  it('reports what rows actually is when it is not an array', () => {
    // A bare "rows must be an array" leaves an author who wrote `"rows": "..."`
    // staring at something that looks like rows to them.
    expect(validateLevel(42)).toEqual([
      'rows must be an array of strings, but its type is number.',
    ]);
    expect(validateLevel('..S..')).toEqual([
      'rows must be an array of strings, but its type is string.',
    ]);
    expect(validateLevel({})).toEqual([
      'rows must be an array of strings, but its type is object.',
    ]);
  });

  it('reports an empty rows array as its own problem', () => {
    const errors = validateLevel([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('rows is empty');
  });

  it('never throws, including on an array of non-strings', () => {
    for (const rows of [null, 42, [], [1, 2], [null], [['#']], undefined, true]) {
      expect(() => validateLevel(rows)).not.toThrow();
      expect(validateLevel(rows).length).toBeGreaterThan(0);
    }
  });
});

describe('validateLevel: grid shape', () => {
  it('names the row that is not a string, and what it is instead', () => {
    const errors = validateLevel(['#S#G', 42, '####']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^row 1 \(0-based\) is not a string/);
    expect(errors[0]).toContain('number');
  });

  it('reports every non-string row, not just the first', () => {
    const errors = validateLevel([1, 2]);
    // Two bad rows, plus the missing S and the missing G.
    expect(errors.filter((e) => e.includes('is not a string'))).toHaveLength(2);
    expect(errors[0]).toContain('row 0');
    expect(errors[1]).toContain('row 1');
  });

  it('rejects a zero-length row', () => {
    const errors = validateLevel(['#S#G', '', '####']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('row 1');
    expect(errors[0]).toContain('empty string');
  });

  it('reports both widths for a ragged row', () => {
    // Both, because "row 1 is the wrong width" leaves the author guessing
    // which of the two rows they actually mistyped.
    const errors = validateLevel(['#S#G', '.....', '####']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/row 1 \(0-based\) is 5 characters wide/);
    expect(errors[0]).toMatch(/row 0 is 4/);
  });

  it('reports each ragged row against row 0, not against its predecessor', () => {
    const errors = validateLevel(['#S#G', '.....', '......', '####']);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/row 1 .* is 5 characters wide, but row 0 is 4/);
    expect(errors[1]).toMatch(/row 2 .* is 6 characters wide, but row 0 is 4/);
  });
});

describe('validateLevel: grid content', () => {
  it('reports an unknown character with its row and column', () => {
    const errors = validateLevel(['..S..', '..x..', '..G..']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"x"');
    expect(errors[0]).toContain('row 1');
    expect(errors[0]).toContain('column 2');
    expect(errors[0]).toContain('0-based');
  });

  it('reports every unknown character, not just the first', () => {
    const errors = validateLevel(['..S..', 'q...z', '..G..']);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('column 0');
    expect(errors[1]).toContain('column 4');
  });

  it('counts the spawn markers and says how many it found', () => {
    // The count is the whole message: "expected exactly one S" does not tell
    // an author whether they forgot one or left two behind.
    expect(validateLevel(['.....', '..G..', '#####'])).toEqual([
      'found 0 spawn markers ("S"), expected exactly 1: mark the start tile with S.',
    ]);
    const two = validateLevel(['..S..', '..S..', '..G..']);
    expect(two).toHaveLength(1);
    expect(two[0]).toContain('found 2 spawn markers');
  });

  it('counts the goal markers and says how many it found', () => {
    const none = validateLevel(['..S..', '.....', '#####']);
    expect(none).toHaveLength(1);
    expect(none[0]).toContain('found 0 goal markers');
    const three = validateLevel(['..S..', 'G.G.G', '#####']);
    expect(three).toHaveLength(1);
    expect(three[0]).toContain('found 3 goal markers');
  });

  it('does not mistake a pad or a solid for an unknown character', () => {
    expect(validateLevel(['.^v<>#', '..S..G'])).toEqual([]);
  });
});

describe('validateLevel: several problems at once', () => {
  it('returns the whole list, shape before content', () => {
    const errors = validateLevel(['##..##', '#x#', '######']);
    expect(errors).toHaveLength(4);
    // Shape first: the ragged row explains why the column numbers below are
    // worth reading at all.
    expect(errors[0]).toMatch(/row 1 .* is 3 characters wide, but row 0 is 6/);
    expect(errors[1]).toContain('"x"');
    expect(errors[2]).toContain('found 0 spawn markers');
    expect(errors[3]).toContain('found 0 goal markers');
  });
});

describe('serializeLevel', () => {
  it('writes JSON text with one string per row, each of the grid width', () => {
    const level = parseOrFail(RAW);
    const text = serializeLevel(level);
    const file = JSON.parse(text) as { id: string; name: string; rows: string[] };
    expect(file.id).toBe('01-first-steps');
    expect(file.name).toBe('FIRST STEPS');
    expect(file.rows).toHaveLength(level.map.h);
    for (const row of file.rows) {
      expect(row).toHaveLength(level.map.w);
    }
    expect(file.rows).toEqual(ROWS);
  });

  it('paints S and G back over the grid', () => {
    // The map holds Tile.Empty at both, so the markers exist only in the
    // spawn/goal fields — serialising has to put them back or the level loses
    // its start and finish on the first save.
    const level = parseOrFail(RAW);
    const file = JSON.parse(serializeLevel(level)) as { rows: string[] };
    expect(file.rows[0][2]).toBe('S');
    expect(file.rows[0][6]).toBe('G');
  });

  it('is pretty-printed at 2 spaces with a trailing newline, so it diffs by row', () => {
    const text = serializeLevel(parseOrFail(RAW));
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "id": "01-first-steps"');
    expect(text).toContain('\n    "..S...G.."');
  });

  it('round-trips: parse(JSON.parse(serialize(level))) deep-equals the original', () => {
    // The property the phase 7 editor rests on — it edits a grid, saves it, and
    // expects to load back exactly what it was looking at. Covers all four pad
    // kinds, solid, empty, S and G in one pass.
    const level = parseOrFail(RAW);
    const again = parseOrFail(JSON.parse(serializeLevel(level)));
    expect(again).toEqual(level);
    expect(again.map.bytes()).toEqual(level.map.bytes());
    expect(serializeLevel(again)).toBe(serializeLevel(level));
  });
});

describe('levels of arbitrary size', () => {
  /**
   * Nothing in the format carries a width or a height — both are derived from
   * `rows` — so the only thing standing between a 3x3 and a 200x60 is that
   * every loop in here is written against `list.length` and `list[0].length`.
   * These pin that at both extremes, through the full parse → serialise →
   * parse cycle the editor's save/open round-trip actually performs.
   */

  /** One character replaced, so markers can be painted over a pattern. */
  function withCharAt(row: string, tx: number, ch: string): string {
    return row.slice(0, tx) + ch + row.slice(tx + 1);
  }

  /**
   * A deterministic grid of the requested size: solids and pads on two coprime
   * strides so neither degenerates into stripes, then S and G painted on top —
   * on top, because a marker sharing a cell with a solid is not a thing the
   * format can express and the round-trip would not survive it.
   */
  function gridOf(w: number, h: number): string[] {
    const rows: string[] = [];
    for (let ty = 0; ty < h; ty++) {
      const row: string[] = [];
      for (let tx = 0; tx < w; tx++) {
        if ((tx + ty) % 7 === 0) {
          row.push('#');
        } else if ((tx + 2 * ty) % 13 === 0) {
          row.push('^');
        } else {
          row.push('.');
        }
      }
      rows.push(row.join(''));
    }
    rows[0] = withCharAt(rows[0], 0, 'S');
    rows[h - 1] = withCharAt(rows[h - 1], w - 1, 'G');
    return rows;
  }

  /** parse → levelRows → parse → serialise, asserted at every hop. */
  function roundTrip(id: string, rows: readonly string[]): void {
    const level = parseOrFail({ id, name: 'ARBITRARY', rows: [...rows] });
    expect(level.map.h).toBe(rows.length);
    expect(level.map.w).toBe(rows[0].length);
    expect(level.map.widthPx).toBe(rows[0].length * TILE);
    expect(level.map.heightPx).toBe(rows.length * TILE);

    // The grid characters come back exactly as written, S and G included.
    expect(levelRows(level)).toEqual([...rows]);

    const again = parseOrFail(JSON.parse(serializeLevel(level)));
    expect(again).toEqual(level);
    expect(again.spawn).toEqual(level.spawn);
    expect(again.goal).toEqual(level.goal);
    expect(again.pads).toEqual(level.pads);
    expect(levelRows(again)).toEqual([...rows]);
  }

  it('parses and round-trips a 3x3 level', () => {
    const rows = ['S.G', '.^.', '###'];
    const level = parseOrFail({ id: 'tiny', name: 'TINY', rows: [...rows] });
    expect(level.map.w).toBe(3);
    expect(level.map.h).toBe(3);
    expect(level.spawn).toEqual({ tx: 0, ty: 0 });
    expect(level.goal).toEqual({ tx: 2, ty: 0 });
    expect(level.pads).toEqual([{ tx: 1, ty: 1, tile: Tile.PadUp }]);
    expect(level.map.get(0, 0)).toBe(Tile.Empty); // S is metadata
    expect(level.map.get(2, 0)).toBe(Tile.Empty); // and so is G
    roundTrip('tiny', rows);
  });

  it('parses and round-trips a 1x1 level — the smallest grid there is', () => {
    // One row, one character: it cannot hold both markers, so it cannot be a
    // level. What matters is that it fails on the marker count and not on the
    // size, i.e. nothing in here has a minimum-dimensions assumption.
    const errors = errorsOf({ id: 'dot', name: 'DOT', rows: ['S'] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('found 0 goal markers');

    // Two cells across is enough for a whole level, and it parses.
    roundTrip('two', ['SG']);
  });

  it('parses and round-trips a 200x60 level', () => {
    const rows = gridOf(200, 60);
    const level = parseOrFail({ id: 'huge', name: 'HUGE', rows: [...rows] });
    expect(level.map.w).toBe(200);
    expect(level.map.h).toBe(60);
    expect(level.spawn).toEqual({ tx: 0, ty: 0 });
    expect(level.goal).toEqual({ tx: 199, ty: 59 });
    expect(level.map.widthPx).toBe(200 * TILE);
    expect(level.map.heightPx).toBe(60 * TILE);
    // Enough pads that a row-major ordering claim is worth making at scale.
    expect(level.pads.length).toBeGreaterThan(100);
    for (let i = 1; i < level.pads.length; i++) {
      const prev = level.pads[i - 1];
      const cur = level.pads[i];
      expect(cur.ty > prev.ty || (cur.ty === prev.ty && cur.tx > prev.tx)).toBe(true);
    }
    roundTrip('huge', rows);
  });

  it('parses and round-trips lopsided grids in both directions', () => {
    // 200 x 3 and 3 x 200: width and height are read from different places, so
    // a swapped index survives a square grid and dies on these.
    roundTrip('wide', gridOf(200, 3));
    roundTrip('tall', gridOf(3, 200));
  });
});

describe('flip pickups', () => {
  const ROWS: readonly string[] = ['..........', '.S..o..oG.', '##########'];

  it('parses as metadata on an EMPTY cell, like the two markers', () => {
    const res = parseLevel({ id: 'p', name: 'P', rows: ROWS });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    // The tile enum does not grow: a pickup is not collidable, and a solver
    // that had to ask "but is this one blocking?" per tile is the version of
    // this feature that changes the physics.
    expect(res.level.map.get(4, 1)).toBe(Tile.Empty);
    expect(res.level.pickups).toEqual([
      { tx: 4, ty: 1 },
      { tx: 7, ty: 1 },
    ]);
  });

  it('is legal in any number, unlike S and G', () => {
    expect(validateLevel(['SG', 'oo'])).toEqual([]);
    expect(validateLevel(['SG', '..'])).toEqual([]);
  });

  it('round-trips through serialise and back', () => {
    const res = parseLevel({ id: 'p', name: 'P', rows: ROWS });
    if (!res.ok) {
      throw new Error(res.errors.join('; '));
    }
    expect(levelRows(res.level)).toEqual(ROWS);
    const again = parseLevel(JSON.parse(serializeLevel(res.level)));
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.level.pickups).toEqual(res.level.pickups);
    }
  });
});
