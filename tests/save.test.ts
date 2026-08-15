import { describe, expect, it } from 'vitest';
import { isBetterTime, SAVE_KEYS, SaveStore } from '../src/engine/save';
import type { StorageLike, TimeEntry } from '../src/engine/save';

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

function entry(timeMs: number): TimeEntry {
  return { timeMs, dateIso: '2026-07-16T00:00:00.000Z' };
}

describe('isBetterTime', () => {
  it('lower time wins and a tie is not an improvement', () => {
    expect(isBetterTime(entry(4000), entry(5000))).toBe(true);
    expect(isBetterTime(entry(5000), entry(4000))).toBe(false);
    expect(isBetterTime(entry(4000), entry(4000))).toBe(false);
  });
});

describe('SaveStore.submit', () => {
  it('first submit is a new best and persists', () => {
    const store = new SaveStore(new FakeStorage());
    expect(store.submit('k', entry(5000)).isNewBest).toBe(true);
    expect(store.getBest('k')).toEqual(entry(5000));
  });

  it('faster beats slower; slower does not overwrite', () => {
    const store = new SaveStore(new FakeStorage());
    store.submit('k', entry(5000));
    expect(store.submit('k', entry(4000)).isNewBest).toBe(true);
    expect(store.submit('k', entry(9000)).isNewBest).toBe(false);
    expect(store.getBest('k')).toEqual(entry(4000));
  });

  it('re-submitting the exact best is not a new best', () => {
    const store = new SaveStore(new FakeStorage());
    store.submit('k', entry(4000));
    expect(store.submit('k', entry(4000)).isNewBest).toBe(false);
  });

  it('per-level keys are independent', () => {
    const store = new SaveStore(new FakeStorage());
    store.submit(SAVE_KEYS.best('01-first-steps'), entry(1000));
    expect(store.getBest(SAVE_KEYS.best('02-flip'))).toBeNull();
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
    storage.setItem('k', JSON.stringify({ timeMs: 'fast' }));
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
    expect(store.submit('k', entry(1200)).isNewBest).toBe(true);
    expect(store.getBest('k')).toEqual(entry(1200));
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
    expect(store.submit('k', entry(100)).isNewBest).toBe(true);
    expect(store.getBest('k')).toEqual(entry(100));
    store.setFlag('f', true);
    expect(store.getFlag('f')).toBe(true);
  });

  it('never throws when the storage itself throws', () => {
    const store = new SaveStore(new ThrowingStorage());
    expect(store.getBest('k')).toBeNull();
    expect(store.submit('k', entry(1)).isNewBest).toBe(true); // best-effort
    expect(store.getFlag('f')).toBe(false);
    expect(() => store.setFlag('f', true)).not.toThrow();
  });
});

describe('SAVE_KEYS', () => {
  it('matches the GAME-DESIGN §3 bw. key scheme', () => {
    expect(SAVE_KEYS.progress).toBe('bw.progress');
    expect(SAVE_KEYS.muted).toBe('bw.muted');
    expect(SAVE_KEYS.editorDraft).toBe('bw.editor.draft');
    expect(SAVE_KEYS.best('01-first-steps')).toBe('bw.best.01-first-steps');
  });
});
