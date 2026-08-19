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
  EDITOR_MARQUEE_ALPHA,
  EDITOR_MARQUEE_WIDTH,
  EDITOR_PAN_SPEED,
  EDITOR_ZOOM_STEPS,
  PAD_CHEVRON_LEN,
  PAD_CHEVRON_WIDTH,
  PICKUP_SIZE,
  TILE,
  VIEW_H,
  VIEW_W,
} from '../constants';
import {
  EMPTY_CHAR,
  EditorGrid,
  GOAL_CHAR,
  GRID_CHARS,
  PICKUP_CHAR,
  SPAWN_CHAR,
  blankRows,
  clipRect,
  forEachCharRun,
  gridWarnings,
  parseSizeInput,
} from '../editor/grid';
import type { CellRect } from '../editor/grid';
import { draftExists, renameDraft, uniqueDraftId, writeDraft } from '../editor/drafts';
import { zoomLabel, zoomRange } from '../editor/zoom';
import { measureText } from '../engine/font';
import { MOUSE_LEFT, MOUSE_MIDDLE, MOUSE_RIGHT } from '../engine/input';
import { saveLevel } from '../engine/levelio';
import { LEVEL_ID_PATTERN } from '../engine/levelio';
import { palette } from '../engine/palette';
import type { Renderer } from '../engine/renderer';
import type { Game, Scene } from '../game';
import { LEVELS } from '../levels/index';
import { levelRows, parseLevel, validateLevel } from '../world/level';
import type { Level } from '../world/level';
import { Tile, padDirection, tileFromChar } from '../world/tiles';
import { EditorSelectScene } from './editorselect';
import { renderHelp } from './editorhelp';
import { PlayScene } from './play';
import { drawChevron, drawGoal, drawPickup, drawSpawn, plate } from './tiledraw';

/**
 * A level as the editor holds it: §8's on-disk shape, plus one fact the shape
 * cannot carry — where a copy came from. `copyOf` is set when a **shipped**
 * level was opened, and it is only ever a label: the id it arrived with is
 * already a fresh one (`editorInitFromLevel`), because a built-in is opened as
 * a copy rather than opened and then refused at the save.
 */
export interface EditorInit {
  readonly id: string;
  readonly name: string;
  readonly rows: readonly string[];
  readonly copyOf?: string;
}

/**
 * The modes, stated as a type so a fifth cannot be added by accident. `id`,
 * `name` and `size` are text entry and `help` is the controls panel; all four
 * swallow every key, which is precisely why they are visible on screen while
 * active.
 */
type Mode = 'paint' | 'id' | 'name' | 'size' | 'help';

/**
 * The three drawing tools. `mode` is *modal state* — a field open, a pan under
 * way — while this is what the left button MEANS in paint mode, which is why
 * they are separate fields rather than five values of one enum: a rectangle
 * drag is not a mode, and a name field is not a tool.
 */
export type Tool = 'brush' | 'rect' | 'select';

/**
 * A pointer drag in progress. ONE field for all four kinds, because the bugs
 * in a drag are the ones where two of them are half-live at once — a rectangle
 * anchored while a selection is also being resized. The anchor is the cell the
 * button went down on and `cx`/`cy` track the pointer; only `brush` edits as it
 * goes, the other three commit on release.
 */
interface DragState {
  readonly kind: 'brush' | 'rect' | 'select' | 'move';
  readonly button: number;
  readonly ax: number;
  readonly ay: number;
  /**
   * `grid.undoDepth` when the drag opened. A brush commits per frame, so this
   * is the only way to tell a cancelled stroke that painted something from one
   * that did not — and undoing without it would pop somebody else's snapshot.
   */
  readonly depth: number;
  cx: number;
  cy: number;
}

/** How far past the grid's edges the view may be panned (px). */
const PAN_MARGIN = 64;

/** The palette bar: eight swatches, bottom left, drawn as TILES not letters. */
const BAR_CELL = 34;
const BAR_GAP = 6;
const BAR_X = 16;
const BAR_Y = VIEW_H - 50;
const BAR_W = GRID_CHARS.length * BAR_CELL + (GRID_CHARS.length - 1) * BAR_GAP;

/** The controls button's label, and the key that does the same thing. */
const HELP_LABEL = 'CONTROLS AND TOOLS  (H)';

/** Longest display name a copy keeps, so the header plate cannot outgrow the frame. */
const NAME_MAX = 40;

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
  /**
   * Index into `EDITOR_ZOOM_STEPS`, held between `zoomMin` and `zoomMax` —
   * which are a function of the grid's size, so they are recomputed after every
   * resize rather than stored (`editor/zoom.ts` says why each end is where it
   * is). The level opens at the step that shows all of it.
   */
  private zoom: number;
  private panX = 0;
  private panY = 0;

  private tool: Tool = 'brush';
  /** The select tool's marked-out region, or null. Survives until it is replaced. */
  private selection: CellRect | null = null;
  private drag: DragState | null = null;
  /** Which button began the current pan, or null. */
  private panButton: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;

  private errors: string[] = [];
  private warnings: string[] = [];
  private status = 'H OR THE BUTTON BELOW LISTS EVERY CONTROL AND TOOL';
  /** The shipped level this is a copy of, or null. A label, never a key. */
  private readonly copyOf: string | null;
  /** The id the draft is filed under. Moves with the id, via `renameDraft`. */
  private draftKey: string;

  constructor(init?: EditorInit) {
    this.id = init?.id ?? 'untitled';
    this.name = init?.name ?? 'UNTITLED';
    this.copyOf = init?.copyOf ?? null;
    this.draftKey = this.id;
    this.grid = new EditorGrid(init?.rows ?? blankRows(EDITOR_DEFAULT_W, EDITOR_DEFAULT_H));
    this.zoom = zoomRange(this.grid.w, this.grid.h).initial;
    this.revalidate();
  }

  /** Grid, undo stack and view survive a playtest, because the scene does. */
  enter(game: Game): void {
    // Belt and braces for the playtest round trip: whatever the pointer was
    // doing when the level was handed over, it is not doing it now.
    this.cancelDrag();
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
    buffer: string;
    rows: readonly string[];
    sel: string;
    tool: Tool;
    selection: CellRect | null;
    zoom: number;
    zoomIndex: number;
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
      buffer: this.buffer,
      rows: this.grid.rows,
      sel: GRID_CHARS[this.sel],
      tool: this.tool,
      selection: this.selection,
      zoom: EDITOR_ZOOM_STEPS[this.zoom],
      zoomIndex: this.zoom,
      undoDepth: this.grid.undoDepth,
      panning: this.panButton !== null,
      errors: this.errors,
      warnings: this.warnings,
      status: this.status,
    };
  }

  update(dt: number, game: Game): void {
    const input = game.input;
    // The panel and the text fields FIRST and unconditionally, because they
    // swallow everything — including `Escape`, which means four different
    // things across four scenes and must be read by exactly one reader in each.
    if (this.mode === 'help') {
      this.updateHelp(game);
      return;
    }
    if (this.mode !== 'paint') {
      this.updateTextEntry(game);
      return;
    }

    if (input.pressed('mute')) {
      game.toggleMute();
    }
    if (input.pressed('back')) {
      // Innermost first: a drag, then a selection, then the editor. A modal key
      // that skips its innermost mode is how an author loses a level.
      if (this.drag !== null) {
        this.cancelDrag();
        this.status = 'CANCELLED';
        return;
      }
      if (this.selection !== null) {
        this.selection = null;
        this.status = 'SELECTION CLEARED';
        return;
      }
      game.setScene(new EditorSelectScene());
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
        this.selection = null; // the cells it named may have just moved back
        this.afterEdit(game, this.grid.undo() ? 'UNDO' : 'NOTHING TO UNDO');
      }
      if (input.codePressed('KeyY')) {
        this.selection = null;
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
    // Zoom is a ladder now rather than a toggle, so it is on the keys that
    // mean "more" and "less" everywhere else. `Equal` is `+` unshifted, and the
    // numpad pair is here because a keyboard that has one is a keyboard whose
    // owner will reach for it.
    if (input.codePressed('Equal') || input.codePressed('NumpadAdd')) {
      this.stepZoom(1);
    }
    if (input.codePressed('Minus') || input.codePressed('NumpadSubtract')) {
      this.stepZoom(-1);
    }
    if (input.codePressed('KeyH') || input.codePressed('Slash')) {
      this.openHelp(game);
      return;
    }
    // B, X, V - brush, box, and the move tool that every other editor also
    // calls V. They sit with the palette digits rather than on the Ctrl side,
    // because picking a tool is the same kind of act as picking a character.
    for (const [code, tool] of TOOL_KEYS) {
      if (input.codePressed(code)) {
        this.setTool(tool);
      }
    }
    // Finding 5: entering a text field ENDS the frame. Without the return, the
    // rest of this method and then `updatePointer` keep running in paint mode
    // behind an open field — and a click on that frame opens a stroke whose
    // `endStroke` the text-mode guard then skips, leaving `strokeButton` set.
    if (input.codePressed('KeyN')) {
      this.beginTextEntry('id');
      return;
    }
    // R is the DESTINATION form of the bracket keys below. Both exist because
    // they are different jobs: nudging an edge while looking at it, and saying
    // outright how big the level is. 190 taps of `]` is not the second one.
    if (input.codePressed('KeyR')) {
      this.beginTextEntry('size');
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
    this.selection = null; // it named cells that may not exist any more
    this.clampZoom();
    this.afterEdit(game, `${this.grid.w} X ${this.grid.h}`);
  }

  /**
   * One rung in or out, and it **stops at the ends rather than wrapping**. A
   * ladder that wrapped would send `-` from the widest view straight to the
   * closest one, which on a 200-wide level is the most disorienting single
   * keystroke the editor could offer.
   */
  private stepZoom(dir: number): void {
    const range = zoomRange(this.grid.w, this.grid.h);
    const next = clamp(this.zoom + dir, range.min, range.max);
    if (next === this.zoom) {
      this.status = dir > 0 ? 'CLOSEST ZOOM FOR THIS SIZE' : 'WIDEST ZOOM FOR THIS SIZE';
      return;
    }
    this.setZoom(next);
    this.status = `ZOOM ${zoomLabel(this.zoom)}`;
  }

  /**
   * Hold the view CENTRE, in tiles, across the change. Anchoring to the top
   * left instead would throw away wherever you were looking, which at the wide
   * end is most of the level.
   */
  private setZoom(index: number): void {
    const before = this.cell;
    const cx = (this.panX + VIEW_W / 2) / before;
    const cy = (this.panY + VIEW_H / 2) / before;
    this.zoom = index;
    const after = this.cell;
    this.panX = cx * after - VIEW_W / 2;
    this.panY = cy * after - VIEW_H / 2;
    this.clampPan();
  }

  /**
   * A resize moves the ends of the ladder, because both depend on the size of
   * the grid — so a level grown past the frame must not be left sitting at a
   * zoom that no longer exists for it.
   */
  private clampZoom(): void {
    const range = zoomRange(this.grid.w, this.grid.h);
    const next = clamp(this.zoom, range.min, range.max);
    if (next !== this.zoom) {
      this.setZoom(next);
    }
  }

  // --- The controls panel. One screen, opened on demand, closed by anything:
  // a reference nobody can dismiss by accident is a reference in the way. ---

  private openHelp(game: Game): void {
    this.cancelDrag(); // the release will land on a panel, not on the grid
    this.mode = 'help';
    game.audio.play('menuMove');
  }

  private updateHelp(game: Game): void {
    // Anything at all closes it, including a click: it is a page of text with
    // nothing to press, so every input an author could try means "done".
    if (game.input.pressedCodes().length > 0 || game.input.pointerPressed(MOUSE_LEFT)) {
      this.mode = 'paint';
      this.status = `${this.tool.toUpperCase()} TOOL`;
      game.audio.play('menuMove');
    }
  }

  // --- Text entry. The id and the name have different charsets because they
  // have different jobs: one becomes a filename and a save key, the other is
  // drawn by a font with no lowercase glyphs. ---

  private beginTextEntry(mode: 'id' | 'name' | 'size'): void {
    // A field swallows every key including the release edge of a drag, so the
    // drag has to end here rather than be left for a pointer-up that the field
    // will never let through.
    this.cancelDrag();
    this.mode = mode;
    // The size field opens on the CURRENT size rather than empty, so the
    // common edit — one dimension, the other left alone — is a backspace or
    // two rather than retyping both.
    this.buffer =
      mode === 'id' ? this.id : mode === 'name' ? this.name : `${this.grid.w}X${this.grid.h}`;
    this.status =
      mode === 'id'
        ? 'TYPE AN ID: A-Z 0-9 -'
        : mode === 'name'
          ? 'TYPE A NAME: A-Z 0-9 SPACE'
          : 'TYPE A SIZE: W X H';
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
    const sizeMode = this.mode === 'size';
    if (code.startsWith('Key')) {
      const letter = code.slice(3);
      // The size field takes digits and the one letter that separates them.
      // Letting the rest through would build a buffer only the parser could
      // reject, on a field whose whole content is two numbers.
      if (sizeMode) {
        return letter === 'X' ? 'X' : null;
      }
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
    if (this.mode === 'size') {
      const size = parseSizeInput(this.buffer);
      if (size === null) {
        // Stays open, like a bad id does: the fix is one backspace away, and
        // closing the field would throw away what was typed to say so.
        this.status = 'BAD SIZE: TYPE W X H, LIKE 60 X 20';
        return;
      }
      const changed = this.grid.setSize(size.w, size.h);
      this.selection = null;
      this.mode = 'paint';
      this.clampZoom();
      // `afterEdit` either way: an unchanged size still owes the author a
      // status line saying what the size actually is.
      this.afterEdit(game, changed ? `${this.grid.w} X ${this.grid.h}` : 'SIZE UNCHANGED');
      this.clampPan();
      return;
    }
    if (this.mode === 'id') {
      // Enforced here as well as in `saveLevel` and in the vite sink: the id is
      // a filename, and the first place to say so is the field you type it in.
      if (!LEVEL_ID_PATTERN.test(this.buffer)) {
        this.status = 'BAD ID: LOWERCASE, DIGITS AND -, NOT STARTING WITH -';
        return;
      }
      // Two kinds of id are already spoken for, and both refusals leave the
      // field open with the text still in it, because the fix is a suffix away.
      // The built-in one is load-bearing: the id IS the filename, so accepting
      // it here is the one thing that could let a save overwrite a shipped
      // level rather than write a copy beside it.
      if (this.buffer !== this.id && isBuiltinId(this.buffer)) {
        this.status = 'THAT ID IS A BUILT-IN LEVEL: PICK ANOTHER, IT SAVES AS A COPY';
        return;
      }
      if (this.buffer !== this.id && draftExists(game.save, this.buffer)) {
        this.status = 'THAT ID IS ALREADY A DRAFT: PICK ANOTHER';
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

    if (input.pointerPressed(MOUSE_LEFT) && inRect(this.helpButton(), input.pointerX, input.pointerY)) {
      this.openHelp(game);
      return;
    }
    if (input.pointerPressed(MOUSE_LEFT)) {
      if (swatch !== null) {
        this.sel = swatch;
        game.audio.play('menuMove');
      } else if (overUi) {
        // A press on a panel is a press on the panel, and nothing else.
      } else if (input.codeDown('Space')) {
        this.beginPan(MOUSE_LEFT, input.pointerX, input.pointerY);
      } else if (input.shiftDown && this.tool === 'brush') {
        const [tx, ty] = this.cellUnderPointer(game);
        this.grid.flood(tx, ty, GRID_CHARS[this.sel]);
        this.afterEdit(game, 'FILL');
      } else {
        this.beginDrag(MOUSE_LEFT, game);
      }
    }
    if (input.pointerPressed(MOUSE_RIGHT) && !overUi) {
      // Right is erase for the two painting tools, and "drop it" for the one
      // that has something to drop. A right-drag that re-selected would leave
      // the select tool no way at all to let go.
      if (this.tool === 'select') {
        this.selection = null;
        this.status = 'SELECTION CLEARED';
      } else {
        this.beginDrag(MOUSE_RIGHT, game);
      }
    }
    if (input.pointerPressed(MOUSE_MIDDLE) && !overUi) {
      this.beginPan(MOUSE_MIDDLE, input.pointerX, input.pointerY);
    }

    if (this.panButton !== null) {
      this.panX -= input.pointerX - this.lastPointerX;
      this.panY -= input.pointerY - this.lastPointerY;
      this.clampPan();
    } else if (this.drag !== null && input.pointerIn) {
      const [tx, ty] = this.cellUnderPointer(game);
      this.drag.cx = tx;
      this.drag.cy = ty;
      // Only the brush edits as it goes. The other three are previews until the
      // button comes up, which is what lets a rectangle be re-aimed.
      if (this.drag.kind === 'brush' && !overUi) {
        this.grid.paint(tx, ty, this.drag.button === MOUSE_RIGHT ? '.' : GRID_CHARS[this.sel]);
      }
    }

    if (this.drag !== null && input.pointerReleased(this.drag.button)) {
      this.endDrag(game);
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
   * Pick a tool, and DROP THE SELECTION with it. An outline that outlived the
   * tool able to act on it is a promise the next click will not keep.
   */
  private setTool(tool: Tool): void {
    if (this.tool === tool) {
      return;
    }
    this.cancelDrag();
    this.tool = tool;
    this.selection = null;
    this.status = `${tool.toUpperCase()} TOOL`;
  }

  /** Open a drag of whichever kind the current tool means by this button. */
  private beginDrag(button: number, game: Game): void {
    const [tx, ty] = this.cellUnderPointer(game);
    const depth = this.grid.undoDepth;
    if (this.tool === 'brush') {
      // The stroke opens on the grid too, because the brush is the one tool
      // that edits per frame and so needs its undo snapshot taken up front.
      this.grid.beginStroke();
      this.drag = { kind: 'brush', button, ax: tx, ay: ty, depth, cx: tx, cy: ty };
      return;
    }
    if (this.tool === 'rect') {
      this.drag = { kind: 'rect', button, ax: tx, ay: ty, depth, cx: tx, cy: ty };
      return;
    }
    // Select: a press INSIDE the selection picks it up, and anywhere else marks
    // out a new one. Same button, and the difference is where you pressed -
    // which is the one convention every editor with a marquee already shares.
    const inside = this.selection !== null && containsCell(this.selection, tx, ty);
    this.drag = {
      kind: inside ? 'move' : 'select',
      button,
      ax: tx,
      ay: ty,
      depth,
      cx: tx,
      cy: ty,
    };
  }

  /**
   * Tear down a drag without committing it — Esc, a tool change, a text field,
   * a playtest, and re-entering the scene on the way back from one.
   *
   * **A brush stroke is rolled back, not merely closed.** It commits per frame,
   * so "cancelled" with the painted cells still there is a lie; the snapshot
   * it pushed is the stroke's own, and `depth` is how we know it pushed one
   * rather than undoing somebody else's edit.
   *
   * Every path that can eat the pointer release has to call this, because the
   * per-frame paint is guarded by the drag being open and not by the button
   * still being down: a drag left open paints on hover for the rest of the
   * session.
   */
  private cancelDrag(): void {
    const d = this.drag;
    this.drag = null;
    if (d === null || d.kind !== 'brush') {
      return;
    }
    this.grid.endStroke();
    if (this.grid.undoDepth > d.depth) {
      this.grid.undo();
      this.revalidate();
    }
  }

  /** The release. Every tool's actual edit happens here except the brush's. */
  private endDrag(game: Game): void {
    const d = this.drag;
    if (d === null) {
      return;
    }
    this.drag = null;
    if (d.kind === 'brush') {
      this.grid.endStroke();
      this.afterEdit(game, this.status);
      return;
    }
    // The CLIPPED rectangle in both cases, so a drag that ran off the edge
    // reports the size it actually filled rather than the size of the gesture.
    const rc = clipRect(d.ax, d.ay, d.cx, d.cy, this.grid.w, this.grid.h);
    if (d.kind === 'rect') {
      const ch = d.button === MOUSE_RIGHT ? EMPTY_CHAR : GRID_CHARS[this.sel];
      const changed = this.grid.fillRect(d.ax, d.ay, d.cx, d.cy, ch);
      this.afterEdit(game, changed ? `RECT ${spanOf(rc)}` : 'RECT CHANGED NOTHING');
      return;
    }
    if (d.kind === 'select') {
      this.selection = rc;
      this.status = rc === null ? 'NOTHING SELECTED' : `SELECTED ${spanOf(rc)}`;
      return;
    }
    const sel = this.selection;
    if (sel === null) {
      return;
    }
    const dx = d.cx - d.ax;
    const dy = d.cy - d.ay;
    if (!this.grid.moveRect(sel.x0, sel.y0, sel.x1, sel.y1, dx, dy)) {
      // Either nothing moved, or the model refused a move that would have
      // destroyed a marker. Both are "the grid is as you left it".
      this.status = 'MOVED NOTHING';
      return;
    }
    // The selection travels with what it moved, so a block can be dragged twice
    // running without being marked out again — CLIPPED, because the cells that
    // fell off the edge are not part of what is now selected.
    this.selection = clipRect(
      sel.x0 + dx,
      sel.y0 + dy,
      sel.x1 + dx,
      sel.y1 + dy,
      this.grid.w,
      this.grid.h,
    );
    this.afterEdit(game, `MOVED ${dx} ${dy}`);
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
    return this.mode === 'id' || this.mode === 'name' || this.mode === 'size'
      ? `${this.mode.toUpperCase()}: ${this.buffer}_`
      : `${this.id}  ·  ${this.name}`;
  }

  private headerMeta(): string {
    // No "PAINT <char>" here, deliberately. `^` has no glyph in the 5×7 font
    // and renders as the fallback hollow box, which reads as a missing glyph
    // rather than as a pad — which is the whole reason the palette bar draws
    // tiles instead of characters. The bar's thick border IS the readout.
    // The copy note rides here rather than on the status line, because the
    // status line is the last thing that happened and this is a standing fact
    // about the level: a built-in was opened, and it will be saved BESIDE the
    // level it came from, never over it.
    const copy = this.copyOf === null ? '' : `   COPY OF ${this.copyOf.toUpperCase()}`;
    return (
      `${this.grid.w} X ${this.grid.h}   ZOOM ${zoomLabel(this.zoom)}   ` +
      `UNDO ${this.grid.undoDepth}   ${this.tool.toUpperCase()}${copy}`
    );
  }

  /** The CONTROLS AND TOOLS button, at the right-hand end of the bar. */
  private helpButton(): Rect {
    const w = measureText(HELP_LABEL, 1) + 20;
    return { x: VIEW_W - 16 - w, y: BAR_Y, w, h: BAR_CELL };
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
   *
   * It is filed under the id, and an id that has changed since the last write
   * is a **move**: leaving the old record behind would put a stale copy of this
   * level on the shelf under the name it used to have, which is exactly the
   * confusion a shelf of drafts exists to end. A built-in's id is never written
   * at all — nothing on the shelf may shadow a shipped level.
   */
  private writeDraft(game: Game): void {
    if (isBuiltinId(this.id)) {
      return;
    }
    const rec = { id: this.id, name: this.name, rows: this.grid.rows };
    if (this.draftKey !== this.id) {
      if (!renameDraft(game.save, this.draftKey, rec)) {
        // `commitTextEntry` refuses an id another draft holds, so this is only
        // reachable if a second tab claimed it in between. The work is safe
        // under the old key, and the id goes back to matching where it is.
        this.id = this.draftKey;
        this.status = `THAT ID IS ALREADY A DRAFT: STILL SAVED AS ${this.draftKey.toUpperCase()}`;
        return;
      }
      this.draftKey = this.id;
      return;
    }
    writeDraft(game.save, rec);
  }

  private playtest(game: Game): void {
    // Same reason as `beginTextEntry`: the release happens in another scene.
    this.cancelDrag();
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
    // The copy rule, enforced where it bites. Unreachable by the ordinary route
    // — a built-in is opened under a copy's id and the id field refuses to type
    // one back — which is exactly why it is checked once more before the write.
    if (isBuiltinId(this.id)) {
      this.status = 'CANNOT SAVE OVER A BUILT-IN LEVEL: PRESS N FOR A NEW ID';
      return;
    }
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
    this.renderTools(r);
    this.renderHeader(r, game);
    this.renderPanel(r);
    this.renderBar(r);
    if (this.mode === 'help') {
      renderHelp(r, 'ANY KEY CLOSES');
    }
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
        // The markers are singletons, so a run of them is always length 1 —
        // pickups are not, so they draw one per cell of the run rather than as
        // one merged slab. They are not geometry and must not read as a floor.
        if (ch === SPAWN_CHAR || ch === GOAL_CHAR || ch === PICKUP_CHAR) {
          for (let i = 0; i < len; i++) {
            drawCellContent(r, ch, (tx + i) * cell + cell / 2, cy, cell, scale, false);
          }
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

  /**
   * The selection and whatever the current drag is about to do. Drawn over the
   * grid and under every panel, because it is a statement about cells.
   *
   * A pending rectangle gets both a tint and an outline: the tint is the only
   * cue that survives over `paper` cells at a glance, and the outline is the
   * only one that survives over `ink` ones. The resting selection gets the
   * outline alone — it is not about to change anything, and a permanent wash
   * over the region would misreport the colours of the level underneath it.
   */
  private renderTools(r: Renderer): void {
    const d = this.drag;
    if (this.selection !== null && (d === null || d.kind !== 'move')) {
      this.outlineRect(r, this.selection, false);
    }
    if (d === null) {
      return;
    }
    if (d.kind === 'rect' || d.kind === 'select') {
      // Tinted in both cases: the tint marks the rectangle that is LIVE, and a
      // pending marquee drawn like the resting selection is two identical
      // outlines with nothing to say which one the pointer is holding.
      const rc = clipRect(d.ax, d.ay, d.cx, d.cy, this.grid.w, this.grid.h);
      if (rc !== null) {
        this.outlineRect(r, rc, true);
      }
      return;
    }
    if (d.kind === 'move' && this.selection !== null) {
      const sel = this.selection;
      const dx = d.cx - d.ax;
      const dy = d.cy - d.ay;
      // Where it came from, and where it is going. Without the first, a drag
      // over a busy grid loses track of what is actually being carried.
      this.outlineRect(r, sel, false);
      this.outlineRect(
        r,
        { x0: sel.x0 + dx, y0: sel.y0 + dy, x1: sel.x1 + dx, y1: sel.y1 + dy },
        true,
      );
    }
  }

  private outlineRect(r: Renderer, rc: CellRect, tint: boolean): void {
    const cell = this.cell;
    const x = rc.x0 * cell;
    const y = rc.y0 * cell;
    const w = (rc.x1 - rc.x0 + 1) * cell;
    const h = (rc.y1 - rc.y0 + 1) * cell;
    if (tint) {
      r.rect(x, y, w, h, palette.inkRgba(EDITOR_MARQUEE_ALPHA));
    }
    r.rectRotatedOutline(x + w / 2, y + h / 2, w, h, 0, palette.ink, EDITOR_MARQUEE_WIDTH);
  }

  private renderCursor(r: Renderer, game: Game): void {
    // A drag draws its own region, and a one-cell cursor inside it is noise.
    if (this.drag !== null && this.drag.kind !== 'brush') {
      return;
    }
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
    const button = this.helpButton();
    const statusX = BAR_X + BAR_W + 20;
    const cols = Math.floor((button.x - 12 - statusX) / 6);
    r.text(this.status.slice(0, Math.max(0, cols)), statusX, BAR_Y + 14, palette.ink);
    // Drawn as a button — a border and a label — because it is the one thing in
    // this scene that is clicked rather than pressed, and a bare word on a
    // plate reads as another status line.
    r.rectRotatedOutline(
      button.x + button.w / 2,
      button.y + button.h / 2,
      button.w,
      button.h,
      0,
      palette.ink,
      this.mode === 'help' ? 3 : 1,
      true,
    );
    r.text(HELP_LABEL, button.x + 10, button.y + 14, palette.ink);
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

/** The tool keys, as a table so a fourth tool cannot be bound in two places. */
const TOOL_KEYS: readonly (readonly [string, Tool])[] = [
  ['KeyB', 'brush'],
  ['KeyX', 'rect'],
  ['KeyV', 'select'],
];

function containsCell(r: CellRect, tx: number, ty: number): boolean {
  return tx >= r.x0 && tx <= r.x1 && ty >= r.y0 && ty <= r.y1;
}

/** `"4 X 2"` for a rectangle, counting cells inclusively at both ends. */
function spanOf(r: CellRect | null): string {
  return r === null ? '0 X 0' : `${r.x1 - r.x0 + 1} X ${r.y1 - r.y0 + 1}`;
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
  if (ch === SPAWN_CHAR) {
    drawSpawn(r, cx, cy, size, ui);
    return;
  }
  if (ch === GOAL_CHAR) {
    drawGoal(r, cx, cy, size * 0.8, ui);
    return;
  }
  if (ch === PICKUP_CHAR) {
    // Always drawn READY in the editor: the spent state is a fact about an
    // attempt in progress, and an author is looking at the level, not at a run.
    drawPickup(r, cx, cy, size * (PICKUP_SIZE / TILE), true, ui);
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

/** The ids `src/levels/index.ts` ships. Nothing an author edits may claim one. */
export function builtinIds(): readonly string[] {
  return LEVELS.map((l) => l.id);
}

export function isBuiltinId(id: string): boolean {
  return builtinIds().includes(id);
}

/**
 * A shipped level, opened for editing — **as a copy, from the first frame**.
 * `levelRows` is `parseLevel`'s inverse, and the id is a fresh one rather than
 * the level's own: a built-in is a file in this repo under version control, and
 * an editor that let you save over it would make the tool the fastest way to
 * lose a shipped level. Saying so at the save would be too late to be a design;
 * saying so by handing back a copy is the design.
 *
 * `taken` is whatever else already claims an id — the draft shelf — so a second
 * copy of the same level lands beside the first rather than on top of it.
 */
export function editorInitFromLevel(level: Level, taken: readonly string[] = []): EditorInit {
  return {
    id: uniqueDraftId(`${level.id}-copy`, [...builtinIds(), ...taken]),
    name: `${level.name} COPY`.slice(0, NAME_MAX),
    rows: levelRows(level),
    copyOf: level.id,
  };
}
