import { describe, expect, it } from 'vitest';
import {
  FALLBACK_GLYPH,
  GLYPH_HEIGHT,
  GLYPHS,
  glyphFor,
  measureText,
} from '../src/engine/font';

describe('glyph data', () => {
  it('every glyph is 7 rows of consistent width 1..5 using only # and .', () => {
    const all: Array<[string, readonly string[]]> = [
      ...Object.entries(GLYPHS),
      ['<fallback>', FALLBACK_GLYPH],
    ];
    for (const [ch, rows] of all) {
      expect(rows.length, `glyph ${JSON.stringify(ch)} row count`).toBe(GLYPH_HEIGHT);
      const w = rows[0].length;
      expect(w, `glyph ${JSON.stringify(ch)} width`).toBeGreaterThanOrEqual(1);
      expect(w, `glyph ${JSON.stringify(ch)} width`).toBeLessThanOrEqual(5);
      for (const row of rows) {
        expect(row.length, `glyph ${JSON.stringify(ch)} ragged row`).toBe(w);
        expect(row, `glyph ${JSON.stringify(ch)} bad char`).toMatch(/^[#.]*$/);
      }
    }
  });

  it('covers A-Z, 0-9, space and required punctuation', () => {
    const required =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?\'"()[]+-*/=<>%#_♥·×';
    for (const ch of required) {
      expect(GLYPHS[ch], `missing glyph ${JSON.stringify(ch)}`).toBeDefined();
    }
  });

  it('maps lowercase to uppercase and unknown chars to the fallback box', () => {
    expect(glyphFor('a')).toBe(GLYPHS.A);
    expect(glyphFor('z')).toBe(GLYPHS.Z);
    expect(glyphFor('@')).toBe(FALLBACK_GLYPH);
    expect(glyphFor('~')).toBe(FALLBACK_GLYPH);
  });
});

describe('measureText', () => {
  it('AB = widthA + 1 + widthB', () => {
    const wA = GLYPHS.A[0].length;
    const wB = GLYPHS.B[0].length;
    expect(measureText('AB')).toBe(wA + 1 + wB);
  });

  it('single glyph has no trailing spacing; empty string is 0', () => {
    expect(measureText('A')).toBe(GLYPHS.A[0].length);
    expect(measureText('')).toBe(0);
  });

  it('scale multiplies the whole measurement', () => {
    expect(measureText('AB', 3)).toBe(measureText('AB') * 3);
    expect(measureText('HELLO WORLD', 2)).toBe(measureText('HELLO WORLD') * 2);
  });

  it('lowercase measures the same as uppercase', () => {
    expect(measureText('pixel quest')).toBe(measureText('PIXEL QUEST'));
  });

  it('narrow glyphs use their natural width', () => {
    expect(measureText('!')).toBe(GLYPHS['!'][0].length);
    expect(measureText('I')).toBe(GLYPHS.I[0].length);
    expect(GLYPHS['!'][0].length).toBeLessThan(5);
  });
});
