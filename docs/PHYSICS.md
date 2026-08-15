# Physics

The oriented-box rigid-body solver in `src/world/obb.ts` + `src/world/physics.ts`, and the game-feel numbers in `src/constants.ts`.

> **Status:** describes the target solver from [GAME-DESIGN.md](GAME-DESIGN.md). Phase 4 lands it; see [PHASES.md](PHASES.md). Refreshed from as-built code at the end of phase 7.

## The core split

**Linear motion is arcade. Angular motion is simulated.**

Horizontal velocity is set by input through acceleration and friction, exactly as in a conventional platformer. Vertical velocity is gravity plus jump impulses, and is clamped dead on contact. Nothing about the collision response is allowed to take linear control away from the player.

Rotation is the opposite: real angular velocity, real torque from off-centre impacts, real damping, real settling. The square genuinely tumbles, and its corners genuinely collide.

This is not a compromise between two models — it's the design. Spin supplies all the drama and none of the frustration, because it never decides where you land, only how you look getting there. Every equation below exists to serve that split.

## State

A body is a square of side `s` with unit mass, centred at `(x, y)`:

| Symbol | Field | Note |
| --- | --- | --- |
| **p** | `x, y` | **centre** origin, not top-left — this is a break from the old AABB solver |
| **v** | `vx, vy` | px/s |
| θ | `angle` | radians |
| ω | `angVel` | rad/s |
| m | — | 1 (unit mass; every impulse below is per-unit-mass) |
| I | `PLAYER_INERTIA` | m·s²/6 for a square lamina about its centre = 400/6 ≈ **66.7** at s = 20 |

Gravity direction is a sign, not a vector: `gravitySign` is `+1` (down) or `−1` (up), and the flip negates it. Everything downstream — "rising" vs "falling" gravity, grounded detection, the death planes — reads that sign rather than assuming a floor.

## Per-step algorithm

One fixed step of `STEP = 1/60 s`:

1. **Integrate gravity.** `g = rising ? GRAVITY_RISE : GRAVITY_FALL`, where *rising* means `vy · gravitySign < 0`. `vy += g · gravitySign · dt`, clamped to `±MAX_FALL_SPEED`.
2. **Sub-step.** Split the step so no sub-step moves more than `MAX_SUBSTEP` (8 px) linearly *or* sweeps a corner further than that arc-wise:
   ```
   corner_arc = |ω| · dt · s/√2
   steps = ceil( max(|vx·dt|, |vy·dt|, corner_arc) / MAX_SUBSTEP )
   ```
   At terminal velocity that's 12.8 px/frame → 2 sub-steps against a 32 px tile. Nothing tunnels. The rotational term rarely dominates (14 rad/s spins a corner 3.6 px per frame) but including it costs nothing and closes the case where a fast spin whips a corner through a thin wall.
3. **Advance** position and angle by the sub-step.
4. **Resolve contacts** (below), up to `MAX_CONTACT_ITERS` = 4 times.
5. **Damp and settle** rotation (below).

## Collision detection — SAT

The player is an oriented box; tiles are axis-aligned boxes. Separating Axis Theorem over four axes:

- the tile's axes, `(1,0)` and `(0,1)`
- the box's axes, `u = (cos θ, sin θ)` and `w = (−sin θ, cos θ)`

Because the box is a *square*, its projection radius onto any unit axis **a** is

```
r_box = (s/2) · ( |a·u| + |a·w| )
```

and the tile's radius onto **a** is `(T/2)·(|a_x| + |a_y|)`. Overlap on all four axes ⇒ collision; the axis of **minimum** overlap gives the contact normal **n** and penetration depth `d`. Sign **n** so it points from the tile toward the box — the direction the box gets pushed out.

The square's 90° rotational symmetry means θ only ever matters mod 90°, which is worth exploiting for both the tests and the auto-right target.

### Contact point

Which feature is incident depends on which axis won:

- **n is a tile axis** → a box vertex is deepest. Contact = the vertex minimising `vertex · n`.
- **n is a box axis** → a tile corner is deepest. Contact = the corner maximising `corner · n`.

This is the whole reason corners feel real. A square descending onto a ledge edge resolves against a *tile corner* on a *box face axis*, which puts the contact point far from the centre and generates the torque that spins you off.

### Resolution order

Collect every overlapping solid tile, resolve the **deepest first**, then re-run the broadphase and repeat. A corner wedged into a one-tile gap touches two tiles and needs both resolved, and resolving them in arbitrary order oscillates. Cap at 4 iterations and accept a hair of penetration over a hang.

Positional correction moves the centre by `n · (d − SLOP)` with `SLOP` = 0.01 px.

## Collision response — impulse

With **r** = contact − centre, the contact point's velocity is

```
v_p = v + ω × r        (2D:  ω × r = ω · (−r_y, r_x) )
v_n = v_p · n
```

Skip if `v_n ≥ 0` — already separating. Otherwise the impulse magnitude is the standard rigid-body result:

```
              −(1 + RESTITUTION) · v_n
j  =  ─────────────────────────────────────────
          1/m  +  (r × n)² / I
```

with the 2D cross `r × n = r_x·n_y − r_y·n_x`, and `RESTITUTION` = 0 (impacts spin you; they never launch you).

Applied:

```
v  +=  (j / m) · n
ω  +=  SPIN_TRANSFER · j · (r × n) / I
v  =  v − min(0, v·n) · n          ← the arcade clamp
```

**That last line is the seam between the two models,** and it's the most important line in the solver. Physically exact response would leave a landing square still moving into the floor: a flat-face landing puts the contact at a vertex, `r × n = ∓s/2 = ∓10`, so `(r×n)²/I = 100/66.7 = 1.5` and the denominator is 2.5 — one impulse kills only 40 % of the downward speed. A corner landing is worse: `|r × n|` reaches `s/√2 ≈ 14.1`, denominator 4, killing 25 %.

For a free-floating body that's correct and looks great. For a platformer it means mushy, sinking landings. So the impulse runs in full — the spin it produces is exactly the physical spin — and then the velocity component *into* the surface is clamped to zero. Linear motion stops dead like a platformer. Angular motion keeps every bit of the real physics. Neither model contaminates the other.

`SPIN_TRANSFER` = 0.6 is an admitted cheat on top: a physically exact torque makes the square whirl off every graze. 0.6 keeps impacts lively and readable without turning a scrape into a tumble.

## Grounded

Grounded ⇔ any contact resolved this step had

```
n · up  >  GROUND_NORMAL_DOT       where up = (0, −gravitySign),  GROUND_NORMAL_DOT = 0.7
```

The threshold exists because tiles are axis-aligned but the *box* isn't: a square resting on a corner contacts along one of its own face normals, which can point up to 45° off vertical. 0.7 (≈45°) counts that as ground — you can stand, jump, and recharge the flip while balanced on a corner, which is exactly the moment the game is showing off.

Because `up` is derived from `gravitySign`, landing on what was the ceiling is ground in every sense: it stops you, it recharges the flip, it triggers the landing particles and sound.

## Rotational damping and settling

Three mutually exclusive cases per step:

| Condition | Behaviour |
| --- | --- |
| Airborne | `ω *= exp(−ANG_DAMP_AIR · dt)` — light, 0.4/s. A jump's spin decays ~20 % over its 0.57 s airtime. |
| Grounded, a contact resolved this step | `ω *= exp(−ANG_DAMP_GROUND · dt)` — strong, 8/s. **The spring is suppressed**, so a genuine impact isn't fought by the auto-right in the same frame it lands. |
| Grounded, no contact this step | The restoring spring, below. |

The spring pulls toward the nearest multiple of 90° — visually identical for a square, so it's always the short way round and never rotates more than 45°:

```
θ_target = round( θ / (π/2) ) · (π/2)
err      = θ − θ_target                      ∈ [−π/4, π/4]
α        = −RIGHT_STIFFNESS · err  −  RIGHT_DAMPING · ω
ω       += α · dt
```

`RIGHT_STIFFNESS` = 240 rad/s² and `RIGHT_DAMPING` = 31 ≈ 2√240 make it **critically damped**: no overshoot, no wobble, natural frequency ω_n = √240 = 15.5 rad/s, settling to within 2 % in **≈ 0.25 s**. That's the "~0.3 s soft auto-right" from the design doc, and it's why a tilted landing reads as a physical settle rather than a snap or a bounce.

## The numbers

All in `src/constants.ts` with units. Derived properties are enforced by `tests/physics.test.ts`, so retuning can't silently break level geometry.

| Constant | Value | Meaning |
| --- | --- | --- |
| `TILE` | 32 px | tile size |
| `PLAYER_SIZE` | 20 px | square edge |
| `RUN_SPEED` | 256 px/s | 8 tiles/s |
| `GROUND_ACCEL` / `AIR_ACCEL` | 2100 / 1300 px/s² | full speed in ~0.12 s; ~62 % air control |
| `GROUND_FRICTION` | 3600 px/s² | stop from full speed in ~0.07 s |
| `JUMP_VELOCITY` | 700 px/s | against gravity |
| `GRAVITY_RISE` / `GRAVITY_FALL` | 2200 / 3520 px/s² | 1.6× heavier descending |
| `MAX_FALL_SPEED` | 768 px/s | 24 tiles/s |
| `MAX_SUBSTEP` | 8 px | anti-tunnelling |
| `PLAYER_INERTIA` | 66.7 | s²/6 at unit mass |
| `JUMP_SPIN_BASE` | 2.5 rad/s | standing jump |
| `JUMP_SPIN_PER_SPEED` | 0.014 rad/s per px/s | scaled by \|vx\| |
| `FLIP_SPIN_KICK` | 3.0 rad/s | flip |
| `MAX_ANG_SPEED` | 14 rad/s | clamp |
| `SPIN_TRANSFER` | 0.6 | collision torque scale |
| `RESTITUTION` | 0.0 | no bounce |
| `GROUND_NORMAL_DOT` | 0.7 | ≈45° counts as ground |

### Derived, and asserted by tests

- **Jump peak** = v²/2g = 700²/4400 ≈ 111.4 px ≈ **3.48 tiles**.
- **Rise** ≈ 0.318 s, **fall from peak** ≈ 0.252 s, **airtime ≈ 0.570 s**.
- **Full-speed jump clearance** ≈ 0.570 × 256 ≈ 146 px ≈ **4.56 tiles**. Levels may use 4-tile gaps; 5 needs a flip or a pad.
- **Spin per jump.** With air damping, total rotation over one airtime is `ω₀ · (1 − e^{−0.4·0.57}) / 0.4 = ω₀ · 0.511`. A standing jump (ω₀ = 2.5) turns **≈ 73°**; a full-speed jump (ω₀ = 2.5 + 0.014·256 = 6.08) turns **≈ 178°** — very close to a half-turn, so a fast jump usually lands on the opposite face.

### The one-tile corridor

The number that constrains every level:

```
PLAYER_SIZE · √2  =  20 × 1.4142  =  28.28 px      vs      TILE = 32 px
```

**3.72 px of total clearance at the worst angle (45°), 1.86 px per side.** The square therefore fits a one-tile gap at *any* rotation, but tightly enough that corners scrape constantly on the way through. That tension — always possible, never comfortable — is the core sensation of moving through this game.

The hard ceiling is `PLAYER_SIZE ≤ TILE/√2 = 22.6`. Above that, one-tile gaps become angle-dependent: a spinning entry would sometimes wedge and sometimes pass, which reads as a bug no matter how physically honest it is. 20 leaves deliberate headroom below that cliff. **Do not raise it without re-checking every level.**

## Game feel

The player controller (`entities/player.ts`) layers the classics on top of the solver: coyote time (`COYOTE_TIME`), jump buffering (`JUMP_BUFFER`), and a one-shot jump cut (`JUMP_CUT_FACTOR`) for variable height. These matter *more* on a rigid body than on an AABB, because the visual is busier — the spin makes the exact frame of takeoff harder to read, and the grace windows absorb that.

Jump pads override the relevant velocity component rather than adding to it, so launch height is predictable regardless of approach speed, and impart angular velocity proportional to contact offset from the pad's centre — clip a pad with a corner and you leave it spinning.

## Determinism

Fixed timestep, no `Math.random` on any physics path, no wall-clock reads. Same start state plus same input sequence ⇒ bit-identical trajectory. A test asserts exactly that over 600 steps, and it is the cheapest insurance in the repo: it turns any accidental non-determinism introduced by a later refactor into an immediate red test rather than a physics bug someone notices three phases later.
