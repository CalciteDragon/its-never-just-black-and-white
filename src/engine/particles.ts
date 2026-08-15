/**
 * Pooled particle system (cosmetic only — never affects game logic).
 * Fixed pool of MAX_PARTICLES; spawns beyond the cap are dropped. Node-safe:
 * render takes an injected 2d context and is never called in tests.
 */

import { palette } from './palette';
import { Rng } from './rng';

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
  /** Colour override. Defaults to the accent as it stands at spawn time. */
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
      color: '',
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
    // Sampled per spawn: a spark keeps the colour of the phase that made it.
    const color = opts.color ?? palette.accent;
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

/**
 * Accent dust kicked up on jump and landing. The one emitter phase 2 keeps;
 * phase 6 replaces it with the full set (dust, burst, flip ring, pad streams).
 */
export function burstDust(ps: ParticleSystem, x: number, y: number): void {
  ps.spawn({
    x,
    y,
    count: 6,
    speedMin: 30,
    speedMax: 90,
    angleMin: -Math.PI * 0.85,
    angleMax: -Math.PI * 0.15,
    life: 0.3,
    lifeJitter: 0.15,
    size: 2,
    gravity: 240,
    drag: 3,
  });
}
