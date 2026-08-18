/**
 * The level format (GAME-DESIGN §8): `{ id, name, rows }`, where `rows` is the
 * whole level as one string per grid row and the width and height are derived
 * from it. Parse, validate, serialise. Pure and node-safe like the rest of
 * `world/` — the JSON arrives from an import, never from a fetch in here.
 *
 * Two shapes here differ from §12's first sketch, both for the same reason:
 * the contract was written before the consumers existed.
 *
 * **`Level` owns a `TileMap`, not a `Uint8Array`.** Every consumer downstream —
 * the solver's broadphase, `forEachRun`, the phase 7 editor — already takes a
 * `TileMap`, so a raw array would be re-wrapped at each use site, and the
 * stride and the seal-sides OOB rule of `tiles.ts` would then have to be agreed
 * independently in every one of them. Two agreements are one disagreement
 * waiting, and a disagreement about the OOB rule is a level whose walls leak.
 *
 * **`parseLevel` returns a discriminated union, not `Level | LevelError`.** An
 * untagged union of two object types cannot be narrowed in strict TS without a
 * hand-maintained type guard, and the caller that matters — the editor's
 * validation panel — wants the *whole* error list rather than the first thing
 * wrong. So `ok` is the discriminant, errors accumulate, and nothing here ever
 * throws: `parseLevel` is fed unvalidated JSON, and a level failing to load is
 * a message to show, not an exception to catch.
 *
 * `S` and `G` are metadata written onto an empty cell, not tile values. The
 * enum does not grow; the parsed map reads `Tile.Empty` at both.
 */

import { Tile, TileMap, charFromTile, isPad, tileFromChar } from './tiles';

/** A grid position in tile coordinates. */
export interface TilePos {
  readonly tx: number;
  readonly ty: number;
}

/** Where a pad is and which of the four it is. `padDirection` reads the kind. */
export interface PadRef {
  readonly tx: number;
  readonly ty: number;
  readonly tile: Tile;
}

export interface Level {
  readonly id: string;
  readonly name: string;
  readonly map: TileMap;
  readonly spawn: TilePos;
  readonly goal: TilePos;
  /**
   * Pad positions and kinds, kept as a list so phase 6's chevron emitters do
   * not rescan the grid every frame. Row-major order.
   */
  readonly pads: readonly PadRef[];
}

export type ParseResult = { ok: true; level: Level } | { ok: false; errors: string[] };

/** The two metadata markers. Both sit on a cell that parses as `Tile.Empty`. */
const SPAWN_CHAR = 'S';
const GOAL_CHAR = 'G';

/** Quoted verbatim in the unknown-character message, in §8's table order. */
const LEGAL_CHARS = '. # ^ v < > S G';

/** For error messages: `typeof` with the two cases it gets wrong spelled out. */
function typeName(v: unknown): string {
  if (v === null) {
    return 'null';
  }
  if (Array.isArray(v)) {
    return 'array';
  }
  return typeof v;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validates the grid alone — `id` and `name` are `parseLevel`'s business — and
 * returns EVERY problem it finds, empty when the grid is good. The phase 7
 * editor shows this list verbatim, so each message names the offending row and
 * column (0-based, and says so) and what would fix it.
 *
 * Never throws, for any input at all. It is called on `obj.rows` off freshly
 * parsed JSON, so `null`, a number and an array of numbers are all reachable.
 */
export function validateLevel(rows: unknown): string[] {
  if (rows === undefined || rows === null) {
    return ['rows is missing: a level is a "rows" array holding one string per grid row.'];
  }
  if (!Array.isArray(rows)) {
    return [`rows must be an array of strings, but its type is ${typeName(rows)}.`];
  }
  // Cast rather than let Array.isArray widen the element type to `any`.
  const list = rows as readonly unknown[];
  if (list.length === 0) {
    return ['rows is empty: a level needs at least one row.'];
  }

  const errors: string[] = [];

  // Shape first, content second. A list that leads with "unknown character at
  // row 7, column 40" when row 7 is a number is a list that buries the fix.
  //
  // Row 0 sets the width. When row 0 is itself unusable there is no reference
  // to be ragged against, so the ragged check sits out entirely rather than
  // reporting every remaining row against a nonsense number.
  const first = list[0];
  const width = typeof first === 'string' && first.length > 0 ? first.length : -1;

  for (let ty = 0; ty < list.length; ty++) {
    const row = list[ty];
    if (typeof row !== 'string') {
      errors.push(
        `row ${ty} (0-based) is not a string: its type is ${typeName(row)}. ` +
          'Every row is one string of grid characters.',
      );
    } else if (row.length === 0) {
      errors.push(
        `row ${ty} (0-based) is an empty string: every row needs at least one character.`,
      );
    } else if (width >= 0 && row.length !== width) {
      errors.push(
        `row ${ty} (0-based) is ${row.length} characters wide, but row 0 is ${width}: ` +
          'the grid must be rectangular.',
      );
    }
  }

  let spawns = 0;
  let goals = 0;
  for (let ty = 0; ty < list.length; ty++) {
    const row = list[ty];
    if (typeof row !== 'string') {
      continue; // Already reported, and it has no columns to walk.
    }
    for (let tx = 0; tx < row.length; tx++) {
      const ch = row[tx];
      if (ch === SPAWN_CHAR) {
        spawns++;
      } else if (ch === GOAL_CHAR) {
        goals++;
      } else if (tileFromChar(ch) === null) {
        errors.push(
          `unknown character "${ch}" at row ${ty}, column ${tx} (both 0-based): ` +
            `the grid accepts ${LEGAL_CHARS}.`,
        );
      }
    }
  }

  // The count is in the message because "expected exactly one S" tells an
  // author nothing about whether they forgot one or left two behind.
  if (spawns !== 1) {
    errors.push(
      `found ${spawns} spawn markers ("S"), expected exactly 1: mark the start tile with S.`,
    );
  }
  if (goals !== 1) {
    errors.push(
      `found ${goals} goal markers ("G"), expected exactly 1: mark the finish tile with G.`,
    );
  }

  return errors;
}

/**
 * Parses a decoded JSON value into a `Level`, or into the complete list of
 * reasons it is not one. `raw` is `unknown` because that is honestly what comes
 * off `JSON.parse` and off a `.json` import from a file someone hand-edited.
 */
export function parseLevel(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [
        `level must be a JSON object with id, name and rows, but its type is ${typeName(raw)}.`,
      ],
    };
  }
  const obj = raw as Record<string, unknown>;

  // Read in the order the file writes them, so the error list reads top-down.
  const id = isNonEmptyString(obj.id) ? obj.id : null;
  const name = isNonEmptyString(obj.name) ? obj.name : null;
  const errors: string[] = [];
  if (id === null) {
    errors.push(
      'id is missing or not a non-empty string: ' +
        'it names the level file and its best-time save key.',
    );
  }
  if (name === null) {
    errors.push(
      'name is missing or not a non-empty string: it is the title shown on the level select.',
    );
  }
  errors.push(...validateLevel(obj.rows));

  // The null checks are redundant with `errors` at runtime; they are what
  // narrows id and name to `string` below without reaching for a cast.
  if (id === null || name === null || errors.length > 0) {
    return { ok: false, errors };
  }

  // The one place validation's knowledge crosses back into the type system:
  // `validateLevel` returning empty proves this is a rectangular array of
  // non-empty strings holding exactly one S and one G.
  const list = obj.rows as readonly string[];
  const h = list.length;
  const w = list[0].length;
  const map = new TileMap(w, h);
  const pads: PadRef[] = [];
  // Both are reassigned in the loop — validation guarantees exactly one of each.
  let spawn: TilePos = { tx: 0, ty: 0 };
  let goal: TilePos = { tx: 0, ty: 0 };

  for (let ty = 0; ty < h; ty++) {
    const row = list[ty];
    for (let tx = 0; tx < w; tx++) {
      const ch = row[tx];
      if (ch === SPAWN_CHAR) {
        spawn = { tx, ty };
        continue; // The cell stays Tile.Empty: S is metadata, not a tile.
      }
      if (ch === GOAL_CHAR) {
        goal = { tx, ty };
        continue;
      }
      const tile = tileFromChar(ch);
      if (tile === null || tile === Tile.Empty) {
        continue; // The map is already filled with Empty.
      }
      map.set(tx, ty, tile);
      if (isPad(tile)) {
        pads.push({ tx, ty, tile }); // The scan is row-major, so this list is.
      }
    }
  }

  return { ok: true, level: { id, name, map, spawn, goal, pads } };
}

/**
 * Back to the file format: JSON text, 2-space indent, trailing newline — the
 * shape git diffs cleanly and the shape the editor's save writes.
 *
 * `parseLevel(JSON.parse(serializeLevel(level)))` round-trips to a deep-equal
 * `Level`, which is the property the phase 7 editor rests on: it edits a grid,
 * writes it out, and expects to load back exactly what it saw.
 *
 * The spawn and goal characters are painted over whatever the map holds at
 * those cells, because the format cannot express "S on a solid tile" and a
 * level must not either. Out-of-range markers are dropped rather than punching
 * holes in a row, mirroring `TileMap.set` ignoring out-of-bounds writes; the
 * level then fails validation on the way back in, which is the readable place
 * for that mistake to surface.
 */
export function serializeLevel(level: Level): string {
  const rows = levelRows(level);
  return `${JSON.stringify({ id: level.id, name: level.name, rows }, null, 2)}\n`;
}

/**
 * A parsed `Level` back to its grid characters — `parseLevel`'s exact inverse,
 * and the half of `serializeLevel` the editor needs on its own: opening a
 * shipped level for editing is `new EditorGrid(levelRows(level))`.
 *
 * Kept separate rather than re-deriving the rows in the editor, because a
 * second implementation of "where do S and G go" is a second answer waiting.
 */
export function levelRows(level: Level): string[] {
  const { map, spawn, goal } = level;
  const rows: string[] = [];

  for (let ty = 0; ty < map.h; ty++) {
    const row: string[] = [];
    for (let tx = 0; tx < map.w; tx++) {
      row.push(charFromTile(map.get(tx, ty)));
    }
    if (ty === spawn.ty && spawn.tx >= 0 && spawn.tx < map.w) {
      row[spawn.tx] = SPAWN_CHAR;
    }
    if (ty === goal.ty && goal.tx >= 0 && goal.tx < map.w) {
      row[goal.tx] = GOAL_CHAR;
    }
    rows.push(row.join(''));
  }
  return rows;
}
