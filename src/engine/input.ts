/**
 * Keyboard and pointer input with a pure, node-testable core. `onKey` ingests
 * KeyboardEvent.code strings and `onPointerDown/Move/Up` ingests VIEW-space
 * coordinates; `attach` (browser-only, called from main.ts) wires real
 * listeners. Edge state (pressed/released) is cleared by `update()` once per
 * consumed fixed step.
 *
 * Single player, so an action is just an action — no player index anywhere.
 *
 * Three layers, and the reason there are three rather than one (PHASES phase 7,
 * decision 2):
 *
 * - **Actions** are the game's verbs, and GAME-DESIGN §12 pins the list.
 *   `PlayScene` reads nothing else.
 * - **Raw codes** are every `KeyboardEvent.code`, recorded whether or not it is
 *   bound. The editor needs `Digit1`–`Digit8` for its palette, `ShiftLeft` for
 *   flood and letters for the id field, and not one of those is a game verb —
 *   "paint" is not an `Action` and must not become one. The raw layer also
 *   settles `Space`, which is bound to *both* `flip` and `confirm`: the
 *   editor's space-drag pan reads the code, not either action.
 * - **The pointer** arrives already converted to view space by `attach`, so
 *   this core never learns that a scale exists — which is what lets the editor
 *   unit-test headlessly, with the mouse included and no canvas anywhere.
 */

import { VIEW_H, VIEW_W } from '../constants';
import { screenToView } from './renderer';

export type Action =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'jump'
  | 'flip'
  | 'restart'
  | 'confirm'
  | 'back'
  | 'pause'
  | 'mute'
  | 'fullscreen';

export interface Binding {
  action: Action;
  codes: readonly string[];
}

/** Binding table (GAME-DESIGN §4). Also what the controls footer renders from. */
export const BINDINGS: readonly Binding[] = [
  { action: 'left', codes: ['KeyA', 'ArrowLeft'] },
  { action: 'right', codes: ['KeyD', 'ArrowRight'] },
  { action: 'up', codes: ['KeyW', 'ArrowUp'] },
  { action: 'down', codes: ['KeyS', 'ArrowDown'] },
  { action: 'jump', codes: ['KeyW', 'ArrowUp', 'KeyZ'] },
  { action: 'flip', codes: ['Space'] },
  { action: 'restart', codes: ['KeyR'] },
  { action: 'confirm', codes: ['Enter', 'Space'] },
  { action: 'back', codes: ['Escape', 'KeyP'] },
  { action: 'pause', codes: ['Escape', 'KeyP'] },
  { action: 'mute', codes: ['KeyM'] },
  { action: 'fullscreen', codes: ['KeyF'] },
];

/** Keys whose browser default (scrolling etc.) must be suppressed. */
const PREVENT_DEFAULT_CODES: ReadonlySet<string> = new Set([
  'Space',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
]);

/**
 * Keys whose browser default must be suppressed **only when Ctrl or Cmd is
 * held** — the editor's shortcuts, which collide with the browser's own.
 *
 * `KeyS` is already in the set above, as one of the four WASD keys, so Ctrl+S
 * happens to be suppressed today by accident. That is precisely why this table
 * exists: the day somebody rebinds movement off WASD, "save this page" would
 * start appearing over the editor and nothing would explain why. Stated here,
 * the suppression survives any change to the movement keys.
 *
 * Cmd is included because `e.code` is `KeyS` on a Mac too, and Cmd+S there is
 * the same dialog. The editor still only acts on Ctrl (`ctrlDown`); this list
 * is about the browser, not about the binding.
 */
const CTRL_PREVENT_DEFAULT_CODES: ReadonlySet<string> = new Set(['KeyS']);

/**
 * Codes whose label is not the code with its prefix stripped. `Escape` is the
 * one that earns the table: "ESCAPE" is six glyphs of a footer that has to fit
 * several bindings on one line.
 */
const CODE_LABELS: Readonly<Record<string, string>> = {
  Escape: 'ESC',
  Space: 'SPACE',
  Enter: 'ENTER',
  Backspace: 'BKSP',
  Tab: 'TAB',
  ShiftLeft: 'SHIFT',
  ShiftRight: 'SHIFT',
  ControlLeft: 'CTRL',
  ControlRight: 'CTRL',
};

/**
 * A `KeyboardEvent.code` as the 5×7 font can draw it. The font has no lowercase
 * glyphs, so everything comes back upper case; anything the table cannot name
 * shortly keeps its own code, which is ugly but is never a lie.
 */
export function codeLabel(code: string): string {
  const named = CODE_LABELS[code];
  if (named !== undefined) {
    return named;
  }
  if (code.startsWith('Key')) {
    return code.slice(3);
  }
  if (code.startsWith('Digit')) {
    return code.slice(5);
  }
  if (code.startsWith('Arrow')) {
    return code.slice(5).toUpperCase();
  }
  return code.toUpperCase();
}

/**
 * The label for an action's FIRST bound code. The title screen's controls
 * footer renders from this rather than from a hardcoded string, so a rebinding
 * cannot silently leave the footer lying about which key does what.
 */
export function bindingLabel(action: Action): string {
  const b = BINDINGS.find((x) => x.action === action);
  return b ? codeLabel(b.codes[0]) : '';
}

/** DOM `MouseEvent.button` values, named. */
export const MOUSE_LEFT = 0;
export const MOUSE_MIDDLE = 1;
export const MOUSE_RIGHT = 2;

export class Input {
  /** code -> actions it drives. */
  private readonly codeMap = new Map<string, readonly Action[]>();
  private readonly downSet = new Set<Action>();
  private readonly pressedSet = new Set<Action>();
  private readonly releasedSet = new Set<Action>();
  /** Per-action count of physical codes currently held (multi-key bindings). */
  private readonly holdCounts = new Map<Action, number>();

  /** The raw layer: every code, bound or not. */
  private readonly codeDownSet = new Set<string>();
  private readonly codePressedSet = new Set<string>();

  /** Pointer position in VIEW space, and whether it is inside the frame. */
  private px = 0;
  private py = 0;
  private pIn = false;
  private readonly btnDown = new Set<number>();
  private readonly btnPressed = new Set<number>();
  private readonly btnReleased = new Set<number>();

  constructor() {
    const map = new Map<string, Action[]>();
    for (const b of BINDINGS) {
      for (const code of b.codes) {
        let list = map.get(code);
        if (!list) {
          list = [];
          map.set(code, list);
        }
        if (!list.includes(b.action)) {
          list.push(b.action);
        }
      }
    }
    for (const [code, list] of map) {
      this.codeMap.set(code, list);
    }
  }

  /**
   * Pure core: feed a KeyboardEvent.code and its down/up state. The raw layer
   * is recorded FIRST and unconditionally — the early return below is what the
   * ACTION layer does with an unbound code, not what the input system does.
   */
  onKey(code: string, down: boolean): void {
    if (down) {
      if (!this.codeDownSet.has(code)) {
        this.codeDownSet.add(code);
        this.codePressedSet.add(code);
      }
    } else {
      this.codeDownSet.delete(code);
    }
    const actions = this.codeMap.get(code);
    if (!actions) {
      return;
    }
    for (const a of actions) {
      const count = this.holdCounts.get(a) ?? 0;
      if (down) {
        if (count === 0) {
          this.downSet.add(a);
          this.pressedSet.add(a);
        }
        this.holdCounts.set(a, count + 1);
      } else {
        const next = Math.max(0, count - 1);
        this.holdCounts.set(a, next);
        if (count > 0 && next === 0) {
          this.downSet.delete(a);
          this.releasedSet.add(a);
        }
      }
    }
  }

  /**
   * Clear one-frame edges — ALL of them, on all three layers, in one call. A
   * pointer edge outliving a key edge would be a frame of skew between the
   * mouse and the keyboard, which is a class of editor bug nobody would think
   * to go looking for.
   */
  update(): void {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.codePressedSet.clear();
    this.btnPressed.clear();
    this.btnReleased.clear();
  }

  /** Is the action currently held? */
  down(action: Action): boolean {
    return this.downSet.has(action);
  }

  /** Did the action go down since the last update()? */
  pressed(action: Action): boolean {
    return this.pressedSet.has(action);
  }

  /** Did the action go up since the last update()? */
  released(action: Action): boolean {
    return this.releasedSet.has(action);
  }

  /** Is this physical code held, bound or not? */
  codeDown(code: string): boolean {
    return this.codeDownSet.has(code);
  }

  /** Did this physical code go down since the last update()? */
  codePressed(code: string): boolean {
    return this.codePressedSet.has(code);
  }

  /**
   * Every code pressed since the last update(). Text entry needs to know WHICH
   * key arrived, and probing forty codes one at a time to find out is a loop
   * over the alphabet sitting in a scene.
   */
  pressedCodes(): readonly string[] {
    return [...this.codePressedSet];
  }

  /** Either shift key — flood-fill, and the opposite-edge resize. */
  get shiftDown(): boolean {
    return this.codeDownSet.has('ShiftLeft') || this.codeDownSet.has('ShiftRight');
  }

  /** Either control key — undo, redo, save. */
  get ctrlDown(): boolean {
    return this.codeDownSet.has('ControlLeft') || this.codeDownSet.has('ControlRight');
  }

  // --- Pointer. Coordinates are VIEW space: `attach` has already run the
  // letterbox inverse, so nothing below knows that a scale exists. ---

  get pointerX(): number {
    return this.px;
  }

  get pointerY(): number {
    return this.py;
  }

  /** Is the pointer over the 960×540 frame rather than in a letterbox bar? */
  get pointerIn(): boolean {
    return this.pIn;
  }

  /**
   * A press. **A press in the letterbox is not a press at all** — it is not a
   * press on the edge tile, which is what clamping would make it, and what
   * would smear a wall of tiles down the border of every level.
   */
  onPointerDown(vx: number, vy: number, button: number): void {
    this.movePointer(vx, vy);
    if (!this.pIn || this.btnDown.has(button)) {
      return;
    }
    this.btnDown.add(button);
    this.btnPressed.add(button);
  }

  onPointerMove(vx: number, vy: number): void {
    this.movePointer(vx, vy);
  }

  /**
   * A release, and it is honoured WHEREVER it lands. The alternative is a
   * stroke that never ends because the button came up over a letterbox bar,
   * and an editor that keeps painting for the rest of the session.
   */
  onPointerUp(vx: number, vy: number, button: number): void {
    this.movePointer(vx, vy);
    if (this.btnDown.delete(button)) {
      this.btnReleased.add(button);
    }
  }

  pointerDown(button: number): boolean {
    return this.btnDown.has(button);
  }

  pointerPressed(button: number): boolean {
    return this.btnPressed.has(button);
  }

  pointerReleased(button: number): boolean {
    return this.btnReleased.has(button);
  }

  private movePointer(vx: number, vy: number): void {
    this.px = vx;
    this.py = vy;
    // Half-open, like every other bound in the project: the pixel at VIEW_W is
    // the first one outside the frame.
    this.pIn = vx >= 0 && vx < VIEW_W && vy >= 0 && vy < VIEW_H;
  }

  /**
   * Browser-only: wire keydown/keyup on a window, and — given the visible
   * canvas — the pointer too. One of the four sanctioned places that may touch
   * a DOM API; importing this module in node stays side-effect-free.
   *
   * **The conversion to view space happens HERE, on the way in.** That is the
   * whole of decision 2: the pure core above never sees a client coordinate, so
   * there is exactly one place in the project where the letterbox arithmetic
   * lives and exactly one place it can be wrong.
   */
  attach(win: Window, canvas?: HTMLCanvasElement): void {
    win.addEventListener('keydown', (e: KeyboardEvent) => {
      if (preventsDefault(e.code, e.ctrlKey || e.metaKey)) {
        e.preventDefault();
      }
      if (e.repeat) {
        return;
      }
      this.onKey(e.code, true);
    });
    win.addEventListener('keyup', (e: KeyboardEvent) => {
      if (preventsDefault(e.code, e.ctrlKey || e.metaKey)) {
        e.preventDefault();
      }
      this.onKey(e.code, false);
    });
    // The window loses every held key when it loses focus, and the browser
    // sends no keyup for them. Without this, alt-tabbing away mid-run comes
    // back with `right` still held and a level playing itself.
    win.addEventListener('blur', () => {
      this.releaseAll();
    });
    if (!canvas) {
      return;
    }

    // `getBoundingClientRect` rather than `clientX` alone: the canvas is sized
    // to the window and laid out at the origin today, but a CSS change that
    // moved it would otherwise offset every paint by a silent constant.
    const toView = (e: MouseEvent): { vx: number; vy: number } => {
      const rect = canvas.getBoundingClientRect();
      return screenToView(canvas.width, canvas.height, e.clientX - rect.left, e.clientY - rect.top);
    };
    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      const { vx, vy } = toView(e);
      this.onPointerDown(vx, vy, e.button);
    });
    // On the WINDOW, not the canvas: a drag is allowed to leave the frame, and
    // the editor's rule is that it stops painting rather than clamping — which
    // it can only do if it keeps hearing where the pointer went.
    win.addEventListener('pointermove', (e: PointerEvent) => {
      const { vx, vy } = toView(e);
      this.onPointerMove(vx, vy);
    });
    win.addEventListener('pointerup', (e: PointerEvent) => {
      const { vx, vy } = toView(e);
      this.onPointerUp(vx, vy, e.button);
    });
    // Right-drag is the editor's erase, so the context menu has to go.
    canvas.addEventListener('contextmenu', (e: Event) => {
      e.preventDefault();
    });
  }

  /** Drop every held key and button, keeping the release edges honest. */
  private releaseAll(): void {
    for (const code of [...this.codeDownSet]) {
      this.onKey(code, false);
    }
    for (const button of [...this.btnDown]) {
      this.btnDown.delete(button);
      this.btnReleased.add(button);
    }
  }
}

/**
 * Should this keydown/keyup have its browser default suppressed? Exported so
 * the rule is testable without a DOM: the whole point of naming Ctrl+S here is
 * that a test can assert it, rather than it being an accident of WASD.
 */
export function preventsDefault(code: string, ctrlOrMeta: boolean): boolean {
  return PREVENT_DEFAULT_CODES.has(code) || (ctrlOrMeta && CTRL_PREVENT_DEFAULT_CODES.has(code));
}
