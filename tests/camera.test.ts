import { describe, expect, it } from 'vitest';
import { STEP, VIEW_H, VIEW_W } from '../src/constants';
import { Camera } from '../src/world/camera';

describe('Camera', () => {
  it('snapTo centers the view on the target', () => {
    const c = new Camera();
    c.snapTo(500, 300);
    expect(c.x).toBe(500 - VIEW_W / 2);
    expect(c.y).toBe(300 - VIEW_H / 2);
  });

  it('follow converges toward the target', () => {
    const c = new Camera();
    c.snapTo(0, 0);
    for (let i = 0; i < 120; i++) {
      c.follow(800, 400, STEP);
    }
    expect(Math.abs(c.x - (800 - VIEW_W / 2))).toBeLessThan(1);
    expect(Math.abs(c.y - (400 - VIEW_H / 2))).toBeLessThan(1);
  });

  it('clampTo keeps the view inside the map', () => {
    const c = new Camera();
    c.snapTo(-100, -100);
    c.clampTo(2000, 600);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    c.snapTo(5000, 5000);
    c.clampTo(2000, 600);
    expect(c.x).toBe(2000 - VIEW_W);
    expect(c.y).toBe(600 - VIEW_H);
  });

  it('clampTo pins to origin when the map is smaller than the view', () => {
    const c = new Camera();
    c.snapTo(9999, 9999);
    c.clampTo(VIEW_W - 100, VIEW_H - 50);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
  });

  it('shake jitters the view then decays to exactly zero', () => {
    const c = new Camera();
    c.snapTo(500, 300);
    const baseX = c.viewX;
    c.shake(4, 0.2);
    let sawJitter = false;
    for (let i = 0; i < 30; i++) {
      c.update(STEP);
      if (Math.abs(c.viewX - baseX) > 0.01) {
        sawJitter = true;
      }
    }
    expect(sawJitter).toBe(true);
    expect(c.viewX).toBe(c.x);
    expect(c.viewY).toBe(c.y);
  });
});
