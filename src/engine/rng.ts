/**
 * Deterministic randomness. All game logic randomness flows through Rng
 * (mulberry32) so identical seeds produce identical runs — this powers the
 * daily challenge and the generator tests. Node-safe: no browser APIs.
 */

/** Hash an arbitrary string to a uint32 seed (FNV-1a, 32-bit). */
export function hashStringToSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h *= 16777619 (FNV prime), via shifts to stay in uint32 land.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Deterministically mix two uint32 seeds into a new uint32 (avalanche). */
export function mixSeeds(a: number, b: number): number {
  let h = (a >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = (h + (b >>> 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Seeded PRNG (mulberry32 core). Cheap, decent quality, fully deterministic. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Next raw uint32. */
  nextU32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform integer in [min, max], inclusive on both ends. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p (clamped to [0, 1]). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Pick a uniformly random element. Throws on an empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) {
      throw new Error('Rng.pick: empty array');
    }
    return arr[this.int(0, arr.length - 1)];
  }

  /** Fisher-Yates shuffle. Returns a NEW array; the input is untouched. */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }
}

/** UTC calendar date as 'YYYY-MM-DD'. Defaults to now. */
export function dailyDateString(d?: Date): string {
  const date = d ?? new Date();
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The shared world-wide seed for a given UTC day. */
export function dailySeed(d?: Date): number {
  return hashStringToSeed('PIXEL-QUEST-DAILY-' + dailyDateString(d));
}
