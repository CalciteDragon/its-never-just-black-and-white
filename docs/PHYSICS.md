# Physics

The oriented-box rigid-body solver in `src/world/obb.ts` + `src/world/physics.ts`, and the game-feel numbers in `src/constants.ts`.

> **Status:** as-built, and current. The solver was built in phase 4 and amended in phase 5, when pads became collidable geometry; nothing since has changed a line of it — the phase that added the editor and the shell touched no physics at all. Sections marked *(amended in phase N)* were written before anything ran and turned out wrong once it did; they are kept as amendments rather than quietly rewritten, because the version that was wrong is the useful half. See [PHASES.md](PHASES.md) for the history.

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

1. **Integrate gravity.** `g = rising ? GRAVITY_RISE : GRAVITY_FALL`, where *rising* means `vy · gravitySign < 0`. `vy += g · gravitySign · dt`.

   *(Amended in phase 4.)* The clamp is **directional**, not symmetric: `MAX_FALL_SPEED` limits motion *along* gravity only, so `if (vy · gravitySign > MAX_FALL_SPEED) vy = MAX_FALL_SPEED · gravitySign`. A symmetric clamp would cap `PAD_IMPULSE` (820 px/s) at 768 and quietly break every jump pad in the game.

   And position drifts by the **average of the pre- and post-gravity velocity**, not by the post-gravity velocity:
   ```
   driftY = (vy_before + vy_after) / 2
   ```
   This is exact for constant acceleration, so sampled positions lie *on* the parabola. It is also **not** interchangeable with the half-gravity split (kick-drift-kick), which is the same trajectory but a different *stored* velocity: KDK ends the step having just applied the second half-kick, so a square sitting still on the floor stores `vy = GRAVITY_FALL · STEP / 2` = **29.3 px/s forever**. `speedNorm` would never fall below 0.09, the vignette would never fully open, and the controller would need an "at rest" special case everywhere. Take the average from the actual pair rather than subtracting `g·dt/2`, or the terminal clamp desynchronises the two and the fall runs 29 px/s slow.

2. **Sub-step.** Split the step so no sub-step moves more than `MAX_SUBSTEP` (8 px) linearly *or* sweeps a corner further than that arc-wise:
   ```
   corner_arc = |ω| · dt · s/√2
   steps      = ceil( max( hypot(vx·dt, driftY·dt), corner_arc ) / MAX_SUBSTEP )
   ```
   *(Amended in phase 4.)* The linear term is the **magnitude of the displacement**, not the larger component: max-of-components under-counts diagonal motion by up to √2. It is taken from the actual per-step displacement rather than from `vy`, so a caller that hands in a velocity beyond terminal cannot smuggle a long advance past the cap.

   At full run plus terminal fall that's 13.5 px/frame → 2 sub-steps against a 32 px tile. Nothing tunnels: measured, a body entering at 4000 px/s never penetrates a floor by more than `CONTACT_SLOP`. The rotational term rarely dominates (14 rad/s sweeps a corner 3.3 px per frame) but including it costs nothing and closes the case where a fast spin whips a corner through a thin wall.

3. **Advance** position and angle by the sub-step.
4. **Resolve contacts** (below), up to `MAX_CONTACT_ITERS` = 4 times — **inside** the sub-step loop. *(Amended in phase 4: the original listed sub-stepping and resolution as sequential steps. Read that way, sub-stepping is decorative — advancing the same distance in pieces with no test between them lands in exactly the same place.)* If any contact was found, the remaining sub-steps drift at the post-resolution `vy` rather than the pre-collision average.
5. **Damp and settle** rotation (below), once per full step.

## Collision detection — SAT

The player is an oriented box; tiles are axis-aligned boxes. Separating Axis Theorem over four axes:

- the tile's axes, `(1,0)` and `(0,1)`
- the box's axes, `u = (cos θ, sin θ)` and `w = (−sin θ, cos θ)`

Because the box is a *square*, its projection radius onto any unit axis **a** is

```
r_box = (s/2) · ( |a·u| + |a·w| )
```

and the tile's radius onto **a** is `(T/2)·(|a_x| + |a_y|)`. Overlap on all four axes ⇒ collision; the axis of **minimum** overlap gives the contact normal **n** and penetration depth `d`. Sign **n** so it points from the tile toward the box — the direction the box gets pushed out.

Tile axes are tested first and an axis is kept only on **strict** improvement, so a tie goes to the tile axis. That is what makes a flush contact resolve as a face contact rather than a degenerate box-axis one, and it is one of the orderings determinism rests on.

The square's 90° rotational symmetry means θ only ever matters mod 90°, which is worth exploiting for both the tests and the auto-right target.

### Interior faces

*(Added in phase 4.)* **A tile face buried against a neighbouring solid is not a surface, and must be excluded from the choice of resolution direction.** Without this rule a contiguous floor is not a floor. A square landing across a tile seam barely overlaps the second tile horizontally, so *that* tile's cheapest separating axis is sideways — and the landing answers with a shove along the floor plus ~9 rad/s of spin from the resulting single-corner contact.

The rule is exact rather than heuristic: if the neighbour in the push direction is solid, the push drives the box **into** solid material, so the contact is spurious and the neighbour owns the real one. The dominant component of **n** picks the direction to test; at exactly 45° both are tested, which needs no threshold and no tie-break. Overlap is still tested on all four axes, so *detection* stays exact — only the resolution direction is restricted.

Out-of-bounds reads do the right thing for free: the sealed sides mask their own outward faces, and the open top and bottom leave theirs exposed.

### Contact point

Which feature is incident depends on which axis won:

- **n is a tile axis** → box vertices are candidates, clipped to the tile's extent along the contact tangent.
- **n is a box axis** → tile corners are candidates, clipped to the box face's extent along the tangent.

Corner contacts are the whole reason corners feel real. A square descending onto a ledge edge resolves against a *tile corner* on a *box face axis*, which puts the contact point far from the centre and generates the torque that spins you off.

**The deepest-vertex rule cannot rest a flat square, and the failure is loud.** *(Amended in phase 4 — the original took the single deepest feature.)* A 20 px square flush on a floor has two bottom corners at equal depth; a tie-break picks one, giving `r × n = ∓10`. Measured against the as-built solver, that lands a flat drop with **−12.25 rad/s** of spin out of a perfectly square approach, and with the impact gate below also removed it settles into a permanent **2.20 rad/s** (126°/s) roll — deterministic, so *every* flat landing in the game rolls the same way.

So contacts are **merged into a manifold before resolution**, not resolved one tile at a time:

- candidate points are clipped to the incident face, with `CLIP_TOL` of tangential slack (below);
- contacts sharing a normal merge across tiles, taking the maximum depth;
- the contact point is the **centroid of every candidate within `CONTACT_TOL` of the deepest**, pooled across the whole manifold.

Flush on one tile or straddling two, both bottom corners tie, the centroid is the face centre, `r × n` is **exactly** zero, the denominator collapses to `1/m`, and the impulse is a clean full stop with no torque at all. Overhanging a ledge, only the corner actually over the tile is a candidate, so it tips off. Tilted, one vertex is clearly deepest and the corner physics is untouched. `CONTACT_TOL` = 0.25 px puts the tie band at `asin(0.25/20)` = **±0.72°**, below the settled angular residual and far below any visible tilt.

`CLIP_TOL` is a different quantity from `CONTACT_TOL` — tangential rather than depth — and has to be larger. A resting body sits `CONTACT_SLOP` inside the floor and sinks a further `GRAVITY_FALL · STEP² / 2` = 0.489 px every step before its contact is resolved, so its lower corner strays that far past the bottom of the wall tile beside it. Clipped strictly, that corner is discarded, the wall contact degenerates to its single upper corner, and **walking into a wall answers with 3.7 rad/s of spin conjured out of resting slop alone.** Two steps' worth of sink, 0.99 px, on a 32 px tile.

### Resolution order

Collect every overlapping solid tile, merge into manifolds, resolve the **deepest**, then re-run the broadphase and repeat. Cap at `MAX_CONTACT_ITERS` = 4 — a natural cap once manifolds are merged, since there are only four tile-axis normals.

*(Amended in phase 4.)* **Only one manifold is resolved per pass.** Resolving several off one collection is what turns an inside corner into an oscillator: the wall push moves the body several px, and the floor contact behind it is then resolved against candidate points from before the move, losing the corner that had strayed past the floor tile's edge and answering with a single-corner torque. Manifolds that decline to act have not moved anything, so the next one down is still looking at fresh geometry and may be tried in the same pass.

The broadphase iterates **row-major**, and manifolds order by depth with a **stable** sort, so ties keep discovery order. Both are free if chosen deliberately and unfindable if not.

Positional correction moves the centre by `n · (d − SLOP)` with `CONTACT_SLOP` = 0.01 px. Correcting to *exactly* the slop makes rest a **fixed point** rather than an asymptote: the body descends 0.489 px and is pushed back to the same float, bit-identically, forever. That is why no velocity-based sleep threshold is needed — a test asserts the last 100 positions of a 300-step rest are the same number, not merely close.

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
ω  +=  SPIN_TRANSFER · j · (r × n) / I     ← only if −v_n > IMPACT_SPEED_MIN
v  =  v − min(0, v·n) · n                  ← the arcade clamp
```

*(Amended in phase 4: the angular half is gated on approach speed — see below.)* The linear half always runs, and the clamp makes it exact: since `Δ(v·n) = −v_n/denominator ≤ −v_n`, the impulse can never overshoot into separation, so after the clamp `v·n` is **exactly** zero. A body resting on a floor therefore stores `vy === 0`, not a residual.

**That last line is the seam between the two models,** and it's the most important line in the solver. Physically exact response would leave a landing square still moving into the floor: a flat-face landing puts the contact at a vertex, `r × n = ∓s/2 = ∓10`, so `(r×n)²/I = 100/66.7 = 1.5` and the denominator is 2.5 — one impulse kills only 40 % of the downward speed. A corner landing is worse: `|r × n|` reaches `s/√2 ≈ 14.1`, denominator 4, killing 25 %.

For a free-floating body that's correct and looks great. For a platformer it means mushy, sinking landings. So the impulse runs in full — the spin it produces is exactly the physical spin — and then the velocity component *into* the surface is clamped to zero. Linear motion stops dead like a platformer. Angular motion keeps every bit of the real physics. Neither model contaminates the other.

`SPIN_TRANSFER` = 0.6 is an admitted cheat on top: a physically exact torque makes the square whirl off every graze. 0.6 keeps impacts lively and readable without turning a scrape into a tumble.

### Impact, not contact

*(Added in phase 4.)* **A resting contact is still a contact.** With `CONTACT_SLOP` residual penetration, gravity re-penetrates a resting body by 0.489 px *every* step, so "a contact resolved this step" is permanently true on the ground — and it is therefore useless as a discriminator, whether for spin or for the auto-right spring.

Discriminate by **approach speed** instead: `IMPACT_SPEED_MIN = 2 · GRAVITY_FALL · STEP` = 117.3 px/s, twice the largest approach gravity alone can build in one step, sitting at a 1.96 px drop. One threshold, two jobs:

- **above it** — a genuine impact: apply the angular impulse, and suppress the spring for that step;
- **below it** — resting or scraping: linear stop only, no torque, and the spring runs.

The second job is what stops a square resting at 1° from buzzing, and it is also what closes the wedge oscillation this solver was most at risk of. A body held into a corner and *accelerated* there the way a controller does approaches at `GROUND_ACCEL · STEP` = 35 px/s after the first frame — comfortably under the gate, so no torque, and the position is a bit-identical fixed point. Re-supplying a large velocity every step instead (which nothing in the game can do) makes every frame a fresh above-threshold impact, and the tilted corner and the suppressed spring settle into a period-2 limit cycle.

The threshold is a cheat and it has a boundary: a contact at exactly 117.3 px/s either spins you or does not. Nothing in the game arrives at that speed, but it is a discontinuity and worth knowing where it is when something looks wrong.

## Grounded

Grounded ⇔ any contact resolved this step had

```
n · up  >  GROUND_NORMAL_DOT       where up = (0, −gravitySign),  GROUND_NORMAL_DOT = 0.7
```

The threshold exists because tiles are axis-aligned but the *box* isn't: a square resting on a corner contacts along one of its own face normals, which can point up to 45° off vertical. 0.7 (≈45°) counts that as ground — you can stand, jump, and recharge the flip while balanced on a corner, which is exactly the moment the game is showing off.

Because `up` is derived from `gravitySign`, landing on what was the ceiling is ground in every sense: it stops you, it recharges the flip, it triggers the landing particles and sound.

*(Amended in phase 5.)* **Grounded and "recharges the flip" are different predicates.** Pads became collidable geometry in phase 5, so landing on one *is* a ground-normal contact, and the recharge rule has always keyed off the *tile* rather than the normal. `StepResult.grounded` therefore cannot answer the recharge question, and each `Contact` carries two extra bits instead:

| Field | Meaning |
| --- | --- |
| `pad: Tile` | the pad tile that produced this contact, `Tile.Empty` for none |
| `onSolid: boolean` | whether any plain `Tile.Solid` pooled into it |

Both are needed rather than one enum, because the two halves are read independently and a body can be on both at once — straddling a pad and the floor beside it launches (the pad fired) *and* recharges. They are set on the manifold as tiles pool into it — `pad` from the first pad seen, `onSolid` from any plain solid — and accumulate across sub-steps in `recordContact`, since one normal can be re-resolved against a different tile each pass.

*(Amended after 0.2 playtesting: pads now recharge — see GAME-DESIGN §5.)* The recharge is `(onSolid && n · up > GROUND_NORMAL_DOT) || pad !== Tile.Empty`. A solid keeps the ground test at the same threshold as `grounded`, so balancing on a corner still recharges you; a pad recharges from any contact, including its back, because the rule an author can see is the tile.

The launch is the complementary test on the same contact: `n · facing > -PAD_BACK_DOT` — every face **but** the back — and it always fires along the pad's own facing, never along the contact normal.

Pads are blocking geometry to the broadphase in **both** places it asks — the collision test *and* the interior-face mask. Masking only the first rebuilds the tile-seam bug of § Interior faces at every pad in the game: the pad's neighbours would leave their faces toward it exposed, and landing across the seam finds a sideways cheapest-axis. Measured at **8.32 rad/s** with the mask still reading `=== Tile.Solid`, against the 8.07 the same failure produced between two plain tiles.

## Rotational damping and settling

Three mutually exclusive cases per step. *(Amended in phase 4: keyed on **impact**, not on contact — see above. Keyed on contact, the middle row is permanently true for anything standing on the ground, so the spring would never run in the one place it exists to run.)*

| Condition | Behaviour |
| --- | --- |
| Airborne | `ω *= exp(−ANG_DAMP_AIR · dt)` — light, 0.4/s. A jump's spin decays ~20 % over its 0.57 s airtime. |
| Grounded, an **impact** this step | `ω *= exp(−ANG_DAMP_GROUND · dt)` — strong, 8/s. **The spring is suppressed**, so a genuine impact isn't fought by the auto-right in the same frame it lands. |
| Grounded, no impact this step | The restoring spring, below. |

The spring pulls toward the nearest multiple of 90° — visually identical for a square, so it's always the short way round and never rotates more than 45°:

```
θ_target = round( θ / (π/2) ) · (π/2)
err      = θ − θ_target                      ∈ [−π/4, π/4]
α        = −RIGHT_STIFFNESS · err  −  RIGHT_DAMPING · ω
ω       += α · dt
```

`RIGHT_STIFFNESS` = 240 rad/s² and `RIGHT_DAMPING` = 31 ≈ 2√240 make it **critically damped**: no overshoot, no wobble, natural frequency ω_n = √240 = 15.5 rad/s.

*(Amended in phase 4.)* The continuous 2 % settling time is `4/ω_n` = **0.26 s**, and the discrete scheme does not hit it. Because the angle is advanced before the spring is evaluated, the step map is `[[1, h], [−kh, 1 − ch − kh²]]`, whose eigenvalues at 60 Hz are **0.844 and 0.573** — both real and positive, so still no overshoot and no oscillation, but the slow mode decays more slowly than the continuous envelope. Measured from both 25° and 44°:

| Remaining error | Time |
| --- | --- |
| 5 % | 0.350 s |
| 2 % | 0.433 s |
| 1 % | 0.500 s |
| exactly 0 (the settle snap) | 0.58–0.63 s |

The design's "~0.3 s soft auto-right" holds at the threshold that matters perceptually — 5 % of a 25° tilt is 1.25°, which reads as square — but the doc's 2 % figure was a continuous-time number and is 0.43 s in practice. Bringing the 2 % mark down to 0.26 s would need `RIGHT_DAMPING` ≈ 27 (the discrete critical value at this `h` and `k`), which is a feel decision rather than a correctness one. Phase 5's controller pass did not take it: `RIGHT_DAMPING` stands at **31**, on the grounds that 5 % is where the eye stops reading a tilt and the remaining 0.43 s is spent below 1.25°.

### The settle snap

*(Added in phase 4.)* Position reaches an exact fixed point; ω only ever approaches zero asymptotically, leaving a permanent sub-pixel wobble and no exactly-still state to assert. So: grounded, `|ω| < ANG_SETTLE_VEL` (0.05 rad/s) and `|err| < ANG_SETTLE_EPS` (0.002 rad) ⇒ set the angle to the target and zero ω. At 0.002 rad a corner of the square moves 0.028 px, so the snap the design otherwise forbids is a third of a pixel below visible.

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
| `CONTACT_SLOP` | 0.01 px | residual penetration left by positional correction |
| `CONTACT_TOL` | 0.25 px | depth band within which candidates tie and merge |
| `CLIP_TOL` | 0.99 px | tangential slack on the incident-face clip (derived) |
| `MAX_CONTACT_ITERS` | 4 | resolution passes per sub-step |
| `IMPACT_SPEED_MIN` | 117.3 px/s | impact vs. resting, `2 · GRAVITY_FALL · STEP` (derived) |
| `ANG_SETTLE_EPS` | 0.002 rad | angle error under which a grounded body snaps square |
| `ANG_SETTLE_VEL` | 0.05 rad/s | angular speed under which that snap is allowed |

### Derived, and asserted by tests

- **`PLAYER_INERTIA` = `inertiaOfSquare(PLAYER_SIZE)` = s²/6 = 66.7.** Derived, never typed in: a literal could silently disagree with `PLAYER_SIZE`, and every angular result scales with the ratio. The solver computes inertia from the body's own size through the same function.
- **Jump peak** = v²/2g = 700²/4400 ≈ 111.4 px ≈ **3.48 tiles**. Simulated: **111.361 px**, 0.002 % under — average-velocity integration is exact for constant acceleration, so the only error left is that the true apex falls between two samples. (Phase 2's plain Euler missed by 5.2 %.)
- **Rise** ≈ 0.318 s, **fall from peak** ≈ 0.252 s, **airtime ≈ 0.570 s** = 34.2 steps.
- **Full-speed jump clearance** ≈ 0.570 × 256 ≈ 146 px ≈ **4.56 tiles**. Levels may use 4-tile gaps; 5 needs a flip or a pad.
- **Spin per jump.** With air damping, total rotation over one airtime is `ω₀ · (1 − e^{−0.4·0.57}) / 0.4 = ω₀ · 0.511`. A standing jump (ω₀ = 2.5) turns **≈ 73°**; a full-speed jump (ω₀ = 2.5 + 0.014·256 = 6.08) turns **≈ 178°** — very close to a half-turn, so a fast jump usually lands on the opposite face. Measured in the browser at the last airborne frame: **72.87°** and **177.3°**. The discrete sum runs +0.33 % high because damping is applied after the advance, which is `h·λ/2` exactly.
- **Solver cost** at terminal velocity wedged in a corner: **0.0023 ms/step**, against a 16.67 ms frame budget. Resting flat, 0.0005 ms.

### The one-tile corridor

The number that constrains every level:

```
PLAYER_SIZE · √2  =  20 × 1.4142  =  28.28 px      vs      TILE = 32 px
```

**3.72 px of total clearance at the worst angle (45°), 1.86 px per side.** The square therefore fits a one-tile gap at *any* rotation, but tightly enough that corners scrape constantly on the way through. That tension — always possible, never comfortable — is the core sensation of moving through this game.

The hard ceiling is `PLAYER_SIZE ≤ TILE/√2 = 22.6`. Above that, one-tile gaps become angle-dependent: a spinning entry would sometimes wedge and sometimes pass, which reads as a bug no matter how physically honest it is. 20 leaves deliberate headroom below that cliff. **Do not raise it without re-checking every level.**

## Game feel

The player controller (`entities/player.ts`) layers the classics on top of the solver: coyote time (`COYOTE_TIME`), jump buffering (`JUMP_BUFFER`), and a one-shot jump cut (`JUMP_CUT_FACTOR`) for variable height. These matter *more* on a rigid body than on an AABB, because the visual is busier — the spin makes the exact frame of takeoff harder to read, and the grace windows absorb that.

Jump pads override the relevant velocity component rather than adding to it, so launch height is predictable regardless of approach speed, and impart angular velocity proportional to how off-centre the contact was — clip a pad with a corner and you leave it spinning.

*(Amended in phase 5.)* Two details the sentence above got wrong, both derived rather than preferred:

**The pad's spin needs its own scale.** Reusing the solver's torque with `j = PAD_IMPULSE` gives `Δω = SPIN_TRANSFER · 820 · (r×n) / PLAYER_INERTIA` = **73.8 rad/s** at a full corner — over five times `MAX_ANG_SPEED`, so anything more than ~2 px off centre clamps and every off-centre hit looks identical. So the pad uses `PAD_SPIN_MAX` = 8.0 rad/s at a full-corner arm, scaled linearly and clamped:

```
Δω = PAD_SPIN_MAX · clamp( (r × n) / (PLAYER_SIZE/2),  −1, +1 )
```

`r` is measured from the **body's** centre, not the pad's — it is a torque arm, not a measure of where the pad was hit. A flat landing anywhere on a pad is `r × n = 0` and produces no spin at all, which is what makes "clip it with a corner and you leave spinning" a distinction rather than a constant tumble. Sign, stated so it can be asserted: for an up-pad `n = (0, −1)`, so `r × n = −r_x` and a contact right of centre sends ω **negative** — counter-clockwise on screen, right side lifting.

**The horizontal clamp is one-sided.** `PAD_IMPULSE` is 820 and `RUN_SPEED` is 256, so a controller that re-clamps `vx` to ±`RUN_SPEED` every frame a direction is held erases a sideways pad within one frame of firing — and holding *toward* the launch is what erases it. Suppressing control for a few frames instead is not available (hard rule 7). So input may never push `|vx|` **past** `RUN_SPEED`, but may not brake an existing overspeed either; pressing *against* one decelerates at the normal rate, so turning around at 820 px/s still works. Overspeed then bleeds off at `GROUND_FRICTION` whenever the body is grounded, held direction or not, and is preserved in the air: a pad is a launch, not a permanent speed upgrade, and the ground is where the controller governs speed. Below `RUN_SPEED` the branch is arithmetically identical to a symmetric clamp, which is why every phase 4 movement assertion survived it unchanged.

## Determinism

Fixed timestep, no `Math.random` on any physics path, no wall-clock reads. Same start state plus same input sequence ⇒ bit-identical trajectory. A test asserts exactly that over 600 steps, and it is the cheapest insurance in the repo: it turns any accidental non-determinism introduced by a later refactor into an immediate red test rather than a physics bug someone notices three phases later.

### The pause, and why it is an early return

`PlayScene` can be paused, which makes it the one thing in the game that interrupts a reproducible trajectory. It is a **true freeze**: `update` returns before the state machine, so no solver step, no camera update, no particle step and no smoother runs at all. A test holds a pause for thirty frames mid-run and asserts that the resumed body agrees with an uninterrupted one on `x`, `y`, `vx` and `vy` to the last bit — not `toBeCloseTo`, because anything that leaked one frame of simulation into the pause would show up there and nowhere else.

The obvious alternative is `update(dt = 0)`, and the measured finding is worth recording because it is the opposite of what the brief for it predicted: **a `dt = 0` pause is not detectable by trajectory divergence in this solver.** Gravity increments by `g · 0`; the sub-step advance is `v · 0`; and every exponential smoother in the scene — `speedNorm`, the camera follow, the lookahead — takes its coefficient as `min(1, rate · dt)`, which at `dt = 0` is exactly 0, so they hold rather than creeping. (`subStepCount` returns its floor of **1** rather than 0, so the loop does run once; it advances by nothing.) The resume test above genuinely cannot see the difference.

What does see it is the audio. A dt-zero pause falls through to the bottom of `update` and calls `setIntensity` a second time on the same frame, so ten paused frames pump the scheduler twenty times — and that is what the pause test measures, counting the entries fed to the bed (ten, all zero) beside the trajectory comparison. The early return is still the right shape, because a freeze defined by *not running* is easier to keep true than one that runs everything against a zero. But the reason to prefer it turned out not to be the physics.
