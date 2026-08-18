import { describe, expect, it } from 'vitest';
import { FALLBACK_GLYPH, glyphFor } from '../src/engine/font';
import { buildLevelPayload, isValidLevelId, LEVEL_ID_PATTERN, saveLevel } from '../src/engine/levelio';
import type { FetchLike, LevelPayload } from '../src/engine/levelio';
import { SAVE_KEYS } from '../src/engine/save';
import type { StorageLike } from '../src/engine/save';
import { parseLevel, serializeLevel } from '../src/world/level';
import firstSteps from '../src/levels/01-first-steps.json';

class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();

  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }

  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

/** Private mode, quota, a sandboxed iframe: every storage call can throw. */
class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error('nope');
  }

  setItem(): void {
    throw new Error('nope');
  }
}

interface FetchCall {
  readonly url: string;
  readonly method: string;
  readonly body: string;
}

/** A fetch that records what it was handed and answers with a fixed status. */
function fakeFetch(status: number, calls: FetchCall[]): FetchLike {
  return (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    return Promise.resolve({ status });
  };
}

/** The dev server is not running / the machine is offline: the promise rejects. */
function rejectingFetch(calls: FetchCall[]): FetchLike {
  return (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    return Promise.reject(new Error('ECONNREFUSED'));
  };
}

/**
 * Runs `fn` with no `globalThis.fetch` at all — the shape a very old browser or
 * a stripped test environment has, and the one branch of `saveLevel` that
 * cannot be reached by passing a dep. Restored afterwards either way.
 */
async function withoutGlobalFetch<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as { fetch?: unknown };
  const real = g.fetch;
  delete g.fetch;
  if (g.fetch !== undefined) {
    g.fetch = undefined; // Non-configurable in some runtimes; shadow it instead.
  }
  // Without this the test could pass for the wrong reason: node's real fetch
  // would reject on the relative URL and land in the same fallback branch.
  expect(g.fetch).toBeUndefined();
  try {
    return await fn();
  } finally {
    if (real === undefined) {
      delete g.fetch;
    } else {
      g.fetch = real;
    }
  }
}

function payload(over: Partial<LevelPayload> = {}): LevelPayload {
  return {
    id: '02-test-bed',
    name: 'TEST BED',
    rows: ['..........', '.S......G.', '##########'],
    ...over,
  };
}

/**
 * A status-line message is drawn with the 5×7 bitmap font, which has A-Z, 0-9
 * and a little punctuation and NOTHING else — anything missing renders as a
 * hollow box. Asserting on the font itself rather than on a hand-kept charset
 * means the check follows the font if a glyph is ever added or removed.
 */
function expectRenderable(message: string): void {
  const bad = [...message].filter((ch) => glyphFor(ch) === FALLBACK_GLYPH);
  expect(bad).toEqual([]);
  expect(message.length).toBeGreaterThan(0);
}

describe('LEVEL_ID_PATTERN / isValidLevelId', () => {
  it('accepts the shipped level id', () => {
    expect(isValidLevelId('01-first-steps')).toBe(true);
    expect(LEVEL_ID_PATTERN.test('01-first-steps')).toBe(true);
    expect(isValidLevelId('a')).toBe(true);
    expect(isValidLevelId('9')).toBe(true);
  });

  it('rejects path traversal, uppercase and the empty string', () => {
    // The three the phase brief names. `../evil` is the one that matters: it is
    // what a hand-crafted POST would send to walk out of src/levels.
    expect(isValidLevelId('../evil')).toBe(false);
    expect(isValidLevelId('A-Z')).toBe(false);
    expect(isValidLevelId('')).toBe(false);
  });

  it('rejects a leading dash, separators and whitespace', () => {
    expect(isValidLevelId('-leading')).toBe(false);
    expect(isValidLevelId('two words')).toBe(false);
    expect(isValidLevelId('under_score')).toBe(false);
    expect(isValidLevelId('a/b')).toBe(false);
    expect(isValidLevelId('a.json')).toBe(false);
    expect(isValidLevelId('a\nb')).toBe(false); // Anchors must span the whole id.
  });

  it('never throws on a non-string', () => {
    expect(isValidLevelId(undefined)).toBe(false);
    expect(isValidLevelId(null)).toBe(false);
    expect(isValidLevelId(42)).toBe(false);
    expect(isValidLevelId(['01-first-steps'])).toBe(false);
  });
});

describe('buildLevelPayload', () => {
  it('is byte-identical to serializeLevel for the same level', () => {
    // Decision 1's whole point: what the editor writes is what `git diff`
    // shows. Round-trip the payload through the real parser and the real
    // serialiser and compare strings, not objects.
    const text = buildLevelPayload(payload());
    const parsed = parseLevel(JSON.parse(text));
    if (!parsed.ok) {
      throw new Error(parsed.errors.join('\n'));
    }
    expect(serializeLevel(parsed.level)).toBe(text);
  });

  it('reproduces the shipped level file byte for byte', () => {
    const text = buildLevelPayload(firstSteps);
    const parsed = parseLevel(JSON.parse(text));
    if (!parsed.ok) {
      throw new Error(parsed.errors.join('\n'));
    }
    expect(serializeLevel(parsed.level)).toBe(text);
  });

  it('is 2-space JSON with a trailing newline, keys in file order', () => {
    const text = buildLevelPayload(payload());
    expect(text.endsWith('\n')).toBe(true);
    expect(text.startsWith('{\n  "id": "02-test-bed",\n  "name": "TEST BED",\n  "rows": [\n')).toBe(
      true,
    );
    // Nothing but id/name/rows reaches the file, whatever the caller passes.
    expect(Object.keys(JSON.parse(text) as object)).toEqual(['id', 'name', 'rows']);
  });
});

describe('saveLevel transport selection', () => {
  it('reports disk on a 200 and posts exactly the bytes serializeLevel would', async () => {
    const calls: FetchCall[] = [];
    const storage = new FakeStorage();
    const out = await saveLevel(payload(), { fetch: fakeFetch(200, calls), storage });

    expect(out).toMatchObject({ ok: true, transport: 'disk' });
    expectRenderable(out.message);
    expect(out.message).toContain('02-TEST-BED');

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/__level');
    expect(calls[0].url).toContain('id=02-test-bed');
    expect(calls[0].body).toBe(buildLevelPayload(payload()));

    // A disk save must not also leave a draft behind: the file IS the record.
    expect(storage.map.size).toBe(0);
  });

  it('falls back to local on a 404 rather than throwing', async () => {
    const calls: FetchCall[] = [];
    const storage = new FakeStorage();
    const copied: string[] = [];
    const out = await saveLevel(payload(), {
      fetch: fakeFetch(404, calls),
      storage,
      clipboard: (t) => {
        copied.push(t);
        return Promise.resolve();
      },
    });

    expect(calls).toHaveLength(1);
    expect(out).toMatchObject({ ok: true, transport: 'local' });
    expectRenderable(out.message);
    expect(out.message).toContain('CLIPBOARD');
    expect(storage.getItem(SAVE_KEYS.editorDraft)).toBe(buildLevelPayload(payload()));
    expect(copied).toEqual([buildLevelPayload(payload())]);
  });

  it('falls back to local when the request rejects outright', async () => {
    const calls: FetchCall[] = [];
    const storage = new FakeStorage();
    const out = await saveLevel(payload(), { fetch: rejectingFetch(calls), storage });

    expect(calls).toHaveLength(1);
    expect(out).toMatchObject({ ok: true, transport: 'local' });
    expect(storage.getItem(SAVE_KEYS.editorDraft)).toBe(buildLevelPayload(payload()));
  });

  it('falls back to local when there is no fetch at all', async () => {
    const storage = new FakeStorage();
    const out = await withoutGlobalFetch(() => saveLevel(payload(), { storage }));

    expect(out).toMatchObject({ ok: true, transport: 'local' });
    expectRenderable(out.message);
    expect(storage.getItem(SAVE_KEYS.editorDraft)).toBe(buildLevelPayload(payload()));
  });

  it('uses globalThis.fetch when no fetch dep is given', async () => {
    const calls: FetchCall[] = [];
    const g = globalThis as unknown as { fetch?: unknown };
    const real = g.fetch;
    g.fetch = fakeFetch(200, calls);
    try {
      const out = await saveLevel(payload(), { storage: new FakeStorage() });
      expect(out.transport).toBe('disk');
      expect(calls).toHaveLength(1);
    } finally {
      if (real === undefined) {
        delete g.fetch;
      } else {
        g.fetch = real;
      }
    }
  });
});

describe('saveLevel id guard', () => {
  it('refuses a bad id without touching the network or the draft', async () => {
    const calls: FetchCall[] = [];
    const storage = new FakeStorage();
    const out = await saveLevel(payload({ id: '../evil' }), {
      fetch: fakeFetch(200, calls),
      storage,
    });

    expect(out.ok).toBe(false);
    expect(out.transport).toBe('local');
    expectRenderable(out.message);
    // The message has to name the legal charset; a bare "bad id" leaves the
    // author guessing at the one field the sink refuses to guess for them.
    expect(out.message.toUpperCase()).toContain('-');
    expect(out.message.toUpperCase()).toContain('DIGIT');
    expect(calls).toEqual([]);
    expect(storage.map.size).toBe(0);
  });

  it('refuses an empty id', async () => {
    const calls: FetchCall[] = [];
    const out = await saveLevel(payload({ id: '' }), { fetch: fakeFetch(200, calls) });
    expect(out.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('saveLevel fallback is best-effort', () => {
  it('survives a clipboard that rejects, and still writes the draft', async () => {
    const storage = new FakeStorage();
    const out = await saveLevel(payload(), {
      fetch: fakeFetch(500, []),
      storage,
      clipboard: () => Promise.reject(new Error('not allowed without a gesture')),
    });

    expect(out.transport).toBe('local');
    expect(out.ok).toBe(true); // The draft is safe even when the clipboard is not.
    expectRenderable(out.message);
    expect(storage.getItem(SAVE_KEYS.editorDraft)).toBe(buildLevelPayload(payload()));
  });

  it('survives a clipboard that throws synchronously', async () => {
    const storage = new FakeStorage();
    const out = await saveLevel(payload(), {
      fetch: fakeFetch(500, []),
      storage,
      clipboard: () => {
        throw new Error('no clipboard here');
      },
    });

    expect(out.transport).toBe('local');
    expect(storage.getItem(SAVE_KEYS.editorDraft)).toBe(buildLevelPayload(payload()));
  });

  it('survives a storage that throws on every call', async () => {
    const copied: string[] = [];
    const out = await saveLevel(payload(), {
      fetch: fakeFetch(500, []),
      storage: new ThrowingStorage(),
      clipboard: (t) => {
        copied.push(t);
        return Promise.resolve();
      },
    });

    expect(out.transport).toBe('local');
    expectRenderable(out.message);
    // Storage failed but the clipboard carried the JSON, so the save stands.
    expect(out.ok).toBe(true);
    expect(copied).toEqual([buildLevelPayload(payload())]);
  });
});
