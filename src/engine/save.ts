/**
 * Best-score + flag persistence. Storage is injectable for tests; defaults to
 * localStorage when available, otherwise an in-memory Map. Every storage
 * access is wrapped in try/catch (private mode, quota, corrupt JSON).
 */

export interface ScoreEntry {
  score: number;
  timeMs: number;
  coins: number;
  dateIso: string;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** localStorage keys (GAME-DESIGN §3). */
export const SAVE_KEYS = {
  adventure: 'pq.best.adventure',
  coop: 'pq.best.coop',
  muted: 'pq.muted',
  /** Per-day daily-challenge best, e.g. daily('2026-07-16'). */
  daily(dateStr: string): string {
    return `pq.daily.${dateStr}`;
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

function isScoreEntry(v: unknown): v is ScoreEntry {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const e = v as Record<string, unknown>;
  return (
    typeof e.score === 'number' &&
    typeof e.timeMs === 'number' &&
    typeof e.coins === 'number' &&
    typeof e.dateIso === 'string'
  );
}

/** Is `a` a better result than `b`? Higher score wins; ties → lower timeMs. */
export function isBetterScore(a: ScoreEntry, b: ScoreEntry): boolean {
  if (a.score !== b.score) {
    return a.score > b.score;
  }
  return a.timeMs < b.timeMs;
}

export class SaveStore {
  private readonly storage: StorageLike;

  constructor(storage?: StorageLike) {
    this.storage = storage ?? defaultStorage();
  }

  /** Stored best for a key, or null (missing / corrupt / unreadable). */
  getBest(key: string): ScoreEntry | null {
    try {
      const raw = this.storage.getItem(key);
      if (raw === null) {
        return null;
      }
      const parsed: unknown = JSON.parse(raw);
      return isScoreEntry(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Record a result; persists (and reports) only if it beats the stored best. */
  submit(key: string, entry: ScoreEntry): { isNewBest: boolean } {
    const best = this.getBest(key);
    if (best !== null && !isBetterScore(entry, best)) {
      return { isNewBest: false };
    }
    try {
      this.storage.setItem(key, JSON.stringify(entry));
    } catch {
      // Persistence is best-effort; the run result still counts this session.
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
