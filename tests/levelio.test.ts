import { describe, expect, it } from 'vitest';
import { FALLBACK_GLYPH, glyphFor } from '../src/engine/font';
import {
  buildLevelPayload,
  exportLevel,
  FileDropbox,
  isValidLevelId,
  LEVEL_ID_PATTERN,
  levelFileName,
} from '../src/engine/levelio';
import type { DownloadLike, LevelPayload } from '../src/engine/levelio';
import { SAVE_KEYS } from '../src/engine/save';
import type { StorageLike } from '../src/engine/save';
import { parseLevel, serializeLevel } from '../src/world/level';
import whiteAndBlack from '../src/levels/01-white-and-black.json';

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

interface DownloadCall {
  readonly filename: string;
  readonly text: string;
}

/** A download that records what it was handed and reports a fixed result. */
function fakeDownload(ok: boolean, calls: DownloadCall[]): DownloadLike {
  return (filename, text) => {
    calls.push({ filename, text });
    return ok;
  };
}

/** A download that throws rather than returning false — a refused anchor. */
function throwingDownload(): DownloadLike {
  return () => {
    throw new Error('no document here');
  };
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
    const text = buildLevelPayload(whiteAndBlack);
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

describe('exportLevel transport selection', () => {
  it('downloads <id>.json with exactly the bytes serializeLevel would write', async () => {
    const calls: DownloadCall[] = [];
    const storage = new FakeStorage();
    const out = await exportLevel(payload(), { download: fakeDownload(true, calls), storage });

    expect(out).toMatchObject({ ok: true, transport: 'download' });
    expectRenderable(out.message);
    expect(out.message).toContain('02-TEST-BED.JSON');
    expect(out.message).toContain('DOWNLOADS');

    expect(calls).toHaveLength(1);
    expect(calls[0].filename).toBe('02-test-bed.json');
    expect(calls[0].text).toBe(buildLevelPayload(payload()));

    // A download must not also leave a copy in storage: the draft shelf already
    // holds the level, and `bw.editor.draft` is the legacy key, not a record.
    expect(storage.map.size).toBe(0);
  });

  it('names the file after the id, which is the filename everywhere else', () => {
    expect(levelFileName('02-test-bed')).toBe('02-test-bed.json');
  });

  it('falls back to the clipboard when the download reports failure', async () => {
    const copied: string[] = [];
    const storage = new FakeStorage();
    const out = await exportLevel(payload(), {
      download: fakeDownload(false, []),
      storage,
      clipboard: (t) => {
        copied.push(t);
        return Promise.resolve();
      },
    });

    expect(out).toMatchObject({ ok: true, transport: 'clipboard' });
    expectRenderable(out.message);
    expect(out.message).toContain('CLIPBOARD');
    expect(copied).toEqual([buildLevelPayload(payload())]);
    // The clipboard carried it, so nothing had to be stashed in storage.
    expect(storage.map.size).toBe(0);
  });

  it('falls back to storage when the download throws and the clipboard refuses', async () => {
    const storage = new FakeStorage();
    const out = await exportLevel(payload(), {
      download: throwingDownload(),
      storage,
      clipboard: () => Promise.reject(new Error('not allowed without a gesture')),
    });

    expect(out).toMatchObject({ ok: true, transport: 'storage' });
    expectRenderable(out.message);
    expect(storage.getItem(SAVE_KEYS.editorDraft)).toBe(buildLevelPayload(payload()));
  });

  it('survives a clipboard that throws synchronously', async () => {
    const storage = new FakeStorage();
    const out = await exportLevel(payload(), {
      download: fakeDownload(false, []),
      storage,
      clipboard: () => {
        throw new Error('no clipboard here');
      },
    });

    expect(out.transport).toBe('storage');
    expect(storage.getItem(SAVE_KEYS.editorDraft)).toBe(buildLevelPayload(payload()));
  });

  it('reports failure honestly when nothing at all takes the file', async () => {
    const out = await exportLevel(payload(), {
      download: fakeDownload(false, []),
      storage: new ThrowingStorage(),
      clipboard: () => Promise.reject(new Error('nope')),
    });

    expect(out.ok).toBe(false);
    expectRenderable(out.message);
    // And it says the draft is still there, because it is: the shelf autosaves
    // on every stroke, so a failed export is not lost work.
    expect(out.message).toContain('DRAFT');
  });

  it('detects no download under node and still reports something renderable', async () => {
    // No `download` dep and no document: the branch a production build would
    // only reach on a browser that refuses blobs, exercised here for free.
    const out = await exportLevel(payload(), {
      storage: new FakeStorage(),
      clipboard: () => Promise.resolve(),
    });
    expect(out.transport).toBe('clipboard');
    expectRenderable(out.message);
  });
});

describe('exportLevel id guard', () => {
  it('refuses a bad id without downloading anything or writing a draft', async () => {
    const calls: DownloadCall[] = [];
    const storage = new FakeStorage();
    const out = await exportLevel(payload({ id: '../evil' }), {
      download: fakeDownload(true, calls),
      storage,
    });

    expect(out.ok).toBe(false);
    expectRenderable(out.message);
    // The message has to name the legal charset; a bare "bad id" leaves the
    // author guessing at the one field nothing else can guess for them.
    expect(out.message.toUpperCase()).toContain('-');
    expect(out.message.toUpperCase()).toContain('DIGIT');
    expect(calls).toEqual([]);
    expect(storage.map.size).toBe(0);
  });

  it('refuses an empty id', async () => {
    const calls: DownloadCall[] = [];
    const out = await exportLevel(payload({ id: '' }), { download: fakeDownload(true, calls) });
    expect(out.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('FileDropbox', () => {
  it('drains the queue exactly once', () => {
    const box = new FileDropbox();
    box.push({ name: 'a.json', text: '{}' });
    box.push({ name: 'b.json', text: '{}' });

    expect(box.take().map((f) => f.name)).toEqual(['a.json', 'b.json']);
    // The second read is empty, which is what stops two screens importing the
    // same drop — and what stops one screen importing it every frame.
    expect(box.take()).toEqual([]);
  });

  it('caps the queue rather than growing without bound', () => {
    const box = new FileDropbox();
    for (let i = 0; i < 40; i++) {
      box.push({ name: `${i}.json`, text: '{}' });
    }
    const taken = box.take();
    expect(taken.length).toBeLessThanOrEqual(8);
    // The newest survive: a drop of forty files is a slip, and the last ones
    // are the ones the author was still looking at.
    expect(taken[taken.length - 1].name).toBe('39.json');
  });

  it('is inert under node: no DOM, no throw', () => {
    const box = new FileDropbox();
    expect(box.hovering).toBe(false);
    expect(box.openPicker()).toBe(false);
    expect(box.take()).toEqual([]);
  });
});
