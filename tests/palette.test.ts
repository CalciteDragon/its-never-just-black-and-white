import { describe, expect, it } from 'vitest';
import { CHANNEL_BLUE, CHANNEL_GREEN, CHANNEL_RED, COMPOSITE_BLACK, Palette, palette } from '../src/engine/palette';

/** Pull the three colour components out of an `rgba(r, g, b, a)` string. */
function rgbOf(s: string): string {
  const m = /^rgba\((\d+), ?(\d+), ?(\d+), ?[\d.]+\)$/.exec(s);
  if (!m) {
    throw new Error(`not an rgba string: ${s}`);
  }
  return `${m[1]},${m[2]},${m[3]}`;
}

function alphaOf(s: string): number {
  const m = /^rgba\(\d+, ?\d+, ?\d+, ?([\d.]+)\)$/.exec(s);
  if (!m) {
    throw new Error(`not an rgba string: ${s}`);
  }
  return Number(m[1]);
}

describe('Palette', () => {
  it('starts in phase A', () => {
    expect(new Palette().phase).toBe(0);
  });

  it('flipping twice is the identity', () => {
    const p = new Palette();
    const a = { paper: p.paper, ink: p.ink };
    p.flip();
    p.flip();
    expect(p.phase).toBe(0);
    expect({ paper: p.paper, ink: p.ink }).toEqual(a);
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

  it('has exactly two tokens — there is no third colour to ask for', () => {
    // The accent retired with the particles that were its only caller: a spark
    // is now the frame beneath it, inverted, so the palette holds no saturated
    // colour at all. Asserted on the instance rather than left implicit,
    // because re-adding one is exactly the drift GAME-DESIGN §2 forbids.
    const p = new Palette();
    expect('accent' in p).toBe(false);
    expect('accentRgba' in p).toBe(false);
    expect(p.paper).not.toBe(p.ink);
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
      for (const c of [p.paper, p.ink]) {
        expect(c).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it('the shared instance is a Palette in phase A', () => {
    expect(palette).toBeInstanceOf(Palette);
    expect(palette.phase).toBe(0);
  });
});

describe('Palette rgba accessors', () => {
  it('alpha varies independently of the colour', () => {
    const p = new Palette();
    expect(rgbOf(p.paperRgba(0))).toBe(rgbOf(p.paperRgba(1)));
    expect(alphaOf(p.paperRgba(0))).toBe(0);
    expect(alphaOf(p.paperRgba(1))).toBe(1);
  });

  it('the flip moves the rgb, exactly as it moves the hex', () => {
    const p = new Palette();
    const before = rgbOf(p.paperRgba(0.5));
    p.flip();
    expect(rgbOf(p.paperRgba(0.5))).not.toBe(before);
    p.flip();
    expect(rgbOf(p.paperRgba(0.5))).toBe(before);
  });

  it('the rgb matches the hex token it is derived from', () => {
    // The vignette's inner stop is transparent paper; if these ever disagreed,
    // the gradient would fade toward a colour that is not the background.
    const p = new Palette();
    for (const phase of [0, 1] as const) {
      p.phase = phase;
      const hex = p.paper;
      const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
      expect(rgbOf(p.paperRgba(1))).toBe(rgb);
    }
  });

  it('never emits a hex literal — a gradient stop is not a fillStyle', () => {
    const p = new Palette();
    for (const phase of [0, 1] as const) {
      p.phase = phase;
      for (const s of [p.paperRgba(0), p.paperRgba(0.37), p.inkRgba(1)]) {
        expect(s).not.toContain('#');
        expect(s).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
      }
    }
  });

  it('clamps alpha rather than emitting an invalid colour', () => {
    const p = new Palette();
    expect(alphaOf(p.paperRgba(-1))).toBe(0);
    expect(alphaOf(p.paperRgba(4))).toBe(1);
    expect(alphaOf(p.inkRgba(Number.NaN))).toBe(0);
  });
});

describe('compositing operands', () => {
  it('the channel masks are pure and mutually exclusive', () => {
    // Multiplying a frame by (1,0,0) yields (r,0,0) — that decomposition is
    // what makes chromatic aberration survive the flip, so these must be pure.
    expect(CHANNEL_RED).toBe('#FF0000');
    expect(CHANNEL_GREEN).toBe('#00FF00');
    expect(CHANNEL_BLUE).toBe('#0000FF');
    expect(new Set([CHANNEL_RED, CHANNEL_GREEN, CHANNEL_BLUE]).size).toBe(3);
  });

  it('the operands are not palette colours and do not move with the phase', () => {
    // They are arguments to `multiply` and `lighter`, not things anyone sees.
    const p = new Palette();
    const before = [CHANNEL_RED, CHANNEL_GREEN, CHANNEL_BLUE, COMPOSITE_BLACK];
    p.flip();
    expect([CHANNEL_RED, CHANNEL_GREEN, CHANNEL_BLUE, COMPOSITE_BLACK]).toEqual(before);
    for (const c of before) {
      expect(c).not.toBe(p.paper);
      expect(c).not.toBe(p.ink);
    }
  });

  it('black is the additive identity the accumulator starts from', () => {
    expect(COMPOSITE_BLACK).toBe('#000000');
  });
});
