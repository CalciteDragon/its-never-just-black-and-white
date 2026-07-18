/**
 * Keyboard input with a pure, node-testable core. `onKey` ingests
 * KeyboardEvent.code strings; `attach` (browser-only, called from main.ts)
 * wires real listeners. Edge state (pressed/released) is cleared by `update()`
 * once per rendered frame.
 */

export type Action =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'jump'
  | 'confirm'
  | 'back'
  | 'pause'
  | 'mute'
  | 'fullscreen';

export type PlayerIndex = 0 | 1;

export interface Binding {
  player: PlayerIndex | 'both';
  action: Action;
  codes: readonly string[];
}

/**
 * Binding table (also rendered by the how-to screen).
 * Player 0: WASD + Space. Player 1: arrows. Globals apply to both players.
 */
export const BINDINGS: readonly Binding[] = [
  { player: 0, action: 'left', codes: ['KeyA'] },
  { player: 0, action: 'right', codes: ['KeyD'] },
  { player: 0, action: 'up', codes: ['KeyW'] },
  { player: 0, action: 'down', codes: ['KeyS'] },
  { player: 0, action: 'jump', codes: ['KeyW', 'Space'] },
  { player: 1, action: 'left', codes: ['ArrowLeft'] },
  { player: 1, action: 'right', codes: ['ArrowRight'] },
  { player: 1, action: 'up', codes: ['ArrowUp'] },
  { player: 1, action: 'down', codes: ['ArrowDown'] },
  { player: 1, action: 'jump', codes: ['ArrowUp'] },
  { player: 'both', action: 'confirm', codes: ['Enter', 'Space'] },
  { player: 'both', action: 'back', codes: ['Escape', 'KeyP'] },
  { player: 'both', action: 'pause', codes: ['Escape', 'KeyP'] },
  { player: 'both', action: 'mute', codes: ['KeyM'] },
  { player: 'both', action: 'fullscreen', codes: ['KeyF'] },
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

/** player-action composite key, e.g. '0:jump'. */
function slot(player: PlayerIndex, action: Action): string {
  return `${player}:${action}`;
}

export class Input {
  /** code -> list of (player, action) slots it drives. */
  private readonly codeMap = new Map<string, readonly string[]>();
  private readonly downSet = new Set<string>();
  private readonly pressedSet = new Set<string>();
  private readonly releasedSet = new Set<string>();
  /** Per-slot count of physical codes currently held (multi-key bindings). */
  private readonly holdCounts = new Map<string, number>();

  constructor() {
    const map = new Map<string, string[]>();
    for (const b of BINDINGS) {
      const players: PlayerIndex[] = b.player === 'both' ? [0, 1] : [b.player];
      for (const code of b.codes) {
        let list = map.get(code);
        if (!list) {
          list = [];
          map.set(code, list);
        }
        for (const p of players) {
          const s = slot(p, b.action);
          if (!list.includes(s)) {
            list.push(s);
          }
        }
      }
    }
    for (const [code, list] of map) {
      this.codeMap.set(code, list);
    }
  }

  /** Pure core: feed a KeyboardEvent.code and its down/up state. */
  onKey(code: string, down: boolean): void {
    const slots = this.codeMap.get(code);
    if (!slots) {
      return;
    }
    for (const s of slots) {
      const count = this.holdCounts.get(s) ?? 0;
      if (down) {
        if (count === 0) {
          this.downSet.add(s);
          this.pressedSet.add(s);
        }
        this.holdCounts.set(s, count + 1);
      } else {
        const next = Math.max(0, count - 1);
        this.holdCounts.set(s, next);
        if (count > 0 && next === 0) {
          this.downSet.delete(s);
          this.releasedSet.add(s);
        }
      }
    }
  }

  /** Clear one-frame edges. Call ONCE at the end of each rendered frame. */
  update(): void {
    this.pressedSet.clear();
    this.releasedSet.clear();
  }

  /** Is the action currently held for this player? */
  down(player: PlayerIndex, action: Action): boolean {
    return this.downSet.has(slot(player, action));
  }

  /** Did the action go down since the last update()? */
  pressed(player: PlayerIndex, action: Action): boolean {
    return this.pressedSet.has(slot(player, action));
  }

  /** Did the action go up since the last update()? */
  released(player: PlayerIndex, action: Action): boolean {
    return this.releasedSet.has(slot(player, action));
  }

  /** Held by either player? */
  anyDown(action: Action): boolean {
    return this.down(0, action) || this.down(1, action);
  }

  /** Pressed by either player since the last update()? */
  anyPressed(action: Action): boolean {
    return this.pressed(0, action) || this.pressed(1, action);
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
