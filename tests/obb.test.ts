/**
 * The largest test file in the repo, deliberately. `obb.ts` is pure, cheap to
 * test exhaustively, and the only layer where a wrong sign produces plausible-
 * looking motion instead of a crash — so every number here is hand-computed
 * against a tile at (48, 48) spanning [32, 64]², not against the implementation.
 *
 * THE CONVENTION UNDER TEST: normals point from the TILE toward the BOX.
 */

import { describe, expect, it } from 'vitest';
import { CONTACT_TOL, PLAYER_SIZE, TILE } from '../src/constants';
import {
  contactCandidates,
  deepestVertex,
  projectRadius,
  satOverlap,
  tileRadius,
  vertices,
} from '../src/world/obb';
import type { Aabb, Obb, Point, SatResult } from '../src/world/obb';

/** The one tile every case in this file is measured against: [32,64] × [32,64]. */
const TILE_11: Aabb = { cx: 48, cy: 48, half: TILE / 2 };

function box(x: number, y: number, angle = 0, size = PLAYER_SIZE): Obb {
  return { x, y, angle, size };
}

function emptySat(): SatResult {
  return { nx: 0, ny: 0, depth: 0, tileAxis: true };
}

/** Candidate (x, y, pen) triples as tuples, for readable expectations. */
function candidates(
  b: Obb,
  nx: number,
  ny: number,
  tileAxis: boolean,
): [number, number, number][] {
  const out: number[] = [];
  const n = contactCandidates(b, TILE_11, nx, ny, tileAxis, out);
  const list: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    list.push([out[i * 3], out[i * 3 + 1], out[i * 3 + 2]]);
  }
  return list;
}

/** Only the candidates that would survive the solver's CONTACT_TOL tie filter. */
function tied(list: [number, number, number][]): [number, number, number][] {
  const deepest = Math.max(...list.map((c) => c[2]));
  return list.filter((c) => c[2] >= deepest - CONTACT_TOL);
}

describe('vertices', () => {
  it('gives the four corners of an axis-aligned square', () => {
    const v = vertices(box(48, 26));
    expect(v).toEqual([38, 16, 58, 16, 58, 36, 38, 36]);
  });

  it('rotating 90° permutes the same four corners', () => {
    const v = vertices(box(0, 0, Math.PI / 2));
    const pts = [
      [v[0], v[1]],
      [v[2], v[3]],
      [v[4], v[5]],
      [v[6], v[7]],
    ].map(([x, y]) => [Math.round(x), Math.round(y)]);
    expect(pts.sort()).toEqual(
      [
        [-10, -10],
        [-10, 10],
        [10, -10],
        [10, 10],
      ].sort(),
    );
  });

  it('every corner sits s/√2 from the centre at any angle', () => {
    for (const angle of [0, 0.3, Math.PI / 4, 1.9, -2.7]) {
      const v = vertices(box(100, 200, angle));
      for (let i = 0; i < 8; i += 2) {
        expect(Math.hypot(v[i] - 100, v[i + 1] - 200)).toBeCloseTo(
          (PLAYER_SIZE * Math.SQRT2) / 2,
          10,
        );
      }
    }
  });
});

describe('projection radius', () => {
  it('is s/2 at 0° and s/√2 at 45° — the whole one-tile-corridor story', () => {
    expect(projectRadius(box(0, 0, 0), 1, 0)).toBeCloseTo(PLAYER_SIZE / 2, 12);
    expect(projectRadius(box(0, 0, 0), 0, 1)).toBeCloseTo(PLAYER_SIZE / 2, 12);
    expect(projectRadius(box(0, 0, Math.PI / 4), 1, 0)).toBeCloseTo(
      PLAYER_SIZE / Math.SQRT2,
      12,
    );
    // 28.28 px across a 32 px gap: it fits at every angle, and only just.
    expect(projectRadius(box(0, 0, Math.PI / 4), 1, 0) * 2).toBeLessThan(TILE);
  });

  it('matches explicit vertex projection at 30°, not just itself', () => {
    const b = box(0, 0, Math.PI / 6);
    for (const [ax, ay] of [
      [1, 0],
      [0, 1],
      [Math.SQRT1_2, Math.SQRT1_2],
      [-0.6, 0.8],
    ]) {
      const v = vertices(b);
      let explicit = 0;
      for (let i = 0; i < 8; i += 2) {
        explicit = Math.max(explicit, Math.abs(v[i] * ax + v[i + 1] * ay));
      }
      expect(projectRadius(b, ax, ay)).toBeCloseTo(explicit, 10);
    }
  });

  it('tileRadius is half at the axes and half·√2 on the diagonal', () => {
    expect(tileRadius(TILE_11, 1, 0)).toBe(16);
    expect(tileRadius(TILE_11, 0, 1)).toBe(16);
    expect(tileRadius(TILE_11, Math.SQRT1_2, Math.SQRT1_2)).toBeCloseTo(16 * Math.SQRT2, 10);
  });
});

describe('satOverlap — normal direction, stated four ways', () => {
  // Half the value of this whole file is in these four cases. Each box overlaps
  // the tile by exactly 4 px from one side; the normal is the push-out.
  const cases: [string, Obb, number, number][] = [
    ['from above', box(48, 26), 0, -1],
    ['from below', box(48, 70), 0, 1],
    ['from the left', box(26, 48), -1, 0],
    ['from the right', box(70, 48), 1, 0],
  ];

  for (const [name, b, nx, ny] of cases) {
    it(`a box overlapping ${name} pushes out along (${nx}, ${ny}) by 4 px`, () => {
      const out = emptySat();
      expect(satOverlap(b, TILE_11, out)).toBe(true);
      expect(out.nx).toBe(nx);
      expect(out.ny).toBe(ny);
      expect(out.depth).toBeCloseTo(4, 12);
      expect(out.tileAxis).toBe(true);
    });
  }

  it('reports no overlap when the box merely touches, and when it is clear', () => {
    const out = emptySat();
    // Bottom edge exactly on the tile's top edge: zero overlap is not a hit.
    expect(satOverlap(box(48, 22), TILE_11, out)).toBe(false);
    expect(satOverlap(box(48, -100), TILE_11, out)).toBe(false);
    expect(satOverlap(box(200, 48), TILE_11, out)).toBe(false);
  });

  it('a 45° box clears a corner it would overlap at 0°', () => {
    const out = emptySat();
    // Centre 8 px diagonally clear of the tile's corner. At 0° the box's own
    // corner reaches 2 px in; rotated 45° it presents a flat face to the
    // diagonal and separates. Rotation genuinely changes what fits.
    expect(satOverlap(box(24, 24, 0), TILE_11, out)).toBe(true);
    expect(out.depth).toBeCloseTo(2, 12);
    expect(satOverlap(box(24, 24, Math.PI / 4), TILE_11, out)).toBe(false);
  });
});

describe('satOverlap — axis selection', () => {
  it('a flush face contact resolves on a tile axis, never a box axis', () => {
    const out = emptySat();
    satOverlap(box(48, 26), TILE_11, out);
    expect(out.tileAxis).toBe(true);
    // The box's own w axis ties this contact at exactly 4 px. Keeping an axis
    // only on STRICT improvement is what sends the tie to the tile.
    expect(projectRadius(box(48, 26), 0, 1) + tileRadius(TILE_11, 0, 1) - 22).toBeCloseTo(
      out.depth,
      12,
    );
  });

  it('a 45° box on a tile corner resolves on a box axis, 10 px deep', () => {
    const out = emptySat();
    // Centre exactly on the tile's top-left corner: the corner pokes s/2 into
    // the box's face, and no tile axis separates as cheaply.
    expect(satOverlap(box(32, 32, Math.PI / 4), TILE_11, out)).toBe(true);
    expect(out.tileAxis).toBe(false);
    expect(out.depth).toBeCloseTo(PLAYER_SIZE / 2, 10);
    expect(out.nx).toBeCloseTo(-Math.SQRT1_2, 10);
    expect(out.ny).toBeCloseTo(-Math.SQRT1_2, 10);
  });
});

describe('deepestVertex', () => {
  it('minimises v · n, since n points tile → box', () => {
    const out: Point = { x: 0, y: 0 };
    deepestVertex(box(48, 26), 0, -1, out);
    // Deepest into a floor means the LARGEST y, because n = (0, −1).
    expect(out.y).toBe(36);
    deepestVertex(box(48, 70), 0, 1, out);
    expect(out.y).toBe(60);
    deepestVertex(box(26, 48), -1, 0, out);
    expect(out.x).toBe(36);
  });

  it('picks a single corner once the box is tilted', () => {
    const out: Point = { x: 0, y: 0 };
    deepestVertex(box(48, 26, Math.PI / 4), 0, -1, out);
    expect(out.x).toBeCloseTo(48, 10);
    expect(out.y).toBeCloseTo(26 + PLAYER_SIZE / Math.SQRT2, 10);
  });
});

describe('contactCandidates — clipping to the incident face', () => {
  it('a flush box centred over one tile ties both bottom corners at the face centre', () => {
    const b = box(48, 26);
    const t = tied(candidates(b, 0, -1, true));
    expect(t.length).toBe(2);
    expect(t.map((c) => c[0]).sort((p, q) => p - q)).toEqual([38, 58]);
    expect(t.every((c) => c[1] === 36)).toBe(true);
    expect(t.every((c) => Math.abs(c[2] - 4) < 1e-12)).toBe(true);
    // The centroid is the face centre, so r × n is EXACTLY zero and a flat
    // landing produces no torque at all. This is decision 2 in one assertion.
    const cx = (t[0][0] + t[1][0]) / 2;
    const cy = (t[0][1] + t[1][1]) / 2;
    const rx = cx - b.x;
    const ry = cy - b.y;
    expect(Math.abs(rx * -1 - ry * 0)).toBe(0);
  });

  it('overhanging a ledge leaves only the corner still over the tile', () => {
    // Centre 18 px past the tile's left-of-centre line: the right-hand bottom
    // vertex (at x = 76) is off the tile and clips away.
    const b = box(66, 26);
    const t = tied(candidates(b, 0, -1, true));
    expect(t.length).toBe(1);
    expect(t[0][0]).toBe(56);
    expect(t[0][1]).toBe(36);
    // r = (−10, +10), n = (0, −1) ⇒ r × n = +10: ω goes POSITIVE, which is
    // clockwise on screen, right side down — the box tips off to the right.
    const rx = t[0][0] - b.x;
    const ry = t[0][1] - b.y;
    expect(rx * -1 - ry * 0).toBe(10);
  });

  it('a 20° tilt gives a single vertex — corner physics untouched', () => {
    const t = tied(candidates(box(48, 26, (20 * Math.PI) / 180), 0, -1, true));
    expect(t.length).toBe(1);
  });

  it('the tie band is ±0.72°, and 1° is outside it', () => {
    // Depth difference between the two bottom corners is s·sin θ, so the band
    // where they still count as tied is asin(CONTACT_TOL / PLAYER_SIZE).
    const band = Math.asin(CONTACT_TOL / PLAYER_SIZE);
    expect((band * 180) / Math.PI).toBeCloseTo(0.716, 3);
    expect(tied(candidates(box(48, 26, band * 0.9), 0, -1, true)).length).toBe(2);
    expect(tied(candidates(box(48, 26, (1 * Math.PI) / 180), 0, -1, true)).length).toBe(1);
  });

  it('a box-axis contact clips tile corners to the box face', () => {
    const b = box(32, 32, Math.PI / 4);
    const n = -Math.SQRT1_2;
    const t = tied(candidates(b, n, n, false));
    expect(t.length).toBe(1);
    // The tile's top-left corner, poking s/2 into the box's face.
    expect(t[0][0]).toBeCloseTo(32, 10);
    expect(t[0][1]).toBeCloseTo(32, 10);
    expect(t[0][2]).toBeCloseTo(PLAYER_SIZE / 2, 10);
  });

  it('candidates carry a real penetration, so they compare across tiles', () => {
    // Two floor tiles in the same row share a surface plane, so a box straddling
    // them pools two equal-depth corners and still finds its face centre.
    const left: Aabb = { cx: 48, cy: 48, half: TILE / 2 };
    const right: Aabb = { cx: 80, cy: 48, half: TILE / 2 };
    const b = box(64, 26);
    const outL: number[] = [];
    const outR: number[] = [];
    const nl = contactCandidates(b, left, 0, -1, true, outL);
    const nr = contactCandidates(b, right, 0, -1, true, outR);
    const pool: [number, number, number][] = [];
    for (let i = 0; i < nl; i++) {
      pool.push([outL[i * 3], outL[i * 3 + 1], outL[i * 3 + 2]]);
    }
    for (let i = 0; i < nr; i++) {
      pool.push([outR[i * 3], outR[i * 3 + 1], outR[i * 3 + 2]]);
    }
    const t = tied(pool);
    expect(t.length).toBe(2);
    expect((t[0][0] + t[1][0]) / 2).toBe(64);
  });
});
