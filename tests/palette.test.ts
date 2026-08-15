import { describe, expect, it } from 'vitest';
import { Palette, palette } from '../src/engine/palette';

describe('Palette', () => {
  it('starts in phase A', () => {
    expect(new Palette().phase).toBe(0);
  });

  it('flipping twice is the identity', () => {
    const p = new Palette();
    const a = { paper: p.paper, ink: p.ink, accent: p.accent };
    p.flip();
    p.flip();
    expect(p.phase).toBe(0);
    expect({ paper: p.paper, ink: p.ink, accent: p.accent }).toEqual(a);
  });

  it('the flip swaps paper and ink rather than recolouring them', () => {
    const p = new Palette();
    const paperA = p.paper;
    const inkA = p.ink;
    p.flip();
    expect(p.paper).toBe(inkA);
    expect(p.ink).toBe(paperA);
  });

  it('paper and ink are never equal, in either phase', () => {
    const p = new Palette();
    expect(p.paper).not.toBe(p.ink);
    p.flip();
    expect(p.paper).not.toBe(p.ink);
  });

  it('the accent is distinct from both tokens and changes with the phase', () => {
    const p = new Palette();
    const accentA = p.accent;
    expect(accentA).not.toBe(p.paper);
    expect(accentA).not.toBe(p.ink);
    p.flip();
    expect(p.accent).not.toBe(accentA);
    expect(p.accent).not.toBe(p.paper);
    expect(p.accent).not.toBe(p.ink);
  });

  it('reset returns to phase A from either phase', () => {
    const p = new Palette();
    p.reset();
    expect(p.phase).toBe(0);
    p.flip();
    p.reset();
    expect(p.phase).toBe(0);
  });

  it('every token is a 6-digit hex literal', () => {
    const p = new Palette();
    for (const phase of [0, 1] as const) {
      p.phase = phase;
      for (const c of [p.paper, p.ink, p.accent]) {
        expect(c).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it('the shared instance is a Palette in phase A', () => {
    expect(palette).toBeInstanceOf(Palette);
    expect(palette.phase).toBe(0);
  });
});
