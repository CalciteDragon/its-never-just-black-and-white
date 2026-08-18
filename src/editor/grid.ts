/**
 * The editor's grid model. Pure and node-safe: paint, erase, flood, resize,
 * a stroke-scoped undo stack, and the warnings `validateLevel` deliberately
 * does not raise.
 *
 * **It edits characters, not tiles** (PHASES phase 7, decision 1). The obvious
 * model is a `TileMap` plus a spawn and a goal beside it; it is wrong, and the
 * reason is `S` and `G` — they are metadata on an empty cell in a `Level`, but
 * they are *paintable cells* in an editor, and a `TileMap` cannot hold them.
 * Modelling the grid as `readonly string[]` — GAME-DESIGN §8's own on-disk
 * shape — makes `world/level.ts` this module's entire format layer:
 *
 * - validation is `validateLevel(rows)` verbatim;
 * - saving is `JSON.stringify({ id, name, rows })`, byte-identical to
 *   `serializeLevel`, so what the editor writes is what `git diff` shows;
 * - playtesting is `parseLevel({ id, name, rows })`, which hands the *real*
 *   `PlayScene` the *real* `Level` — no second parser, no preview mode;
 * - **a resize from the left or the top moves the spawn and the goal for
 *   free**, because they are characters in the rows being shifted;
 * - an undo snapshot is a `string[]` copy, 1200 characters for a 60×20 level.
 *
 * Two edits the model makes unrepresentable, which is worth more than any
 * validation panel: painting `S` **moves** the spawn rather than adding a
 * second one (same for `G`, and neither can be erased — only relocated), and a
 * rectangular array of equal-length rows cannot go ragged. Between those and a
 * fixed palette, every error `validateLevel` can report is unreachable from
 * this module except one: a resize that crops the spawn or the goal off the
 * grid. That is not an argument for dropping the panel; it is the argument for
 * what the panel is *for*.
 */

import { EDITOR_MAX_H, EDITOR_MAX_W, EDITOR_UNDO_MAX } from '../constants';

/**
 * What an author paints: GAME-DESIGN §8's six grid characters plus the two
 * markers. **Eight, not §10's "1–7"** — six is the tile enum and eight is the
 * palette; seven is neither. §10 amended in phase 7.
 */
export const GRID_CHARS: readonly string[] = ['.', '#', '^', 'v', '<', '>', 'S', 'G'];

/** The empty cell, and what an erase paints. */
export const EMPTY_CHAR = '.';
/** The two singletons. Everything special about them is in this one pair. */
export const SPAWN_CHAR = 'S';
export const GOAL_CHAR = 'G';

/** The four edges a resize can move. */
export type Edge = 'left' | 'right' | 'top' | 'bottom';

/** Pad character → the cell it fires into, in canvas orientation (−y is up). */
const PAD_FACINGS: Readonly<Record<string, { readonly dx: number; readonly dy: number }>> = {
  '^': { dx: 0, dy: -1 },
  v: { dx: 0, dy: 1 },
  '<': { dx: -1, dy: 0 },
  '>': { dx: 1, dy: 0 },
};

export function isGridChar(ch: string): boolean {
  return ch.length === 1 && GRID_CHARS.includes(ch);
}

function isMarker(ch: string): boolean {
  return ch === SPAWN_CHAR || ch === GOAL_CHAR;
}

/** Row-by-row equality. A grid is small enough that this beats hashing it. */
function sameRows(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * A blank grid that is **already valid**: empty but for a spawn near the left
 * and a goal near the right, both on the row above the floor line an author
 * would draw. A fresh editor that opened onto a level failing validation would
 * greet every new level with an error panel, which teaches the author to ignore
 * the panel.
 *
 * A grid too small to hold both markers simply gets neither, and validation
 * says so — there is no sensible placement to invent, and inventing one would
 * put two markers in one cell.
 */
export function blankRows(w: number, h: number): string[] {
  const width = Math.max(1, Math.min(EDITOR_MAX_W, Math.floor(w)));
  const height = Math.max(1, Math.min(EDITOR_MAX_H, Math.floor(h)));
  const rows: string[] = [];
  for (let ty = 0; ty < height; ty++) {
    rows.push(EMPTY_CHAR.repeat(width));
  }
  if (width < 2) {
    return rows;
  }
  const ty = height > 2 ? height - 2 : Math.floor(height / 2);
  const sx = width > 3 ? 1 : 0;
  const gx = width > 3 ? width - 2 : width - 1;
  const row = rows[ty].split('');
  row[sx] = SPAWN_CHAR;
  row[gx] = GOAL_CHAR;
  rows[ty] = row.join('');
  return rows;
}

/**
 * Every problem that is legal-but-probably-wrong: pure, and separate from
 * `validateLevel` on purpose (PHASES phase 7, decision 6). These **cannot** be
 * errors — the grids are well-formed, `parseLevel` must accept them, and
 * `src/levels/index.ts` throws on anything `validateLevel` rejects, so
 * promoting a level-design footgun to a format error would turn a shipped level
 * into a build failure. Only errors block a save; warnings are advice.
 *
 * Runs beside `validateLevel` rather than after it, so it must survive a
 * ragged, empty or marker-less grid without throwing.
 */
export function gridWarnings(rows: readonly string[]): string[] {
  const warnings: string[] = [];
  const h = rows.length;
  if (h === 0) {
    return warnings;
  }

  /**
   * The out-of-bounds rule of `TileMap.get`, restated over characters: the
   * sides seal the level, and above the top row and below the bottom row are
   * open — because gravity flips, and leaving through the ceiling has to be as
   * lethal as falling out of the floor.
   */
  const blockingAt = (tx: number, ty: number): boolean => {
    if (ty < 0 || ty >= h) {
      return false;
    }
    const row = rows[ty];
    if (typeof row !== 'string') {
      return false;
    }
    if (tx < 0 || tx >= row.length) {
      return true;
    }
    const ch = row[tx];
    return ch !== EMPTY_CHAR && !isMarker(ch);
  };

  for (let ty = 0; ty < h; ty++) {
    const row = rows[ty];
    if (typeof row !== 'string') {
      continue;
    }
    for (let tx = 0; tx < row.length; tx++) {
      const ch = row[tx];
      const facing = PAD_FACINGS[ch];
      if (facing && blockingAt(tx + facing.dx, ty + facing.dy)) {
        // Phase 5's down-pad trap, generalised to all four facings: a pad
        // firing into its own geometry re-fires every step and pins the body.
        warnings.push(
          `pad "${ch}" at row ${ty}, column ${tx} (both 0-based) fires into solid ` +
            'geometry: it will re-fire every step and pin the player.',
        );
      }
      if (!isMarker(ch)) {
        continue;
      }
      const what = ch === SPAWN_CHAR ? 'spawn' : 'goal';
      if (ty === 0) {
        warnings.push(`the ${what} is on the top row (row 0), which is a death plane.`);
      } else if (ty === h - 1) {
        warnings.push(`the ${what} is on the bottom row (row ${ty}), which is a death plane.`);
      }
      // "Inside a solid tile" is unrepresentable in this format — the marker IS
      // the cell — so the reachable version of that mistake is a marker with
      // nowhere at all to go.
      if (
        blockingAt(tx - 1, ty) &&
        blockingAt(tx + 1, ty) &&
        blockingAt(tx, ty - 1) &&
        blockingAt(tx, ty + 1)
      ) {
        warnings.push(
          `the ${what} at row ${ty}, column ${tx} is enclosed by solid tiles on all four sides.`,
        );
      }
    }
  }
  return warnings;
}

/**
 * Walks the visible cells as merged horizontal runs of equal character, so a
 * 60-wide floor draws as one rect instead of sixty. `tx0..tx1` / `ty0..ty1` are
 * *inclusive* and are clipped to the grid; empty cells are skipped entirely.
 *
 * The same shape as `world/tiles.ts`'s `forEachRun`, and it exists for the same
 * reason — but over **characters**, not a `TileMap`. The phase 7 brief's
 * fallback for an over-budget editor draw was "`forEachRun` over a `TileMap`
 * rebuilt on edit"; merging the rows directly is that idea without the second
 * model, which matters because a `TileMap` cannot hold `S` and `G` at all
 * (decision 1) and would have to be rebuilt on every stroke.
 *
 * Callback-based rather than array-returning: nothing is allocated per run.
 */
export function forEachCharRun(
  rows: readonly string[],
  tx0: number,
  ty0: number,
  tx1: number,
  ty1: number,
  cb: (tx: number, ty: number, len: number, ch: string) => void,
): void {
  const h = rows.length;
  if (h === 0) {
    return;
  }
  const y0 = Math.max(0, Math.floor(ty0));
  const y1 = Math.min(h - 1, Math.floor(ty1));
  for (let ty = y0; ty <= y1; ty++) {
    const row = rows[ty];
    const x0 = Math.max(0, Math.floor(tx0));
    const x1 = Math.min(row.length - 1, Math.floor(tx1));
    let tx = x0;
    while (tx <= x1) {
      const ch = row[tx];
      if (ch === EMPTY_CHAR) {
        tx++;
        continue;
      }
      let len = 1;
      while (tx + len <= x1 && row[tx + len] === ch) {
        len++;
      }
      cb(tx, ty, len, ch);
      tx += len;
    }
  }
}

/**
 * The mutable grid, with a stroke-scoped undo stack.
 *
 * **The undo granularity is the stroke, and the snapshot is pushed before the
 * first cell of it** (decision 4). Per-cell snapshots make `Ctrl+Z` undo one
 * pixel of a drag, which is not an undo stack, it is a diary. Two rules go with
 * that, and both are the classic bugs: a stroke that changed nothing pushes
 * nothing, and the redo stack clears on any new edit.
 */
export class EditorGrid {
  private grid: string[];
  private readonly undoStack: string[][] = [];
  private readonly redoStack: string[][] = [];
  /**
   * The grid as it stood when the current stroke opened, held but NOT yet
   * pushed. Pushing eagerly on pointer-down and popping it back if the drag
   * turned out to change nothing would work; holding it is the same thing
   * without a stack that is briefly wrong.
   */
  private strokeBase: string[] | null = null;
  private strokeCommitted = false;

  constructor(rows: readonly string[]) {
    this.grid = rows.slice();
  }

  /** A snapshot. Callers may keep it; mutating it cannot reach the grid. */
  get rows(): readonly string[] {
    return this.grid.slice();
  }

  get w(): number {
    return this.grid.length > 0 ? this.grid[0].length : 0;
  }

  get h(): number {
    return this.grid.length;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  /** Empty outside the grid, so callers never have to bounds-check first. */
  charAt(tx: number, ty: number): string {
    if (ty < 0 || ty >= this.grid.length) {
      return EMPTY_CHAR;
    }
    const row = this.grid[ty];
    return tx < 0 || tx >= row.length ? EMPTY_CHAR : row[tx];
  }

  /** Open a stroke. One pointer-down, however many frames the drag spans. */
  beginStroke(): void {
    this.strokeBase = this.grid.slice();
    this.strokeCommitted = false;
  }

  endStroke(): void {
    this.strokeBase = null;
    this.strokeCommitted = false;
  }

  /**
   * Paint one cell. Returns whether anything actually changed — which is what
   * lets a scene autosave a draft only when there is something to save, and is
   * how a no-op stroke avoids pushing an identical snapshot.
   *
   * The two singletons are enforced here rather than in a validation pass:
   * painting `S` MOVES the spawn, and no other character may overwrite it. That
   * makes "found 0 spawn markers" and "found 2" both unreachable, which is the
   * whole argument for this model.
   */
  paint(tx: number, ty: number, ch: string): boolean {
    if (!isGridChar(ch) || ty < 0 || ty >= this.grid.length) {
      return false;
    }
    const row = this.grid[ty];
    if (tx < 0 || tx >= row.length) {
      return false;
    }
    const existing = row[tx];
    if (existing === ch) {
      return false;
    }
    // A marker can be relocated but never erased or overwritten, in either
    // direction: dropping the spawn on the goal would delete the goal.
    if (isMarker(existing)) {
      return false;
    }
    this.commit();
    if (isMarker(ch)) {
      this.clearChar(ch);
    }
    this.writeChar(tx, ty, ch);
    return true;
  }

  /**
   * Flood the 4-connected region of equal character containing (tx, ty).
   *
   * Filling **with** a marker places exactly one — the singleton rule outranks
   * the fill, and a flood of spawns is not a level. Filling a region that
   * starts *on* a marker is refused for the same reason `paint` refuses it.
   */
  flood(tx: number, ty: number, ch: string): void {
    if (!isGridChar(ch) || ty < 0 || ty >= this.grid.length) {
      return;
    }
    if (tx < 0 || tx >= this.grid[ty].length) {
      return;
    }
    if (isMarker(ch)) {
      this.atomic(() => {
        this.paint(tx, ty, ch);
      });
      return;
    }
    const target = this.charAt(tx, ty);
    if (target === ch || isMarker(target)) {
      return;
    }

    // Explicit stack rather than recursion: a 200×60 grid of one character is
    // 12000 deep, which is a stack overflow on a level someone really did draw.
    const seen = new Set<number>();
    const stack: number[] = [ty * this.w + tx];
    const cells: [number, number][] = [];
    while (stack.length > 0) {
      const key = stack.pop() as number;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const cy = Math.floor(key / this.w);
      const cx = key - cy * this.w;
      if (cy < 0 || cy >= this.h || cx < 0 || cx >= this.w) {
        continue;
      }
      if (this.charAt(cx, cy) !== target) {
        continue;
      }
      cells.push([cx, cy]);
      if (cx > 0) {
        stack.push(cy * this.w + cx - 1);
      }
      if (cx < this.w - 1) {
        stack.push(cy * this.w + cx + 1);
      }
      if (cy > 0) {
        stack.push((cy - 1) * this.w + cx);
      }
      if (cy < this.h - 1) {
        stack.push((cy + 1) * this.w + cx);
      }
    }

    this.atomic(() => {
      for (const [cx, cy] of cells) {
        this.paint(cx, cy, ch);
      }
    });
  }

  /**
   * Grow (positive delta) or crop (negative) from one edge, clamped to
   * [1, EDITOR_MAX_*]. A resize from the left or the top shifts the spawn and
   * the goal along with everything else, because they are characters in the
   * rows being shifted — and a crop that loses one is the single reachable
   * `validateLevel` error, reported by the panel rather than prevented here.
   */
  resize(edge: Edge, delta: number): void {
    const d = Math.trunc(delta);
    if (d === 0 || this.grid.length === 0) {
      return;
    }
    const horizontal = edge === 'left' || edge === 'right';
    const current = horizontal ? this.w : this.h;
    const max = horizontal ? EDITOR_MAX_W : EDITOR_MAX_H;
    const next = Math.max(1, Math.min(max, current + d));
    const change = next - current;
    if (change === 0) {
      return;
    }

    this.atomic(() => {
      if (horizontal) {
        this.grid = this.grid.map((row) => {
          if (change > 0) {
            const pad = EMPTY_CHAR.repeat(change);
            return edge === 'left' ? pad + row : row + pad;
          }
          return edge === 'left' ? row.slice(-change) : row.slice(0, next);
        });
        return;
      }
      if (change > 0) {
        const blank = EMPTY_CHAR.repeat(this.w);
        const added = Array.from({ length: change }, () => blank);
        this.grid = edge === 'top' ? added.concat(this.grid) : this.grid.concat(added);
      } else {
        this.grid = edge === 'top' ? this.grid.slice(-change) : this.grid.slice(0, next);
      }
    });
  }

  /** Replace the whole grid in one undoable step (load, clear, revert). */
  replace(rows: readonly string[]): void {
    this.atomic(() => {
      this.grid = rows.slice();
    });
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) {
      return false;
    }
    this.redoStack.push(this.grid.slice());
    this.grid = prev;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) {
      return false;
    }
    this.undoStack.push(this.grid.slice());
    this.grid = next;
    return true;
  }

  /**
   * A whole edit that is not a drag — a resize, a flood, a load — as its own
   * stroke and therefore its own undo step.
   *
   * It commits by COMPARING rather than by trusting `fn`, which is what keeps
   * the two kinds of edit under one rule. A flood commits through the `paint`
   * calls inside it and this sees nothing left to do; a resize replaces the
   * whole array and never touches `paint`, so this is the only thing that could
   * notice. Either way a no-op pushes nothing, which is the same guarantee a
   * drag across unchanged cells gets.
   */
  private atomic(fn: () => void): void {
    const outer = this.strokeBase;
    const outerCommitted = this.strokeCommitted;
    this.beginStroke();
    const before = this.strokeBase as string[];
    fn();
    if (!this.strokeCommitted && !sameRows(before, this.grid)) {
      this.commit();
    }
    this.endStroke();
    this.strokeBase = outer;
    this.strokeCommitted = outerCommitted;
  }

  /**
   * Push the current stroke's snapshot, once, at the moment of the first
   * effective change. Called from `paint` and nowhere else — which is exactly
   * why a stroke that changes nothing can never push.
   */
  private commit(): void {
    if (this.strokeCommitted) {
      return;
    }
    this.strokeCommitted = true;
    this.undoStack.push(this.strokeBase ? this.strokeBase.slice() : this.grid.slice());
    if (this.undoStack.length > EDITOR_UNDO_MAX) {
      this.undoStack.shift(); // the ceiling is memory; the cap is the leak
    }
    this.redoStack.length = 0;
  }

  private writeChar(tx: number, ty: number, ch: string): void {
    const row = this.grid[ty];
    this.grid[ty] = row.slice(0, tx) + ch + row.slice(tx + 1);
  }

  /** Erase the one existing occurrence of a marker, wherever it is. */
  private clearChar(ch: string): void {
    for (let ty = 0; ty < this.grid.length; ty++) {
      const tx = this.grid[ty].indexOf(ch);
      if (tx >= 0) {
        this.writeChar(tx, ty, EMPTY_CHAR);
        return;
      }
    }
  }
}
