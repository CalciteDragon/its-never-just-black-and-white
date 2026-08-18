/**
 * The level editor: the deliverable that outlives this phase, because
 * everything after 0.2 is levels, and levels are made here or they are not made
 * at all.
 *
 * It owns no format knowledge. The grid is `readonly string[]` (see
 * `editor/grid.ts`), so validation is `validateLevel(rows)` verbatim, saving is
 * `buildLevelPayload`, and playtesting is `parseLevel` handing the **real**
 * `PlayScene` a **real** `Level` — no second parser and no preview mode.
 *
 * It is node-testable for exactly the reason `PlayScene` is, and that is the
 * payoff of putting the mouse in `Input`: a press arrives as
 * `onPointerDown(vx, vy, 0)` in view space rather than as a DOM event, so a
 * test paints a stroke, undoes it, resizes the grid, playtests it and comes
 * back with no canvas anywhere.
 *
 * **This is the first scene in the project with modal state** — a text field
 * that swallows every key, a pan that owns the mouse, a stroke in progress.
 * Mode bugs are the ones that survive a browser pass, because the tester knows
 * which mode they are in. So `mode` is a single explicit field, it is checked
 * before anything else in `update`, and it is printed on screen.
 */

import {
  EDITOR_DEFAULT_H,
  EDITOR_DEFAULT_W,
  EDITOR_GRID_ALPHA,
  EDITOR_PAN_SPEED,
  EDITOR_ZOOM_STEPS,
  PAD_CHEVRON_LEN,
  PAD_CHEVRON_WIDTH,
  TILE,
  VIEW_H,
  VIEW_W,
} from '../constants';
import {
  EditorGrid,
  GRID_CHARS,
  blankRows,
  forEachCharRun,
  gridWarnings,
} from '../editor/grid';
import { measureText } from '../engine/font';
import { MOUSE_LEFT, MOUSE_MIDDLE, MOUSE_RIGHT } from '../engine/input';
import { saveLevel } from '../engine/levelio';
import { LEVEL_ID_PATTERN } from '../engine/levelio';
import { palette } from '../engine/palette';
import type { Renderer } from '../engine/renderer';
import { SAVE_KEYS } from '../engine/save';
import type { SaveStore } from '../engine/save';
import type { Game, Scene } from '../game';
import { levelRows, parseLevel, validateLevel } from '../world/level';
import type { Level } from '../world/level';
import { Tile, padDirection, tileFromChar } from '../world/tiles';
import { PlayScene } from './play';
import { drawChevron, drawGoal, drawSpawn } from './tiledraw';
import { TitleScene } from './title';

/** A level as the editor holds it: §8's on-disk shape, and nothing else. */
export interface EditorInit {
  readonly id: string;
  readonly name: string;
  readonly rows: readonly string[];
}

/**
 * The three modes, stated as a type so a fourth cannot be added by accident.
 * `id` and `name` are text entry; they swallow every key, which is precisely
 * why they are visible on screen while active.
 */
type Mode = 'paint' | 'id' | 'name';

/** How far past the grid's edges the view may be panned (px). */
const PAN_MARGIN = 64;

/** The palette bar: eight swatches, bottom left, drawn as TILES not letters. */
const BAR_CELL = 34;
const BAR_GAP = 6;
const BAR_X = 16;
const BAR_Y = VIEW_H - 50;
const BAR_W = GRID_CHARS.length * BAR_CELL + (GRID_CHARS.length - 1) * BAR_GAP;

/** `Digit1`…`Digit8`, in palette order. */
const DIGIT_CODES: readonly string[] = GRID_CHARS.map((_, i) => `Digit${i + 1}`);

/** Longest line the validation panel can show at scale 1 before it clips. */
const PANEL_COLS = 74;
/** How many errors and warnings the panel lists before saying "and N more". */
const PANEL_MAX = 3;

/** A UI rectangle, in view space. */
interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function inRect(r: Rect, vx: number, vy: number): boolean {
  return vx >= r.x && vx <= r.x + r.w && vy >= r.y && vy <= r.y + r.h;
}

export class EditorScene implements Scene {
  private readonly grid: EditorGrid;
  private id: string;
  private name: string;

  private mode: Mode = 'paint';
  /** The text being typed, held apart until Enter so Esc can cancel. */
  private buffer = '';

  private sel = 1; // '#', because the first thing anyone paints is a floor
  private zoom = 1; // index into EDITOR_ZOOM_STEPS; ½ first, to see the level
  private panX = 0;
  private panY = 0;

  private strokeButton: number | null = null;
  /** Which button began the current pan, or null. */
  private panButton: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private errors: string[] = [];
  private warnings: string[] = [];
  private status = 'N NAMES IT  ·  ENTER PLAYTESTS  ·  CTRL+S SAVES';

  constructor(init?: EditorInit) {
    this.id = init?.id ?? 'untitled';
    this.name = init?.name ?? 'UNTITLED';
    this.grid = new EditorGrid(init?.rows ?? blankRows(EDITOR_DEFAULT_W, EDITOR_DEFAULT_H));
    this.revalidate();
  }

  /** Grid, undo stack and view survive a playtest, because the scene does. */
  enter(game: Game): void {
    // Silence, like every screen that is not play. A bed under an editor would
    // be scored to the wrong activity entirely.
    game.audio.stopMusic();
    // And phase A, for the same reason every shell screen resets it: the
    // palette reads out GRAVITY, and an editor has none.
    palette.reset();
  }

  /** What a headless test reads. Nothing in `render` uses it. */
  get state(): {
    mode: Mode;
    id: string;
    name: string;
    rows: readonly string[];
    sel: string;
    zoom: number;
    undoDepth: number;
    panning: boolean;
    errors: readonly string[];
    warnings: readonly string[];
    status: string;
  } {
    return {
      mode: this.mode,
      id: this.id,
      name: this.name,
      rows: this.grid.rows,
      sel: GRID_CHARS[this.sel],
      zoom: EDITOR_ZOOM_STEPS[this.zoom],
      undoDepth: this.grid.undoDepth,
      panning: this.panButton !== null,
      errors: this.errors,
      warnings: this.warnings,
      status: this.status,
    };
  }

  update(dt: number, game: Game): void {
    const input = game.input;
    // Text entry FIRST and unconditionally, because it swallows everything —
    // including `Escape`, which means four different things across four scenes
    // and must be read by exactly one reader in each.
    if (this.mode !== 'paint') {
      this.updateTextEntry(game);
      return;
    }

    if (input.pressed('mute')) {
      game.toggleMute();
    }
    if (input.pressed('back')) {
      game.setScene(new TitleScene());
      return;
    }

    this.updateKeys(game);
    // `updateKeys` can open a text field or leave for a playtest, and either
    // way the pointer must not be handled as if we were still painting.
    if (this.mode !== 'paint') {
      return;
    }
    this.updatePointer(game);
    this.updatePan(dt, game);
  }

  // --- Keyboard, all of it on the RAW layer except pan and back. Painting is
  // not a game verb and must not become an `Action` (GAME-DESIGN §12). ---

  private updateKeys(game: Game): void {
    const input = game.input;
    // Ctrl FIRST, and it returns. It is a modifier, not something you paint
    // through — and the palette loop below has to sit on this side of that
    // return, or a slip while reaching for Ctrl+Z silently switches the tool.
    if (input.ctrlDown) {
      if (input.codePressed('KeyZ')) {
        this.afterEdit(game, this.grid.undo() ? 'UNDO' : 'NOTHING TO UNDO');
      }
      if (input.codePressed('KeyY')) {
        this.afterEdit(game, this.grid.redo() ? 'REDO' : 'NOTHING TO REDO');
      }
      if (input.codePressed('KeyS')) {
        this.save(game);
      }
      return;
    }
    for (let i = 0; i < DIGIT_CODES.length; i++) {
      if (input.codePressed(DIGIT_CODES[i])) {
        this.sel = i;
      }
    }
    if (input.codePressed('KeyZ')) {
      this.toggleZoom();
    }
    // Finding 5: entering a text field ENDS the frame. Without the return, the
    // rest of this method and then `updatePointer` keep running in paint mode
    // behind an open field — and a click on that frame opens a stroke whose
    // `endStroke` the text-mode guard then skips, leaving `strokeButton` set.
    if (input.codePressed('KeyN')) {
      this.beginTextEntry('id');
      return;
    }
    if (input.codePressed('Enter')) {
      this.playtest(game);
      return;
    }
    // `[` `]` are the horizontal pair and `,` `.` the vertical one; the second
    // of each grows, and Shift moves the OPPOSITE edge. One key per direction
    // would be eight keys, and eight keys is a table nobody remembers.
    const far = input.shiftDown;
    if (input.codePressed('BracketRight')) {
      this.resize(game, far ? 'left' : 'right', 1);
    }
    if (input.codePressed('BracketLeft')) {
      this.resize(game, far ? 'left' : 'right', -1);
    }
    if (input.codePressed('Period')) {
      this.resize(game, far ? 'top' : 'bottom', 1);
    }
    if (input.codePressed('Comma')) {
      this.resize(game, far ? 'top' : 'bottom', -1);
    }
  }

  private resize(game: Game, edge: 'left' | 'right' | 'top' | 'bottom', delta: number): void {
    this.grid.resize(edge, delta);
    this.afterEdit(game, `${this.grid.w} X ${this.grid.h}`);
  }

  private toggleZoom(): void {
    // Hold the view CENTRE, in tiles, across the change. Anchoring to the top
    // left instead would throw away wherever you were looking, which at half
    // zoom is most of the level.
    const before = this.cell;
    const cx = (this.panX + VIEW_W / 2) / before;
    const cy = (this.panY + VIEW_H / 2) / before;
    this.zoom = (this.zoom + 1) % EDITOR_ZOOM_STEPS.length;
    const after = this.cell;
    this.panX = cx * after - VIEW_W / 2;
    this.panY = cy * after - VIEW_H / 2;
    this.clampPan();
  }

  // --- Text entry. The id and the name have different charsets because they
  // have different jobs: one becomes a filename and a save key, the other is
  // drawn by a font with no lowercase glyphs. ---

  private beginTextEntry(mode: 'id' | 'name'): void {
    this.mode = mode;
    this.buffer = mode === 'id' ? this.id : this.name;
    this.status = mode === 'id' ? 'TYPE AN ID: A-Z 0-9 -' : 'TYPE A NAME: A-Z 0-9 SPACE';
  }

  private updateTextEntry(game: Game): void {
    for (const code of game.input.pressedCodes()) {
      if (code === 'Escape') {
        this.mode = 'paint';
        this.status = 'CANCELLED';
        return;
      }
      if (code === 'Enter') {
        this.commitTextEntry(game);
        return;
      }
      if (code === 'Backspace') {
        this.buffer = this.buffer.slice(0, -1);
        continue;
      }
      const ch = this.charForCode(code);
      if (ch !== null) {
        this.buffer += ch;
      }
    }
  }

  private charForCode(code: string): string | null {
    const idMode = this.mode === 'id';
    if (code.startsWith('Key')) {
      const letter = code.slice(3);
      return idMode ? letter.toLowerCase() : letter;
    }
    if (code.startsWith('Digit')) {
      return code.slice(5);
    }
    if (code === 'Minus' && idMode) {
      return '-';
    }
    if (code === 'Space' && !idMode) {
      return ' ';
    }
    return null;
  }

  private commitTextEntry(game: Game): void {
    if (this.mode === 'id') {
      // Enforced here as well as in `saveLevel` and in the vite sink: the id is
      // a filename, and the first place to say so is the field you type it in.
      if (!LEVEL_ID_PATTERN.test(this.buffer)) {
        this.status = 'BAD ID: LOWERCASE, DIGITS AND -, NOT STARTING WITH -';
        return;
      }
      this.id = this.buffer;
      this.beginTextEntry('name'); // straight on to the name, one Enter apart
      return;
    }
    if (this.buffer.trim() === '') {
      this.status = 'NAME CANNOT BE EMPTY';
      return;
    }
    this.name = this.buffer;
    this.mode = 'paint';
    this.status = `NAMED ${this.id}`;
    this.writeDraft(game);
  }

  // --- Pointer. `pointerIn` is checked on every paint, so a drag that leaves
  // the frame STOPS rather than clamping to the edge tile — clamping would
  // smear a wall of tiles down the border. ---

  private updatePointer(game: Game): void {
    const input = game.input;
    const swatch = this.swatchAt(input.pointerX, input.pointerY);
    // EVERY opaque overlay blocks, not just the palette swatches. The bar's
    // plate spans the frame to carry the status line, and the header and the
    // validation panel are plates too — so a click on any of them used to fall
    // through and paint a cell that the plate itself then hid. The rects come
    // from `overlayRects`, which is also what `render` draws, so a panel that
    // moves cannot leave its hit region behind.
    const overUi = this.overlayRects().some((rect) => inRect(rect, input.pointerX, input.pointerY));

    if (input.pointerPressed(MOUSE_LEFT)) {
      if (swatch !== null) {
        this.sel = swatch;
        game.audio.play('menuMove');
      } else if (overUi) {
        // A press on a panel is a press on the panel, and nothing else.
      } else if (input.codeDown('Space')) {
        this.beginPan(MOUSE_LEFT, input.pointerX, input.pointerY);
      } else if (input.shiftDown) {
        const [tx, ty] = this.cellUnderPointer(game);
        this.grid.flood(tx, ty, GRID_CHARS[this.sel]);
        this.afterEdit(game, 'FILL');
      } else {
        this.grid.beginStroke();
        this.strokeButton = MOUSE_LEFT;
      }
    }
    if (input.pointerPressed(MOUSE_RIGHT) && !overUi) {
      this.grid.beginStroke();
      this.strokeButton = MOUSE_RIGHT;
    }
    if (input.pointerPressed(MOUSE_MIDDLE) && !overUi) {
      this.beginPan(MOUSE_MIDDLE, input.pointerX, input.pointerY);
    }

    if (this.panButton !== null) {
      this.panX -= input.pointerX - this.lastPointerX;
      this.panY -= input.pointerY - this.lastPointerY;
      this.clampPan();
    } else if (this.strokeButton !== null && input.pointerIn && !overUi) {
      const [tx, ty] = this.cellUnderPointer(game);
      this.grid.paint(tx, ty, this.strokeButton === MOUSE_RIGHT ? '.' : GRID_CHARS[this.sel]);
    }

    if (this.strokeButton !== null && input.pointerReleased(this.strokeButton)) {
      this.grid.endStroke();
      this.strokeButton = null;
      this.afterEdit(game, this.status);
    }
    // The button that STARTED the pan is the one that ends it. Tearing down on
    // a release of either would let a left-button tap mid middle-drag strand
    // the pan with the middle button still held.
    if (this.panButton !== null && input.pointerReleased(this.panButton)) {
      this.panButton = null;
    }

    this.lastPointerX = input.pointerX;
    this.lastPointerY = input.pointerY;
  }

  /**
   * Start a drag-pan from HERE, remembering which button began it. Without
   * re-seating the anchor the first frame of a pan takes its delta against
   * wherever the pointer was last seen — which on the first pan of a session is
   * the origin, and the view jumps by the whole pointer position before it
   * starts tracking.
   */
  private beginPan(button: number, vx: number, vy: number): void {
    this.panButton = button;
    this.lastPointerX = vx;
    this.lastPointerY = vy;
  }

  /**
   * The rects the overlays occupy, in draw order. `render` draws a plate for
   * each and `updatePointer` blocks on each, so the drawn panel and the
   * blocking panel are the same rectangle by construction — which is the whole
   * fix for three opaque overlays and one partial hit test.
   */
  private overlayRects(): readonly Rect[] {
    const rects: Rect[] = [{ x: 8, y: 6, w: this.headerWidth(), h: 42 }];
    if (this.errors.length > 0 || this.warnings.length > 0) {
      const lines = this.panelHeight(this.errors) + this.panelHeight(this.warnings);
      rects.push({
        x: VIEW_W - 16 - PANEL_COLS * 6 - 10,
        y: 52,
        w: PANEL_COLS * 6 + 20,
        h: lines + 20,
      });
    }
    rects.push({ x: BAR_X - 8, y: BAR_Y - 8, w: VIEW_W - BAR_X - 8, h: BAR_CELL + 16 });
    return rects;
  }

  /** Sized to its text, so the plate never covers more grid than it must. */
  private headerWidth(): number {
    return Math.max(measureText(this.headerLine(), 2), measureText(this.headerMeta(), 1)) + 24;
  }

  private headerLine(): string {
    return this.mode !== 'paint'
      ? `${this.mode.toUpperCase()}: ${this.buffer}_`
      : `${this.id}  ·  ${this.name}`;
  }

  private headerMeta(): string {
    // No "PAINT <char>" here, deliberately. `^` has no glyph in the 5×7 font
    // and renders as the fallback hollow box, which reads as a missing glyph
    // rather than as a pad — which is the whole reason the palette bar draws
    // tiles instead of characters. The bar's thick border IS the readout.
    return (
      `${this.grid.w} X ${this.grid.h}   ZOOM ${this.zoom === 0 ? '1X' : 'HALF'}   ` +
      `UNDO ${this.grid.undoDepth}`
    );
  }

  /** Which palette swatch is under this point, or null. */
  private swatchAt(vx: number, vy: number): number | null {
    if (vy < BAR_Y || vy > BAR_Y + BAR_CELL || vx < BAR_X) {
      return null;
    }
    const i = Math.floor((vx - BAR_X) / (BAR_CELL + BAR_GAP));
    if (i < 0 || i >= GRID_CHARS.length) {
      return null;
    }
    // Reject the gaps between swatches too: the bar is eight buttons, not one
    // strip, and clicking a gap should do nothing rather than pick a neighbour.
    return vx - BAR_X - i * (BAR_CELL + BAR_GAP) <= BAR_CELL ? i : null;
  }

  private updatePan(dt: number, game: Game): void {
    const input = game.input;
    const dx = (input.down('right') ? 1 : 0) - (input.down('left') ? 1 : 0);
    const dy = (input.down('down') ? 1 : 0) - (input.down('up') ? 1 : 0);
    if (dx === 0 && dy === 0) {
      return;
    }
    this.panX += dx * EDITOR_PAN_SPEED * dt;
    this.panY += dy * EDITOR_PAN_SPEED * dt;
    this.clampPan();
  }

  private get cell(): number {
    return TILE * EDITOR_ZOOM_STEPS[this.zoom];
  }

  private cellUnderPointer(game: Game): [number, number] {
    const cell = this.cell;
    return [
      Math.floor((game.input.pointerX + this.panX) / cell),
      Math.floor((game.input.pointerY + this.panY) / cell),
    ];
  }

  private clampPan(): void {
    const cell = this.cell;
    this.panX = clamp(this.panX, -PAN_MARGIN, Math.max(0, this.grid.w * cell - VIEW_W) + PAN_MARGIN);
    this.panY = clamp(this.panY, -PAN_MARGIN, Math.max(0, this.grid.h * cell - VIEW_H) + PAN_MARGIN);
  }

  // --- Validation, drafts, playtest, save. ---

  /**
   * Errors and warnings are recomputed together and shown in two lists, and
   * **only errors block a save** (PHASES phase 7, decision 6). A warning that
   * blocked would eventually be promoted to an error, and `src/levels/index.ts`
   * throws on those — which would make a level-design footgun a build failure.
   */
  private revalidate(): void {
    this.errors = validateLevel(this.grid.rows);
    this.warnings = gridWarnings(this.grid.rows);
  }

  private afterEdit(game: Game, status: string): void {
    this.revalidate();
    this.status = status;
    this.writeDraft(game);
  }

  /**
   * The draft is written on every stroke end, so a reload never costs more than
   * the stroke in progress. A serialised 60×20 level is ~1.3 KB, which is
   * 0.03 % of a 5 MB quota — autosaving this often is free.
   */
  private writeDraft(game: Game): void {
    game.save.setText(
      SAVE_KEYS.editorDraft,
      JSON.stringify({ id: this.id, name: this.name, rows: this.grid.rows }, null, 2) + '\n',
    );
  }

  private playtest(game: Game): void {
    const res = parseLevel({ id: this.id, name: this.name, rows: this.grid.rows });
    if (!res.ok) {
      this.status = res.errors[0];
      return;
    }
    // `back: this` is the whole of §10's "returns on Esc with edits intact":
    // the grid, the undo stack and the view all survive because the SCENE does.
    game.setScene(new PlayScene(res.level, { kind: 'playtest', back: this }));
  }

  private save(game: Game): void {
    this.revalidate();
    if (this.errors.length > 0) {
      this.status = `CANNOT SAVE: ${this.errors[0]}`;
      return;
    }
    this.status = 'SAVING...';
    const payload = { id: this.id, name: this.name, rows: this.grid.rows };
    // `saveLevel` never rejects — it reports which transport it took — so the
    // only thing to do with the promise is show what it says.
    void saveLevel(payload).then((outcome) => {
      this.status = outcome.message;
      game.audio.play(outcome.ok ? 'goal' : 'death');
    });
  }

  // --- Rendering. The grid owns the whole frame; the panels sit over it. ---

  render(r: Renderer, game: Game): void {
    r.setCamera(this.panX, this.panY);
    r.clear(palette.paper);
    this.renderCells(r);
    this.renderGridLines(r);
    this.renderBounds(r);
    this.renderCursor(r, game);
    this.renderHeader(r, game);
    this.renderPanel(r);
    this.renderBar(r);
    r.applyPost(0);
  }

  /**
   * The cells, as row-merged runs.
   *
   * It started as one `fillRect` per cell, which is what the phase 7 brief
   * budgeted: 60 × 34 = 2040 visible at half zoom, predicted at 0.31 ms from
   * phase 6's measured fill rate. **Measured at 1.11 ms** on a 200×60 grid of
   * solid — 3.6× over, because phase 6's rate came from 2 px particles and
   * these are 16 px cells, so the draw is fill-rate bound rather than call
   * bound. That is the overrun the brief named, and this is the fallback it
   * named for it: merge the runs. A solid 60-wide row is then one rect instead
   * of sixty, and the same worst case measures 0.06 ms.
   *
   * Merging over `readonly string[]` rather than over a rebuilt `TileMap`,
   * because a `TileMap` cannot hold `S` and `G` and would need rebuilding on
   * every stroke — see `forEachCharRun`.
   */
  private renderCells(r: Renderer): void {
    const cell = this.cell;
    const scale = cell / TILE;
    forEachCharRun(
      this.grid.rows,
      this.panX / cell,
      this.panY / cell,
      (this.panX + VIEW_W) / cell,
      (this.panY + VIEW_H) / cell,
      (tx, ty, len, ch) => {
        const cy = ty * cell + cell / 2;
        // The markers are singletons, so a run of them is always length 1.
        if (ch === 'S' || ch === 'G') {
          drawCellContent(r, ch, tx * cell + cell / 2, cy, cell, scale, false);
          return;
        }
        const tile = tileFromChar(ch);
        if (tile === null) {
          return;
        }
        r.rect(tx * cell, ty * cell, len * cell, cell, palette.ink);
        const dir = padDirection(tile);
        if (dir) {
          for (let i = 0; i < len; i++) {
            drawChevron(r, (tx + i) * cell + cell / 2, cy, dir, PAD_CHEVRON_LEN * scale, PAD_CHEVRON_WIDTH * scale);
          }
        }
      },
    );
  }

  private renderGridLines(r: Renderer): void {
    const cell = this.cell;
    const color = palette.inkRgba(EDITOR_GRID_ALPHA);
    const tx0 = Math.max(0, Math.floor(this.panX / cell));
    const ty0 = Math.max(0, Math.floor(this.panY / cell));
    const tx1 = Math.min(this.grid.w, Math.floor((this.panX + VIEW_W) / cell) + 1);
    const ty1 = Math.min(this.grid.h, Math.floor((this.panY + VIEW_H) / cell) + 1);
    for (let tx = tx0; tx <= tx1; tx++) {
      r.rect(tx * cell, ty0 * cell, 1, (ty1 - ty0) * cell, color);
    }
    for (let ty = ty0; ty <= ty1; ty++) {
      r.rect(tx0 * cell, ty * cell, (tx1 - tx0) * cell, 1, color);
    }
  }

  /** The grid's extent, so the edge of the level is visible rather than inferred. */
  private renderBounds(r: Renderer): void {
    const cell = this.cell;
    const w = this.grid.w * cell;
    const h = this.grid.h * cell;
    r.rectRotatedOutline(w / 2, h / 2, w, h, 0, palette.ink, 2);
  }

  private renderCursor(r: Renderer, game: Game): void {
    const { pointerX, pointerY } = game.input;
    // Hidden under every overlay, for the same reason the click is blocked
    // there: a hover cue over a panel promises an edit that will not happen.
    if (!game.input.pointerIn || this.overlayRects().some((rc) => inRect(rc, pointerX, pointerY))) {
      return;
    }
    const [tx, ty] = this.cellUnderPointer(game);
    if (tx < 0 || ty < 0 || tx >= this.grid.w || ty >= this.grid.h) {
      return;
    }
    const cell = this.cell;
    r.rectRotatedOutline(tx * cell + cell / 2, ty * cell + cell / 2, cell, cell, 0, palette.ink, 2);
  }

  private renderHeader(r: Renderer, game: Game): void {
    // The mode is on screen because an editor whose current mode is invisible
    // is one that will paint a level's worth of S into a grid.
    plate(r, 8, 6, this.headerWidth(), 42);
    r.text(this.headerLine(), 20, 12, palette.ink, 2);
    r.text(this.headerMeta(), 20, 34, palette.ink);
    if (game.audio.muted) {
      plate(r, VIEW_W - 74, 6, 66, 20);
      r.text('MUTED', VIEW_W - 66, 11, palette.ink);
    }
  }

  /** Errors and warnings, in two lists, wrapped rather than clipped. */
  private renderPanel(r: Renderer): void {
    if (this.errors.length === 0 && this.warnings.length === 0) {
      return;
    }
    const x = VIEW_W - 16 - PANEL_COLS * 6;
    // The plate comes from `overlayRects` so that what is drawn and what blocks
    // the pointer are the same rectangle, measured the same way.
    const rect = this.overlayRects()[1];
    plate(r, rect.x, rect.y, rect.w, rect.h);
    let y = 62;
    y = this.renderList(r, 'ERRORS', this.errors, x, y, palette.ink);
    this.renderList(r, 'WARNINGS', this.warnings, x, y, palette.inkRgba(0.6));
  }

  /** Pixel height `renderList` will take for a list, including its heading. */
  private panelHeight(items: readonly string[]): number {
    if (items.length === 0) {
      return 0;
    }
    let h = 22;
    for (const item of items.slice(0, PANEL_MAX)) {
      h += wrap(item.toUpperCase(), PANEL_COLS).length * 10;
    }
    return items.length > PANEL_MAX ? h + 10 : h;
  }

  private renderList(
    r: Renderer,
    title: string,
    items: readonly string[],
    x: number,
    y0: number,
    color: string,
  ): number {
    if (items.length === 0) {
      return y0;
    }
    let y = y0;
    r.text(`${title} ${items.length}`, x, y, color, 2);
    y += 22;
    for (const item of items.slice(0, PANEL_MAX)) {
      for (const line of wrap(item.toUpperCase(), PANEL_COLS)) {
        r.text(line, x, y, color);
        y += 10;
      }
    }
    if (items.length > PANEL_MAX) {
      r.text(`AND ${items.length - PANEL_MAX} MORE`, x, y, color);
      y += 10;
    }
    return y;
  }

  /**
   * The palette bar draws **the tiles themselves**, not their characters. It is
   * WYSIWYG for free, and it sidesteps the fact that `^` has no glyph in the
   * 5×7 font — `v` would resolve to `V`, which is worse, because it looks
   * deliberate.
   */
  private renderBar(r: Renderer): void {
    // One plate spanning the width, so the swatches read as a panel over the
    // grid rather than as eight more cells of it — and so the status line has
    // somewhere to sit that is not on top of the level.
    plate(r, BAR_X - 8, BAR_Y - 8, VIEW_W - BAR_X - 8, BAR_CELL + 16);
    // Truncated rather than wrapped: the full text of anything long enough to
    // need it is already in the panel, and a status line that reflows would
    // move the bar under the pointer.
    const statusX = BAR_X + BAR_W + 20;
    const cols = Math.floor((VIEW_W - 16 - statusX) / 6);
    r.text(this.status.slice(0, cols), statusX, BAR_Y + 14, palette.ink);
    for (let i = 0; i < GRID_CHARS.length; i++) {
      const x = BAR_X + i * (BAR_CELL + BAR_GAP);
      const cx = x + BAR_CELL / 2;
      const cy = BAR_Y + BAR_CELL / 2;
      drawCellContent(r, GRID_CHARS[i], cx, cy, BAR_CELL, BAR_CELL / TILE, true);
      r.rectRotatedOutline(
        cx,
        cy,
        BAR_CELL,
        BAR_CELL,
        0,
        i === this.sel ? palette.ink : palette.inkRgba(0.3),
        i === this.sel ? 3 : 1,
        true,
      );
      r.text(String(i + 1), x + 2, BAR_Y - 20, palette.ink, 1, true);
    }
  }
}

/**
 * One grid character, drawn as what it is. Shared by the grid and the palette
 * bar so a swatch cannot drift from the cell it stands for — which is the whole
 * argument for a WYSIWYG bar in the first place.
 */
function drawCellContent(
  r: Renderer,
  ch: string,
  cx: number,
  cy: number,
  size: number,
  scale: number,
  ui: boolean,
): void {
  if (ch === 'S') {
    drawSpawn(r, cx, cy, size, ui);
    return;
  }
  if (ch === 'G') {
    drawGoal(r, cx, cy, size * 0.8, ui);
    return;
  }
  const tile = tileFromChar(ch);
  if (tile === null || tile === Tile.Empty) {
    return;
  }
  r.rect(cx - size / 2, cy - size / 2, size, size, palette.ink, ui);
  const dir = padDirection(tile);
  if (dir) {
    drawChevron(r, cx, cy, dir, PAD_CHEVRON_LEN * scale, PAD_CHEVRON_WIDTH * scale, ui);
  }
}

/**
 * A `paper` panel with an `ink` border, in UI space. Every overlay in this
 * scene sits on one: the grid underneath is `ink`, and ink text on ink geometry
 * is text nobody can read — which is the two-colour version of "the HUD
 * disappeared over the dark bit".
 */
function plate(r: Renderer, x: number, y: number, w: number, h: number): void {
  r.rect(x, y, w, h, palette.paper, true);
  r.rectRotatedOutline(x + w / 2, y + h / 2, w, h, 0, palette.ink, 1, true);
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Greedy word wrap. The panel's messages are sentences, so words survive. */
function wrap(text: string, cols: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line === '') {
      line = word;
    } else if (line.length + 1 + word.length <= cols) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') {
    lines.push(line);
  }
  return lines;
}

/** A shipped level, opened for editing. `levelRows` is `parseLevel`'s inverse. */
export function editorInitFromLevel(level: Level): EditorInit {
  return { id: level.id, name: level.name, rows: levelRows(level) };
}

/**
 * The autosaved draft, or null if there isn't a usable one. Everything here is
 * defensive because the value is JSON from a previous session's browser: it can
 * be absent, truncated, from an older shape, or something else entirely that
 * happens to share the key.
 */
export function draftFromSave(save: SaveStore): EditorInit | null {
  const raw = save.getText(SAVE_KEYS.editorDraft);
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const rows = obj.rows;
    if (typeof obj.id !== 'string' || typeof obj.name !== 'string' || !Array.isArray(rows)) {
      return null;
    }
    if (!rows.every((row): row is string => typeof row === 'string') || rows.length === 0) {
      return null;
    }
    return { id: obj.id, name: obj.name, rows };
  } catch {
    return null;
  }
}
