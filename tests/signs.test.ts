import { describe, expect, it } from 'vitest';
import { SIGN_LINE_H, SIGN_TEXT_SCALE, TILE } from '../src/constants';
import { FALLBACK_GLYPH, GLYPH_HEIGHT, glyphFor, measureText } from '../src/engine/font';
import { LEVELS } from '../src/levels/index';
import { signsFor } from '../src/scenes/signs';
import type { Sign } from '../src/scenes/signs';
import { isBlocking } from '../src/world/tiles';
import type { Level } from '../src/world/level';

/**
 * The signs are placed in world pixels by hand, against a grid that lives in
 * another file. That is exactly the pair that drifts: a row inserted into
 * `00-tutorial.json` moves the geometry and leaves the captions where they
 * were. These tests are the tie — they re-derive each caption's box from the
 * font and assert it is still inside the level and still clear of its tiles.
 */

const TUTORIAL = LEVELS.find((l) => l.id === '00-tutorial');
const SELFISH_AND_SELFLESS = LEVELS.find((l) => l.id === '11-selfish-and-selfless');

function tutorial(): Level {
  if (!TUTORIAL) {
    throw new Error('the tutorial is not registered in LEVELS');
  }
  return TUTORIAL;
}

function selfishAndSelfless(): Level {
  if (!SELFISH_AND_SELFLESS) {
    throw new Error('Selfish and Selfless is not registered in LEVELS');
  }
  return SELFISH_AND_SELFLESS;
}

/** A line's box in world pixels, the way `textCentered` lays it out. */
function lineBox(sign: Sign, i: number): { x0: number; y0: number; x1: number; y1: number } {
  const w = measureText(sign.lines[i], SIGN_TEXT_SCALE);
  const y0 = sign.y + i * SIGN_LINE_H;
  return {
    x0: sign.x - w / 2,
    y0,
    x1: sign.x + w / 2,
    y1: y0 + GLYPH_HEIGHT * SIGN_TEXT_SCALE,
  };
}

function boxes(sign: Sign): { x0: number; y0: number; x1: number; y1: number }[] {
  return sign.lines.map((_, i) => lineBox(sign, i));
}

describe('signsFor', () => {
  it('has captions for the two teaching levels and nothing else', () => {
    expect(signsFor('00-tutorial').length).toBe(6);
    expect(signsFor('11-selfish-and-selfless').length).toBe(1);
    for (const level of LEVELS) {
      if (level.id !== '00-tutorial' && level.id !== '11-selfish-and-selfless') {
        expect(signsFor(level.id)).toEqual([]);
      }
    }
  });

  it('returns an empty list for an unknown id rather than null', () => {
    expect(signsFor('a-level-that-does-not-exist')).toEqual([]);
  });
});

describe('the Selfish and Selfless sign', () => {
  it('explains the corner hop directly', () => {
    const said = signsFor('11-selfish-and-selfless')[0].lines.join(' ');
    expect(said).toContain('CORNER HOP');
    expect(said).toContain('HALFWAY OFF THE EDGE');
    expect(said).toContain('TAP W');
    expect(said).toContain('RIGHT BEFORE YOU LAND HOLD RIGHT, AND JUMP ON THE CORNER');
    expect(signsFor('11-selfish-and-selfless')[0].lines.slice(1)).toEqual([
      '1. LINE UP HALFWAY OFF THE EDGE',
      '2. TAP W FOR A SMALL JUMP',
      '3. RIGHT BEFORE YOU LAND HOLD RIGHT, AND JUMP ON THE CORNER',
    ]);
  });

  it('fits above the opening platform without touching solid tiles', () => {
    const level = selfishAndSelfless();
    const sign = signsFor(level.id)[0];
    for (const b of boxes(sign)) {
      expect(b.x0).toBeGreaterThanOrEqual(0);
      expect(b.y0).toBeGreaterThanOrEqual(0);
      expect(b.x1).toBeLessThanOrEqual(level.map.widthPx);
      expect(b.y1).toBeLessThanOrEqual(level.map.heightPx);
      for (let ty = Math.floor(b.y0 / TILE); ty <= Math.floor((b.y1 - 1) / TILE); ty++) {
        for (let tx = Math.floor(b.x0 / TILE); tx <= Math.floor((b.x1 - 1) / TILE); tx++) {
          expect(isBlocking(level.map.get(tx, ty))).toBe(false);
        }
      }
    }
  });

  it('points right at the upper corner of the first platform', () => {
    const sign = signsFor('11-selfish-and-selfless')[0];
    const arrow = sign.arrow;
    if (!arrow) {
      throw new Error('the corner-hop sign has no arrow');
    }
    const cornerX = 10 * TILE;
    const cornerY = 13 * TILE;
    expect(arrow.x1).toBe(arrow.x0);
    expect(arrow.x1).toBe(cornerX);
    expect(arrow.y1).toBeGreaterThan(arrow.y0);
    expect(Math.hypot(cornerX - arrow.x1, cornerY - arrow.y1)).toBeLessThan(TILE);
  });

  it('uses only characters the 5x7 font actually has', () => {
    for (const line of signsFor('11-selfish-and-selfless')[0].lines) {
      for (const ch of line) {
        expect(glyphFor(ch)).not.toBe(FALLBACK_GLYPH);
      }
    }
  });
});

describe('the tutorial signs', () => {
  it('teach the four verbs, the pads and the goal, in play order', () => {
    const said = signsFor('00-tutorial').map((s) => s.lines.join(' '));
    expect(said[0]).toContain('A AND D');
    expect(said[1]).toContain('W TO JUMP');
    expect(said[2]).toContain('SPACE TO FLIP');
    expect(said[3]).toContain('DIAMOND');
    expect(said[4]).toContain('JUMP PAD ALSO RECHARGES FLIP');
    expect(said[5]).toContain('FINISH');
  });

  it('reads left to right: each sign starts after the one before it', () => {
    const xs = signsFor('00-tutorial').map((s) => s.x);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  });

  it('uses only characters the 5x7 font actually has', () => {
    for (const sign of signsFor('00-tutorial')) {
      for (const line of sign.lines) {
        for (const ch of line) {
          expect(glyphFor(ch)).not.toBe(FALLBACK_GLYPH);
        }
      }
    }
  });

  it('fits inside the level on every side', () => {
    const { map } = tutorial();
    for (const sign of signsFor('00-tutorial')) {
      for (const b of boxes(sign)) {
        expect(b.x0).toBeGreaterThanOrEqual(0);
        expect(b.y0).toBeGreaterThanOrEqual(0);
        expect(b.x1).toBeLessThanOrEqual(map.widthPx);
        expect(b.y1).toBeLessThanOrEqual(map.heightPx);
      }
    }
  });

  it('never overlaps a solid tile', () => {
    const { map } = tutorial();
    for (const sign of signsFor('00-tutorial')) {
      for (const b of boxes(sign)) {
        for (let ty = Math.floor(b.y0 / TILE); ty <= Math.floor((b.y1 - 1) / TILE); ty++) {
          for (let tx = Math.floor(b.x0 / TILE); tx <= Math.floor((b.x1 - 1) / TILE); tx++) {
            expect({ tx, ty, solid: isBlocking(map.get(tx, ty)) }).toEqual({
              tx,
              ty,
              solid: false,
            });
          }
        }
      }
    }
  });

  it('points its one arrow at the goal, from the left and level with it', () => {
    const level = tutorial();
    const signs = signsFor('00-tutorial');
    const arrows = signs.filter((s) => s.arrow !== undefined);
    expect(arrows.length).toBe(1);
    const arrow = arrows[0].arrow;
    if (!arrow) {
      throw new Error('unreachable: filtered above');
    }
    const goalX = level.goal.tx * TILE + TILE / 2;
    const goalY = level.goal.ty * TILE + TILE / 2;
    // Tip beyond the tail and short of the goal: it aims at it, not through it.
    expect(arrow.x1).toBeGreaterThan(arrow.x0);
    expect(arrow.x1).toBeLessThan(goalX);
    expect(goalX - arrow.x1).toBeLessThan(2 * TILE);
    expect(Math.abs(arrow.y1 - goalY)).toBeLessThan(TILE);
  });
});
