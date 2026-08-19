/**
 * The three things phase 7's editor did not have: a shelf of drafts, a zoom
 * ladder whose ends depend on the level, and a controls panel that can be
 * opened twice.
 *
 * Driven headlessly like every other scene test — `EditorSelectScene` touches
 * only `game.save`, `game.audio` and `game.setScene`, and the two pure modules
 * under it touch nothing at all.
 */

import { describe, expect, it } from 'vitest';
import { EDITOR_ZOOM_STEPS, TILE, VIEW_H, VIEW_W } from '../src/constants';
import {
  decodeDraft,
  deleteDraft,
  draftExists,
  listDrafts,
  migrateLegacyDraft,
  readDraft,
  renameDraft,
  uniqueDraftId,
  writeDraft,
} from '../src/editor/drafts';
import { fitZoomIndex, zoomLabel, zoomRange } from '../src/editor/zoom';
import { SAVE_KEYS } from '../src/engine/save';
import { EditorScene } from '../src/scenes/editor';
import { EditorSelectScene } from '../src/scenes/editorselect';
import { HELP_SECTIONS } from '../src/scenes/editorhelp';
import { TitleScene } from '../src/scenes/title';
import { LEVELS } from '../src/levels/index';
import { fakeGame, tap } from './harness';
import type { Harness } from './harness';

const TINY = ['.S.', '.G.', '###'];

function rec(id: string, name = id.toUpperCase()): { id: string; name: string; rows: string[] } {
  return { id, name, rows: [...TINY] };
}

function openPicker(seed: readonly string[] = []): { h: Harness; scene: EditorSelectScene } {
  const h = fakeGame();
  for (const id of seed) {
    writeDraft(h.game.save, rec(id));
  }
  const scene = new EditorSelectScene();
  scene.enter(h.game);
  return { h, scene };
}

/** Move the cursor down `n` rows, the way a hand does. */
function down(h: Harness, scene: EditorSelectScene, n: number): void {
  for (let i = 0; i < n; i++) {
    tap(h, scene, 'ArrowDown');
  }
}

describe('the draft shelf', () => {
  it('holds more than one level at a time, which is the whole point', () => {
    const h = fakeGame();
    writeDraft(h.save, rec('cellar'));
    writeDraft(h.save, rec('attic'));
    expect(listDrafts(h.save).map((d) => d.id)).toEqual(['cellar', 'attic']);
    expect(readDraft(h.save, 'attic')?.rows).toEqual(TINY);
  });

  it('upserts rather than duplicating, however often the editor autosaves', () => {
    const h = fakeGame();
    for (let i = 0; i < 20; i++) {
      writeDraft(h.save, rec('cellar', `PASS ${i}`));
    }
    expect(listDrafts(h.save)).toHaveLength(1);
    expect(readDraft(h.save, 'cellar')?.name).toBe('PASS 19');
  });

  it('A RENAME IS A MOVE, and it keeps its place in the list', () => {
    const h = fakeGame();
    writeDraft(h.save, rec('one'));
    writeDraft(h.save, rec('two'));
    writeDraft(h.save, rec('three'));
    expect(renameDraft(h.save, 'two', rec('middle'))).toBe(true);
    // In place: a rename that shuffled the rows would move every other level
    // under the cursor of whoever is looking at the picker.
    expect(listDrafts(h.save).map((d) => d.id)).toEqual(['one', 'middle', 'three']);
    expect(readDraft(h.save, 'two')).toBeNull();
  });

  it('refuses a rename onto an id that already exists, rather than merging two levels', () => {
    const h = fakeGame();
    writeDraft(h.save, rec('one'));
    writeDraft(h.save, rec('two'));
    expect(renameDraft(h.save, 'one', rec('two'))).toBe(false);
    expect(listDrafts(h.save).map((d) => d.id)).toEqual(['one', 'two']);
    expect(readDraft(h.save, 'one')?.id).toBe('one');
  });

  it('deletes one without disturbing the others', () => {
    const h = fakeGame();
    writeDraft(h.save, rec('one'));
    writeDraft(h.save, rec('two'));
    deleteDraft(h.save, 'one');
    expect(draftExists(h.save, 'one')).toBe(false);
    expect(listDrafts(h.save).map((d) => d.id)).toEqual(['two']);
  });

  it('survives every shape of garbage a previous session could leave', () => {
    for (const junk of ['{not json', 'null', '[]', '{"id":1}', '{"id":"a","name":"B"}', '']) {
      expect(decodeDraft(junk), junk).toBeNull();
    }
    const h = fakeGame();
    h.storage.setItem(SAVE_KEYS.editorDrafts, '{not an array');
    expect(listDrafts(h.save)).toEqual([]);
    // An index naming a record that is gone lists nothing rather than throwing.
    h.storage.setItem(SAVE_KEYS.editorDrafts, JSON.stringify(['ghost']));
    expect(listDrafts(h.save)).toEqual([]);
  });

  it('IMPORTS THE OLD SINGLE DRAFT ONCE, so nobody loses the level they had open', () => {
    const h = fakeGame();
    h.save.setText(SAVE_KEYS.editorDraft, JSON.stringify(rec('in-progress')));
    migrateLegacyDraft(h.save);
    expect(listDrafts(h.save).map((d) => d.id)).toEqual(['in-progress']);

    // Once. A second pass must not resurrect a draft that has since been
    // deleted, which is what a migration that did not clear its source would do.
    deleteDraft(h.save, 'in-progress');
    migrateLegacyDraft(h.save);
    expect(listDrafts(h.save)).toEqual([]);
  });

  it('suffixes rather than colliding, and never lands on a taken id', () => {
    expect(uniqueDraftId('untitled', [])).toBe('untitled');
    expect(uniqueDraftId('untitled', ['untitled'])).toBe('untitled-2');
    expect(uniqueDraftId('untitled', ['untitled', 'untitled-2'])).toBe('untitled-3');
    // A base that is not a legal filename cannot be made into one by suffixing.
    expect(uniqueDraftId('Not An Id', [])).toBe('untitled');
  });
});

describe('the zoom ladder', () => {
  it('lets a level be zoomed out until all of it fits, and no further', () => {
    // A 40x20 default fits at half zoom, so half zoom is the widest rung it
    // offers: below it the level is a stamp in the middle of nothing.
    const range = zoomRange(40, 20);
    expect(EDITOR_ZOOM_STEPS[range.min]).toBe(0.5);
    expect(EDITOR_ZOOM_STEPS[range.initial]).toBe(0.5);
    expect(40 * TILE * 0.5).toBeLessThanOrEqual(VIEW_W);
    expect(20 * TILE * 0.5).toBeLessThanOrEqual(VIEW_H);
  });

  it('opens the whole ladder for a level too big to fit at any of them', () => {
    const range = zoomRange(200, 60);
    expect(fitZoomIndex(200, 60)).toBe(0);
    expect(range.min).toBe(0);
    expect(EDITOR_ZOOM_STEPS[range.initial]).toBe(0.25);
    // And still lets it be worked on close up, because detail is why 2x exists.
    expect(EDITOR_ZOOM_STEPS[range.max]).toBeGreaterThanOrEqual(2);
  });

  it('NEVER STRANDS A TINY LEVEL at a zoom that shows nothing but the level', () => {
    // 3x3 fits at every rung, so the fit rule alone would pin it to the closest
    // one and leave `-` doing nothing at all. 1x is the floor for that reason.
    const range = zoomRange(3, 3);
    expect(EDITOR_ZOOM_STEPS[range.min]).toBe(1);
    expect(range.max).toBeGreaterThan(range.min);
  });

  it('gives every size a usable range, with the ends the right way round', () => {
    for (const [w, h] of [
      [1, 1],
      [10, 5],
      [40, 20],
      [60, 34],
      [200, 60],
    ]) {
      const range = zoomRange(w, h);
      expect(range.min, `${w}x${h}`).toBeLessThan(range.max);
      expect(range.initial).toBeGreaterThanOrEqual(range.min);
      expect(range.initial).toBeLessThanOrEqual(range.max);
      // 1x is always reachable: it is the size the game itself draws at.
      expect(EDITOR_ZOOM_STEPS[range.min]).toBeLessThanOrEqual(1);
      expect(EDITOR_ZOOM_STEPS[range.max]).toBeGreaterThanOrEqual(1);
    }
  });

  it('labels a rung the way the 5x7 font can draw it', () => {
    expect(zoomLabel(EDITOR_ZOOM_STEPS.indexOf(0.5))).toBe('50%');
    expect(zoomLabel(EDITOR_ZOOM_STEPS.indexOf(1))).toBe('100%');
  });
});

describe('the controls panel', () => {
  it('OPENS ON DEMAND AND CLOSES ON ANYTHING, as often as an author wants it', () => {
    const h = fakeGame();
    const scene = new EditorScene({ id: 'test-level', name: 'TEST LEVEL', rows: [...TINY] });
    scene.enter(h.game);
    for (let i = 0; i < 3; i++) {
      tap(h, scene, 'KeyH');
      expect(scene.state.mode).toBe('help');
      tap(h, scene, 'KeyB');
      expect(scene.state.mode).toBe('paint');
    }
    // The other key that means "what does this do" on every keyboard.
    tap(h, scene, 'Slash');
    expect(scene.state.mode).toBe('help');
  });

  it('SWALLOWS THE KEY THAT CLOSES IT, so no shortcut fires behind the page', () => {
    // The panel closes on anything, and the key that closes it does nothing
    // else. Otherwise dismissing a page of text would resize the level under
    // it, which is the worst possible reward for reading the instructions.
    for (const [code, read] of [
      ['Digit2', (s: EditorScene): unknown => s.state.sel],
      ['BracketRight', (s: EditorScene): unknown => s.state.rows.join()],
      ['Equal', (s: EditorScene): unknown => s.state.zoomIndex],
      ['Enter', (): unknown => null],
    ] as const) {
      const h = fakeGame();
      const scene = new EditorScene({ id: 'test-level', name: 'TEST LEVEL', rows: [...TINY] });
      scene.enter(h.game);
      const before = read(scene);
      tap(h, scene, 'KeyH');
      tap(h, scene, code);
      expect(scene.state.mode, code).toBe('paint');
      expect(read(scene), code).toEqual(before);
      expect(h.scenes, code).toHaveLength(0); // Enter did not launch a playtest
    }
  });

  it('NAMES EVERY KEY THE EDITOR LISTENS FOR', () => {
    // The one file in the project that can go stale without any other test
    // noticing, because it is prose about behaviour rather than behaviour.
    const text = HELP_SECTIONS.flatMap((s) => s.entries.map((e) => `${e.keys} ${e.text}`))
      .join('  ')
      .toUpperCase();
    for (const key of [
      'B',
      'X',
      'V',
      'SHIFT',
      '1 - 9',
      'ARROWS',
      'MIDDLE',
      'SPACE',
      '+ AND -',
      '] AND [',
      '. AND ,',
      'R',
      'CTRL+Z',
      'CTRL+Y',
      'CTRL+S',
      'N',
      'ENTER',
      'M',
      'H',
      'ESC',
    ]) {
      expect(text, key).toContain(key);
    }
    // And the two facts an author cannot discover by pressing things: what
    // shift+click does, and that a built-in is only ever saved as a copy.
    expect(text).toContain('FLOOD');
    expect(text).toContain('COPY');
  });

  it('fits the frame, so nothing it says is off the bottom of the page', () => {
    const lines = HELP_SECTIONS.reduce((n, s) => n + s.entries.length + 2, 0);
    expect(lines * 12 + 62).toBeLessThan(VIEW_H);
    for (const section of HELP_SECTIONS) {
      for (const entry of section.entries) {
        expect((entry.keys.length + entry.text.length) * 6 + 200).toBeLessThan(VIEW_W);
      }
    }
  });
});

describe('the level picker', () => {
  it('offers NEW and IMPORT, then every draft, then every shipped level', () => {
    const { scene } = openPicker(['cellar', 'attic']);
    expect(scene.state.rows.map((r) => r.kind)).toEqual([
      'new',
      'import',
      'draft',
      'draft',
      ...LEVELS.map(() => 'builtin'),
    ]);
  });

  it('NEW makes a level of its own rather than reusing the last one', () => {
    const { h, scene } = openPicker();
    tap(h, scene, 'Enter');
    expect(h.scenes[0]).toBeInstanceOf(EditorScene);
    expect(listDrafts(h.game.save).map((d) => d.id)).toEqual(['untitled']);

    // Again, from a fresh picker: the second NEW must not land on the first.
    const second = new EditorSelectScene();
    second.enter(h.game);
    tap(h, second, 'Enter');
    expect(listDrafts(h.game.save).map((d) => d.id)).toEqual(['untitled', 'untitled-2']);
  });

  it('opens a draft with its own rows, not a blank grid', () => {
    const { h, scene } = openPicker(['cellar']);
    down(h, scene, 2); // past NEW and IMPORT, onto the draft
    tap(h, scene, 'Enter');
    const editor = h.scenes[0] as EditorScene;
    expect(editor.state.id).toBe('cellar');
    expect(editor.state.rows).toEqual(TINY);
  });

  it('OPENS A SHIPPED LEVEL AS A COPY, on the shelf, before a single edit', () => {
    const { h, scene } = openPicker();
    down(h, scene, 2); // past NEW and IMPORT, onto the first built-in
    tap(h, scene, 'Enter');
    const editor = h.scenes[0] as EditorScene;
    expect(editor.state.id).toBe(`${LEVELS[0].id}-copy`);
    expect(editor.state.rows).toHaveLength(LEVELS[0].map.h);
    // Written now rather than on the first stroke, so somebody who opens a
    // built-in, looks around and leaves still finds the copy when they return.
    expect(listDrafts(h.game.save).map((d) => d.id)).toEqual([`${LEVELS[0].id}-copy`]);
  });

  it('DELETING ASKS FIRST, and N keeps it', () => {
    const { h, scene } = openPicker(['cellar']);
    down(h, scene, 2);
    tap(h, scene, 'KeyX');
    expect(scene.state.confirming).toBe('cellar');
    tap(h, scene, 'KeyN');
    expect(scene.state.confirming).toBeNull();
    expect(listDrafts(h.game.save)).toHaveLength(1);

    tap(h, scene, 'KeyX');
    tap(h, scene, 'KeyY');
    expect(listDrafts(h.game.save)).toEqual([]);
    expect(scene.state.rows.some((r) => r.kind === 'draft')).toBe(false);
  });

  it('the prompt swallows Esc, so leaving is never one keystroke from deleting', () => {
    const { h, scene } = openPicker(['cellar']);
    down(h, scene, 2);
    tap(h, scene, 'KeyX');
    tap(h, scene, 'Escape');
    expect(scene.state.confirming).toBeNull();
    expect(h.scenes).toHaveLength(0); // it cancelled the prompt, not the screen
    expect(listDrafts(h.game.save)).toHaveLength(1);
  });

  it('REFUSES TO DELETE A BUILT-IN, and says why rather than doing nothing', () => {
    const { h, scene } = openPicker();
    down(h, scene, 2);
    tap(h, scene, 'KeyX');
    expect(scene.state.confirming).toBeNull();
    expect(scene.state.status).toContain('BUILT-IN');
  });

  it('Esc returns to the title', () => {
    const { h, scene } = openPicker();
    tap(h, scene, 'Escape');
    expect(h.scenes[0]).toBeInstanceOf(TitleScene);
  });

  it('the cursor never leaves the list, however long or short it is', () => {
    const { h, scene } = openPicker(['a', 'b', 'c']);
    for (let i = 0; i < scene.state.rows.length * 2 + 3; i++) {
      tap(h, scene, 'ArrowDown');
      expect(scene.state.index).toBeGreaterThanOrEqual(0);
      expect(scene.state.index).toBeLessThan(scene.state.rows.length);
    }
  });
});
