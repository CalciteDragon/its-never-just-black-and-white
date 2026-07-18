import { describe, expect, it } from 'vitest';
import { SAVE_KEYS, SaveStore } from '../src/engine/save';
import type { ScoreEntry, StorageLike } from '../src/engine/save';

class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();

  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }

  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error('nope');
  }

  setItem(): void {
    throw new Error('nope');
  }
}

function entry(score: number, timeMs: number): ScoreEntry {
  return { score, timeMs, coins: score / 10, dateIso: '2026-07-16T00:00:00.000Z' };
}

describe('SaveStore.submit', () => {
  it('first submit is a new best and persists', () => {
    const store = new SaveStore(new FakeStorage());
    expect(store.submit('k', entry(100, 5000)).isNewBest).toBe(true);
    expect(store.getBest('k')).toEqual(entry(100, 5000));
  });

  it('higher score beats lower; lower score does not overwrite', () => {
    const store = new SaveStore(new FakeStorage());
    store.submit('k', entry(100, 5000));
    expect(store.submit('k', entry(150, 9000)).isNewBest).toBe(true);
    expect(store.submit('k', entry(120, 1000)).isNewBest).toBe(false);
    expect(store.getBest('k')).toEqual(entry(150, 9000));
  });

  it('score ties break by lower timeMs; equal score and time is not a new best', () => {
    const store = new SaveStore(new FakeStorage());
    store.submit('k', entry(100, 5000));
    expect(store.submit('k', entry(100, 4000)).isNewBest).toBe(true);
    expect(store.getBest('k')).toEqual(entry(100, 4000));
    expect(store.submit('k', entry(100, 6000)).isNewBest).toBe(false);
    expect(store.submit('k', entry(100, 4000)).isNewBest).toBe(false);
  });

  it('keys are independent', () => {
    const store = new SaveStore(new FakeStorage());
    store.submit(SAVE_KEYS.adventure, entry(100, 1));
    expect(store.getBest(SAVE_KEYS.coop)).toBeNull();
  });
});

describe('SaveStore.getBest robustness', () => {
  it('missing key is null', () => {
    expect(new SaveStore(new FakeStorage()).getBest('nope')).toBeNull();
  });

  it('corrupt JSON is tolerated as null', () => {
    const storage = new FakeStorage();
    storage.setItem('k', '{not json');
    expect(new SaveStore(storage).getBest('k')).toBeNull();
  });

  it('wrong-shape JSON is tolerated as null', () => {
    const storage = new FakeStorage();
    storage.setItem('k', JSON.stringify({ score: 'high', timeMs: 1 }));
    expect(new SaveStore(storage).getBest('k')).toBeNull();
    storage.setItem('k', JSON.stringify([1, 2, 3]));
    expect(new SaveStore(storage).getBest('k')).toBeNull();
    storage.setItem('k', 'null');
    expect(new SaveStore(storage).getBest('k')).toBeNull();
  });

  it('a corrupt best is simply replaced on next submit', () => {
    const storage = new FakeStorage();
    storage.setItem('k', 'garbage');
    const store = new SaveStore(storage);
    expect(store.submit('k', entry(10, 1)).isNewBest).toBe(true);
    expect(store.getBest('k')).toEqual(entry(10, 1));
  });
});

describe('SaveStore flags', () => {
  it('roundtrips and defaults to false', () => {
    const store = new SaveStore(new FakeStorage());
    expect(store.getFlag(SAVE_KEYS.muted)).toBe(false);
    store.setFlag(SAVE_KEYS.muted, true);
    expect(store.getFlag(SAVE_KEYS.muted)).toBe(true);
    store.setFlag(SAVE_KEYS.muted, false);
    expect(store.getFlag(SAVE_KEYS.muted)).toBe(false);
  });
});

describe('SaveStore fallbacks', () => {
  it('works with no storage at all (in-memory fallback in node)', () => {
    const store = new SaveStore();
    expect(store.getBest('k')).toBeNull();
    expect(store.submit('k', entry(50, 100)).isNewBest).toBe(true);
    expect(store.getBest('k')).toEqual(entry(50, 100));
    store.setFlag('f', true);
    expect(store.getFlag('f')).toBe(true);
  });

  it('never throws when the storage itself throws', () => {
    const store = new SaveStore(new ThrowingStorage());
    expect(store.getBest('k')).toBeNull();
    expect(store.submit('k', entry(1, 1)).isNewBest).toBe(true); // best-effort
    expect(store.getFlag('f')).toBe(false);
    expect(() => store.setFlag('f', true)).not.toThrow();
  });
});

describe('SAVE_KEYS', () => {
  it('matches the GAME-DESIGN §3 key scheme', () => {
    expect(SAVE_KEYS.adventure).toBe('pq.best.adventure');
    expect(SAVE_KEYS.coop).toBe('pq.best.coop');
    expect(SAVE_KEYS.muted).toBe('pq.muted');
    expect(SAVE_KEYS.daily('2026-07-16')).toBe('pq.daily.2026-07-16');
  });
});
