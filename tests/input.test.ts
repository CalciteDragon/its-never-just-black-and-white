import { describe, expect, it } from 'vitest';
import { BINDINGS, Input } from '../src/engine/input';

describe('Input', () => {
  it('KeyA drives player 0 left with a one-frame pressed edge', () => {
    const input = new Input();
    input.onKey('KeyA', true);
    expect(input.down(0, 'left')).toBe(true);
    expect(input.pressed(0, 'left')).toBe(true);
    input.update();
    expect(input.pressed(0, 'left')).toBe(false);
    expect(input.down(0, 'left')).toBe(true); // still held
  });

  it('released is a one-frame edge and clears down', () => {
    const input = new Input();
    input.onKey('KeyA', true);
    input.update();
    input.onKey('KeyA', false);
    expect(input.down(0, 'left')).toBe(false);
    expect(input.released(0, 'left')).toBe(true);
    input.update();
    expect(input.released(0, 'left')).toBe(false);
  });

  it('players are independent (ArrowLeft only affects player 1)', () => {
    const input = new Input();
    input.onKey('ArrowLeft', true);
    expect(input.down(1, 'left')).toBe(true);
    expect(input.down(0, 'left')).toBe(false);
    expect(input.anyDown('left')).toBe(true);
  });

  it('Space triggers both player-0 jump and global confirm', () => {
    const input = new Input();
    input.onKey('Space', true);
    expect(input.down(0, 'jump')).toBe(true);
    expect(input.down(1, 'jump')).toBe(false);
    expect(input.anyDown('confirm')).toBe(true);
    expect(input.anyPressed('confirm')).toBe(true);
    expect(input.pressed(0, 'confirm')).toBe(true);
    expect(input.pressed(1, 'confirm')).toBe(true);
  });

  it('KeyW drives both up and jump for player 0; ArrowUp jump for player 1', () => {
    const input = new Input();
    input.onKey('KeyW', true);
    expect(input.down(0, 'up')).toBe(true);
    expect(input.down(0, 'jump')).toBe(true);
    input.onKey('ArrowUp', true);
    expect(input.down(1, 'jump')).toBe(true);
    expect(input.down(1, 'up')).toBe(true);
  });

  it('multi-key actions stay down until every bound key is released', () => {
    const input = new Input();
    input.onKey('KeyW', true);
    input.onKey('Space', true);
    input.update();
    input.onKey('Space', false);
    expect(input.down(0, 'jump')).toBe(true); // KeyW still held
    expect(input.released(0, 'jump')).toBe(false);
    input.onKey('KeyW', false);
    expect(input.down(0, 'jump')).toBe(false);
    expect(input.released(0, 'jump')).toBe(true);
  });

  it('holding a second key does not re-fire pressed', () => {
    const input = new Input();
    input.onKey('KeyW', true);
    input.update();
    input.onKey('Space', true); // jump already down via KeyW
    expect(input.pressed(0, 'jump')).toBe(false);
    expect(input.down(0, 'jump')).toBe(true);
  });

  it('Escape and KeyP both map to pause/back for either player', () => {
    const input = new Input();
    input.onKey('Escape', true);
    expect(input.anyPressed('pause')).toBe(true);
    expect(input.anyPressed('back')).toBe(true);
    input.onKey('Escape', false);
    input.update();
    input.onKey('KeyP', true);
    expect(input.anyDown('pause')).toBe(true);
  });

  it('ignores unknown codes', () => {
    const input = new Input();
    expect(() => input.onKey('KeyZ', true)).not.toThrow();
    expect(() => input.onKey('F13', false)).not.toThrow();
    expect(input.anyDown('left')).toBe(false);
    expect(input.anyDown('confirm')).toBe(false);
  });

  it('binding table covers every action for both players or globally', () => {
    const actions = new Set(BINDINGS.map((b) => b.action));
    for (const action of [
      'left',
      'right',
      'up',
      'down',
      'jump',
      'confirm',
      'back',
      'pause',
      'mute',
      'fullscreen',
    ] as const) {
      expect(actions.has(action)).toBe(true);
    }
  });
});
