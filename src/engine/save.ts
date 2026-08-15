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
  editorDraft: 'bw.editor.draft',
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
}
