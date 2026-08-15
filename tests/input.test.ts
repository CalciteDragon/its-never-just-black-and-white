import { describe, expect, it } from 'vitest';
import { BINDINGS, Input } from '../src/engine/input';
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
