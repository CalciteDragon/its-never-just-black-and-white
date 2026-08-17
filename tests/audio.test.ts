import { describe, expect, it } from 'vitest';
import { AudioSys } from '../src/engine/audio';
import type { SfxName } from '../src/engine/audio';

/**
 * GAME-DESIGN §9's set, in full. Listed here rather than derived from the union
 * so that adding or losing an effect is a visible edit to a test, not a silent
 * one — this is the name set phase 6 rewrites the synthesis behind.
 */
const ALL: readonly SfxName[] = [
  'step',
  'jump',
  'land',
  'flip',
  'pad',
  'goal',
  'death',
  'menuMove',
  'menuPick',
];

describe('AudioSys (node no-op path)', () => {
  it('imports and plays every effect safely without a browser', () => {
    const a = new AudioSys();
    for (const name of ALL) {
      expect(() => a.play(name)).not.toThrow();
    }
  });

  it('mute flag is a plain toggle', () => {
    const a = new AudioSys();
    expect(a.muted).toBe(false);
    a.muted = true;
    expect(() => a.play('flip')).not.toThrow();
    expect(a.muted).toBe(true);
  });
});
