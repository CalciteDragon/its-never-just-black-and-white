/**
 * Custom levels: importing a file, the CUSTOM LEVELS screen, and the door to it
 * from the level select.
 *
 * All of it runs headlessly. Files arrive through `game.files` — a queue
 * `engine/levelio.ts` fills from a DOM `drop` and every screen drains in
 * `update` — so a test pushes onto that queue and no browser is involved, which
 * is the whole reason the drop was built as a queue rather than as a callback.
 */

import { describe, expect, it } from 'vitest';
import { FALLBACK_GLYPH, glyphFor } from '../src/engine/font';
import { buildLevelPayload } from '../src/engine/levelio';
import { SAVE_KEYS } from '../src/engine/save';
import { listDrafts, writeDraft } from '../src/editor/drafts';
import { importLevelText, importDroppedFiles, slugifyId } from '../src/editor/transfer';
import { preventsDefault } from '../src/engine/input';
import { LEVELS } from '../src/levels/index';
import { CUSTOM_HELP, CustomSelectScene } from '../src/scenes/customselect';
import { EditorScene } from '../src/scenes/editor';
import { EditorSelectScene, IMPORT_HELP } from '../src/scenes/editorselect';
import { LevelSelectScene } from '../src/scenes/levelselect';
import { PlayScene } from '../src/scenes/play';
import { ResultsScene } from '../src/scenes/results';
import { TitleScene } from '../src/scenes/title';
import { fakeGame, step, tap } from './harness';
import type { Harness } from './harness';

/** A level small enough to read in a test and legal enough to parse. */
const TINY: readonly string[] = ['.S..G.', '######'];

function fileText(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ id: 'cellar', name: 'THE CELLAR', rows: TINY, ...over });
}

function enter<T extends { enter?(game: never): void }>(h: Harness, scene: T): T {
  (scene as { enter?(game: unknown): void }).enter?.(h.game);
  return scene;
}

function down(h: Harness, scene: { update(dt: number, g: never): void }, n: number): void {
  for (let i = 0; i < n; i++) {
    tap(h, scene as Parameters<typeof tap>[1], 'ArrowDown');
  }
}

/**
 * Anything a menu draws goes through the 5×7 bitmap font, which has A-Z, 0-9
 * and a little punctuation and nothing else. Asserting against the font itself
 * means the check follows it if a glyph is ever added or removed.
 */
function expectRenderable(text: string): void {
  expect([...text].filter((ch) => glyphFor(ch) === FALLBACK_GLYPH)).toEqual([]);
}

describe('importLevelText', () => {
  it('accepts a file the editor exported, byte for byte', () => {
    const text = buildLevelPayload({ id: 'cellar', name: 'THE CELLAR', rows: TINY });
    const res = importLevelText(text, []);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    // The round trip is the feature: what export writes, import reads back.
    expect(res.draft).toEqual({ id: 'cellar', name: 'THE CELLAR', rows: TINY });
    expect(res.renamed).toBe(false);
  });

  it('NEVER OVERWRITES: a taken id is renamed, and the rename is reported', () => {
    const res = importLevelText(fileText(), ['cellar']);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.draft.id).toBe('cellar-2');
    // Reported, because an author who imports `cellar` and silently edits
    // `cellar-2` afterwards has been lied to about which level is which.
    expect(res.renamed).toBe(true);
  });

  it('refuses a built-in id by renaming past it, so nothing shadows a shipped level', () => {
    const res = importLevelText(fileText({ id: LEVELS[0].id }), LEVELS.map((l) => l.id));
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.draft.id).not.toBe(LEVELS[0].id);
  });

  it('falls back to the filename when the file carries no usable id', () => {
    const res = importLevelText(fileText({ id: '../evil' }), [], 'My Level (2).json');
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.draft.id).toBe('my-level-2');
  });

  it('falls back to a generic id when neither the file nor the name gives one', () => {
    const res = importLevelText(fileText({ id: 42 }), [], '!!!.json');
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.draft.id).toBe('imported');
  });

  it('rejects junk, empty files and non-objects with a message a menu can draw', () => {
    for (const text of ['', '   ', 'not json at all', '[1,2,3]', '"a string"', 'null']) {
      const res = importLevelText(text, []);
      expect(res.ok, text).toBe(false);
      if (!res.ok) {
        expectRenderable(res.error);
      }
    }
  });

  it('rejects a grid that is not a level, quoting the real validator', () => {
    const res = importLevelText(fileText({ rows: ['....', '....'] }), []);
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    // The SAME function the editor's status line uses, not a looser copy: the
    // reason names the missing spawn rather than saying "invalid".
    expect(res.error).toContain('spawn');
  });

  it('clips an absurd name rather than putting it on a menu row', () => {
    const res = importLevelText(fileText({ name: 'X'.repeat(400) }), []);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.draft.name.length).toBeLessThanOrEqual(40);
  });

  it('slugifies filenames and gives up honestly when nothing survives', () => {
    expect(slugifyId('cellar.json')).toBe('cellar');
    expect(slugifyId('  Deep Cellar 2.JSON')).toBe('deep-cellar-2');
    expect(slugifyId('---.json')).toBe('');
    expect(slugifyId('')).toBe('');
  });
});

describe('importDroppedFiles', () => {
  it('puts every file on the shelf and reports the batch', () => {
    const h = fakeGame();
    const batch = importDroppedFiles(
      h.save,
      [
        { name: 'a.json', text: fileText({ id: 'cellar' }) },
        { name: 'b.json', text: fileText({ id: 'attic', name: 'THE ATTIC' }) },
      ],
      [],
    );

    expect(batch.imported.map((d) => d.id)).toEqual(['cellar', 'attic']);
    expect(batch.lastId).toBe('attic');
    expect(listDrafts(h.save).map((d) => d.id)).toEqual(['cellar', 'attic']);
    expectRenderable(batch.status);
    expect(batch.status).toContain('2');
  });

  it('DROPPING THE SAME FILE TWICE MAKES TWO LEVELS, not one collision', () => {
    const h = fakeGame();
    const twice = [
      { name: 'a.json', text: fileText() },
      { name: 'a.json', text: fileText() },
    ];
    importDroppedFiles(h.save, twice, []);
    // The second file is renamed against the first, which only works because
    // the ids claimed *within* one batch are carried forward through it.
    expect(listDrafts(h.save).map((d) => d.id)).toEqual(['cellar', 'cellar-2']);
  });

  it('names one failure rather than listing all of them, and keeps the good ones', () => {
    const h = fakeGame();
    const batch = importDroppedFiles(
      h.save,
      [
        { name: 'good.json', text: fileText() },
        { name: 'bad.json', text: 'not json' },
      ],
      [],
    );
    expect(batch.imported).toHaveLength(1);
    expect(batch.status).toContain('FAILED');
    expectRenderable(batch.status);
  });

  it('says nothing at all when nothing was dropped', () => {
    const h = fakeGame();
    expect(importDroppedFiles(h.save, [], []).status).toBe('');
  });
});

describe('CustomSelectScene', () => {
  function openCustom(ids: readonly string[] = []): { h: Harness; scene: CustomSelectScene } {
    const h = fakeGame();
    for (const id of ids) {
      writeDraft(h.save, { id, name: id.toUpperCase(), rows: TINY });
    }
    return { h, scene: enter(h, new CustomSelectScene()) };
  }

  it('offers IMPORT, then every draft — and a draft needed no importing to be there', () => {
    const { scene } = openCustom(['cellar', 'attic']);
    expect(scene.state.rows.map((r) => r.kind)).toEqual(['import', 'draft', 'draft']);
  });

  it('IMPORTS A DROPPED FILE and puts the cursor on what just arrived', () => {
    const { h, scene } = openCustom(['cellar']);
    h.files.push({ name: 'attic.json', text: fileText({ id: 'attic', name: 'THE ATTIC' }) });
    step(h, scene);

    expect(scene.state.rows.map((r) => (r.kind === 'draft' ? r.draft.id : r.kind))).toEqual([
      'import',
      'cellar',
      'attic',
    ]);
    expect(scene.state.index).toBe(2);
    expect(scene.state.status).toContain('THE ATTIC');
  });

  it('drains a drop even while the delete prompt is up, rather than losing it', () => {
    const { h, scene } = openCustom(['cellar']);
    down(h, scene, 1);
    tap(h, scene, 'KeyX');
    expect(scene.state.confirming).toBe('cellar');

    h.files.push({ name: 'attic.json', text: fileText({ id: 'attic' }) });
    step(h, scene);
    expect(listDrafts(h.save).map((d) => d.id)).toEqual(['cellar', 'attic']);
    // And a file arriving did not answer the prompt for the author.
    expect(scene.state.confirming).toBe('cellar');
  });

  it('reports a bad file instead of doing nothing', () => {
    const { h, scene } = openCustom();
    h.files.push({ name: 'notes.txt', text: 'hello' });
    step(h, scene);
    expect(scene.state.status).not.toBe('');
    expectRenderable(scene.state.status);
    expect(listDrafts(h.save)).toEqual([]);
  });

  it('ENTER PLAYS the selected level, in a context that is not the campaign', () => {
    const { h, scene } = openCustom(['cellar']);
    down(h, scene, 1);
    tap(h, scene, 'Enter');
    expect(h.scenes[0]).toBeInstanceOf(PlayScene);
  });

  it('refuses to play a draft that is not finished, and says why', () => {
    const h = fakeGame();
    writeDraft(h.save, { id: 'wip', name: 'WIP', rows: ['....', '....'] });
    const scene = enter(h, new CustomSelectScene());
    down(h, scene, 1);
    tap(h, scene, 'Enter');
    expect(h.scenes).toHaveLength(0);
    expect(scene.state.status).toContain('CANNOT PLAY');
  });

  it('D EDITS THE DRAFT ITSELF, not a copy of it — this list is the shelf', () => {
    const { h, scene } = openCustom(['cellar']);
    down(h, scene, 1);
    tap(h, scene, 'KeyD');
    const editor = h.scenes[0] as EditorScene;
    expect(editor).toBeInstanceOf(EditorScene);
    expect(editor.state.id).toBe('cellar');
  });

  it('E exports the selected level and reports the outcome on the status line', async () => {
    const { h, scene } = openCustom(['cellar']);
    down(h, scene, 1);
    tap(h, scene, 'KeyE');
    // Under node there is no download and no clipboard, so it lands on the
    // storage fallback — the point here is that it reports, and never throws.
    await Promise.resolve();
    await Promise.resolve();
    expectRenderable(scene.state.status);
    expect(h.scenes).toHaveLength(0); // export is not a scene change
  });

  it('E EXPORTS RATHER THAN EDITING, which is the one key that differs from LEVELS', () => {
    // `E` opens the editor on the level select and exports here. The screens
    // disagree on purpose — sharing is what this one is for — so it is worth a
    // test of its own rather than being something a footer happens to say.
    const { h, scene } = openCustom(['cellar']);
    down(h, scene, 1);
    tap(h, scene, 'KeyE');
    expect(h.scenes).toHaveLength(0);
    expect(scene.state.status).not.toBe('');
  });

  it('DELETING ASKS FIRST, and the verbs do nothing on the IMPORT row', () => {
    const { h, scene } = openCustom(['cellar']);
    tap(h, scene, 'KeyX');
    expect(scene.state.confirming).toBeNull();
    tap(h, scene, 'KeyD');
    expect(h.scenes).toHaveLength(0);

    down(h, scene, 1);
    tap(h, scene, 'KeyX');
    expect(scene.state.confirming).toBe('cellar');
    tap(h, scene, 'KeyY');
    expect(listDrafts(h.save)).toEqual([]);
  });

  it('Esc returns to the level select', () => {
    const { h, scene } = openCustom();
    tap(h, scene, 'Escape');
    expect(h.scenes[0]).toBeInstanceOf(LevelSelectScene);
  });

  it('SAYS THE THREE THINGS AN AUTHOR CANNOT GUESS, in glyphs the font has', () => {
    const text = CUSTOM_HELP.join('  ');
    expectRenderable(text);
    expect(text).toContain('EDITOR'); // drafts arrive here by themselves
    expect(text).toContain('DROP'); // how a file gets in
    expect(text).toContain('DOWNLOADS'); // how one gets out
    expect(text).toContain('PRESS E'); // and which key does it
  });
});

describe('the level select door to custom levels', () => {
  it('PINS CUSTOM LEVELS AT ROW 0, above however many built-ins there are', () => {
    const h = fakeGame();
    const scene = enter(h, new LevelSelectScene());
    expect(scene.state.rowCount).toBe(LEVELS.length + 1);
    // The cursor still opens on the campaign: the pinned row is reached, not
    // landed on, so PLAY is still one keypress for somebody mid-campaign.
    expect(scene.state.index).toBe(1);
  });

  it('C opens it from anywhere in the list, however far down the cursor is', () => {
    const h = fakeGame();
    h.save.setProgress(LEVELS.length);
    const scene = enter(h, new LevelSelectScene());
    down(h, scene, LEVELS.length - 1); // to the last row, furthest from row 0
    tap(h, scene, 'KeyC');
    expect(h.scenes[0]).toBeInstanceOf(CustomSelectScene);
  });

  it('ENTER on the pinned row opens it too, and E there does not open an editor', () => {
    const h = fakeGame();
    const scene = enter(h, new LevelSelectScene());
    tap(h, scene, 'ArrowUp'); // wrap to row 0, the pinned one
    tap(h, scene, 'KeyE');
    expect(h.scenes).toHaveLength(0); // there is no level on this row to copy
    tap(h, scene, 'Enter');
    expect(h.scenes[0]).toBeInstanceOf(CustomSelectScene);
  });

  it('counts what is on the shelf, so the row says whether it is worth opening', () => {
    const h = fakeGame();
    writeDraft(h.save, { id: 'cellar', name: 'CELLAR', rows: TINY });
    const scene = enter(h, new LevelSelectScene());
    expect(scene.state.customCount).toBe(1);
  });

  it('the campaign rows still play the level they name, offset by the pinned row', () => {
    const h = fakeGame();
    const scene = enter(h, new LevelSelectScene());
    tap(h, scene, 'Enter');
    expect(h.scenes[0]).toBeInstanceOf(PlayScene);
  });
});

describe('a custom run is not a campaign run', () => {
  function finishCustom(h: Harness): PlayScene {
    const scene = enter(h, new CustomSelectScene());
    down(h, scene, 1);
    tap(h, scene, 'Enter');
    return h.scenes[0] as PlayScene;
  }

  it('WRITES A BEST TIME BUT NEVER TOUCHES PROGRESS', () => {
    const h = fakeGame();
    writeDraft(h.save, { id: 'cellar', name: 'CELLAR', rows: TINY });
    const play = finishCustom(h);
    (play as unknown as { win(g: unknown): void }).win(h.game);

    // A time is the point of playing it, and `bw.best.cellar` cannot collide
    // with a shipped level's key because the shelf refuses a built-in id.
    expect(h.save.getBest(SAVE_KEYS.best('cellar'))).not.toBeNull();
    // But finishing somebody else's level must not unlock the campaign.
    expect(h.save.getProgress()).toBe(0);
  });

  it('sends its results screen back to CUSTOM LEVELS rather than to LEVELS', () => {
    const h = fakeGame();
    const back = new CustomSelectScene();
    const results = new ResultsScene({
      level: LEVELS[0],
      index: null,
      back,
      timeMs: 1000,
      previousBestMs: null,
      isNewBest: true,
    });
    tap(h, results, 'Escape');
    expect(h.scenes[0]).toBe(back);
  });

  it('offers no NEXT for a custom level: there is no ladder to be next on', () => {
    const h = fakeGame();
    const results = new ResultsScene({
      level: LEVELS[0],
      index: null,
      back: new CustomSelectScene(),
      timeMs: 1000,
      previousBestMs: null,
      isNewBest: true,
    });
    tap(h, results, 'Enter'); // the first item, which must be RETRY
    expect(h.scenes[0]).toBeInstanceOf(PlayScene);
  });
});

describe('the editor picker imports too', () => {
  it('offers an IMPORT row and takes a dropped file onto the shelf', () => {
    const h = fakeGame();
    const scene = enter(h, new EditorSelectScene());
    expect(scene.state.rows[1].kind).toBe('import');

    h.files.push({ name: 'cellar.json', text: fileText() });
    step(h, scene);
    expect(listDrafts(h.save).map((d) => d.id)).toEqual(['cellar']);
    expect(scene.state.status).toContain('THE CELLAR');
    // And the cursor is on it, ready to be opened.
    const row = scene.state.rows[scene.state.index];
    expect(row.kind === 'draft' && row.draft.id).toBe('cellar');
  });

  it('ENTER on IMPORT says how to import when no picker can be opened', () => {
    const h = fakeGame();
    const scene = enter(h, new EditorSelectScene());
    down(h, scene, 1);
    tap(h, scene, 'Enter');
    expect(h.scenes).toHaveLength(0); // it is not a level; nothing opens
    expect(scene.state.status).toContain('DROP');
    expectRenderable(scene.state.status);
  });

  it('SAYS THE THREE THINGS AN AUTHOR CANNOT GUESS, in glyphs the font has', () => {
    const text = IMPORT_HELP.join('  ');
    expectRenderable(text);
    expect(text).toContain('CUSTOM LEVELS'); // where a draft shows up
    expect(text).toContain('DROP'); // how a file gets in
    expect(text).toContain('DOWNLOADS'); // how one gets out
  });
});

describe('Ctrl+S belongs to the editor, not to the browser', () => {
  it('suppresses the browser default for Ctrl+S and Cmd+S', () => {
    // Stated rather than inherited: KeyS is also one of the WASD movement keys,
    // so today it is suppressed twice over. The day movement moves off WASD,
    // "save this page" must not start appearing over the editor.
    expect(preventsDefault('KeyS', true)).toBe(true);
    expect(preventsDefault('KeyS', false)).toBe(true);
  });

  it('leaves ordinary Ctrl combinations to the browser', () => {
    // Ctrl+T, Ctrl+W and friends are the user's, not the game's.
    expect(preventsDefault('KeyT', true)).toBe(false);
    expect(preventsDefault('KeyC', true)).toBe(false);
  });

  it('does not suppress a bare letter the game has no use for', () => {
    expect(preventsDefault('KeyT', false)).toBe(false);
  });
});

describe('the title still leads everywhere it did', () => {
  it('LEVELS opens the level select, which is where custom levels now live', () => {
    const h = fakeGame();
    const scene = new TitleScene();
    tap(h, scene, 'ArrowDown');
    tap(h, scene, 'Enter');
    expect(h.scenes[h.scenes.length - 1]).toBeInstanceOf(LevelSelectScene);
  });
});
