/**
 * The shell: title menu, level select with its progress gating, and results.
 *
 * All three are driven headlessly through `tests/harness.ts` for the same
 * reason `PlayScene` is — they touch only `game.input`, `game.audio`,
 * `game.save` and `game.setScene`, and `render` is never called.
 */

import { describe, expect, it } from 'vitest';
import { BINDINGS, bindingLabel } from '../src/engine/input';
import { SAVE_KEYS } from '../src/engine/save';
import { listDrafts } from '../src/editor/drafts';
import { LEVELS } from '../src/levels/index';
import { EditorScene } from '../src/scenes/editor';
import { EditorSelectScene } from '../src/scenes/editorselect';
import { LevelSelectScene } from '../src/scenes/levelselect';
import { PlayScene } from '../src/scenes/play';
import { ResultsScene } from '../src/scenes/results';
import type { ResultsStats } from '../src/scenes/results';
import { TitleScene, controlsFooter } from '../src/scenes/title';
import { openExternal } from '../src/engine/link';
import { click, fakeGame, step, tap } from './harness';
import type { Harness } from './harness';

function enter<T extends { enter?(game: never): void }>(h: Harness, scene: T): T {
  const s = scene as { enter?(game: unknown): void };
  s.enter?.(h.game);
  return scene;
}

function stats(over: Partial<ResultsStats> = {}): ResultsStats {
  return {
    level: LEVELS[0],
    index: 0,
    back: null,
    timeMs: 4321,
    previousBestMs: null,
    isNewBest: true,
    ...over,
  };
}

describe('TitleScene', () => {
  it('PLAY starts a campaign run', () => {
    const h = fakeGame();
    const scene = new TitleScene();
    tap(h, scene, 'Enter');
    expect(h.scenes).toHaveLength(1);
    expect(h.scenes[0]).toBeInstanceOf(PlayScene);
  });

  it('continues at the furthest level reached, clamped to the set that exists', () => {
    const h = fakeGame();
    h.save.setProgress(99); // a save from a longer campaign than we ship
    const scene = new TitleScene();
    tap(h, scene, 'Enter');
    expect(h.scenes[0]).toBeInstanceOf(PlayScene);
    // It must not index past the end of LEVELS. Constructing the scene at all
    // proves it — PlayScene would have thrown on an undefined level.
    expect(h.scenes).toHaveLength(1);
  });

  it('the menu moves and wraps, reaching LEVELS and EDITOR', () => {
    const h = fakeGame();
    const scene = new TitleScene();
    tap(h, scene, 'ArrowDown'); // PLAY -> LEVELS
    tap(h, scene, 'Enter');
    expect(h.scenes[0]).toBeInstanceOf(LevelSelectScene);

    const h2 = fakeGame();
    const s2 = new TitleScene();
    tap(h2, s2, 'ArrowUp'); // wraps PLAY -> EDITOR
    tap(h2, s2, 'Enter');
    expect(h2.scenes[0]).toBeInstanceOf(EditorSelectScene);
  });

  it('clicks menu rows and navigates them with the wheel', () => {
    const clicked = fakeGame();
    click(clicked, new TitleScene(), 480, 320);
    expect(clicked.scenes[0]).toBeInstanceOf(LevelSelectScene);

    const wheeled = fakeGame();
    const scene = new TitleScene();
    wheeled.input.onWheel(480, 270, 100);
    step(wheeled, scene);
    tap(wheeled, scene, 'Enter');
    expect(wheeled.scenes[0]).toBeInstanceOf(LevelSelectScene);
  });

  it('does not let a stationary mouse fight keyboard navigation', () => {
    const h = fakeGame();
    const scene = new TitleScene();
    h.input.onPointerMove(480, 370); // EDITOR owns the highlight.
    step(h, scene);
    tap(h, scene, 'ArrowUp'); // Keyboard takes it to LEVELS.
    step(h, scene, 3); // A stationary cursor must not take EDITOR back.
    tap(h, scene, 'Enter');
    expect(h.scenes[0]).toBeInstanceOf(LevelSelectScene);

    const h2 = fakeGame();
    const s2 = new TitleScene();
    tap(h2, s2, 'ArrowDown'); // LEVELS by keyboard.
    h2.input.onPointerMove(480, 370); // Real movement hands back to mouse.
    step(h2, s2);
    tap(h2, s2, 'Enter');
    expect(h2.scenes[0]).toBeInstanceOf(EditorSelectScene);
  });

  it('the corner links open a tab and leave the menu where it was', () => {
    const g = globalThis as { open?: unknown };
    const before = g.open;
    const opened: string[] = [];
    g.open = (url: string) => opened.push(url);
    try {
      const h = fakeGame();
      const scene = new TitleScene();
      click(h, scene, 20, 18); // top-left: the author's site
      expect(opened).toEqual(['https://calcitedev.me']);

      opened.length = 0;
      click(h, scene, 940, 18); // top-right: the tip jar
      expect(opened).toEqual(['https://ko-fi.com/calcitedragon']);

      opened.length = 0;
      click(h, scene, 480, 450); // below the menu is neither link nor item
      expect(opened).toEqual([]);

      // A link is not a menu item: none of that navigated anywhere in-game.
      expect(h.scenes).toHaveLength(0);
    } finally {
      g.open = before;
    }
  });

  it('E opens the editor directly, as GAME-DESIGN §4 has always said', () => {
    const h = fakeGame();
    const scene = new TitleScene();
    tap(h, scene, 'KeyE');
    // The PICKER, not a level: with a shelf of drafts, "the editor" is no
    // longer one level, and guessing which one would be wrong most of the time.
    expect(h.scenes[0]).toBeInstanceOf(EditorSelectScene);
  });
});

describe('the controls footer', () => {
  it('IS DERIVED FROM BINDINGS, so a rebinding cannot silently lie', () => {
    const footer = controlsFooter();
    expect(footer).toContain(`${bindingLabel('flip')} FLIP`);
    expect(footer).toContain(`${bindingLabel('mute')} MUTE`);
    expect(footer).toContain('ESC PAUSE');
    // And every label in it really came from the table.
    const labels = BINDINGS.map((b) => bindingLabel(b.action));
    for (const part of footer.split('  ·  ')) {
      expect(labels).toContain(part.split(' ')[0]);
    }
  });

  it('renders inside the frame at scale 1', () => {
    // 6 px per glyph at scale 1 against a 960 px view. A footer that overflowed
    // would be centred and clipped at BOTH ends, which reads as a font bug.
    expect(controlsFooter().length * 6).toBeLessThan(960);
  });
});

describe('LevelSelectScene progress gating', () => {
  it('a corrupt or absent value unlocks exactly one — not zero, and not all', () => {
    // Zero would lock a player out of their own game; all would make the key
    // pointless. One is the only answer that is not a bug.
    const h = fakeGame();
    h.storage.setItem(SAVE_KEYS.progress, 'garbage');
    const scene = enter(h, new LevelSelectScene());
    tap(h, scene, 'Enter');
    expect(h.scenes).toHaveLength(1); // row 0 is playable
    expect(h.scenes[0]).toBeInstanceOf(PlayScene);
  });

  it('bw.progress = 1 unlocks exactly two entries', () => {
    const h = fakeGame();
    h.save.setProgress(1);
    const scene = enter(h, new LevelSelectScene());
    // Entering puts the cursor on the furthest unlocked row, which is 1.
    tap(h, scene, 'Enter');
    if (LEVELS.length > 1) {
      expect(h.scenes).toHaveLength(1);
    }
    // Row 2, if the set has one, is locked and confirm does nothing at all.
    if (LEVELS.length > 2) {
      const h2 = fakeGame();
      h2.save.setProgress(1);
      const s2 = enter(h2, new LevelSelectScene());
      tap(h2, s2, 'ArrowDown'); // 1 -> 2, which is past progress
      tap(h2, s2, 'Enter');
      expect(h2.scenes).toHaveLength(0);
    }
  });

  it('a locked row refuses confirm', () => {
    const h = fakeGame();
    const scene = enter(h, new LevelSelectScene()); // progress 0, cursor on 0
    // Walk to the last row. With one level that is a no-op and the row is open;
    // with more, everything past 0 is locked.
    for (let i = 1; i < LEVELS.length; i++) {
      tap(h, scene, 'ArrowDown');
    }
    tap(h, scene, 'Enter');
    expect(h.scenes).toHaveLength(LEVELS.length > 1 ? 0 : 1);
  });

  it('E opens the highlighted row in the editor, locked or not', () => {
    // The lock is about play order, not about whether the file exists —
    // refusing to open it would make the tool hostage to the campaign.
    const h = fakeGame();
    const scene = enter(h, new LevelSelectScene());
    tap(h, scene, 'KeyE');
    const editor = h.scenes[0] as EditorScene;
    expect(editor).toBeInstanceOf(EditorScene);
    // As a COPY: every cell of the real level, under an id of its own, and on
    // the draft shelf from the moment it opens.
    expect(editor.state.id).not.toBe(LEVELS[0].id);
    expect(editor.state.rows).toHaveLength(LEVELS[0].map.h);
    expect(editor.state.errors).toEqual([]);
    expect(listDrafts(h.game.save).map((d) => d.id)).toEqual([editor.state.id]);
  });

  it('Esc returns to the title', () => {
    const h = fakeGame();
    const scene = enter(h, new LevelSelectScene());
    tap(h, scene, 'Escape');
    expect(h.scenes[0]).toBeInstanceOf(TitleScene);
  });
});

describe('ResultsScene', () => {
  it('RETRY replays the same level in the same campaign slot', () => {
    const h = fakeGame();
    const scene = new ResultsScene(stats());
    // NEXT is present only when there is a next level; walk to RETRY either way.
    const toRetry = LEVELS.length > 1 ? 1 : 0;
    for (let i = 0; i < toRetry; i++) {
      tap(h, scene, 'ArrowDown');
    }
    tap(h, scene, 'Enter');
    expect(h.scenes[0]).toBeInstanceOf(PlayScene);
  });

  it('LEVELS goes to the level select, and so does Esc', () => {
    const h = fakeGame();
    const scene = new ResultsScene(stats());
    tap(h, scene, 'ArrowUp'); // wrap to the last item, which is always LEVELS
    tap(h, scene, 'Enter');
    expect(h.scenes[0]).toBeInstanceOf(LevelSelectScene);

    const h2 = fakeGame();
    const s2 = new ResultsScene(stats());
    tap(h2, s2, 'Escape');
    expect(h2.scenes[0]).toBeInstanceOf(LevelSelectScene);
  });

  it('OFFERS NEXT ONLY WHEN THERE IS ONE', () => {
    // At the end of the set, NEXT is absent rather than disabled: a menu item
    // that cannot be chosen is a menu item that has to explain itself.
    const h = fakeGame();
    const last = new ResultsScene(stats({ index: LEVELS.length - 1 }));
    tap(h, last, 'Enter'); // the first item, whatever it is
    expect(h.scenes[0]).toBeInstanceOf(PlayScene); // RETRY, not NEXT

    if (LEVELS.length > 1) {
      const h2 = fakeGame();
      const first = new ResultsScene(stats({ index: 0 }));
      tap(h2, first, 'Enter'); // now the first item IS next
      expect(h2.scenes[0]).toBeInstanceOf(PlayScene);
    }
  });

  it('owns no clock: it never advances on its own', () => {
    // GOAL_HOLD stays in PlayScene, where it is the punctuation on the frozen
    // frame. This screen waits for a keypress and nothing else.
    const h = fakeGame();
    const scene = new ResultsScene(stats());
    step(h, scene, 600); // ten seconds
    expect(h.scenes).toHaveLength(0);
  });
});

describe('openExternal', () => {
  it('reports false rather than throwing where there is no window.open', () => {
    const g = globalThis as { open?: unknown };
    const before = g.open;
    g.open = undefined;
    try {
      expect(openExternal('https://calcitedev.me')).toBe(false);
    } finally {
      g.open = before;
    }
  });

  it('opens in a new tab with the opener severed', () => {
    const g = globalThis as { open?: unknown };
    const before = g.open;
    const calls: string[][] = [];
    g.open = (...args: string[]) => calls.push(args);
    try {
      expect(openExternal('https://calcitedev.me')).toBe(true);
      expect(calls).toEqual([['https://calcitedev.me', '_blank', 'noopener,noreferrer']]);
    } finally {
      g.open = before;
    }
  });
});
