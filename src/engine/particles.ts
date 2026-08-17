/**
 * Pooled particle system (cosmetic only — never affects game logic).
 * Fixed pool of MAX_PARTICLES; spawns beyond the cap are dropped. Node-safe:
 * `render` takes an injected 2d context, so the tests drive it through a fake.
 *
 * There is exactly ONE spawn primitive, `emit`, taking an exact velocity, and
 * five named emitters over it. The old options-bag `spawn` went the same way
 * `ParticleOpts.color` did and for the same reason: once the emitter set landed
 * it had no caller left in `src/`, and an API kept alive only by its own tests
 * is the placeholder the phase 3/4 rule exists to forbid.
 *
 * Every emitter here is expressed relative to gravity or to a contact normal,
 * never to −y. This game has no fixed "down" — half of it is played upside
 * down — so an emitter that hard-codes one is wrong in exactly half the frames.
 */

import {
  BURST_LIFE,
  BURST_SPEED_MAX,
  BURST_SPEED_MIN,
  DUST_COUNT,
  DUST_LIFE,
  DUST_SPEED_MAX,
  DUST_SPEED_MIN,
  FLIP_RING_COUNT,
  FLIP_RING_LIFE,
  FLIP_RING_SPEED,
  PAD_STREAM_LIFE,
  PAD_STREAM_SPEED,
  PAD_STREAM_SPREAD,
  PARTICLE_SIZE,
  SPARK_DRAG,
  SPARK_GRAVITY,
  SPARK_LIFE_JITTER,
  SPARK_SPREAD,
  SPLASH_LIFE,
  SPLASH_SPEED_MAX,
  SPLASH_SPEED_MIN,
} from '../constants';
import { palette } from './palette';
import { Rng } from './rng';

/** Hard cap on simultaneously alive particles. */
export const MAX_PARTICLES = 512;

/**
 * Jitter for callers that do not carry an Rng of their own. Module-scoped
 * rather than per-system so the free emitters can reach it too. It is seeded
 * and never `Math.random` (hard rule 3) so that visual variation can never
 * perturb the simulation — but nothing that has to be reproducible should rely
 * on its sequence: pass an Rng instead.
 */
const jitterRng = new Rng(0xc0ffee);

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  gravity: number;
  drag: number;
}

export class ParticleSystem {
  private readonly pool: Particle[];
  private alive = 0;
  /** Where the next free-slot scan starts. See `claim`. */
  private cursor = 0;

  constructor() {
    this.pool = Array.from({ length: MAX_PARTICLES }, () => ({
      alive: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      size: 1,
      gravity: 0,
      drag: 0,
    }));
  }

  get aliveCount(): number {
    return this.alive;
  }

  /**
   * Claim one free slot, or null if a full lap round the pool found none.
   *
   * The scan starts at a persistent cursor rather than at zero. A from-zero
   * scan is O(MAX_PARTICLES) per spawn once the low slots are permanently
   * busy, which is the steady state with eight pads streaming a spark every
   * PAD_STREAM_INTERVAL; from a rotating cursor it is amortised O(1), because
   * the slot a spark vacates is the one the cursor is about to reach again.
   *
   * Overflow stays drop-newest: a full lap returns null and the caller stops.
   * Evicting a live spark to make room would look worse than emitting fewer,
   * and at a predicted peak of ~120 of 512 the case should not arise at all.
   */
  private claim(): Particle | null {
    for (let n = 0; n < MAX_PARTICLES; n++) {
      const i = this.cursor;
      this.cursor = i + 1 < MAX_PARTICLES ? i + 1 : 0;
      const p = this.pool[i];
      if (!p.alive) {
        p.alive = true;
        this.alive++;
        return p;
      }
    }
    return null;
  }

  /**
   * Spawn one particle with an EXACT velocity, bypassing the sampling in
   * `spawn`. The flip ring places its angles by index and a pad stream is a
   * single spark per call; both would have to fake a degenerate range to go
   * through `spawn`, and the ring must not touch an Rng at all.
   *
   * Returns false when the pool is full, so an emitting loop can stop on the
   * first drop instead of paying for a failed lap per remaining particle.
   */
  emit(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    gravity: number,
    drag: number,
  ): boolean {
    const p = this.claim();
    if (p === null) {
      return false;
    }
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.size = size;
    p.gravity = gravity;
    p.drag = drag;
    return true;
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
    // One fillStyle for the whole pass, read LIVE (phase 6 decision 6). A
    // colour sampled at spawn time would leave a flip trailing a cloud of the
    // outgoing phase, and worse: the flip ring is emitted inside
    // `Player.update`, and `PlayScene` flips the palette only after that
    // returns — so the flip's own ring, the one thing on screen announcing the
    // flip, would be the last thing still wearing the old colour. Sparks
    // inverting in flight is what makes a flip legible from a single spark.
    ctx.fillStyle = palette.accent;
    for (const p of this.pool) {
      if (!p.alive) {
        continue;
      }
      // Integer-snapped, and this is the sanctioned exception to the coordinate
      // policy ("world draws do not round"), not an oversight: a spark is 1–3
      // px, and sub-pixel placement spreads a 2 px square into a dim 3×3 smear
      // — on the only saturated colour in the game, whose whole job is to read
      // as an event.
      ctx.fillRect(Math.round(p.x - camX), Math.round(p.y - camY), p.size, p.size);
    }
  }

  clear(): void {
    for (const p of this.pool) {
      p.alive = false;
    }
    this.alive = 0;
    // The cursor resets with the pool. `clear` is the scene boundary — level
    // load, respawn — and its contract is that what follows is
    // indistinguishable from a fresh system; carrying the cursor across would
    // make slot occupancy after a respawn depend on the run before it, which is
    // invisible cross-run state bought for nothing.
    this.cursor = 0;
  }
}

/**
 * The shared body of every randomised emitter: `count` sparks in a cone of
 * half-angle `spread` about the direction (dirX, dirY), which the caller
 * derives from gravity or from a contact normal. Stops at the first drop.
 *
 * Lifetimes are jittered as well as directions. Without that, every spark of a
 * burst dies on the same frame — twenty of them leaving together reads as a pop
 * rather than as a splash dissipating. The ring does not come through here, and
 * must not: it is a shape, and a shape has to leave as one.
 */
function emitCone(
  ps: ParticleSystem,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  spread: number,
  count: number,
  speedMin: number,
  speedMax: number,
  life: number,
  gravity: number,
  drag: number,
  rng: Rng,
): void {
  const base = Math.atan2(dirY, dirX);
  for (let i = 0; i < count; i++) {
    const angle = base + rng.float(-spread, spread);
    const speed = rng.float(speedMin, speedMax);
    const ttl = life * rng.float(1, 1 + SPARK_LIFE_JITTER);
    if (
      !ps.emit(
        x,
        y,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        ttl,
        PARTICLE_SIZE,
        gravity,
        drag,
      )
    ) {
      return;
    }
  }
}

/**
 * A footfall's dust, thrown away from the floor — the direction `-gravitySign`,
 * never −y — and falling back along `gravitySign`. A flipped player kicking up
 * dust that falls toward the ceiling they are standing on is the kind of
 * wrongness nobody can name and everybody sees.
 */
export function spawnDust(
  ps: ParticleSystem,
  x: number,
  y: number,
  gravitySign: 1 | -1,
  rng?: Rng,
): void {
  emitCone(
    ps,
    x,
    y,
    0,
    -gravitySign,
    SPARK_SPREAD,
    DUST_COUNT,
    DUST_SPEED_MIN,
    DUST_SPEED_MAX,
    DUST_LIFE,
    SPARK_GRAVITY * gravitySign,
    SPARK_DRAG,
    rng ?? jitterRng,
  );
}

/**
 * A directional burst along the unit vector (dirX, dirY) — the jump fires one
 * along +gravity, so it reads as kicked out behind you, and a pad hit fires one
 * against the pad's facing. Only the cone direction is the caller's; the fall
 * is still gravity's, hence the separate sign.
 */
export function spawnBurst(
  ps: ParticleSystem,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  count: number,
  gravitySign: 1 | -1,
  rng?: Rng,
): void {
  emitCone(
    ps,
    x,
    y,
    dirX,
    dirY,
    SPARK_SPREAD,
    count,
    BURST_SPEED_MIN,
    BURST_SPEED_MAX,
    BURST_LIFE,
    SPARK_GRAVITY * gravitySign,
    SPARK_DRAG,
    rng ?? jitterRng,
  );
}

/**
 * The landing splash, sprayed along the CONTACT NORMAL the solver hands over.
 * Normals point surface → body, so (nx, ny) is already "away from what was
 * hit" for a floor, a ceiling, a wall or a ledge corner alike — which is why
 * this takes the normal rather than deriving one from gravity. `count` comes
 * from the impact ramp the player owns.
 */
export function spawnSplash(
  ps: ParticleSystem,
  x: number,
  y: number,
  nx: number,
  ny: number,
  count: number,
  gravitySign: 1 | -1,
  rng?: Rng,
): void {
  emitCone(
    ps,
    x,
    y,
    nx,
    ny,
    SPARK_SPREAD,
    count,
    SPLASH_SPEED_MIN,
    SPLASH_SPEED_MAX,
    SPLASH_LIFE,
    SPARK_GRAVITY * gravitySign,
    SPARK_DRAG,
    rng ?? jitterRng,
  );
}

/**
 * The flip's ring. Angles are placed BY INDEX and no Rng is touched: a
 * randomly-angled ring is a puff, and the flip is the one moment in the game
 * that deserves a shape. Gravity and drag are zero for the same reason — a ring
 * that sags is a splash, and one that damps unevenly stops being a circle.
 */
export function spawnRing(
  ps: ParticleSystem,
  x: number,
  y: number,
  count: number = FLIP_RING_COUNT,
): void {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    if (
      !ps.emit(
        x,
        y,
        Math.cos(angle) * FLIP_RING_SPEED,
        Math.sin(angle) * FLIP_RING_SPEED,
        FLIP_RING_LIFE,
        PARTICLE_SIZE,
        0,
        0,
      )
    ) {
      return;
    }
  }
}

/**
 * One spark of a pad's idle stream, in a narrow cone about the pad's facing.
 * Zero gravity and zero drag: the stream has to read as an arrow pointing where
 * the pad will throw you, and sparks that sag point at the floor instead. At
 * PAD_STREAM_SPEED × PAD_STREAM_LIFE it carries 40.5 px, 1.27 tiles.
 */
export function spawnStream(
  ps: ParticleSystem,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  rng?: Rng,
): void {
  emitCone(
    ps,
    x,
    y,
    dirX,
    dirY,
    PAD_STREAM_SPREAD,
    1,
    PAD_STREAM_SPEED,
    PAD_STREAM_SPEED,
    PAD_STREAM_LIFE,
    0,
    0,
    rng ?? jitterRng,
  );
}
