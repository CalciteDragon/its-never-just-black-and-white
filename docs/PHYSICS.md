# Physics

The custom AABB solver in `src/world/physics.ts` and the game-feel numbers in `src/constants.ts`.

## Solver

Bodies are axis-aligned boxes (`x, y, w, h, vx, vy`, top-left origin, float px). `moveBody` integrates one fixed step:

1. Total displacement splits into sub-steps of ≤ `MAX_SUBSTEP` (4 px) per axis — a body moving 33 px/frame still collides with a 16 px tile wall. **Nothing tunnels.**
2. Each sub-step moves X then Y independently. On contact the body snaps flush to the tile edge (a 0.001 px skin keeps it out of the wall), the velocity component zeroes, and that axis stops sub-stepping — so a body that hits a wall mid-step can't keep drifting after its velocity died.
3. Results report `onGround`, `hitWall (-1|0|1)`, `hitCeiling`, and `landed` (airborne→grounded transition only, so landing effects fire exactly once).

**Tiles** (`world/tiles.ts`): `Solid` blocks everything; `Platform` blocks only downward motion, and only if the body's bottom started at or above the platform top that sub-step (jump up through it, land on it, or hold down+jump to drop through via `dropThrough`); `Spike` never blocks — hazard overlap is a separate query. Out-of-bounds reads are `Solid` at the sides/top (sealed dungeon) and `Empty` below the bottom (pits kill by falling out).

**Spike fairness:** the hurt-box is only the bottom 7 px of a spike tile, inset 2 px per side — grazing a spike's edge pixels is forgiven.

Gravity is applied by callers (`applyGravity`): rise and fall use different constants, capped at terminal velocity.

## The numbers

All in `src/constants.ts`, units in comments. Targets from GAME-DESIGN §5; **derived properties are enforced by tests** (`tests/physics.test.ts`), so retuning can't silently break level geometry.

| Constant | Value | Meaning |
| --- | --- | --- |
| `RUN_SPEED` | 112 px/s | 7 tiles/s |
| `GROUND_ACCEL` / `AIR_ACCEL` | 900 / 540 px/s² | full speed in ~0.12 s; 60 % air control |
| `GROUND_FRICTION` | 1800 px/s² | stop from full speed in ~0.06 s |
| `JUMP_VELOCITY` | 340 px/s | impulse |
| `GRAVITY_RISE` / `GRAVITY_FALL` | 1000 / 1600 px/s² | 1.6× heavier on the way down |
| `MAX_FALL_SPEED` | 352 px/s | 22 tiles/s terminal |
| `COYOTE_TIME` | 90 ms | jump grace after leaving a ledge |
| `JUMP_BUFFER` | 120 ms | early press honored on landing |
| `JUMP_CUT_FACTOR` | 0.45 | release mid-rise multiplies vy once |
| `PLAYER_BODY_W×H` | 10×13 px | inside a 12×14 sprite |

Derived (and asserted within tolerance):

- **Jump peak** = v²/2g = 340²/2000 ≈ 57.8 px ≈ **3.6 tiles** (test bound: 3.2–4.0; a simulated jump must match the analytic peak within 5 %).
- **Rise time** ≈ 0.34 s; fall from peak ≈ 0.27 s.
- **Full-speed horizontal clearance** ≈ 0.61 s × 112 ≈ 68 px ≈ **4.26 tiles** (test bound: ≥ 3.5) — the dungeon generator caps gaps at 3 tiles, comfortably inside this.

## Game feel

The player controller (`entities/player.ts`) layers the classics on top: coyote time, jump buffering, one-shot jump cut for variable height, drop-through platforms (down+jump, 0.18 s window), landing squash + dust, damage knockback (away from source, up-biased) with 1.2 s of i-frames, and a `lastSafe` position — the last grounded, spike-free spot — that pit falls teleport you back to for one heart instead of a run-ending death.

Slimes use the same solver: patrol at 24 px/s, flip on `hitWall`, and probe the tile beyond their leading foot to turn at ledges instead of walking off.
