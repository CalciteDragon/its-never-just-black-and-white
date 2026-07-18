/**
 * Pooled particle system (cosmetic only — never affects game logic).
 * Fixed pool of MAX_PARTICLES; spawns beyond the cap are dropped. Node-safe:
 * render takes an injected 2d context and is never called in tests.
 */

import { Rng } from './rng';
import { PALETTE } from './sprites';

/** Hard cap on simultaneously alive particles. */
export const MAX_PARTICLES = 512;

export interface ParticleOpts {
  x: number;
  y: number;
  count?: number;
  /** Speed range, px/s. */
  speedMin?: number;
  speedMax?: number;
  /** Emission angle range, radians (canvas convention: negative y = up). */
  angleMin?: number;
  angleMax?: number;
  /** Base lifetime, seconds. */
  life?: number;
  /** Random extra lifetime in [0, lifeJitter) seconds. */
  lifeJitter?: number;
  /** Single color or a palette to pick from per particle. */
  color?: string | string[];
  /** Square size, px. */
  size?: number;
  /** Downward acceleration, px/s². Negative = floats upward. */
  gravity?: number;
  /** Velocity damping per second (0 = none, 1 ≈ full stop in 1 s). */
  drag?: number;
}

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
  gravity: number;
  drag: number;
}

export class ParticleSystem {
  private readonly pool: Particle[];
  private alive = 0;
  private readonly fallbackRng = new Rng(0xc0ffee);

  constructor() {
    this.pool = Array.from({ length: MAX_PARTICLES }, () => ({
      alive: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      size: 1,
      color: PALETTE.W,
      gravity: 0,
      drag: 0,
    }));
  }

  get aliveCount(): number {
    return this.alive;
  }

  spawn(opts: ParticleOpts, rng?: Rng): void {
    const r = rng ?? this.fallbackRng;
    const count = opts.count ?? 8;
    const speedMin = opts.speedMin ?? 20;
    const speedMax = opts.speedMax ?? 60;
    const angleMin = opts.angleMin ?? 0;
    const angleMax = opts.angleMax ?? Math.PI * 2;
    const life = opts.life ?? 0.5;
    const lifeJitter = opts.lifeJitter ?? 0.2;
    const color = opts.color ?? PALETTE.W;
    const size = opts.size ?? 1;
    const gravity = opts.gravity ?? 0;
    const drag = opts.drag ?? 0;

    let spawned = 0;
    for (let i = 0; i < this.pool.length && spawned < count; i++) {
      const p = this.pool[i];
      if (p.alive) {
        continue;
      }
      const angle = r.float(angleMin, angleMax);
      const speed = r.float(speedMin, speedMax);
      p.alive = true;
      p.x = opts.x;
      p.y = opts.y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = life + (lifeJitter > 0 ? r.float(0, lifeJitter) : 0);
      p.size = size;
      p.color = Array.isArray(color) ? r.pick(color) : color;
      p.gravity = gravity;
      p.drag = drag;
      spawned++;
      this.alive++;
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) {
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.alive--;
        continue;
      }
      p.vy += p.gravity * dt;
      if (p.drag > 0) {
        const damp = Math.max(0, 1 - p.drag * dt);
        p.vx *= damp;
        p.vy *= damp;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const p of this.pool) {
      if (!p.alive) {
        continue;
      }
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - camX), Math.round(p.y - camY), p.size, p.size);
    }
  }

  clear(): void {
    for (const p of this.pool) {
      p.alive = false;
    }
    this.alive = 0;
  }
}

/** Ground dust: short gray puffs kicked up on jump/land. */
export function burstDust(ps: ParticleSystem, x: number, y: number): void {
  ps.spawn({
    x,
    y,
    count: 6,
    speedMin: 15,
    speedMax: 45,
    angleMin: -Math.PI * 0.85,
    angleMax: -Math.PI * 0.15,
    life: 0.3,
    lifeJitter: 0.15,
    color: [PALETTE.s, PALETTE.t],
    size: 1,
    gravity: 120,
    drag: 3,
  });
}

/** Coin sparkle: quick gold/white glitter in all directions. */
export function burstSparkle(ps: ParticleSystem, x: number, y: number): void {
  ps.spawn({
    x,
    y,
    count: 10,
    speedMin: 25,
    speedMax: 80,
    life: 0.35,
    lifeJitter: 0.25,
    color: [PALETTE.y, PALETTE.W, PALETTE.o],
    size: 1,
    gravity: 40,
    drag: 4,
  });
}

/** Enemy poof: a colored cloud that rapidly slows. */
export function burstPoof(ps: ParticleSystem, x: number, y: number, color: string): void {
  ps.spawn({
    x,
    y,
    count: 12,
    speedMin: 20,
    speedMax: 70,
    life: 0.45,
    lifeJitter: 0.2,
    color,
    size: 2,
    gravity: -20,
    drag: 5,
  });
}

/** Torch ember: a single slow mote drifting upward. */
export function emberDrift(ps: ParticleSystem, x: number, y: number): void {
  ps.spawn({
    x,
    y,
    count: 1,
    speedMin: 4,
    speedMax: 12,
    angleMin: -Math.PI * 0.75,
    angleMax: -Math.PI * 0.25,
    life: 1.1,
    lifeJitter: 0.6,
    color: [PALETTE.O, PALETTE.o, PALETTE.y],
    size: 1,
    gravity: -12,
    drag: 0.5,
  });
}
