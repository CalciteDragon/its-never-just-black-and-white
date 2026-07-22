import { describe, expect, it } from 'vitest';
import { AudioSys } from '../src/engine/audio';

describe('AudioSys (node no-op path)', () => {
  it('imports and plays safely without a browser', () => {
    const a = new AudioSys();
    expect(() => a.play('jump')).not.toThrow();
    expect(() => a.play('victory')).not.toThrow();
  });

  it('mute flag is a plain toggle', () => {
    const a = new AudioSys();
    expect(a.muted).toBe(false);
    a.muted = true;
    expect(() => a.play('coin')).not.toThrow();
    expect(a.muted).toBe(true);
  });
});
