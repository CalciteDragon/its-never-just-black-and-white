import { describe, expect, it } from 'vitest';
import { VIEW_H, VIEW_W } from '../src/constants';
import { BINDINGS, Input, bindingLabel, codeLabel } from '../src/engine/input';
import type { Action } from '../src/engine/input';

describe('Input', () => {
  it('KeyA drives left with a one-frame pressed edge', () => {
    const input = new Input();
    input.onKey('KeyA', true);
    expect(input.down('left')).toBe(true);
    expect(input.pressed('left')).toBe(true);
    input.update();
    expect(input.pressed('left')).toBe(false);
    expect(input.down('left')).toBe(true); // still held
  });

  it('released is a one-frame edge and clears down', () => {
    const input = new Input();
    input.onKey('KeyA', true);
    input.update();
    input.onKey('KeyA', false);
    expect(input.down('left')).toBe(false);
    expect(input.released('left')).toBe(true);
    input.update();
    expect(input.released('left')).toBe(false);
  });

  it('WASD and the arrows drive the same single player', () => {
    const input = new Input();
    input.onKey('ArrowLeft', true);
    expect(input.down('left')).toBe(true);
    input.onKey('ArrowLeft', false);
    input.update();
    input.onKey('KeyD', true);
    expect(input.down('right')).toBe(true);
    input.onKey('ArrowRight', true);
    expect(input.down('right')).toBe(true);
  });

  it('Space is flip and confirm, and is NOT jump', () => {
    const input = new Input();
    input.onKey('Space', true);
    expect(input.down('flip')).toBe(true);
    expect(input.pressed('flip')).toBe(true);
    expect(input.down('confirm')).toBe(true);
    expect(input.down('jump')).toBe(false);
  });

  it('KeyW drives both up and jump; KeyZ is jump only', () => {
    const input = new Input();
    input.onKey('KeyW', true);
    expect(input.down('up')).toBe(true);
    expect(input.down('jump')).toBe(true);
    input.onKey('KeyW', false);
    input.update();
    input.onKey('KeyZ', true);
    expect(input.down('jump')).toBe(true);
    expect(input.down('up')).toBe(false);
  });

  it('multi-key actions stay down until every bound key is released', () => {
    const input = new Input();
    input.onKey('KeyW', true);
    input.onKey('ArrowUp', true);
    input.update();
    input.onKey('ArrowUp', false);
    expect(input.down('jump')).toBe(true); // KeyW still held
    expect(input.released('jump')).toBe(false);
    input.onKey('KeyW', false);
    expect(input.down('jump')).toBe(false);
    expect(input.released('jump')).toBe(true);
  });

  it('holding a second key does not re-fire pressed', () => {
    const input = new Input();
    input.onKey('KeyW', true);
    input.update();
    input.onKey('KeyZ', true); // jump already down via KeyW
    expect(input.pressed('jump')).toBe(false);
    expect(input.down('jump')).toBe(true);
  });

  it('Escape and KeyP both map to pause and back', () => {
    const input = new Input();
    input.onKey('Escape', true);
    expect(input.pressed('pause')).toBe(true);
    expect(input.pressed('back')).toBe(true);
    input.onKey('Escape', false);
    input.update();
    input.onKey('KeyP', true);
    expect(input.down('pause')).toBe(true);
  });

  it('KeyR restarts and KeyM mutes', () => {
    const input = new Input();
    input.onKey('KeyR', true);
    expect(input.pressed('restart')).toBe(true);
    input.onKey('KeyM', true);
    expect(input.pressed('mute')).toBe(true);
  });

  it('ignores unknown codes', () => {
    const input = new Input();
    expect(() => input.onKey('KeyQ', true)).not.toThrow();
    expect(() => input.onKey('F13', false)).not.toThrow();
    expect(input.down('left')).toBe(false);
    expect(input.down('confirm')).toBe(false);
  });

  it('binding table covers every action exactly once', () => {
    const seen = BINDINGS.map((b) => b.action);
    const actions: Action[] = [
      'left',
      'right',
      'up',
      'down',
      'jump',
      'flip',
      'restart',
      'confirm',
      'back',
      'pause',
      'mute',
      'fullscreen',
    ];
    expect(seen.slice().sort()).toEqual(actions.slice().sort());
  });
});

/**
 * The raw code layer (PHASES phase 7, decision 2). The editor needs
 * `Digit1`-`Digit8` for its palette, `ShiftLeft` for flood and letters for the
 * id field, and none of those is a game verb -- so none of them may become an
 * `Action`. The two layers sit beside each other and must not leak.
 */
describe('Input raw codes', () => {
  it('an unbound code is a raw press and NOTHING else', () => {
    const input = new Input();
    input.onKey('Digit1', true);
    expect(input.codePressed('Digit1')).toBe(true);
    expect(input.codeDown('Digit1')).toBe(true);
    // The whole action layer, unmoved.
    for (const b of BINDINGS) {
      expect(input.down(b.action)).toBe(false);
      expect(input.pressed(b.action)).toBe(false);
    }
  });

  it('a bound code is BOTH, and Space is the case that settles it', () => {
    // Space is bound to flip AND confirm, which is why the editor reads the
    // code for its space-drag pan rather than either action.
    const input = new Input();
    input.onKey('Space', true);
    expect(input.codeDown('Space')).toBe(true);
    expect(input.codePressed('Space')).toBe(true);
    expect(input.pressed('flip')).toBe(true);
    expect(input.pressed('confirm')).toBe(true);
  });

  it('code edges clear on the same update() as the key edges', () => {
    const input = new Input();
    input.onKey('KeyA', true);
    input.onKey('Digit3', true);
    expect(input.pressed('left')).toBe(true);
    expect(input.codePressed('Digit3')).toBe(true);
    input.update();
    expect(input.pressed('left')).toBe(false);
    expect(input.codePressed('Digit3')).toBe(false);
    // Held state survives the clear on both layers.
    expect(input.down('left')).toBe(true);
    expect(input.codeDown('Digit3')).toBe(true);
  });

  it('releasing clears codeDown, and a repeat press does not re-fire codePressed', () => {
    const input = new Input();
    input.onKey('ShiftLeft', true);
    input.update();
    input.onKey('ShiftLeft', true); // key repeat reaching the core anyway
    expect(input.codePressed('ShiftLeft')).toBe(false);
    input.onKey('ShiftLeft', false);
    expect(input.codeDown('ShiftLeft')).toBe(false);
  });

  it('pressedCodes lists the raw presses of this step alone, for text entry', () => {
    const input = new Input();
    input.onKey('KeyH', true);
    input.onKey('KeyI', true);
    expect(input.pressedCodes().slice().sort()).toEqual(['KeyH', 'KeyI']);
    input.update();
    expect(input.pressedCodes()).toEqual([]);
  });
});

/**
 * The pointer core. The editor's mouse arrives as `onPointerDown(vx, vy, 0)` in
 * VIEW space -- `attach` has already run the letterbox inverse -- so the core
 * never learns that a scale exists, and the whole editor unit-tests with no
 * canvas anywhere.
 */
describe('Input pointer', () => {
  it('tracks position and reports whether it is in the frame', () => {
    const input = new Input();
    input.onPointerMove(100, 200);
    expect(input.pointerX).toBe(100);
    expect(input.pointerY).toBe(200);
    expect(input.pointerIn).toBe(true);
    input.onPointerMove(-4, 200); // out in the letterbox
    expect(input.pointerIn).toBe(false);
    input.onPointerMove(VIEW_W, 10); // the far edge is exclusive
    expect(input.pointerIn).toBe(false);
    input.onPointerMove(VIEW_W - 1, VIEW_H - 1);
    expect(input.pointerIn).toBe(true);
  });

  it('has down/pressed/released edges per button, cleared by update()', () => {
    const input = new Input();
    input.onPointerDown(10, 10, 0);
    expect(input.pointerDown(0)).toBe(true);
    expect(input.pointerPressed(0)).toBe(true);
    expect(input.pointerDown(2)).toBe(false);
    input.update();
    expect(input.pointerPressed(0)).toBe(false);
    expect(input.pointerDown(0)).toBe(true);
    input.onPointerUp(10, 10, 0);
    expect(input.pointerDown(0)).toBe(false);
    expect(input.pointerReleased(0)).toBe(true);
    input.update();
    expect(input.pointerReleased(0)).toBe(false);
  });

  it('A PRESS IN THE LETTERBOX IS NOT A PRESS', () => {
    // Not a press on the edge tile -- not a press at all. Clamping instead
    // would smear a wall of tiles down the border, which is the visible version
    // of the same bug.
    const input = new Input();
    input.onPointerDown(-30, 200, 0);
    expect(input.pointerIn).toBe(false);
    expect(input.pointerDown(0)).toBe(false);
    expect(input.pointerPressed(0)).toBe(false);
  });

  it('a drag that leaves the frame stays down but stops being in it', () => {
    const input = new Input();
    input.onPointerDown(40, 40, 0);
    input.update();
    input.onPointerMove(-10, 40);
    expect(input.pointerDown(0)).toBe(true); // the button really is still held
    expect(input.pointerIn).toBe(false); // ...but there is nothing under it
    input.onPointerMove(40, 40);
    expect(input.pointerIn).toBe(true);
  });

  it('a release outside the frame still ends the stroke', () => {
    // The alternative is a stroke that never ends, and an editor that paints
    // for the rest of the session.
    const input = new Input();
    input.onPointerDown(40, 40, 0);
    input.update();
    input.onPointerUp(-99, -99, 0);
    expect(input.pointerDown(0)).toBe(false);
    expect(input.pointerReleased(0)).toBe(true);
  });

  it('a release of a button that was never pressed reports nothing', () => {
    const input = new Input();
    input.onPointerUp(10, 10, 2);
    expect(input.pointerReleased(2)).toBe(false);
  });

  it('the three buttons are independent', () => {
    const input = new Input();
    input.onPointerDown(10, 10, 0);
    input.onPointerDown(10, 10, 2);
    expect(input.pointerDown(0)).toBe(true);
    expect(input.pointerDown(2)).toBe(true);
    expect(input.pointerDown(1)).toBe(false);
    input.onPointerUp(10, 10, 0);
    expect(input.pointerDown(0)).toBe(false);
    expect(input.pointerDown(2)).toBe(true);
  });

  it('tracks pointer motion and wheel edges for one consumed step', () => {
    const input = new Input();
    input.onPointerMove(100, 200);
    expect(input.pointerMoved).toBe(true);
    expect(input.controlSource).toBe('pointer');
    input.onWheel(100, 200, 120);
    input.onWheel(100, 200, 40);
    expect(input.wheelSteps).toBe(2);
    input.update();
    expect(input.pointerMoved).toBe(false);
    expect(input.wheelSteps).toBe(0);
  });

  it('uses event order to hand control seamlessly between pointer and keyboard', () => {
    const input = new Input();
    input.onPointerMove(100, 200);
    input.onKey('ArrowDown', true);
    expect(input.controlSource).toBe('keyboard');
    input.onPointerDown(100, 200, 0);
    expect(input.controlSource).toBe('pointer');
  });

  it('ignores wheel events in the letterbox', () => {
    const input = new Input();
    input.onWheel(-1, 200, 100);
    expect(input.wheelSteps).toBe(0);
    expect(input.controlSource).toBe('keyboard');
  });
});

describe('binding labels', () => {
  it('render from BINDINGS, so a rebinding cannot silently lie in the footer', () => {
    expect(codeLabel('KeyM')).toBe('M');
    expect(codeLabel('Digit4')).toBe('4');
    expect(codeLabel('ArrowLeft')).toBe('LEFT');
    expect(codeLabel('Escape')).toBe('ESC');
    expect(codeLabel('Space')).toBe('SPACE');
    expect(bindingLabel('mute')).toBe('M');
    expect(bindingLabel('flip')).toBe('SPACE');
  });

  it('only ever produces characters the 5x7 font actually has', () => {
    for (const b of BINDINGS) {
      expect(bindingLabel(b.action)).toMatch(/^[A-Z0-9]+$/);
      for (const code of b.codes) {
        expect(codeLabel(code)).toMatch(/^[A-Z0-9]+$/);
      }
    }
  });
});
