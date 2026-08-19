/**
 * Best-time + flag persistence. Storage is injectable for tests; defaults to
 * localStorage when available, otherwise an in-memory Map. Every storage
 * access is wrapped in try/catch (private mode, quota, corrupt JSON).
 *
 * There is no score in this game — a level result is a time, and lower wins.
 */

export interface TimeEntry {
  /** Completion time in milliseconds. Lower is better. */
  timeMs: number;
  dateIso: string;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** localStorage keys (GAME-DESIGN §3/§12). */
export const SAVE_KEYS = {
  /** Furthest level reached. */
  progress: 'bw.progress',
  muted: 'bw.muted',
  /**
   * The pre-multi-draft key, kept for two jobs and no third: `levelio`'s
   * last-ditch fallback writes the saved JSON here when there is no server and
   * no clipboard, and `editor/drafts.ts` imports whatever it finds here once,
   * so an author who left a level in the old single draft still has it.
   */
  editorDraft: 'bw.editor.draft',
  /** The draft index: a JSON array of level ids, in the order they were made. */
  editorDrafts: 'bw.editor.drafts',
  /** One work-in-progress level, e.g. draft('cellar'). */
  draft(levelId: string): string {
    return `bw.editor.draft.${levelId}`;
  },
  /** Per-level best time, e.g. best('01-first-steps'). */
  best(levelId: string): string {
    return `bw.best.${levelId}`;
  },
} as const;

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();

  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }

  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

function defaultStorage(): StorageLike {
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (ls) {
      return ls;
    }
  } catch {
    // Access to localStorage itself can throw (e.g. sandboxed iframes).
  }
  return new MemoryStorage();
}

function isTimeEntry(v: unknown): v is TimeEntry {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const e = v as Record<string, unknown>;
  return typeof e.timeMs === 'number' && typeof e.dateIso === 'string';
}

/** Is `a` a better result than `b`? Strictly faster wins; a tie is not better. */
export function isBetterTime(a: TimeEntry, b: TimeEntry): boolean {
  return a.timeMs < b.timeMs;
}

export class SaveStore {
  private readonly storage: StorageLike;

  constructor(storage?: StorageLike) {
    this.storage = storage ?? defaultStorage();
  }

  /** Stored best for a key, or null (missing / corrupt / unreadable). */
  getBest(key: string): TimeEntry | null {
    try {
      const raw = this.storage.getItem(key);
      if (raw === null) {
        return null;
      }
      const parsed: unknown = JSON.parse(raw);
      return isTimeEntry(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Record a time; persists (and reports) only if it beats the stored best. */
  submit(key: string, entry: TimeEntry): { isNewBest: boolean } {
    const best = this.getBest(key);
    if (best !== null && !isBetterTime(entry, best)) {
      return { isNewBest: false };
    }
    try {
      this.storage.setItem(key, JSON.stringify(entry));
    } catch {
      // Persistence is best-effort; the result still counts this session.
    }
    return { isNewBest: true };
  }

  /**
   * A raw string, guarded. The editor's draft is JSON the editor itself owns —
   * it would be `getBest`'s shape check applied to the wrong shape, and a
   * `SaveStore` that knew what a level grid was would be a layering violation
   * for no gain.
   */
  getText(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  setText(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch {
      // Best-effort, like every other write here.
    }
  }

  /** Boolean flag (e.g. mute). Missing/corrupt → false. */
  getFlag(key: string): boolean {
    try {
      return this.storage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  setFlag(key: string, v: boolean): void {
    try {
      this.storage.setItem(key, v ? '1' : '0');
    } catch {
      // Best-effort.
    }
  }

  /**
   * Furthest level reached, gating the level select. Anything unreadable,
   * missing, negative or not finite reads as **0**, which unlocks exactly the
   * first level — not zero, which would lock a player out of their own game,
   * and not all of them, which would make the key pointless.
   */
  getProgress(): number {
    try {
      const raw = this.storage.getItem(SAVE_KEYS.progress);
      if (raw === null || raw.trim() === '') {
        return 0;
      }
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Advance progress. **Monotone**, because completing an early level again
   * must not re-lock the later ones — and a player who replays level 1 for a
   * better time would otherwise find the rest of the game gone.
   */
  setProgress(n: number): void {
    if (!Number.isFinite(n)) {
      return;
    }
    const next = Math.max(this.getProgress(), Math.floor(n));
    try {
      this.storage.setItem(SAVE_KEYS.progress, String(next));
    } catch {
      // Best-effort, like every other write here.
    }
  }
}
