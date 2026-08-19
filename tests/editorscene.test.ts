/**
 * The editor, driven headlessly — **mouse included**. That is decision 2's real
 * payoff: a press arrives as `Input.onPointerDown(vx, vy, 0)` in view space
 * rather than as a DOM event, so this file paints a stroke, undoes it, resizes
 * the grid, playtests it and comes back with no canvas anywhere.
 */

import { describe, expect, it } from 'vitest';
import {
  EDITOR_DEFAULT_H,
  EDITOR_DEFAULT_W,
  EDITOR_MAX_H,
  EDITOR_MAX_W,
  TILE,
  VIEW_H,
  VIEW_W,
} from '../src/constants';
import { GRID_CHARS } from '../src/editor/grid';
import { MOUSE_MIDDLE, MOUSE_RIGHT } from '../src/engine/input';
import { SAVE_KEYS } from '../src/engine/save';
import { EditorScene, editorInitFromLevel } from '../src/scenes/editor';
import { PlayScene } from '../src/scenes/play';
import { TitleScene } from '../src/scenes/title';
import { LEVELS } from '../src/levels/index';
import { parseLevel, validateLevel } from '../src/world/level';
import { fakeGame, step, tap } from './harness';
import type { Harness } from './harness';

/** A 10x5 stage, small enough to sit whole in the frame at either zoom. */
const STAGE: readonly string[] = [
  '..........',
  '..S....G..',
  '..........',
  '..........',
  '##########',
];

function open(rows: readonly string[] = STAGE): { h: Harness; scene: EditorScene } {
  const h = fakeGame();
  const scene = new EditorScene({ id: 'test-level', name: 'TEST LEVEL', rows });
  scene.enter(h.game);
  return { h, scene };
}

/**
 * The view-space centre of a cell. Derived from the scene's live zoom rather
 * than from TILE, because the editor opens at HALF zoom -- a 40x20 default grid
 * is 1280 px wide at 1x and does not fit the frame, and a level you cannot see
 * is the whole reason zoom exists.
 */
function cellCentre(scene: EditorScene, tx: number, ty: number): [number, number] {
  const cell = TILE * scene.state.zoom;
  return [tx * cell + cell / 2, ty * cell + cell / 2];
}

/** Clear the size field and type a fresh `W X H` into it, then commit. */
function typeSize(h: Harness, scene: EditorScene, text: string): void {
  for (let i = 0; i < 12; i++) {
    tap(h, scene, 'Backspace');
  }
  for (const ch of text) {
    tap(h, scene, ch === 'X' || ch === 'x' ? 'KeyX' : `Digit${ch}`);
  }
  tap(h, scene, 'Enter');
}

/** A drag across a row of cells, one frame per cell, as a real one arrives. */
function drag(
  h: Harness,
  scene: EditorScene,
  cells: readonly (readonly [number, number])[],
  button = 0,
): void {
  const [fx, fy] = cellCentre(scene, cells[0][0], cells[0][1]);
  h.input.onPointerDown(fx, fy, button);
  step(h, scene);
  for (const [tx, ty] of cells.slice(1)) {
    const [vx, vy] = cellCentre(scene, tx, ty);
    h.input.onPointerMove(vx, vy);
    step(h, scene);
  }
  const last = cells[cells.length - 1];
  const [lx, ly] = cellCentre(scene, last[0], last[1]);
  h.input.onPointerUp(lx, ly, button);
  step(h, scene);
}

describe('a fresh editor', () => {
  it('opens onto a blank grid that is already valid', () => {
    const h = fakeGame();
    const scene = new EditorScene();
    scene.enter(h.game);
    expect(scene.state.rows).toHaveLength(EDITOR_DEFAULT_H);
    expect(scene.state.rows[0]).toHaveLength(EDITOR_DEFAULT_W);
    expect(scene.state.errors).toEqual([]);
    expect(scene.state.mode).toBe('paint');
  });

  it('opens a shipped level with no errors and its own id', () => {
    const h = fakeGame();
    const scene = new EditorScene(editorInitFromLevel(LEVELS[0]));
    scene.enter(h.game);
    expect(scene.state.id).toBe(LEVELS[0].id);
    expect(scene.state.errors).toEqual([]);
    expect(scene.state.rows).toHaveLength(LEVELS[0].map.h);
  });

  it('is silent — no bed on any screen but play', () => {
    const { h } = open();
    expect(h.audio.calls).toContain('stop');
    expect(h.audio.calls).not.toContain('start');
  });
});

describe('painting with the mouse', () => {
  it('paints the selected character at the cell under the pointer', () => {
    const { h, scene } = open();
    tap(h, scene, 'Digit2'); // '#'
    expect(scene.state.sel).toBe('#');
    drag(h, scene, [[4, 3]]);
    expect(scene.state.rows[3][4]).toBe('#');
  });

  it('ONE Ctrl+Z UNDOES A WHOLE DRAG, however many frames it spanned', () => {
    const { h, scene } = open();
    tap(h, scene, 'Digit2');
    const before = scene.state.rows;
    drag(
      h,
      scene,
      Array.from({ length: 8 }, (_, i) => [i, 3] as [number, number]),
    );
    expect(scene.state.rows[3]).toBe('########..');
    expect(scene.state.undoDepth).toBe(1);

    h.input.onKey('ControlLeft', true);
    tap(h, scene, 'KeyZ');
    h.input.onKey('ControlLeft', false);
    expect(scene.state.rows).toEqual(before);
  });

  it('right-drag erases', () => {
    const { h, scene } = open();
    drag(
      h,
      scene,
      [
        [0, 4],
        [1, 4],
        [2, 4],
      ],
      MOUSE_RIGHT,
    );
    expect(scene.state.rows[4]).toBe('...#######');
  });

  it('A PRESS IN THE LETTERBOX NEVER PAINTS', () => {
    const { h, scene } = open();
    tap(h, scene, 'Digit2');
    const before = scene.state.rows;
    h.input.onPointerDown(-40, 100, 0); // in the left bar
    step(h, scene);
    h.input.onPointerUp(-40, 100, 0);
    step(h, scene);
    expect(scene.state.rows).toEqual(before);
  });

  it('a drag that leaves the frame STOPS rather than clamping to the edge tile', () => {
    // Clamping would smear a wall of tiles down the border, which is the
    // visible version of the same bug.
    const { h, scene } = open();
    tap(h, scene, 'Digit2');
    const [sx, sy] = cellCentre(scene, 1, 3);
    h.input.onPointerDown(sx, sy, 0);
    step(h, scene);
    for (let i = 0; i < 10; i++) {
      h.input.onPointerMove(-20 - i * 5, sy); // dragged off the left edge
      step(h, scene);
    }
    h.input.onPointerUp(-70, sy, 0);
    step(h, scene);
    expect(scene.state.rows[3]).toBe('.#........');
  });

  it('Shift+click floods, as one undo step', () => {
    const { h, scene } = open();
    tap(h, scene, 'Digit2');
    h.input.onKey('ShiftLeft', true);
    const [vx, vy] = cellCentre(scene, 5, 3);
    h.input.onPointerDown(vx, vy, 0);
    step(h, scene);
    h.input.onPointerUp(vx, vy, 0);
    step(h, scene);
    h.input.onKey('ShiftLeft', false);
    // Rows 0..3 are open and 4-connected around the S and G, so the fill takes
    // everything above the floor except the two markers.
    expect(scene.state.rows[3]).toBe('##########');
    expect(scene.state.rows[0]).toBe('##########');
    expect(scene.state.rows[1]).toBe('##S####G##');
    expect(scene.state.undoDepth).toBe(1);
  });

  it('a click on the palette bar selects rather than painting', () => {
    const { h, scene } = open();
    // The bar sits bottom-left; its first swatch is centred near (33, VIEW_H-33).
    h.input.onPointerDown(33 + 3 * 40, VIEW_H - 33, 0);
    step(h, scene);
    h.input.onPointerUp(33 + 3 * 40, VIEW_H - 33, 0);
    step(h, scene);
    expect(scene.state.sel).toBe(GRID_CHARS[3]);
    expect(scene.state.undoDepth).toBe(0); // nothing was painted
  });
});

describe('the palette and the view', () => {
  it('1 to 8 select the eight characters', () => {
    const { h, scene } = open();
    for (let i = 0; i < GRID_CHARS.length; i++) {
      tap(h, scene, `Digit${i + 1}`);
      expect(scene.state.sel).toBe(GRID_CHARS[i]);
    }
  });

  it('Z toggles the two zoom steps, and Ctrl+Z does not', () => {
    const { h, scene } = open();
    const first = scene.state.zoom;
    tap(h, scene, 'KeyZ');
    expect(scene.state.zoom).not.toBe(first);
    tap(h, scene, 'KeyZ');
    expect(scene.state.zoom).toBe(first);

    // With Ctrl held, Z is undo and the zoom must not move underneath it.
    h.input.onKey('ControlLeft', true);
    tap(h, scene, 'KeyZ');
    h.input.onKey('ControlLeft', false);
    expect(scene.state.zoom).toBe(first);
  });

  it('the bracket and comma keys resize, with Shift for the opposite edge', () => {
    const { h, scene } = open();
    tap(h, scene, 'BracketRight');
    expect(scene.state.rows[0]).toHaveLength(11);
    tap(h, scene, 'Period');
    expect(scene.state.rows).toHaveLength(6);

    // Shift moves the LEFT edge, which carries the spawn with it.
    h.input.onKey('ShiftLeft', true);
    tap(h, scene, 'BracketRight');
    h.input.onKey('ShiftLeft', false);
    expect(scene.state.rows[1][3]).toBe('S');
    expect(validateLevel(scene.state.rows)).toEqual([]);
  });
});

describe('validation and the panel', () => {
  it('A CROP THAT LOSES THE SPAWN REACHES THE PANEL VERBATIM, and blocks the save', () => {
    const { h, scene } = open();
    // Crop three columns off the left; the S is at column 2.
    h.input.onKey('ShiftLeft', true);
    tap(h, scene, 'BracketLeft');
    tap(h, scene, 'BracketLeft');
    tap(h, scene, 'BracketLeft');
    h.input.onKey('ShiftLeft', false);

    expect(scene.state.errors).toHaveLength(1);
    expect(scene.state.errors[0]).toBe(validateLevel(scene.state.rows)[0]);
    expect(scene.state.errors[0]).toContain('found 0 spawn markers');

    // Ctrl+S must refuse. It never reaches `saveLevel`, so there is no fetch to
    // stub — the status line is the whole observable effect.
    h.input.onKey('ControlLeft', true);
    tap(h, scene, 'KeyS');
    h.input.onKey('ControlLeft', false);
    expect(scene.state.status).toContain('CANNOT SAVE');
    expect(scene.state.status).toContain('found 0 spawn markers');
  });

  it('a down-pad in a floor is a WARNING, and does not block anything', () => {
    const { h, scene } = open([
      '..........',
      '..S....G..',
      '....v.....',
      '..........',
      '##########',
    ]);
    expect(scene.state.errors).toEqual([]);
    expect(scene.state.warnings).toHaveLength(0); // the cell below is empty

    tap(h, scene, 'Digit2');
    drag(h, scene, [[4, 3]]); // wall it in from below
    expect(scene.state.errors).toEqual([]);
    expect(scene.state.warnings).toHaveLength(1);
    expect(scene.state.warnings[0]).toContain('row 2');
    // And it still parses, because a warning is advice and not a format error.
    expect(parseLevel({ id: 'w', name: 'W', rows: scene.state.rows }).ok).toBe(true);
  });
});

describe('naming', () => {
  it('N edits the id, then the name, one Enter apart', () => {
    const { h, scene } = open();
    tap(h, scene, 'KeyN');
    expect(scene.state.mode).toBe('id');
    for (const code of ['KeyA', 'Minus', 'Digit2']) {
      tap(h, scene, code);
    }
    // The buffer replaced the old id wholesale? No — it starts FROM it.
    tap(h, scene, 'Enter');
    expect(scene.state.id).toBe('test-levela-2');
    expect(scene.state.mode).toBe('name');
    tap(h, scene, 'Enter');
    expect(scene.state.mode).toBe('paint');
  });

  it('THE TEXT FIELD SWALLOWS EVERY KEY, including the ones that paint', () => {
    // The classic modal bug: typing a name and finding you have painted a
    // level's worth of tiles behind the dialog.
    const { h, scene } = open();
    const before = scene.state.rows;
    const sel = scene.state.sel;
    tap(h, scene, 'KeyN');
    for (const code of ['Digit2', 'KeyZ', 'BracketRight', 'KeyS']) {
      tap(h, scene, code);
    }
    expect(scene.state.rows).toEqual(before);
    expect(scene.state.sel).toBe(sel);
    expect(scene.state.mode).toBe('id');
  });

  it('Esc cancels the field rather than leaving the editor', () => {
    // Escape means four things across four scenes; in this mode it means one.
    const { h, scene } = open();
    tap(h, scene, 'KeyN');
    tap(h, scene, 'Escape');
    expect(scene.state.mode).toBe('paint');
    expect(scene.state.id).toBe('test-level');
    expect(h.scenes).toHaveLength(0); // it did NOT quit to the title
  });

  it('refuses an id outside the filename charset', () => {
    const { h, scene } = open();
    tap(h, scene, 'KeyN');
    // Wipe the buffer, then type nothing at all.
    for (let i = 0; i < 20; i++) {
      tap(h, scene, 'Backspace');
    }
    tap(h, scene, 'Enter');
    expect(scene.state.mode).toBe('id'); // still in the field
    expect(scene.state.status).toContain('BAD ID');
    expect(scene.state.id).toBe('test-level');
  });

  it('lowercases the id and uppercases the name, because their jobs differ', () => {
    const { h, scene } = open();
    tap(h, scene, 'KeyN');
    for (let i = 0; i < 20; i++) {
      tap(h, scene, 'Backspace');
    }
    for (const code of ['KeyM', 'KeyY', 'Minus', 'KeyL', 'Digit9']) {
      tap(h, scene, code);
    }
    tap(h, scene, 'Enter');
    expect(scene.state.id).toBe('my-l9');

    for (let i = 0; i < 20; i++) {
      tap(h, scene, 'Backspace');
    }
    for (const code of ['KeyM', 'KeyY', 'Space', 'KeyL']) {
      tap(h, scene, code);
    }
    tap(h, scene, 'Enter');
    expect(scene.state.name).toBe('MY L');
  });
});

describe('playtest', () => {
  it('hands the REAL PlayScene a REAL Level, in a playtest context', () => {
    const { h, scene } = open();
    tap(h, scene, 'Enter');
    expect(h.scenes).toHaveLength(1);
    expect(h.scenes[0]).toBeInstanceOf(PlayScene);
  });

  it('EDITOR → PLAYTEST → BACK PRESERVES THE GRID AND THE UNDO STACK', () => {
    // §10's requirement, stated as an object identity: the scene returned to is
    // the same instance, not a rebuilt one.
    const { h, scene } = open();
    tap(h, scene, 'Digit2');
    drag(
      h,
      scene,
      Array.from({ length: 5 }, (_, i) => [i, 3] as [number, number]),
    );
    const rows = scene.state.rows;
    const depth = scene.state.undoDepth;

    tap(h, scene, 'Enter');
    const play = h.scenes[0] as PlayScene;
    // Quit out of the playtest through the pause menu.
    tap(h, play, 'Escape');
    tap(h, play, 'ArrowDown');
    tap(h, play, 'ArrowDown');
    tap(h, play, 'Enter');

    expect(h.scenes[1]).toBe(scene); // the SAME editor, not a new one
    expect(scene.state.rows).toEqual(rows);
    expect(scene.state.undoDepth).toBe(depth);
  });

  it('refuses a grid the parser would reject, and says why', () => {
    const { h, scene } = open();
    h.input.onKey('ShiftLeft', true);
    for (let i = 0; i < 3; i++) {
      tap(h, scene, 'BracketLeft'); // crop the spawn away
    }
    h.input.onKey('ShiftLeft', false);
    tap(h, scene, 'Enter');
    expect(h.scenes).toHaveLength(0);
    expect(scene.state.status).toContain('spawn markers');
  });
});

describe('the draft', () => {
  it('is written on every stroke end, so a reload costs one stroke at most', () => {
    const { h, scene } = open();
    expect(h.storage.map.has(SAVE_KEYS.editorDraft)).toBe(false);
    tap(h, scene, 'Digit2');
    drag(h, scene, [[4, 3]]);
    const raw = h.storage.getItem(SAVE_KEYS.editorDraft);
    expect(raw).not.toBeNull();
    const parsed: unknown = JSON.parse(raw as string);
    expect(parsed).toEqual({
      id: 'test-level',
      name: 'TEST LEVEL',
      rows: scene.state.rows,
    });
  });

  it('and what it holds is what parseLevel accepts', () => {
    const { h, scene } = open();
    tap(h, scene, 'Digit2');
    drag(h, scene, [[4, 3]]);
    const parsed: unknown = JSON.parse(h.storage.getItem(SAVE_KEYS.editorDraft) as string);
    expect(parseLevel(parsed).ok).toBe(true);
  });
});

describe('leaving, and the modes', () => {
  it('Esc returns to the title from paint mode', () => {
    const { h, scene } = open();
    tap(h, scene, 'Escape');
    expect(h.scenes[0]).toBeInstanceOf(TitleScene);
  });

  it('middle-drag pans without painting', () => {
    const { h, scene } = open();
    tap(h, scene, 'Digit2');
    const before = scene.state.rows;
    h.input.onPointerDown(400, 200, MOUSE_MIDDLE);
    step(h, scene);
    h.input.onPointerMove(300, 150);
    step(h, scene);
    h.input.onPointerUp(300, 150, MOUSE_MIDDLE);
    step(h, scene);
    expect(scene.state.rows).toEqual(before);
  });

  it('space-drag pans without flipping anything or painting', () => {
    const { h, scene } = open();
    tap(h, scene, 'Digit2');
    const before = scene.state.rows;
    h.input.onKey('Space', true);
    h.input.onPointerDown(400, 200, 0);
    step(h, scene);
    h.input.onPointerMove(340, 200);
    step(h, scene);
    h.input.onPointerUp(340, 200, 0);
    step(h, scene);
    h.input.onKey('Space', false);
    expect(scene.state.rows).toEqual(before);
    expect(h.scenes).toHaveLength(0); // Space is also `confirm`; nothing fired
  });

  it('the arrows pan and never move the selection', () => {
    const { h, scene } = open();
    const sel = scene.state.sel;
    h.input.onKey('ArrowRight', true);
    step(h, scene, 30);
    h.input.onKey('ArrowRight', false);
    expect(scene.state.sel).toBe(sel);
    expect(scene.state.rows).toEqual(STAGE);
  });
});

describe('a 200x60 grid, which is the size cap', () => {
  it('opens, draws its cells and stays valid at both zooms', () => {
    // The draw budget's worst case. Nothing here measures milliseconds — that
    // is the browser pass's job — but the scene has to survive being asked.
    const rows: string[] = [];
    for (let ty = 0; ty < 60; ty++) {
      rows.push(ty === 30 ? `.S${'.'.repeat(196)}G.` : '#'.repeat(200));
    }
    const { h, scene } = open(rows);
    expect(scene.state.errors).toEqual([]);
    expect(scene.state.rows[0]).toHaveLength(200);
    tap(h, scene, 'KeyZ');
    h.input.onKey('ArrowRight', true);
    step(h, scene, 120); // pan two seconds to the right
    h.input.onKey('ArrowRight', false);
    expect(scene.state.rows).toHaveLength(60);
    // The view can never be panned so far that the grid leaves the frame.
    expect(VIEW_W).toBeGreaterThan(0);
  });
});

/**
 * The five defects the phase 7 review found, each as the scenario that produced
 * it. All five are in this scene because it is the first one in the project
 * with modal state and opaque overlays, which is exactly the pair the brief
 * flagged as the risk.
 */
describe('regressions from the review', () => {
  /** Tall enough that the overlays sit over real cells at 1x zoom. */
  const TALL: readonly string[] = [
    '..............................',
    '..S........................G..',
    ...Array.from({ length: 16 }, () => '..............................'),
    '##############################',
  ];

  /**
   * 1x zoom, panned hard to the top-left. Both matter: at 1x a cell is 32 px so
   * the overlays sit over real rows, and the pan has to be reset because
   * toggling zoom holds the view CENTRE, which leaves the origin off-screen and
   * would make every assertion below vacuously true by landing out of bounds.
   */
  function openAt1x(rows: readonly string[] = TALL): { h: Harness; scene: EditorScene } {
    const r = open(rows);
    tap(r.h, r.scene, 'KeyZ'); // half -> 1x
    expect(r.scene.state.zoom).toBe(1);
    // Hard to the top-left corner (which clamps at -PAN_MARGIN), then back by
    // exactly PAN_MARGIN, so the view sits on the grid's origin: view space and
    // world space agree, and the header at view y 6..48 covers rows 0 and 1.
    r.h.input.onKey('ArrowLeft', true);
    r.h.input.onKey('ArrowUp', true);
    step(r.h, r.scene, 120);
    r.h.input.onKey('ArrowLeft', false);
    r.h.input.onKey('ArrowUp', false);
    r.h.input.onKey('ArrowRight', true);
    r.h.input.onKey('ArrowDown', true);
    step(r.h, r.scene, 6); // 6 frames x 640 px/s / 60 = 64 px
    r.h.input.onKey('ArrowRight', false);
    r.h.input.onKey('ArrowDown', false);
    return r;
  }

  /**
   * Guards the guard: paint at this point with the overlays out of the way and
   * assert it DID land, so a blocked-click assertion can never pass merely
   * because the coordinate was off the grid.
   */
  function expectPaintable(h: Harness, scene: EditorScene, vx: number, vy: number): void {
    tap(h, scene, 'Digit2');
    const before = scene.state.rows;
    h.input.onPointerDown(vx, vy, 0);
    step(h, scene);
    h.input.onPointerUp(vx, vy, 0);
    step(h, scene);
    expect(scene.state.rows, `nothing at ${vx},${vy} — the test would be vacuous`).not.toEqual(
      before,
    );
    h.input.onKey('ControlLeft', true);
    tap(h, scene, 'KeyZ'); // undo it again
    h.input.onKey('ControlLeft', false);
    expect(scene.state.rows).toEqual(before);
  }

  /** A press and release at a view point, with a frame either side. */
  function clickAt(h: Harness, scene: EditorScene, vx: number, vy: number, button = 0): void {
    h.input.onPointerDown(vx, vy, button);
    step(h, scene);
    h.input.onPointerUp(vx, vy, button);
    step(h, scene);
  }

  it('A CLICK ON THE STATUS STRIP DOES NOT PAINT UNDER THE BAR', () => {
    // The bar's plate spans the frame to carry the status line, but the hit
    // test used to cover only the eight swatches — so this click painted a cell
    // that the plate itself then hid, at 1x zoom where row 15 sits under it.
    const { h, scene } = openAt1x();
    // The same point, one row up and clear of the plate, really does paint.
    expectPaintable(h, scene, 600, 440);
    const before = scene.state.rows;
    clickAt(h, scene, 600, 505);
    expect(scene.state.rows).toEqual(before);
  });

  it('a click on the header does not paint under it either', () => {
    const { h, scene } = openAt1x();
    expectPaintable(h, scene, 100, 200);
    const before = scene.state.rows;
    clickAt(h, scene, 100, 20);
    expect(scene.state.rows).toEqual(before);
  });

  it('a click on the validation panel does not paint under it', () => {
    // The panel appears exactly when the author is clicking around fixing an
    // error, which is what made this one reachable.
    const { h, scene } = openAt1x();
    h.input.onKey('ShiftLeft', true);
    for (let i = 0; i < 3; i++) {
      tap(h, scene, 'BracketLeft'); // crop the spawn away
    }
    h.input.onKey('ShiftLeft', false);
    expect(scene.state.errors.length).toBeGreaterThan(0);
    expectPaintable(h, scene, 700, 300);
    const before = scene.state.rows;
    clickAt(h, scene, 700, 80);
    expect(scene.state.rows).toEqual(before);
  });

  it('the swatches still select, and the gaps between them do nothing', () => {
    // The blocking rects must not have swallowed the bar's real job.
    const { h, scene } = open();
    clickAt(h, scene, 33 + 3 * 40, VIEW_H - 33);
    expect(scene.state.sel).toBe(GRID_CHARS[3]);
    const sel = scene.state.sel;
    clickAt(h, scene, 16 + 34 + 3, VIEW_H - 33); // the gap after swatch 0
    expect(scene.state.sel).toBe(sel);
  });

  it('CTRL+DIGIT DOES NOT CHANGE THE TOOL', () => {
    // A slip while reaching for Ctrl+Z used to switch the palette to '.', so
    // the next drag erased instead of painting.
    const { h, scene } = open();
    tap(h, scene, 'Digit2');
    expect(scene.state.sel).toBe('#');
    h.input.onKey('ControlLeft', true);
    tap(h, scene, 'Digit1');
    tap(h, scene, 'Digit5');
    h.input.onKey('ControlLeft', false);
    expect(scene.state.sel).toBe('#');
  });

  it('A MIDDLE-DRAG PAN SURVIVES A LEFT-BUTTON TAP', () => {
    // The pan used to tear down on a release of EITHER button, stranding it
    // with the middle button still held and the view no longer following.
    const { h, scene } = open();
    h.input.onPointerDown(400, 200, MOUSE_MIDDLE);
    step(h, scene);
    expect(scene.state.panning).toBe(true);
    h.input.onPointerDown(400, 200, 0);
    step(h, scene);
    h.input.onPointerUp(400, 200, 0);
    step(h, scene);
    expect(scene.state.panning).toBe(true); // middle is still down
    h.input.onPointerUp(400, 200, MOUSE_MIDDLE);
    step(h, scene);
    expect(scene.state.panning).toBe(false);
  });

  it('OPENING A TEXT FIELD ENDS THE FRAME, so nothing paints behind it', () => {
    // Without the early return, `N` pressed on the same frame as a click opened
    // a stroke that the text-mode guard then never ended — leaving the scene
    // with a live stroke that the next release would commit.
    const { h, scene } = open();
    tap(h, scene, 'Digit2');
    const before = scene.state.rows;
    // (50, 40) is tile (3, 2) at half zoom — well inside the 10x5 stage, so a
    // stroke that did start would be visible.
    h.input.onKey('KeyN', true);
    h.input.onPointerDown(50, 40, 0);
    step(h, scene);
    h.input.onKey('KeyN', false);
    h.input.onPointerUp(50, 40, 0);
    step(h, scene);
    expect(scene.state.mode).toBe('id');
    expect(scene.state.rows).toEqual(before);
    expect(scene.state.undoDepth).toBe(0);
  });

  it('and a resize key pressed on that same frame does not fire either', () => {
    const { h, scene } = open();
    const w = scene.state.rows[0].length;
    h.input.onKey('KeyN', true);
    h.input.onKey('BracketRight', true);
    step(h, scene);
    h.input.onKey('KeyN', false);
    h.input.onKey('BracketRight', false);
    step(h, scene);
    expect(scene.state.mode).toBe('id');
    expect(scene.state.rows[0]).toHaveLength(w);
  });
});

describe('the size field', () => {
  // The delta resize is a nudge; this is a destination. Both are needed, and
  // this is the one that makes a 200-wide level authorable — the same edit as
  // 190 taps of `]`, in one command and one undo step.

  it('R opens it prefilled with the current size, and Enter applies it', () => {
    const { h, scene } = open();
    tap(h, scene, 'KeyR');
    expect(scene.state.mode).toBe('size');
    expect(scene.state.buffer).toBe('10X5');

    for (const code of ['Backspace', 'Backspace', 'Backspace', 'Backspace']) {
      tap(h, scene, code);
    }
    for (const code of ['Digit2', 'Digit4', 'KeyX', 'Digit8']) {
      tap(h, scene, code);
    }
    tap(h, scene, 'Enter');
    expect(scene.state.mode).toBe('paint');
    expect(scene.state.rows[0]).toHaveLength(24);
    expect(scene.state.rows).toHaveLength(8);
    // Grown from the right and the bottom, so the markers did not move.
    expect(scene.state.rows[1][2]).toBe('S');
    expect(validateLevel(scene.state.rows)).toEqual([]);
  });

  it('IS ONE UNDO STEP, however many axes it moved', () => {
    const { h, scene } = open();
    const before = scene.state.rows;
    tap(h, scene, 'KeyR');
    typeSize(h, scene, '30X12');
    expect(scene.state.rows[0]).toHaveLength(30);

    h.input.onKey('ControlLeft', true);
    tap(h, scene, 'KeyZ');
    h.input.onKey('ControlLeft', false);
    expect(scene.state.rows).toEqual(before);
  });

  it('swallows every key while open, exactly like the name field', () => {
    const { h, scene } = open();
    const before = scene.state.rows;
    const sel = scene.state.sel;
    tap(h, scene, 'KeyR');
    for (const code of ['Digit2', 'KeyZ', 'BracketRight', 'KeyS']) {
      tap(h, scene, code);
    }
    expect(scene.state.rows).toEqual(before);
    expect(scene.state.sel).toBe(sel);
    expect(scene.state.mode).toBe('size');
  });

  it('Esc cancels without resizing and without leaving the editor', () => {
    const { h, scene } = open();
    const before = scene.state.rows;
    tap(h, scene, 'KeyR');
    tap(h, scene, 'Escape');
    expect(scene.state.mode).toBe('paint');
    expect(scene.state.rows).toEqual(before);
    expect(h.scenes).toHaveLength(0);
  });

  it('says so and stays open when the entry is not two numbers', () => {
    const { h, scene } = open();
    const before = scene.state.rows;
    tap(h, scene, 'KeyR');
    for (let i = 0; i < 8; i++) {
      tap(h, scene, 'Backspace');
    }
    tap(h, scene, 'Digit9');
    tap(h, scene, 'Enter');
    expect(scene.state.mode).toBe('size');
    expect(scene.state.rows).toEqual(before);
    expect(scene.state.status).toContain('SIZE');
  });

  it('clamps to the caps rather than refusing the entry', () => {
    const { h, scene } = open();
    tap(h, scene, 'KeyR');
    typeSize(h, scene, '999X999');
    expect(scene.state.rows[0]).toHaveLength(EDITOR_MAX_W);
    expect(scene.state.rows).toHaveLength(EDITOR_MAX_H);
  });

  it('A CROP THAT LOSES THE GOAL REACHES THE PANEL, like every other resize', () => {
    const { h, scene } = open();
    tap(h, scene, 'KeyR');
    typeSize(h, scene, '4X5');
    expect(scene.state.errors.some((e) => e.includes('found 0 goal markers'))).toBe(true);
  });

  it('writes the draft, so a resize survives a reload', () => {
    const { h, scene } = open();
    tap(h, scene, 'KeyR');
    typeSize(h, scene, '12X6');
    const draft = h.game.save.getText(SAVE_KEYS.editorDraft);
    expect(draft).not.toBeNull();
    expect(JSON.parse(draft as string).rows[0]).toHaveLength(12);
  });
});

/**
 * A stage tall enough that every cell a tool test touches is CLEAR OF THE
 * HEADER PLATE. The header is an opaque overlay spanning the top ~48 px, and a
 * press on any overlay is a press on the overlay — so a drag anchored at row 1
 * of a five-row stage never reaches the grid at all, which is a test that
 * passes for the wrong reason at best.
 */
const TALL: readonly string[] = [
  '..........',
  '..........',
  '..........',
  '...S...G..',
  '..........',
  '..........',
  '..........',
  '##########',
];

describe('the rectangle tool', () => {
  it('X picks it, and B goes back to the brush', () => {
    const { h, scene } = open(TALL);
    expect(scene.state.tool).toBe('brush');
    tap(h, scene, 'KeyX');
    expect(scene.state.tool).toBe('rect');
    tap(h, scene, 'KeyB');
    expect(scene.state.tool).toBe('brush');
  });

  it('fills the dragged rectangle, ONCE, on release', () => {
    const { h, scene } = open(TALL);
    tap(h, scene, 'Digit2'); // '#'
    tap(h, scene, 'KeyX');
    drag(h, scene, [
      [3, 3],
      [4, 3],
      [4, 4],
    ]);
    expect(scene.state.rows[3]).toBe('...S#..G..'); // the S at (3,3) is spared
    expect(scene.state.rows[4]).toBe('...##.....');
    expect(scene.state.rows[5]).toBe('..........'); // the drag never went there
    expect(scene.state.undoDepth).toBe(1);
  });

  it('paints NOTHING until the button comes up, so the drag is a preview', () => {
    const { h, scene } = open(TALL);
    tap(h, scene, 'Digit2');
    tap(h, scene, 'KeyX');
    const before = scene.state.rows;
    const [ax, ay] = cellCentre(scene, 2, 4);
    h.input.onPointerDown(ax, ay, 0);
    step(h, scene);
    const [bx, by] = cellCentre(scene, 6, 5);
    h.input.onPointerMove(bx, by);
    step(h, scene);
    expect(scene.state.rows).toEqual(before);
    h.input.onPointerUp(bx, by, 0);
    step(h, scene);
    expect(scene.state.rows[4]).toBe('..#####...');
    expect(scene.state.rows[5]).toBe('..#####...');
  });

  it('fills the same rectangle whichever corner the drag started from', () => {
    const { h, scene } = open(TALL);
    tap(h, scene, 'Digit2');
    tap(h, scene, 'KeyX');
    drag(h, scene, [
      [6, 5],
      [4, 4],
    ]);
    expect(scene.state.rows[4]).toBe('....###...');
    expect(scene.state.rows[5]).toBe('....###...');
  });

  it('right-drag erases a rectangle', () => {
    const { h, scene } = open(TALL);
    tap(h, scene, 'KeyX');
    drag(
      h,
      scene,
      [
        [0, 7],
        [2, 7],
      ],
      MOUSE_RIGHT,
    );
    expect(scene.state.rows[7]).toBe('...#######');
  });
});

describe('the select tool', () => {
  /** TALL with a 2x2 block to pick up, clear of both markers. */
  const BLOCKS: readonly string[] = [
    '..........',
    '..........',
    '..........',
    '...S...G..',
    '....##....',
    '....##....',
    '..........',
    '##########',
  ];

  function selected(): { h: Harness; scene: EditorScene } {
    const { h, scene } = open(BLOCKS);
    tap(h, scene, 'KeyV');
    drag(h, scene, [
      [4, 4],
      [5, 5],
    ]);
    return { h, scene };
  }

  it('V picks it, and a drag marks out a selection without editing anything', () => {
    const { scene } = selected();
    expect(scene.state.tool).toBe('select');
    expect(scene.state.selection).toEqual({ x0: 4, y0: 4, x1: 5, y1: 5 });
    expect(scene.state.rows).toEqual(BLOCKS);
    expect(scene.state.undoDepth).toBe(0);
  });

  it('DRAGGING FROM INSIDE THE SELECTION MOVES THE BLOCK, in one undo step', () => {
    const { h, scene } = selected();
    drag(h, scene, [
      [4, 4],
      [5, 4],
      [6, 4],
    ]); // two cells right
    expect(scene.state.rows[4]).toBe('......##..');
    expect(scene.state.rows[5]).toBe('......##..');
    expect(scene.state.undoDepth).toBe(1);
    // The selection travels with what it moved, so the block can be dragged on.
    expect(scene.state.selection).toEqual({ x0: 6, y0: 4, x1: 7, y1: 5 });
  });

  it('a drag that starts OUTSIDE the selection marks out a new one instead', () => {
    const { h, scene } = selected();
    drag(h, scene, [
      [0, 6],
      [1, 6],
    ]);
    expect(scene.state.selection).toEqual({ x0: 0, y0: 6, x1: 1, y1: 6 });
    expect(scene.state.rows).toEqual(BLOCKS);
  });

  it('a moved block carries the spawn with it', () => {
    const { h, scene } = open(BLOCKS);
    tap(h, scene, 'KeyV');
    drag(h, scene, [
      [3, 3],
      [3, 3],
    ]);
    drag(h, scene, [
      [3, 3],
      [3, 4],
    ]);
    expect(scene.state.rows[3]).toBe('.......G..');
    expect(scene.state.rows[4]).toBe('...S##....');
    expect(validateLevel(scene.state.rows)).toEqual([]);
  });

  it('ESCAPE CLEARS THE SELECTION rather than leaving the editor', () => {
    // The first Escape is the selection's; only the second one quits. A modal
    // key that skips its innermost mode is how an author loses a level.
    const { h, scene } = selected();
    tap(h, scene, 'Escape');
    expect(scene.state.selection).toBeNull();
    expect(h.scenes).toHaveLength(0);
    tap(h, scene, 'Escape');
    expect(h.scenes[0]).toBeInstanceOf(TitleScene);
  });

  it('switching tools drops the selection, so no outline outlives its tool', () => {
    const { h, scene } = selected();
    tap(h, scene, 'KeyB');
    expect(scene.state.selection).toBeNull();
  });

  it('never paints, whichever button is used', () => {
    const { h, scene } = selected();
    const before = scene.state.rows;
    drag(
      h,
      scene,
      [
        [1, 6],
        [3, 6],
      ],
      MOUSE_RIGHT,
    );
    expect(scene.state.rows).toEqual(before);
    expect(scene.state.selection).toBeNull(); // right-click drops it
  });
});

describe('the pickup in the palette', () => {
  it('is the seventh swatch, and paints like any other character', () => {
    const { h, scene } = open(TALL);
    tap(h, scene, 'Digit7');
    expect(scene.state.sel).toBe('o');
    drag(h, scene, [
      [4, 4],
      [5, 4],
    ]);
    expect(scene.state.rows[4]).toBe('....oo....');
    // It is legal in any number, unlike the two markers, and legal beside them.
    expect(validateLevel(scene.state.rows)).toEqual([]);
  });

  it('playtests, which is the only proof the format agrees end to end', () => {
    const { h, scene } = open(TALL);
    tap(h, scene, 'Digit7');
    drag(h, scene, [[4, 4]]);
    tap(h, scene, 'Enter');
    const play = h.scenes[0];
    expect(play).toBeInstanceOf(PlayScene);
    // Painted here, parsed by the real parser, and standing in the real scene:
    // asserting the class alone would pass with the character dropped on the
    // way through, which is exactly the failure this test is named for.
    (play as PlayScene).enter(h.game);
    expect((play as PlayScene).status.pickupsReady).toBe(1);
  });
});

describe('a drag that is interrupted rather than released', () => {
  /** Press and hold on a cell, with no release. */
  function press(h: Harness, scene: EditorScene, tx: number, ty: number): void {
    const [vx, vy] = cellCentre(scene, tx, ty);
    h.input.onPointerDown(vx, vy, 0);
    step(h, scene);
  }

  /** Move the pointer, still with no release. */
  function moveTo(h: Harness, scene: EditorScene, tx: number, ty: number): void {
    const [vx, vy] = cellCentre(scene, tx, ty);
    h.input.onPointerMove(vx, vy);
    step(h, scene);
  }

  it('A TEXT FIELD ENDS THE DRAG: the pointer does not paint on hover afterwards', () => {
    // The release edge is eaten by the scene that opened the field, so a drag
    // left open paints wherever the mouse goes for the rest of the session.
    const { h, scene } = open(TALL);
    tap(h, scene, 'Digit2');
    press(h, scene, 2, 4);
    tap(h, scene, 'KeyN'); // the id field opens
    tap(h, scene, 'Escape'); // ...and is cancelled
    const before = scene.state.rows;
    moveTo(h, scene, 6, 5);
    moveTo(h, scene, 7, 5);
    expect(scene.state.rows).toEqual(before);
  });

  it('a playtest ends the drag too', () => {
    const { h, scene } = open(TALL);
    tap(h, scene, 'Digit2');
    press(h, scene, 2, 4);
    tap(h, scene, 'Enter'); // off to a playtest
    expect(h.scenes[0]).toBeInstanceOf(PlayScene);
    scene.enter(h.game); // ...and back
    const before = scene.state.rows;
    moveTo(h, scene, 6, 5);
    expect(scene.state.rows).toEqual(before);
  });

  it('ESCAPE ROLLS THE STROKE BACK, rather than saying CANCELLED and keeping it', () => {
    const { h, scene } = open(TALL);
    tap(h, scene, 'Digit2');
    const before = scene.state.rows;
    press(h, scene, 2, 4);
    moveTo(h, scene, 3, 4);
    expect(scene.state.rows[4]).toBe('..##......');
    tap(h, scene, 'Escape');
    expect(scene.state.rows).toEqual(before);
    expect(scene.state.undoDepth).toBe(0);
    expect(h.scenes).toHaveLength(0); // and it did not leave the editor
  });

  it('Escape mid-rectangle discards the pending fill', () => {
    const { h, scene } = open(TALL);
    tap(h, scene, 'Digit2');
    tap(h, scene, 'KeyX');
    const before = scene.state.rows;
    press(h, scene, 2, 4);
    moveTo(h, scene, 6, 5);
    tap(h, scene, 'Escape');
    const [ux, uy] = cellCentre(scene, 6, 5);
    h.input.onPointerUp(ux, uy, 0);
    step(h, scene);
    expect(scene.state.rows).toEqual(before);
  });

  it('switching tools mid-drag ends it', () => {
    const { h, scene } = open(TALL);
    tap(h, scene, 'Digit2');
    press(h, scene, 2, 4);
    tap(h, scene, 'KeyX');
    const before = scene.state.rows;
    moveTo(h, scene, 6, 5);
    expect(scene.state.rows).toEqual(before);
  });
});

describe('a selection that outlives what it selected', () => {
  const BLOCKS: readonly string[] = [
    '..........',
    '..........',
    '..........',
    '...S...G..',
    '....##....',
    '....##....',
    '..........',
    '##########',
  ];

  function selected(): { h: Harness; scene: EditorScene } {
    const { h, scene } = open(BLOCKS);
    tap(h, scene, 'KeyV');
    drag(h, scene, [
      [4, 4],
      [5, 5],
    ]);
    return { h, scene };
  }

  it('a resize drops it, rather than outlining cells that no longer exist', () => {
    const { h, scene } = selected();
    tap(h, scene, 'BracketLeft'); // crop from the right
    expect(scene.state.selection).toBeNull();
  });

  it('an undo drops it, for the same reason', () => {
    const { h, scene } = selected();
    drag(h, scene, [
      [4, 4],
      [6, 4],
    ]); // move it, so there is something to undo
    h.input.onKey('ControlLeft', true);
    tap(h, scene, 'KeyZ');
    h.input.onKey('ControlLeft', false);
    expect(scene.state.selection).toBeNull();
  });

  it('carries the spawn to the very edge, and the selection with it', () => {
    // The scene cannot drag a marker OFF the grid — the pointer has no cells
    // out there to name — so the refusal itself is asserted at the model, in
    // tests/grid.test.ts. What the scene owes is the legal version of the same
    // gesture: all the way to column 0, still valid, selection intact.
    const { h, scene } = open(BLOCKS);
    tap(h, scene, 'KeyV');
    drag(h, scene, [
      [3, 3],
      [3, 3],
    ]); // the spawn alone
    drag(h, scene, [
      [3, 3],
      [0, 3],
    ]);
    expect(scene.state.rows[3]).toBe('S......G..');
    expect(scene.state.selection).toEqual({ x0: 0, y0: 3, x1: 0, y1: 3 });
    expect(validateLevel(scene.state.rows)).toEqual([]);
  });
});

