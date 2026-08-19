import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DUST_COUNT,
  FLIP_RING_COUNT,
  FLIP_RING_LIFE,
  FLIP_RING_SPEED,
  PAD_STREAM_LIFE,
  PAD_STREAM_SPEED,
  PAD_STREAM_SPREAD,
  PARTICLE_SIZE,
  SPARK_LIFE_JITTER,
  SPLASH_LIFE,
  TILE,
} from '../src/constants';
import { INVERT_MASK, palette } from '../src/engine/palette';
import {
  MAX_PARTICLES,
  ParticleSystem,
  spawnBurst,
  spawnDust,
  spawnRing,
  spawnSplash,
  spawnStream,
} from '../src/engine/particles';
import { Rng } from '../src/engine/rng';

interface RectCall {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Recorder {
  /** Every value ever ASSIGNED to fillStyle, in order. */
  styles: string[];
  /** Every value ever ASSIGNED to globalCompositeOperation, in order. */
  ops: string[];
  rects: RectCall[];
  /** The ops and rects interleaved, so ordering is assertable. */
  log: string[];
  ctx: CanvasRenderingContext2D;
}

/**
 * Minimal 2d-context stand-in: render only uses fillStyle,
 * globalCompositeOperation and fillRect.
 *
 * Both style fields are setters rather than plain fields because half of phase
 * 6 decision 6 is the *count* of assignments — one per pass, not one per
 * particle — and a plain field cannot tell one assignment from N identical
 * ones. The composite op has to be counted for the same reason, and ordered
 * against the rects besides: setting it after the sparks would be no effect at
 * all, and restoring it before them would invert nothing.
 */
function recorder(): Recorder {
  const styles: string[] = [];
  const ops: string[] = [];
  const rects: RectCall[] = [];
  const log: string[] = [];
  const ctx = {
    set fillStyle(v: string) {
      styles.push(v);
    },
    get fillStyle(): string {
      return styles[styles.length - 1] ?? '';
    },
    set globalCompositeOperation(v: string) {
      ops.push(v);
      log.push(`op:${v}`);
    },
    get globalCompositeOperation(): string {
      return ops[ops.length - 1] ?? 'source-over';
    },
    fillRect(x: number, y: number, w: number, h: number): void {
      rects.push({ x, y, w, h });
      log.push('rect');
    },
  };
  return { styles, ops, rects, log, ctx: ctx as unknown as CanvasRenderingContext2D };
}

/** N still, long-lived sparks at the origin — the pool's filler. */
function fill(ps: ParticleSystem, count: number, life = 10): void {
  for (let i = 0; i < count; i++) {
    ps.emit(0, 0, 0, 0, life, 1, 0, 0);
  }
}

/** Render is the only readout a particle has; pool order is the slot order. */
function draw(ps: ParticleSystem, camX = 0, camY = 0): RectCall[] {
  const rec = recorder();
  ps.render(rec.ctx, camX, camY);
  return rec.rects;
}

/**
 * An Rng pinned to the middle of every range: the spark lands exactly on the
 * cone axis at mid speed. The gravity-sign tests below read a SIGN off a
 * trajectory, and a sampled cone can put a spark 68° off-axis at 20 px/s, where
 * one frame of gravity already outweighs the throw — that would make the
 * assertion a fact about the seed rather than about the sign.
 */
class MidRng extends Rng {
  constructor() {
    super(1);
  }

  override next(): number {
    return 0.5;
  }
}

/** Per-step displacement of one spark, from a list of per-step renders. */
function steps(frames: RectCall[][], index: number, origin: number): number[] {
  const out: number[] = [];
  let prev = origin;
  for (const f of frames) {
    out.push(f[index].y - prev);
    prev = f[index].y;
  }
  return out;
}

describe('ParticleSystem pool', () => {
  it('respects the 512 cap and drops the newest', () => {
    const ps = new ParticleSystem();
    fill(ps, 600);
    expect(ps.aliveCount).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(ps.aliveCount).toBe(512);
    fill(ps, 50); // still full — no overflow, no throw
    expect(ps.aliveCount).toBe(512);
    // A full lap round the cursor finds nothing: the request is refused, the
    // living are left alone.
    expect(ps.emit(0, 0, 0, 0, 1, 1, 0, 0)).toBe(false);
    expect(ps.aliveCount).toBe(512);
  });

  it('update ages particles and kills them at end of life', () => {
    const ps = new ParticleSystem();
    fill(ps, 5, 0.2);
    expect(ps.aliveCount).toBe(5);
    ps.update(0.1);
    expect(ps.aliveCount).toBe(5);
    ps.update(0.11);
    expect(ps.aliveCount).toBe(0);
  });

  it('freed slots are reusable after death', () => {
    const ps = new ParticleSystem();
    fill(ps, 512, 0.05);
    ps.update(0.1);
    expect(ps.aliveCount).toBe(0);
    fill(ps, 100, 1);
    expect(ps.aliveCount).toBe(100);
  });

  it('clear() empties the system', () => {
    const ps = new ParticleSystem();
    fill(ps, 40);
    expect(ps.aliveCount).toBeGreaterThan(0);
    ps.clear();
    expect(ps.aliveCount).toBe(0);
    expect(draw(ps).length).toBe(0);
  });
});

describe('the spawn cursor', () => {
  it('rotates instead of rescanning from slot 0', () => {
    const ps = new ParticleSystem();
    // Four still sparks; the first dies early. Render walks the pool in slot
    // order, so the sequence of x values is a readout of which slot each took.
    ps.emit(0, 0, 0, 0, 0.05, 1, 0, 0);
    ps.emit(1, 0, 0, 0, 10, 1, 0, 0);
    ps.emit(2, 0, 0, 0, 10, 1, 0, 0);
    ps.emit(3, 0, 0, 0, 10, 1, 0, 0);
    ps.update(0.06); // slot 0 is now the hole
    expect(ps.aliveCount).toBe(3);
    ps.emit(99, 0, 0, 0, 10, 1, 0, 0);
    // A from-zero scan would fall straight into the hole and give [99, 1, 2, 3].
    expect(draw(ps).map((r) => r.x)).toEqual([1, 2, 3, 99]);
  });

  it('wraps and carries on round the ring', () => {
    const ps = new ParticleSystem();
    for (let i = 0; i < MAX_PARTICLES - 1; i++) {
      ps.emit(-1, 0, 0, 0, 0.05, 1, 0, 0);
    }
    ps.update(0.06);
    expect(ps.aliveCount).toBe(0);
    // The cursor is parked on the last slot, so these go 511, 0, 1 — and pool
    // order then puts the FIRST of them last in the render.
    ps.emit(7, 0, 0, 0, 10, 1, 0, 0);
    ps.emit(8, 0, 0, 0, 10, 1, 0, 0);
    ps.emit(9, 0, 0, 0, 10, 1, 0, 0);
    expect(draw(ps).map((r) => r.x)).toEqual([8, 9, 7]);
  });

  it('clear() resets the cursor, so a respawn starts like a fresh system', () => {
    const ps = new ParticleSystem();
    for (let i = 0; i < 3; i++) {
      ps.emit(-1, 0, 0, 0, 10, 1, 0, 0);
    }
    ps.clear();
    for (let i = 0; i < MAX_PARTICLES; i++) {
      ps.emit(i, 0, 0, 0, 10, 1, 0, 0);
    }
    // A retained cursor would have rotated the whole pool by three slots.
    const xs = draw(ps).map((r) => r.x);
    expect(xs[0]).toBe(0);
    expect(xs[MAX_PARTICLES - 1]).toBe(MAX_PARTICLES - 1);
  });
});

describe('ParticleSystem physics', () => {
  it('gravity accelerates particles downward as configured', () => {
    const ps = new ParticleSystem();
    ps.emit(0, 0, 0, 0, 10, 1, 100, 0);
    ps.update(0.1); // vy 10 → y 1
    ps.update(0.1); // vy 20 → y 3
    const rects = draw(ps);
    expect(rects.length).toBe(1);
    expect(rects[0].x).toBe(0);
    expect(rects[0].y).toBe(3);
  });

  it('drag damps velocity as configured', () => {
    const mkSystem = (drag: number): number => {
      const ps = new ParticleSystem();
      ps.emit(0, 0, 40, 0, 10, 1, 0, drag); // straight along +x
      ps.update(0.1);
      ps.update(0.1);
      return draw(ps)[0].x;
    };
    // drag 5 halves velocity each 0.1s tick: x = 2 then +1 → 3
    expect(mkSystem(5)).toBe(3);
    // no drag: x = 4 then 8
    expect(mkSystem(0)).toBe(8);
  });

  it('render subtracts the camera and snaps to integers', () => {
    const ps = new ParticleSystem();
    ps.emit(100.6, 50.2, 0, 0, 10, 2, 0, 0);
    expect(draw(ps, 40, 10)[0]).toEqual({ x: 61, y: 40, w: 2, h: 2 });
  });
});

describe('sparks invert the frame beneath them (decision 6)', () => {
  beforeEach(() => palette.reset());
  afterEach(() => palette.reset());

  it('draws the mask under difference, and hands the context back', () => {
    const ps = new ParticleSystem();
    fill(ps, 3);
    const rec = recorder();
    ps.render(rec.ctx, 0, 0);
    expect(rec.styles).toEqual([INVERT_MASK]);
    // Difference first, sparks, then plain compositing again: the HUD, the
    // post pass and the death fade all draw into this same context afterwards.
    expect(rec.log).toEqual(['op:difference', 'rect', 'rect', 'rect', 'op:source-over']);
  });

  it('carries no palette colour, before or after a flip', () => {
    const ps = new ParticleSystem();
    fill(ps, 30);
    const before = recorder();
    ps.render(before.ctx, 0, 0);
    const outgoing = { paper: palette.paper, ink: palette.ink };
    palette.flip();
    const after = recorder();
    ps.render(after.ctx, 0, 0);

    expect(after.rects.length).toBe(30);
    // Same operand in both phases. A spark's colour is the frame's, so the
    // flip's own ring — emitted before `PlayScene` flips the palette — cannot
    // be caught wearing the outgoing phase.
    expect(after.styles).toEqual(before.styles);
    for (const c of [outgoing.paper, outgoing.ink, palette.paper, palette.ink]) {
      expect(after.styles).not.toContain(c);
    }
  });

  it('assigns fillStyle exactly once for a pass of many particles', () => {
    const ps = new ParticleSystem();
    fill(ps, 200);
    const rec = recorder();
    ps.render(rec.ctx, 0, 0);
    expect(rec.rects.length).toBe(200);
    expect(rec.styles.length).toBe(1);
    // And the composite op twice: on and off, never per spark.
    expect(rec.ops).toEqual(['difference', 'source-over']);
  });
});

describe('emitters are gravity-relative, by sign', () => {
  it('dust with gravitySign −1 is thrown in +y and accelerates in −y', () => {
    const ps = new ParticleSystem();
    spawnDust(ps, 100, 100, -1, new MidRng());
    expect(ps.aliveCount).toBe(DUST_COUNT);

    const frames: RectCall[][] = [];
    for (let i = 0; i < 5; i++) {
      ps.update(0.05);
      frames.push(draw(ps));
    }
    expect(frames[4].length).toBe(DUST_COUNT);
    const dy = steps(frames, 0, 100);
    // Thrown away from the floor it was kicked off, which for an inverted
    // player is +y: a spark launched at −y here would be falling toward the
    // ceiling the player is standing on.
    expect(dy[0]).toBeGreaterThan(0);
    // And pulled back the other way. Each step's displacement is smaller than
    // the last and the motion reverses within the spark's life; an unsigned
    // SPARK_GRAVITY would have it accelerate away instead.
    for (let i = 1; i < dy.length; i++) {
      expect(dy[i]).toBeLessThanOrEqual(dy[i - 1]);
    }
    expect(dy[dy.length - 1]).toBeLessThan(0);
  });

  it('flipping gravity mirrors the dust exactly', () => {
    const down = new ParticleSystem();
    const up = new ParticleSystem();
    spawnDust(down, 100, 100, 1, new MidRng());
    spawnDust(up, 100, 100, -1, new MidRng());
    for (let i = 0; i < 5; i++) {
      down.update(0.05);
      up.update(0.05);
      const a = draw(down);
      const b = draw(up);
      expect(a.length).toBe(b.length);
      for (let j = 0; j < a.length; j++) {
        // Stated as a sum so a spark sitting on the spawn row compares 0 to 0
        // rather than 0 to −0, which Object.is calls a difference.
        expect(a[j].y + b[j].y).toBe(200);
      }
    }
  });

  it('a splash on a ceiling sprays down the contact normal', () => {
    // The solver's normals point surface → body, so a body standing on a
    // ceiling under inverted gravity is handed (0, +1).
    const ps = new ParticleSystem();
    spawnSplash(ps, 100, 100, 0, 1, 6, -1, new MidRng());
    expect(ps.aliveCount).toBe(6);

    const frames: RectCall[][] = [];
    for (let i = 0; i < 7; i++) {
      ps.update(0.05);
      frames.push(draw(ps));
    }
    const dy = steps(frames, 0, 100);
    expect(dy[0]).toBeGreaterThan(0); // sprayed downward, along the normal
    for (let i = 1; i < dy.length; i++) {
      expect(dy[i]).toBeLessThanOrEqual(dy[i - 1]);
    }
    expect(dy[dy.length - 1]).toBeLessThan(0); // and pulled back toward −y
  });

  it('a burst goes where it is aimed', () => {
    const ps = new ParticleSystem();
    spawnBurst(ps, 100, 100, 1, 0, 5, 1, new MidRng());
    expect(ps.aliveCount).toBe(5);
    ps.update(0.05);
    for (const r of draw(ps)) {
      expect(r.x).toBeGreaterThan(100);
      expect(r.w).toBe(PARTICLE_SIZE);
    }
  });
});

describe('the flip ring is a ring', () => {
  const RADIUS = FLIP_RING_SPEED * 0.3;
  // Positions are integer-snapped, so a radius read back off a render carries
  // up to half a pixel of error per axis.
  const SNAP = 0.71;

  it('places count sparks at one radius, evenly spaced', () => {
    const ps = new ParticleSystem();
    spawnRing(ps, 200, 200);
    expect(ps.aliveCount).toBe(FLIP_RING_COUNT);
    ps.update(0.3);

    const rects = draw(ps);
    expect(rects.length).toBe(FLIP_RING_COUNT);
    const angles: number[] = [];
    for (const r of rects) {
      const dx = r.x - 200;
      const dy = r.y - 200;
      expect(Math.abs(Math.hypot(dx, dy) - RADIUS)).toBeLessThan(SNAP);
      angles.push(Math.atan2(dy, dx));
    }
    // Emitted in index order into successive slots, so consecutive renders are
    // consecutive angles. Even spacing is what a sampled ring cannot fake.
    const gap = (Math.PI * 2) / FLIP_RING_COUNT;
    for (let i = 1; i < angles.length; i++) {
      let d = angles[i] - angles[i - 1];
      if (d < 0) {
        d += Math.PI * 2;
      }
      expect(Math.abs(d - gap)).toBeLessThan(2 * (SNAP / RADIUS));
    }
  });

  it('touches no Rng at all', () => {
    const a = new ParticleSystem();
    spawnRing(a, 200, 200);
    a.update(0.3);
    const clean = draw(a);

    const b = new ParticleSystem();
    // Run the shared jitter forward with two emitters that do use it, then
    // clear: if the ring sampled anything, its shape would move with the
    // stream that happened to fire before it.
    spawnDust(b, 0, 0, 1);
    spawnBurst(b, 0, 0, 1, 0, 8, 1);
    spawnStream(b, 0, 0, 0, -1);
    b.clear();
    spawnRing(b, 200, 200);
    b.update(0.3);
    expect(draw(b)).toEqual(clean);
  });

  it('neither sags nor damps — it would stop being a circle', () => {
    const ps = new ParticleSystem();
    spawnRing(ps, 200, 200, 4);
    ps.update(0.15);
    ps.update(0.15);
    // Two half-steps must travel exactly as far as the one above: any drag
    // would shorten the second, any gravity would bias the pair vertically.
    for (const r of draw(ps)) {
      expect(Math.abs(Math.hypot(r.x - 200, r.y - 200) - RADIUS)).toBeLessThan(SNAP);
    }
  });
});

describe('the pad stream', () => {
  const ELAPSED = 0.44; // one step short of PAD_STREAM_LIFE, so it is still alive
  const REACH = PAD_STREAM_SPEED * ELAPSED;
  /** The brief's bound, at the full life — the cone's cross-facing component. */
  const DRIFT = Math.sin(PAD_STREAM_SPREAD) * PAD_STREAM_SPEED * PAD_STREAM_LIFE;

  const run = (dirX: number, dirY: number, seed: number): RectCall => {
    const ps = new ParticleSystem();
    spawnStream(ps, 300, 300, dirX, dirY, new Rng(seed));
    expect(ps.aliveCount).toBe(1);
    for (let i = 0; i < 11; i++) {
      ps.update(ELAPSED / 11);
    }
    const rects = draw(ps);
    expect(rects.length).toBe(1);
    return rects[0];
  };

  it('drifts the pad\'s way without sagging', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const right = run(1, 0, seed);
      expect(right.x - 300).toBeGreaterThan(REACH * Math.cos(PAD_STREAM_SPREAD) - 1);
      expect(right.x - 300).toBeLessThanOrEqual(REACH + 1);
      expect(Math.abs(right.y - 300)).toBeLessThanOrEqual(DRIFT + 1);

      // An up-facing pad is where a sag shows: SPARK_GRAVITY over 0.44 s would
      // eat most of the 39.6 px of reach and point the arrow at the floor.
      const up = run(0, -1, seed);
      expect(300 - up.y).toBeGreaterThan(REACH * Math.cos(PAD_STREAM_SPREAD) - 1);
      expect(300 - up.y).toBeLessThanOrEqual(REACH + 1);
      expect(Math.abs(up.x - 300)).toBeLessThanOrEqual(DRIFT + 1);
    }
  });

  it('carries 40.5 px, 1.27 tiles', () => {
    expect(PAD_STREAM_SPEED * PAD_STREAM_LIFE).toBeCloseTo(40.5, 9);
    expect((PAD_STREAM_SPEED * PAD_STREAM_LIFE) / TILE).toBeCloseTo(1.265625, 9);
    expect((PAD_STREAM_SPEED * PAD_STREAM_LIFE) / TILE).toBeLessThan(2);
  });
});

describe('sampled sparks do not all die on the same frame', () => {
  it('a splash dissipates over a spread of lifetimes, and the ring does not', () => {
    // Twenty sparks vanishing together reads as a pop rather than as a splash
    // dissipating — the case no unit test would notice and every eye would.
    const splash = new ParticleSystem();
    spawnSplash(splash, 0, 0, 0, -1, 20, 1, new Rng(7));
    const deaths: number[] = [];
    let previous = splash.aliveCount;
    for (let i = 0; i < 60; i++) {
      splash.update(SPLASH_LIFE / 30);
      if (splash.aliveCount !== previous) {
        deaths.push(i);
        previous = splash.aliveCount;
      }
    }
    expect(splash.aliveCount).toBe(0);
    // Deaths are spread over many frames, not concentrated on one.
    expect(deaths.length).toBeGreaterThan(5);
    expect(deaths[deaths.length - 1] - deaths[0]).toBeGreaterThan(5);
    // And nothing outlives the jitter bound.
    expect(deaths[deaths.length - 1]).toBeLessThanOrEqual(30 * (1 + SPARK_LIFE_JITTER) + 1);

    // The ring is exempt on purpose: it is a shape, so it leaves as one.
    const ring = new ParticleSystem();
    spawnRing(ring, 0, 0);
    for (let i = 0; i < 100; i++) {
      ring.update(FLIP_RING_LIFE / 50);
      const n = ring.aliveCount;
      expect(n === FLIP_RING_COUNT || n === 0).toBe(true);
    }
    expect(ring.aliveCount).toBe(0);
  });
});
