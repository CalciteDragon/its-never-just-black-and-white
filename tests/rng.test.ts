import { describe, expect, it } from 'vitest';
import {
  dailyDateString,
  dailySeed,
  hashStringToSeed,
  mixSeeds,
  Rng,
} from '../src/engine/rng';

describe('hashStringToSeed', () => {
  it('matches known FNV-1a 32-bit vectors', () => {
    expect(hashStringToSeed('')).toBe(0x811c9dc5);
    expect(hashStringToSeed('a')).toBe(0xe40c292c);
    expect(hashStringToSeed('foobar')).toBe(0xbf9cf968);
  });

  it('is stable and returns uint32', () => {
    const a = hashStringToSeed('PIXEL-QUEST-DAILY-2026-07-16');
    expect(hashStringToSeed('PIXEL-QUEST-DAILY-2026-07-16')).toBe(a);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
  });
});

describe('mixSeeds', () => {
  it('is order-sensitive (not commutative)', () => {
    const pairs: Array<[number, number]> = [
      [1, 2],
      [123, 456],
      [0xdeadbeef, 42],
      [7, 0],
    ];
    for (const [a, b] of pairs) {
      expect(mixSeeds(a, b)).not.toBe(mixSeeds(b, a));
    }
  });

  it('is deterministic and returns uint32', () => {
    const m = mixSeeds(0x12345678, 0x9abcdef0);
    expect(mixSeeds(0x12345678, 0x9abcdef0)).toBe(m);
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(m)).toBe(true);
  });

  it('differs when either input changes', () => {
    expect(mixSeeds(1, 1)).not.toBe(mixSeeds(1, 2));
    expect(mixSeeds(1, 1)).not.toBe(mixSeeds(2, 1));
  });
});

describe('Rng', () => {
  it('same seed produces identical first 50 outputs', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 50; i++) {
      expect(a.nextU32()).toBe(b.nextU32());
    }
  });

  it('different seeds produce different sequences', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    const seqA = Array.from({ length: 10 }, () => a.nextU32());
    const seqB = Array.from({ length: 10 }, () => b.nextU32());
    expect(seqA).not.toEqual(seqB);
  });

  it('next() stays in [0, 1) over 1000 draws', () => {
    const rng = new Rng(999);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(min, max) is inclusive on both ends and never escapes range', () => {
    const rng = new Rng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
      seen.add(v);
    }
    expect(seen.has(3)).toBe(true);
    expect(seen.has(7)).toBe(true);
    expect(seen.size).toBe(5);
  });

  it('float(min, max) stays in range', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 500; i++) {
      const v = rng.float(-2.5, 4.5);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(4.5);
    }
  });

  it('chance respects extremes', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 100; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('pick returns elements of the array and throws on empty', () => {
    const rng = new Rng(77);
    const arr = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
    expect(() => rng.pick([])).toThrow();
  });

  it('shuffle preserves the multiset, returns a new array, deterministic per seed', () => {
    const input = [1, 2, 2, 3, 4, 5, 5, 5, 6, 7];
    const a = new Rng(1234).shuffle(input);
    const b = new Rng(1234).shuffle(input);
    const c = new Rng(4321).shuffle(input);
    expect(a).not.toBe(input);
    expect(input).toEqual([1, 2, 2, 3, 4, 5, 5, 5, 6, 7]); // untouched
    expect([...a].sort((x, y) => x - y)).toEqual(input);
    expect(a).toEqual(b); // deterministic
    expect(c).not.toEqual(a); // different seed, different order (for this fixture)
  });
});

describe('daily seed', () => {
  it('dailyDateString formats UTC with zero padding', () => {
    expect(dailyDateString(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01-05');
    expect(dailyDateString(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe('2026-12-31');
  });

  it('dailySeed is stable for a fixed date and differs across days', () => {
    const d1 = new Date(Date.UTC(2026, 6, 16, 12, 0, 0));
    const d1b = new Date(Date.UTC(2026, 6, 16, 3, 30, 0));
    const d2 = new Date(Date.UTC(2026, 6, 17, 0, 0, 0));
    expect(dailySeed(d1)).toBe(dailySeed(d1b));
    expect(dailySeed(d1)).toBe(hashStringToSeed('PIXEL-QUEST-DAILY-2026-07-16'));
    expect(dailySeed(d1)).not.toBe(dailySeed(d2));
  });
});
