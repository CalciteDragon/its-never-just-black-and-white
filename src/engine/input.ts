/**
 * Keyboard input with a pure, node-testable core. `onKey` ingests
 * KeyboardEvent.code strings; `attach` (browser-only, called from main.ts)
 * wires real listeners. Edge state (pressed/released) is cleared by `update()`
 * once per rendered frame.
 *
 * Single player, so an action is just an action — no player index anywhere.
 */

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

export class Input {
  /** code -> actions it drives. */
  private readonly codeMap = new Map<string, readonly Action[]>();
  private readonly downSet = new Set<Action>();
  private readonly pressedSet = new Set<Action>();
  private readonly releasedSet = new Set<Action>();
  /** Per-action count of physical codes currently held (multi-key bindings). */
  private readonly holdCounts = new Map<Action, number>();

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

  /** Pure core: feed a KeyboardEvent.code and its down/up state. */
  onKey(code: string, down: boolean): void {
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

  /** Clear one-frame edges. Call ONCE at the end of each rendered frame. */
  update(): void {
    this.pressedSet.clear();
    this.releasedSet.clear();
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

  /**
   * Browser-only: wire keydown/keyup on a window. Only ever called from
   * main.ts; importing this module in node stays side-effect-free.
   */
  attach(win: Window): void {
    win.addEventListener('keydown', (e: KeyboardEvent) => {
      if (PREVENT_DEFAULT_CODES.has(e.code)) {
        e.preventDefault();
      }
      if (e.repeat) {
        return;
      }
      this.onKey(e.code, true);
    });
    win.addEventListener('keyup', (e: KeyboardEvent) => {
      if (PREVENT_DEFAULT_CODES.has(e.code)) {
        e.preventDefault();
      }
      this.onKey(e.code, false);
    });
  }
}
