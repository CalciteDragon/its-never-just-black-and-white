import { describe, expect, it } from 'vitest';
import { MAX_PARTICLES, ParticleSystem } from '../src/engine/particles';

interface RectCall {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Minimal 2d-context stand-in: render only uses fillStyle + fillRect. */
function fakeCtx(calls: RectCall[]): CanvasRenderingContext2D {
  const ctx = {
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number): void {
      calls.push({ x, y, w, h });
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

describe('ParticleSystem pool', () => {
  it('spawn respects the 512 cap', () => {
    const ps = new ParticleSystem();
    ps.spawn({ x: 0, y: 0, count: 600 });
    expect(ps.aliveCount).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(ps.aliveCount).toBe(512);
    ps.spawn({ x: 0, y: 0, count: 50 }); // still full — no overflow, no throw
    expect(ps.aliveCount).toBe(512);
  });

  it('update ages particles and kills them at end of life', () => {
    const ps = new ParticleSystem();
    ps.spawn({ x: 0, y: 0, count: 5, life: 0.2, lifeJitter: 0 });
    expect(ps.aliveCount).toBe(5);
    ps.update(0.1);
    expect(ps.aliveCount).toBe(5);
    ps.update(0.11);
    expect(ps.aliveCount).toBe(0);
  });

  it('freed slots are reusable after death', () => {
    const ps = new ParticleSystem();
    ps.spawn({ x: 0, y: 0, count: 512, life: 0.05, lifeJitter: 0 });
    ps.update(0.1);
    expect(ps.aliveCount).toBe(0);
    ps.spawn({ x: 0, y: 0, count: 100, life: 1, lifeJitter: 0 });
    expect(ps.aliveCount).toBe(100);
  });

  it('clear() empties the system', () => {
    const ps = new ParticleSystem();
    ps.spawn({ x: 0, y: 0, count: 40 });
    expect(ps.aliveCount).toBeGreaterThan(0);
    ps.clear();
    expect(ps.aliveCount).toBe(0);
    const calls: RectCall[] = [];
    ps.render(fakeCtx(calls), 0, 0);
    expect(calls.length).toBe(0);
  });
});

describe('ParticleSystem physics', () => {
  it('gravity accelerates particles downward as configured', () => {
    const ps = new ParticleSystem();
    ps.spawn({
      x: 0,
      y: 0,
      count: 1,
      speedMin: 0,
      speedMax: 0,
      life: 10,
      lifeJitter: 0,
      gravity: 100,
      drag: 0,
    });
    ps.update(0.1); // vy 10 → y 1
    ps.update(0.1); // vy 20 → y 3
    const calls: RectCall[] = [];
    ps.render(fakeCtx(calls), 0, 0);
    expect(calls.length).toBe(1);
    expect(calls[0].x).toBe(0);
    expect(calls[0].y).toBe(3);
  });

  it('drag damps velocity as configured', () => {
    const mkSystem = (drag: number): number => {
      const ps = new ParticleSystem();
      ps.spawn({
        x: 0,
        y: 0,
        count: 1,
        speedMin: 40,
        speedMax: 40,
        angleMin: 0,
        angleMax: 0, // fire straight along +x
        life: 10,
        lifeJitter: 0,
        gravity: 0,
        drag,
      });
      ps.update(0.1);
      ps.update(0.1);
      const calls: RectCall[] = [];
      ps.render(fakeCtx(calls), 0, 0);
      return calls[0].x;
    };
    // drag 5 halves velocity each 0.1s tick: x = 2 then +1 → 3
    expect(mkSystem(5)).toBe(3);
    // no drag: x = 4 then 8
    expect(mkSystem(0)).toBe(8);
  });

  it('render subtracts the camera and snaps to integers', () => {
    const ps = new ParticleSystem();
    ps.spawn({
      x: 100.6,
      y: 50.2,
      count: 1,
      speedMin: 0,
      speedMax: 0,
      life: 10,
      lifeJitter: 0,
      size: 2,
    });
    const calls: RectCall[] = [];
    ps.render(fakeCtx(calls), 40, 10);
    expect(calls[0]).toEqual({ x: 61, y: 40, w: 2, h: 2 });
  });
});
