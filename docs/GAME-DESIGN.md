# it's never just black and white — Game Design Document

Source of truth for gameplay, visuals, and module contracts. Every implementation phase builds against this document. Version 0.2.0.

> This document replaces the Pixel Quest design doc wholesale. The old game (procedural dungeons, co-op, daily challenge, enemies, coins, hearts) is gone; see git history before `d7a54ff` for it.

## 1. Vision & pillars

A minimalist momentum platformer. You are a square. The world is two colours. Press space and both of them — along with gravity — turn inside out.

Four pillars:

1. **Two colours, total commitment.** Paper and ink, nothing else. Colour is rationed so hard that the few places it survives (particles, the vignette, chromatic fringing at speed) read as events rather than decoration. The final level's ending breaks this deliberately — that's the twist, and it only lands because everything before it holds the line.
2. **A body, not a sprite.** The player is a real rigid body: it spins when it jumps, its corners genuinely catch on geometry, and it can land tilted and settle. Nothing is animated — everything you see is the simulation.
3. **Speed you can feel.** The vignette closes in, the screen bounces, colour fringes split at the edges, and the music adds layers. The game gets louder the better you play.
4. **Authored, not generated.** Levels are hand-built in an in-browser editor and stored as readable JSON. Difficulty is a design decision, not a seed.

There is no combat and no score. There is a start, a goal, and the space between them. *(Amended after 0.2: there is now exactly one collectible, the **flip pickup** — see §5. It scores nothing and is not optional decoration; it is the flip's charge as a placeable object, which is what lets a level author say "here, and only here, you get a second one". "No collectibles" was a rule against a coin count, and it stays one.)*

## 2. Visual identity

Internal resolution **960×540** (`VIEW_W`×`VIEW_H`), integer-scaled to the window with letterboxing. Unlike the old build, shapes are drawn **antialiased** — a square that rests at 37° has to have a clean edge. Tiles are **32×32 px** (`TILE`), giving a 30×16.9 tile viewport.

> *(Amended in phase 3 — this originally credited the antialiasing to `imageSmoothingEnabled`.)* That flag is a no-op for `fillRect` and paths, which Canvas 2D antialiases unconditionally; it only affects `drawImage` and pattern scaling. What actually decides the edge is the **coordinate policy**: the camera origin and the bitmap font round to whole pixels, world shapes do not. See ARCHITECTURE.md § Rendering pipeline for the full split.

### Palette

The entire game uses two colours plus three sanctioned exceptions.

| Token | Phase A | Phase B | Usage |
| --- | --- | --- | --- |
| `paper` | `#0A0A0A` | `#F2F2F2` | background, player core |
| `ink` | `#F2F2F2` | `#0A0A0A` | geometry, player body, text, UI |

**The flip swaps which hex each token resolves to.** Nothing in the drawing code branches on phase; it asks for `paper` or `ink` and the palette answers. That is the whole trick, and it must stay that way — a single `if (phase === …)` in a draw call is a bug.

Sanctioned exceptions:

| Exception | Colour | Rule |
| --- | --- | --- |
| Particles | `#4CC9F0` phase A / `#F0A44C` phase B | The only saturated colour on screen. Cool in phase A, warm in phase B — the flip is legible even from a single spark. |
| Vignette | `paper`-toned, deepening toward `ink` as speed rises | Alpha is a function of speed (§7). |
| Chromatic aberration | R/B channel split | Sub-pixel below the threshold, up to `CA_MAX_OFFSET` px at top speed (§7). |

### Reading the player against the world

The player is `ink`-filled — the same colour as the geometry it touches. A **`paper`-coloured inset core** (a smaller concentric square, `PLAYER_CORE_INSET` px in from each edge, rotating with the body) keeps it legible against a wall it's flush with, and doubles as the rotation tell: a plain square gives no visual cue about its angle, but a square with a core does at a glance.

The core is also where the "recharged" state shows: charged reads as a solid core, spent reads as a hollow outline. No HUD icon, no meter.

### Rendering style

- Geometry: flat `ink` rectangles, merged into runs per row so a 40-tile floor is one `fillRect`, not 40. No outlines, no texture, no gradients.
- Jump pads: an `ink` slab with an animated chevron of particles streaming in the pad's direction (§5).
- Goal: an `ink` square outline that pulses in scale, with a slow particle drift toward its centre.
- Bitmap font stays — the 5×7 grid from the old build, drawn as fill-rects, scaled ×2 or ×3. It's the one deliberately low-res element and it earns its place as a signature.

## 3. Modes & flow

```
Title ─┬─▶ Play(campaign i) ─▶ Results ─┬─▶ Play(campaign i+1)
       │        ▲                       └─▶ Level select
       ├─▶ Level select ────────────────────▶ Play(campaign i)
       │        ├── E on an entry ─▶ Editor
       │        └── C, or row 0 ─▶ Custom levels ─┬─▶ Play(custom) ─▶ Results
       │                                          └── E on a row ─▶ Editor
       └─▶ Editor picker ─▶ Editor ⇄ Play(playtest)
```

No co-op, no daily challenge, no seeds, no procedural generation. Progress (furthest level reached, best time per level) persists in `localStorage` under the `bw.` key prefix.

> *(Amended in phase 7, from the shell as built.)* **Why an attempt is being played is explicit, and it decides three things at once.** A campaign run records a best time, advances `bw.progress`, and ends at the results screen; **a playtest writes nothing at all** and returns to the editor instance it came from, edits intact. That is not tidiness: a draft carrying the id of a shipped level would otherwise overwrite that level's best time with a run set on a grid that exists only in someone's browser.
>
> `bw.progress` gates the level select — the unlocked count is `progress + 1`, so a missing or corrupt value unlocks exactly one level rather than none — and it only ever moves forward, because replaying an early level for a better time must not re-lock the rest of the game.
>
> *(Amended after 0.2.)* **A custom level is a third context, and it sits between the other two.** A level off the CUSTOM LEVELS shelf — drawn in the editor, or imported from a file — records a best time under its own `bw.best.<id>` and ends at the results screen, because it is a real run and a time is the point of playing it. But it does **not** touch `bw.progress`: a custom level is not a rung on the campaign ladder, and finishing somebody else's level must never unlock the game. Its id cannot collide with a shipped level's, because the draft shelf refuses a built-in id.
>
> **CUSTOM LEVELS is pinned at row 0 of the level select and bound to `C`.** The built-in list grows with every level this repo ships, and a door to your own work that sinks below the fold as the campaign gets longer is a door that stops being found. The cursor still *opens* on the campaign, so PLAY stays one keypress for somebody mid-campaign; the pinned row is reached, not landed on.
>
> Its row verbs are `Enter` play, **`E` export**, `D` edit, `X` delete. `E` is the one key that means something different from the level select, where it opens a copy in the editor — deliberately, because sharing is what this screen is *for*, and the level select has no export to name. Edit takes `D` rather than losing its key entirely: a custom level is a draft, and the shortest path from "this one plays badly" to "fix it" belongs on the screen you noticed it on.
>
> `Esc` **pauses** rather than quitting. §4's control table has said `Pause / back` since the beginning and nothing implemented it; the scene read `back` and left mid-run, silently discarding the attempt. The pause is a true freeze — the simulation, the timer and the music all stop, and resuming continues the same trajectory bit-identically — with RESUME / RESTART / QUIT over a dimmed frame. Since `back` and `pause` are bound to the same two keys, `PlayScene` reads `pause` and nothing else; a scene reading both would fire twice on one keypress.

## 4. Controls

| Action | Keys |
| --- | --- |
| Move | `A` / `D`, or `←` / `→` |
| Jump | `W`, `↑`, or `Z` |
| **Flip** (invert colours + gravity) | `Space` |
| Restart level | `R` |
| Pause / back | `Esc` or `P` |
| Mute | `M` |
| Fullscreen | `F` |
| Editor (dev) | `E` from the title screen |
| Custom levels | `C` from the level select, or its pinned first row |
| — on that screen | `Enter` play · `E` export · `D` edit · `X` delete |

There is no double jump. The flip is the air move.

## 5. Mechanics

### The flip

Pressing `Space`:

1. Swaps `paper` and `ink` throughout the palette.
2. Negates the gravity direction (`gravitySign`: `+1` down, `−1` up).
3. Zeroes `vy` so the reversal is immediate and predictable, then applies `FLIP_SPIN_KICK` angular velocity in the direction of travel.
4. Spends the charge. **The charge only comes back on ground contact** — meaning contact with a surface whose normal opposes current gravity. Landing on what is now the floor (previously the ceiling) recharges you.

One flip per airtime is therefore the hard rule, and level design is built around it: every gap is either a jump, a flip, or a jump-then-flip.

> *(Amended in phase 5 — three consequences of the charge that the list above leaves open.)*
>
> **The palette is downstream of the charge check.** `Player.update` decides whether the flip fired and returns `PlayerEvents { flipped, died }`; `PlayScene` is what turns `flipped` into `palette.flip()`. A refused flip that still inverted every colour in the world would be the most confusing bug this game could ship, because the palette is the only readout of gravity there is. It also keeps the palette singleton off the player's logic path, so a headless test cannot recolour the world by stepping a body.
>
> **A refused flip changes nothing at all.** Not merely "does not invert" — `gravitySign`, `vy` and `angVel` all come through untouched, because the failure mode that matters is a *partly* applied flip.
>
> **There is no flip buffer, and that is deliberate.** `JUMP_BUFFER` exists because a jump pressed just before landing is unambiguous: you want to leave the ground the instant you touch it. A *flip* buffer would mean "flip as soon as I can", and the moment the flip becomes possible is the moment you land — so it would fire you off the floor you just fought to reach. The cost is one frame of strictness: the flip is consumed before the physics step and the recharge is read from its result, so a flip pressed on the exact landing frame is refused and has to be pressed again 16.7 ms later.

### The flip pickup

*(Added after 0.2.)* A cell holding `o` is a **flip recharge**: touch it and the flip comes back, wherever you are and whatever you are doing. It is the flip's charge as a thing an author can place, and it exists because the charge had exactly two sources — the ground and, since 0.2, a pad — and both of them are *surfaces*. A level whose whole idea is a long airborne line had no way to say "here, you get a second one".

Three rules, and each is the thing that keeps it from being a pad with a different shape:

- **No collision, at all.** It is not a tile and nothing in the solver knows it exists; collection is a radius test (`PICKUP_RADIUS`, centre to centre, sized against what is drawn rather than against the grid) run after the step, and the trajectory through one is bit-identical to the trajectory through empty air. A pickup that pushed, stopped or even slowed you would be a pad.
- **It respawns after `PICKUP_RESPAWN` = 3 s.** Long enough that standing on one and flipping every frame cannot farm it — which would make the flip free, and the flip's cost is most of the game — and short enough that a line rehearsed after a death never waits on it. While it is spent it draws as a faint outline rather than vanishing, because a player who has just used one needs to know where it will come back.
- **It is spent only when it gives something back.** Running one over with the flip already in hand leaves it standing, so a line can be run in either order without the pickup silently disarming itself for the way back.

It draws as the player's own charge tell rotated 45°: an `ink` diamond with a `paper` core. The thing you collect looks like the thing it gives you, and a player who has learned to read a solid core as "you may flip" needs no second lesson.

### Jumping and rotation

Jump applies `JUMP_VELOCITY` against gravity **and** an angular impulse — `JUMP_SPIN_BASE` plus a term proportional to horizontal speed, signed by travel direction so the square appears to roll forward. Accounting for air damping, a standing jump turns the square ≈ 73° and a full-speed jump ≈ 178°, so a fast jump lands on the opposite face.

Coyote time (`COYOTE_TIME`), jump buffering (`JUMP_BUFFER`), and jump cut (releasing mid-rise multiplies `vy` by `JUMP_CUT_FACTOR` once) all carry over from the old build. They're what keep a physics body feeling like a platformer.

### Rotation, control, and settling

Linear motion is **arcade**: left/right set horizontal velocity through acceleration and friction, exactly as a normal platformer does. Angular motion is **simulated**: real angular velocity, real torque from off-centre impacts, real damping.

This split is deliberate and load-bearing. Spin is dramatic and physical; it never takes the controls away from you. You have full movement authority at any angle.

When grounded, a soft restoring torque pulls the square toward the nearest multiple of 90° (visually identical for a square, so it's always the short way round) and settles it in roughly 0.3 s. Tilted landings happen, read as physical, and resolve themselves. Details and equations in [PHYSICS.md](PHYSICS.md).

### Corner collision

The player is an **oriented** box, tested against tiles with SAT. Corners are real: they catch ledges, wedge into gaps, and push the body back out with an impulse that spins it.

The square is `PLAYER_SIZE` = 20 px against a 32 px tile. Its diagonal is 20√2 ≈ 28.3 px, so a one-tile corridor leaves **3.7 px of clearance at the worst angle** — it fits at any rotation, but tightly enough that corners scrape constantly on the way through. That tension, always possible and never comfortable, is the core sensation of moving through this game.

The hard ceiling is `PLAYER_SIZE ≤ TILE/√2 = 22.6`. Above it, one-tile gaps become angle-dependent — a spinning entry would sometimes wedge and sometimes pass, which reads as a bug however physically honest it is. 20 leaves deliberate headroom below that cliff; raising it invalidates every level.

### Jump pads

A tile that applies a fixed impulse in its facing direction (`up`, `down`, `left`, `right`) when the player contacts it. Pads:

- Override the relevant velocity component rather than adding to it, so a pad's launch height is predictable regardless of approach speed.
- Emit a continuous animated particle chevron in their direction (the pad's idle state), plus a burst on trigger.
- **Recharge the flip on contact** *(revised after 0.2 playtesting; phase 5 shipped the opposite)*. Spending a whole pad chain with the flip unavailable took the game's other verb away from its most interesting line — and "a pad chain is a commitment" turned out to mean "a pad chain is a corridor". Touching a pad hands the flip straight back, so a chain is a chain of choices.
- Impart angular velocity proportional to how off-centre the contact was — hitting a pad with a corner sends you spinning.
- **Debounce, per pad, for `PAD_DEBOUNCE` = 0.25 s** *(added after 0.2, with the side-firing above)*. Once every face but the back launches, a pad can hold a body against a launching face indefinitely: stand on a right-facing pad with a wall one tile away and its own launch drives you into the wall and straight back onto it. Measured at **38 firings per second** — a buzz, a pinned body, and 38 doses of spin — against **4** with the window.

> *(Amended in phase 5.)* **A pad is a tile, not a trigger volume.** The off-centre torque above needs a real contact *point*, and §2 draws a pad as an `ink` slab, so the solver collides with pads exactly as it does with solid. Two consequences:
>
> - *(Revised twice after 0.2 playtesting.)* **Every face but the back launches.** "Fires on any contact" was kept in phase 5 on the grounds that a pad set into geometry has its buried faces masked as interior, so the case mostly cannot arise — but where it does, on a free-standing slab, it reads as the pad having no collision at all: a body landing on the back of a down-pad was fired straight down through the slab that had just caught it. The first revision excluded the sides along with the back, and that was an over-correction in the other direction — walking into the edge of a free-standing pad and simply *stopping* reads as a pad that is broken. So the test is on the back alone (`PAD_BACK_DOT`): the back is plain platform, and the face and both sides fire. **A side hit fires along the pad's own facing, not along the contact normal** — a pad has one direction, and that is the thing an author placed.
> - Because landing on a pad is a ground-*normal* contact, the recharge rule cannot be expressed through `grounded` in either of its versions. Contacts carry tile identity instead; see [PHYSICS.md](PHYSICS.md) § Grounded. The rules now read off different halves of that: a **solid** recharges only from a ground-normal contact, a **pad** from any contact at all — so the two bits the solver reports are still both needed.
>
> **The debounce is per PAD, not per player**, and that is the whole of it. A player-wide cooldown is one field and fixes the buzz just as well — and it breaks a pad chain, which is two pads a sixth of a second apart and the most interesting line in the game. So the window belongs to the tile: two different pads a step apart both fire, and the same pad twice in a step does not. `Contact` therefore carries `padTx` / `padTy` beside `pad`, because the kind cannot tell two up-pads apart; they come off the same manifold and cost two stores, since the broadphase has the coordinates in hand when it pools the tile.
>
> 0.25 s is fifteen steps: an order of magnitude above the 0.0167 s of a scrape, and well under the shortest genuine return to the same pad, which is that pad's own airtime — 0.667 s for an up-pad at `PAD_IMPULSE`. No line an author can draw is shortened by it.
>
> The spin needs its own scale (`PAD_SPIN_MAX`) because the physical impulse form saturates at five times `MAX_ANG_SPEED`, and the arm is `r × facing` measured from the **body's** centre — the facing, not the contact normal, since the two only agree on a face hit — see PHYSICS.md § Game feel for both, and for why the controller's horizontal clamp had to become one-sided before sideways pads could exist at all.

### Hazards & death

The only hazard is leaving the world vertically. Left and right map edges read as solid; above the top row and below the bottom row are lethal, and with gravity flipping, both directions matter equally.

Death → `DEATH_FADE_OUT` fade, respawn at the level's spawn point with gravity reset to phase A and the flip recharged, `DEATH_FADE_IN` fade back. No lives, no penalty, no checkpoint. Restart is instant enough that failure isn't a punishment.

## 6. Tuning constants

All live in `src/constants.ts` with units in comments. Values below are the design targets; the physics phase tunes within them and `tests/physics.test.ts` asserts the derived properties, so retuning that breaks level geometry fails CI instead of shipping.

### Linear

| Constant | Value | Meaning |
| --- | --- | --- |
| `TILE` | 32 px | tile size |
| `PLAYER_SIZE` | 20 px | square edge; diagonal 28.3 px in a 32 px gap |
| `RUN_SPEED` | 256 px/s | 8 tiles/s |
| `GROUND_ACCEL` / `AIR_ACCEL` | 2100 / 1300 px/s² | full speed in ~0.12 s; ~62 % air control |
| `GROUND_FRICTION` | 3600 px/s² | stop from full speed in ~0.07 s |
| `JUMP_VELOCITY` | 700 px/s | against gravity |
| `GRAVITY_RISE` / `GRAVITY_FALL` | 2200 / 3520 px/s² | 1.6× heavier descending |
| `MAX_FALL_SPEED` | 768 px/s | 24 tiles/s terminal |
| `COYOTE_TIME` | 0.09 s | grace after leaving a ledge |
| `JUMP_BUFFER` | 0.12 s | early press honoured on landing |
| `JUMP_CUT_FACTOR` | 0.45 | release mid-rise, once |
| `MAX_SUBSTEP` | 8 px | anti-tunnelling sub-step cap |
| `PLAYER_CORE_INSET` | 5 px | inset of the paper core from each edge of the body (§2) |

Derived, and asserted by tests:

- **Jump peak** = v²/2g = 700²/4400 ≈ 111.4 px ≈ **3.48 tiles**.
- **Rise time** ≈ 0.318 s; fall from peak ≈ 0.252 s; **airtime ≈ 0.570 s**.
- **Full-speed jump clearance** ≈ 0.570 × 256 ≈ 146 px ≈ **4.56 tiles**. Levels may use 4-tile gaps; 5 requires a flip or a pad.

### Angular

| Constant | Value | Meaning |
| --- | --- | --- |
| `PLAYER_INERTIA` | 66.7 | moment of inertia of a square about its centre; **derived** as `inertiaOfSquare(PLAYER_SIZE)` = s²/6 at unit mass, never typed in |
| `GROUND_NORMAL_DOT` | 0.7 | contact normal within ≈45° of up counts as ground |
| `JUMP_SPIN_BASE` | 2.5 rad/s | spin imparted by a standing jump |
| `JUMP_SPIN_PER_SPEED` | 0.014 rad/s per px/s | added spin scaled by |vx| |
| `FLIP_SPIN_KICK` | 3.0 rad/s | spin imparted by a flip |
| `MAX_ANG_SPEED` | 14 rad/s | clamp |
| `ANG_DAMP_AIR` | 0.4 /s | light exponential damping in flight |
| `ANG_DAMP_GROUND` | 8 /s | strong damping once supported |
| `RIGHT_STIFFNESS` | 240 rad/s² | restoring spring toward nearest 90° |
| `RIGHT_DAMPING` | 31 /s | ≈ 2√k, critically damped, settles in ~0.26 s |
| `SPIN_TRANSFER` | 0.6 | fraction of collision torque actually applied |
| `RESTITUTION` | 0.0 | no bounce; impacts spin you, they don't launch you |

> *(Amended in phase 4.)* `RIGHT_DAMPING` = 31 is critically damped in continuous time, but the discrete scheme settles to 2 % in **0.43 s**, not the 0.26 s quoted above — see [PHYSICS.md](PHYSICS.md) § Rotational damping. It reads as square (5 % of a tilt) at 0.35 s, so the "~0.3 s soft auto-right" holds perceptually; the 2 % figure did not survive discretisation.

### Solver internals

Added in phase 4. These are not feel knobs — each one is the answer to a specific failure, documented in [PHYSICS.md](PHYSICS.md).

| Constant | Value | Meaning |
| --- | --- | --- |
| `CONTACT_SLOP` | 0.01 px | residual penetration left by positional correction; makes rest a fixed point |
| `CONTACT_TOL` | 0.25 px | depth band within which contact candidates tie and merge to their centroid (a ±0.72° tie band at `PLAYER_SIZE`) |
| `CLIP_TOL` | `GRAVITY_FALL·STEP² + CONTACT_SLOP` ≈ 0.99 px | tangential slack when clipping candidates to the incident face — two steps of a resting body's sink |
| `MAX_CONTACT_ITERS` | 4 | resolution passes per sub-step; one per tile-axis normal |
| `IMPACT_SPEED_MIN` | `2·GRAVITY_FALL·STEP` = 117.3 px/s | approach speed separating a genuine impact from resting or scraping |
| `ANG_SETTLE_EPS` | 0.002 rad | angle error under which a grounded, near-still body snaps square (a corner moves 0.028 px) |
| `ANG_SETTLE_VEL` | 0.05 rad/s | angular speed under which that snap is allowed |

### Feel & effects

| Constant | Value | Meaning |
| --- | --- | --- |
| `SPEED_REF` | 320 px/s | speed that normalises to 1.0 for all effects |
| `SPEED_SMOOTH_RATE` | 6 /s | exponential lag on `speedNorm`, so one frame of contact can't strobe |
| `CA_THRESHOLD` | 0.45 | normalised speed where aberration becomes visible |
| `CA_MAX_OFFSET` | 3.0 px | channel split at normalised speed 1 |
| `VIGNETTE_MIN` / `VIGNETTE_MAX` | 0.15 / 0.55 | alpha at rest / at full speed |
| `VIGNETTE_INNER` | 0.45 | fraction of the radius left fully clear at the centre |
| `VIGNETTE_TINT_MAX` | 0.22 | peak alpha of the ink tint over the vignette |
| `SPEED_WINDUP_MIN` | 0.5 | normalised speed at or above which the wind-up bank fills |
| `SPEED_WINDUP_DELAY` | 2.0 s | banked speed before any effect is non-zero |
| `SPEED_WINDUP_RAMP` | 3.0 s | from the gate opening to full strength |
| `SPEED_WINDUP_FILL_BIAS` | 1.0 × | fill rate at full speed; 1× at the threshold, linear between |
| `SPEED_WINDUP_DRAIN_DELAY` | 0.0 s | grace below the threshold before the bank drains at all |
| `SPEED_WINDUP_DRAIN_RATE` | 1.0 × | drain rate once that grace is spent |
| `PAD_BACK_DOT` | 0.7 | how square-on a contact must be to count as a pad's non-launching **back** (every other face fires) |
| `BOUNCE_AMP` | 2.5 px | screen bounce amplitude at full speed |
| `BOUNCE_FREQ` | 9.0 rad/s | bounce frequency at full speed |
| `PAD_IMPULSE` | 820 px/s | jump pad launch velocity |
| `DEATH_FADE_OUT` / `DEATH_FADE_IN` | 0.35 / 0.25 s | respawn timing |
| `PICKUP_RESPAWN` | 3.0 s | how long a collected flip pickup stays gone |
| `PICKUP_RADIUS` | 20 px | collection distance, centre to centre — a radius, so it is rotation-independent, and sized so it fires while the two sprites visibly overlap (they touch at 21.3) |
| `PICKUP_SIZE` | 16 px | the diamond's side |
| `PICKUP_CORE_FRACTION` | 0.5 | its `paper` core, the player's own fraction: (`PLAYER_SIZE` − 2·`PLAYER_CORE_INSET`) / `PLAYER_SIZE` |
| `PICKUP_OUTLINE_WIDTH` | 2 px | stroke of the afterimage |
| `PICKUP_SPENT_ALPHA` | 0.25 | the afterimage left where a spent one will return |
| `PAD_DEBOUNCE` | 0.25 s | how long ONE pad waits before it may fire again; per pad, so a chain is untouched |
| `PAD_SPIN_MAX` | 8.0 rad/s | spin at a full-corner pad contact, scaled by the arm and clamped (added in phase 5; the physical impulse form saturates — see PHYSICS.md § Game feel) |

### Presentation

Added in phase 5. Cosmetic, but real tuning numbers, so they live in `constants.ts` like everything else. The last three are **shell-scoped**: phase 7's `ResultsScene` takes `GOAL_HOLD` with it.

| Constant | Value | Meaning |
| --- | --- | --- |
| `CORE_OUTLINE_WIDTH` | 2 px | stroke of the paper core when the flip is spent. The core is 10 px square, so a 1 px outline is unreadable at speed; at 2 the hollow reads as a 64 px window in an 80 px ring |
| `PAD_CHEVRON_LEN` / `PAD_CHEVRON_WIDTH` | 14 / 5 px | the two `paper` bars drawn at ±135° from a pad's facing. The arms sit at 45°, so a 3 px bar antialiases almost entirely into mid-grey and reads as a smudge rather than an arrow |
| `GOAL_OUTLINE_WIDTH` | 2 px | stroke of the goal's pulsing ink outline |
| `GOAL_PULSE_AMP` / `GOAL_PULSE_FREQ` | 0.12 / 3.0 rad/s | scale pulse of that outline |
| `GOAL_HOLD` | 1.2 s | how long the frozen winning frame holds before the results screen |
| `PAUSE_DIM` | 0.6 | alpha of the `paper` veil under the pause overlay |

> *(Amended in phase 7.)* `GOAL_HOLD` was "how long the completion readout holds before the level advances". The readout moved to `ResultsScene` and the constant did **not** go with it: it is the punctuation on the frame the player just earned, and it belongs to the scene that froze it. `ResultsScene` owns no clock at all.
>
> `PAUSE_DIM` is `paper`, not `ink`, and the distinction is the whole of the two-colour rule working. Ink is near-white in phase A, so an ink "dim" washes a black frame to grey and leaves the white geometry indistinguishable from it — measured on the first build, and it looked exactly as bad as that sounds. The veil is the background flooding back in, and the menu then reads in `ink` like text on every other screen. The death fade is `ink` for the opposite reason, already recorded above: fading toward the background is what the vignette does, so a death dimmed that way reads as a speed effect rather than as dying.

### Editor

Added in phase 7. Every number here is about being able to **see** what you are building.

| Constant | Value | Meaning |
| --- | --- | --- |
| `EDITOR_ZOOM_STEPS` | 1, ½ | the two zoom steps, and there are deliberately only two |
| `EDITOR_PAN_SPEED` | 640 px/s | keyboard pan = 20 tiles/s, crossing the frame in 1.5 s |
| `EDITOR_GRID_ALPHA` | 0.15 | the cell grid overlay: visible over paper, invisible over ink |
| `EDITOR_UNDO_MAX` | 64 | undo depth, in **strokes** — not cells |
| `EDITOR_DEFAULT_W` / `_H` | 40 / 20 | a blank grid, small enough to see whole at half zoom |
| `EDITOR_MAX_W` / `_H` | 200 / 60 | the size cap |

**Half zoom is exactly one screen per sixty tiles**: 60 × 32 × ½ = 960 = `VIEW_W`, and the example stage is 60 wide. That is why there are two steps and not a continuous zoom — a fractional scale buys nothing over "the whole level, or life size" and costs a wheel path in `Input`, fractional tile geometry, and seams between adjacent cells at every non-integer scale, which is the exact problem the coordinate policy exists to avoid. Both steps are whole-pixel cells: 32 and 16.

The size cap is not a memory argument. 200 tiles is 6400 px — 6.7 screens at 1× and 3.3 at ½ — and a level you cannot see a third of is one the tool has stopped helping with. (For the record, memory is not close to being the constraint: an undo snapshot is one character per cell, so 64 of them is ~154 KB at 60×20 and ~1.5 MB at the cap.)

### Music and SFX

Added in phase 6. The gates moved here out of §7's prose; the grid values are **derived** from `MUSIC_BPM` rather than typed in, for the same reason `PLAYER_INERTIA` is.

| Constant | Value | Meaning |
| --- | --- | --- |
| `MUSIC_BPM` | 128 | tempo; a beat is 0.46875 s |
| `MUSIC_SIXTEENTH` | **derived** = 0.1171875 s | the scheduling grid — 7.03 frames, deliberately not a whole number |
| `MUSIC_BAR_STEPS` / `MUSIC_PATTERN_STEPS` | 16 / 32 | sixteenths per bar; the whole pattern is two bars, because the arp ascends over two |
| `MUSIC_BAR` | **derived** = 1.875 s | 112.5 frames. The music runs on the audio clock and the simulation on `STEP`; the two are unrelated on purpose |
| `MUSIC_FADE` | 0.35 s | layer cross-fade. One frame may move a gain by at most `STEP / MUSIC_FADE` = 0.0476 |
| `MUSIC_LOOKAHEAD` | 0.1 s | scheduling window = 6 frames. `FixedStepper.maxFrame` is 2.5x it, which is what forces the cursor's resync (§9) |
| `MUSIC_GATE_HATS` / `_BASS` / `_ARP` | 0.25 / 0.45 / 0.70 | strictly greater-than; the kick is always |
| `MUSIC_GATE_EPS` | 0.01 | gain below which a layer allocates no nodes at all |
| `MUSIC_GAIN_MIN` / `_MAX` | 0.10 / 0.34 | master music gain across the range |
| `SFX_DELAY_TIME` | 0.18 s | the shared feedback-delay send |
| `SFX_DELAY_FEEDBACK` / `_MAX` | 0.35 / 0.55 | feedback at rest and at full speed (§7's "rises slightly") |
| `SFX_DELAY_LOWPASS` | 2000 Hz | inside the feedback loop, so repeats darken rather than merely quieten |
| `STEP_SFX_DIST` | 24 px | ground distance between footfalls. A DISTANCE, so the cadence scales with speed for free and a body pinned against a wall makes no sound at all. At `RUN_SPEED` it lands exactly five to the beat |

### Particles

Added in phase 6. Every emitter is gravity-relative or normal-relative; nothing here is expressed against -y.

| Constant | Value | Meaning |
| --- | --- | --- |
| `PARTICLE_SIZE` | 2 px | spark edge |
| `SPARK_GRAVITY` / `SPARK_DRAG` | 260 px/s² / 3 /s | signed at spawn by `gravitySign` |
| `SPARK_SPREAD` | 0.38π rad | half-angle of the cone for dust, bursts and splashes |
| `DUST_COUNT` | 2 | sparks per footfall, with `DUST_SPEED_MIN`/`_MAX` 20/70 px/s and `DUST_LIFE` 0.3 s |
| `JUMP_BURST_COUNT` | 8 | the burst under a jump, and under a pad hit; `BURST_SPEED_MIN`/`_MAX` 60/170 px/s, `BURST_LIFE` 0.35 s |
| `SPLASH_COUNT_MIN` / `_MAX` | 2 / 20 | the landing splash, ramped from `IMPACT_SPEED_MIN` to `MAX_FALL_SPEED`; `SPLASH_SPEED_MIN`/`_MAX` 40/220 px/s, `SPLASH_LIFE` 0.4 s |
| `FLIP_RING_COUNT` | 20 | the flip's ring, at `FLIP_RING_SPEED` 150 px/s for `FLIP_RING_LIFE` 0.4 s. Angles are placed **by index, never by `Rng`** — a randomly-angled ring is a puff |
| `PAD_STREAM_INTERVAL` / `_SPEED` / `_LIFE` | 0.07 s / 90 px/s / 0.45 s | the pads' idle stream: 40.5 px = 1.27 tiles of travel, 6.4 alive per pad |
| `PAD_STREAM_SPREAD` | 0.25 rad | narrow, so the stream reads as an arrow |
| `PARTICLE_CULL_MARGIN` | 64 px | how far outside the view a pad still streams |

### Camera

| Constant | Value | Meaning |
| --- | --- | --- |
| `CAMERA_FOLLOW_RATE` | 8 /s | exponential follow rate; higher is tighter |
| `LOOKAHEAD_TIME` | 0.35 s | the view leads the player by `vx ×` this |
| `LOOKAHEAD_MAX` | 96 px | cap on the lead — a safety limit for pad launches, not a normal operating point (flat-out running reaches 89.6 px) |
| `LOOKAHEAD_RATE` | 3 /s | smoothing on the lead itself, deliberately slower than the follow so a direction reversal slides instead of whipping |
| `CAMERA_VSLACK` | 64 px | permitted vertical overshoot past the map edge, so the frame before an out-of-bounds death stays legible |

## 7. Speed-driven effects

One number drives all of them. `speedNorm = clamp(|v| / SPEED_REF, 0, 1) · windupGate`, smoothed with a short exponential lag so a single frame of contact doesn't flicker the whole screen.

*(Revised after 0.2 playtesting.)* **The effects are earned over time, not bought by one fast frame.** The scene banks seconds spent at or above `SPEED_WINDUP_MIN`; `windupGate` is exactly 0 until `SPEED_WINDUP_DELAY` of that bank and climbs linearly to 1 over the following `SPEED_WINDUP_RAMP`.

Filling and draining are shaped separately, because they answer separate questions. **Filling** is scaled by how far over the threshold you are: 1× at the threshold itself, `SPEED_WINDUP_FILL_BIAS` at full speed, linear between — so above 1 a flat-out run is worth more than a jog over the line, and below 1 it is worth less. **Draining** first has to outlast `SPEED_WINDUP_DRAIN_DELAY`, the grace that makes a landing, a wall bump or a moment of air cost nothing at all, and then runs at `SPEED_WINDUP_DRAIN_RATE` (0 banks permanently for the attempt). All three ship neutral, reproducing the flat symmetric bank exactly. Speed is cheap here — every pad chain buys a second of it — so gating on *duration* is what separates a fast moment, which stays clean, from a sustained run, which is the thing worth escalating for.

The three numbers are authored by feel, in the browser: `?tune=1` mounts the wind-up tuner (ARCHITECTURE.md § Dev tooling), which drives `engine/tuning.ts` live and emits the `constants.ts` lines to make a session permanent.

| Effect | Response |
| --- | --- |
| Vignette | alpha lerps `VIGNETTE_MIN → VIGNETTE_MAX`; an `ink` tint fades in over the top half of the range, peaking at `VIGNETTE_TINT_MAX`. Ink, not accent: accent is the particles' colour alone (§2), so speed deepens the frame rather than staining it |
| Chromatic aberration | zero below `CA_THRESHOLD`, then ramps to `CA_MAX_OFFSET` px |
| Screen bounce | vertical camera offset `sin(phase) · BOUNCE_AMP · speedNorm`, where `phase += BOUNCE_FREQ · speedNorm · dt` |
| Music | layer gates at `MUSIC_GATE_HATS` / `_BASS` / `_ARP`; master gain ramps `MUSIC_GAIN_MIN → MUSIC_GAIN_MAX` across the range |
| Movement SFX | step rate scales with speed; delay feedback rises slightly |

> **The bounce integrates its phase; it cannot read absolute time.** *(Amended in phase 3 — the original spec here read `sin(t · BOUNCE_FREQ · speedNorm)`.)* With absolute `t`, a small change in `speedNorm` moves the sine argument by `t · BOUNCE_FREQ · Δn`: at t = 100 s a 0.01 speed change jumps the phase by 9 radians and the screen snaps. Frequency modulation has to be applied to the phase, not to the argument. The bug is invisible in a ten-second play session and glaring in a three-minute one, so `tests/camera.test.ts` guards it directly.

> *(Amended in phase 6.)* The gates were prose here (0.0 / 0.25 / 0.45 / 0.70) and are now tuning numbers in `constants.ts` with the rest. Two properties of them are worth stating because they are asserted rather than assumed: they are **strictly** greater-than, so hats are silent *at* 0.25 and audible at 0.2501; and a gate is a **target gain, not a switch**. Gating at scheduling time cannot cross-fade however the gain node behaves afterwards, because a note carries the gain it was scheduled with up to `MUSIC_LOOKAHEAD` before it sounds — so each layer owns a `GainNode` approached at `MUSIC_FADE`, and scheduling merely skips layers already below `MUSIC_GATE_EPS`. Since `speedNorm` is smoothed at `SPEED_SMOOTH_RATE` already, hovering on a boundary gives a slow swell rather than a flutter, and no hysteresis is needed on top.

`speedNorm` normalises the **full velocity magnitude**, so terminal fall (`MAX_FALL_SPEED`) saturates it and flat-out running (`RUN_SPEED / SPEED_REF` = 0.8) deliberately does not. The effects still have somewhere left to go when you stop merely running and start actually moving.

Because they share an input, they arrive together — the game visibly and audibly "opens up" as you get fast, and closes back down when you stall.

## 8. Level format

One JSON file per level in `src/levels/`, imported directly (Vite handles JSON natively — no loader, no new dependency).

```json
{
  "id": "01-first-steps",
  "name": "FIRST STEPS",
  "rows": [
    "................................",
    "..S..........^..............G...",
    "################....############"
  ]
}
```

`rows` is the whole level: a rectangular grid of characters, one string per row. Width and height are derived from it and validated on load (all rows equal length, exactly one `S`, exactly one `G`). `S`, `G` and `o` are **metadata on an empty cell**, not tile values: the tile enum stays six long, because nothing collides with any of the three and an `isBlocking` with an exception in it is a physics change made to add a thing that has no physics.

| Char | Meaning |
| --- | --- |
| `.` | empty |
| `#` | solid |
| `S` | spawn (empty tile; exactly one) |
| `G` | goal (empty tile; exactly one) |
| `^` `v` `<` `>` | jump pad, facing up / down / left / right |
| `o` | flip recharge pickup (empty tile; any number, including none) |

Chosen because it diffs cleanly in git, reads as a picture in any editor, and round-trips through the browser editor without a serialiser. Level order lives in `src/levels/index.ts`.

Bounds behaviour: out-of-bounds reads are **solid** to the left and right, **empty** above and below — so the sides seal the level and the top and bottom kill.

### The example stage

`01-first-steps` ships with phase 5 and exercises every feature: a flat run to build speed, a 3-tile gap (plain jump), a ceiling section that requires a flip to cross, an up-pad, a one-tile corridor, and a goal placed so the final approach is a flip landing on the ceiling.

> *(Amended in phase 5, from the grid as built.)* Three numbers here did not survive contact with the derived ones.
>
> **It is 60 × 20 tiles, not "a screen and a bit".** Two screens wide. The beats are sized from the tuning constants — a 3-tile gap needs 4.56 tiles of clearance behind it, the chasm has to be 6 so a jump cannot cheat it, the pad's plateau needs 3 tiles of run-up and 4 of landing — and they do not fit in 48.
>
> **The pad section is a 4-tile rise, not a 5-tile one.** An up-pad peaks at 152.8 px = 4.78 tiles, so it cannot clear a 5-tile step; 4 is the largest rise it answers, and the plain jump's 3.48 tiles cannot. (5 tiles remains the smallest *gap* that requires a pad, which is the number the pad's 5.34-tile horizontal reach is measured against.)
>
> **A one-tile corridor entered on the ground always fits, at any angle.** The worst case is 45°, where the vertical extent is the 28.3 px diagonal and 3.7 px of clearance remain — so the corridor scrapes but can never wedge a grounded body. Its tension is real and its danger is not; a corridor that genuinely tests you has to be entered *airborne*, at the end of a launch rather than after a landing. This one is placed after the pad's landing, so it teaches the shape rather than punishing it — appropriate for the first level, and a note for later ones.

## 9. Audio

Fully synthesised WebAudio, no assets, node-safe import.

**SFX** run through a shared feedback-delay send (delay ~0.18 s, feedback ~0.35, lowpass ~2 kHz) for the echoey character: `step`, `jump`, `land`, `flip`, `pad`, `pickup`, `goal`, `death`, `menuMove`, `menuPick`. `pickup` is deliberately the goal's shape at a third of its length and none of its weight — collecting one is a small good thing that happens mid-line, and the level's one arrival has to stay the only sound that resolves. Sources are short filtered noise bursts and sine/triangle blips with fast envelopes — no square-wave chiptune, that's the old game.

**Music** is a synthesised techno bed at `MUSIC_BPM` = 128, built from four layers gated by `speedNorm` (§7): kick (always), hats, bass, arp lead. Scheduled with a lookahead scheduler against `AudioContext.currentTime`, not `setInterval` drift. Layers cross-fade over `MUSIC_FADE` rather than hard-switching.

Mute on `M`, persisted at `bw.muted`. The AudioContext is created lazily on first gesture and every access is guarded so the module imports cleanly under node.

> *(Amended in phase 6, from the module as built.)* Four things the paragraphs above leave open, each of which turned out to decide whether the bed works at all.
>
> **A stalled scheduler resyncs; it does not catch up.** The textbook lookahead loop is correct only while it is pumped faster than it advances, and it is pumped from the frame loop — where `FixedStepper.maxFrame` is 250 ms against a 100 ms window. A backgrounded tab, a long GC or a suspended context leaves the cursor arbitrarily far in the past, and the loop then schedules every missed note with a start time already elapsed; WebAudio fires those immediately and simultaneously. The cursor therefore snaps forward to the next sixteenth at or after `now` and drops what was missed. Every pattern is bar-periodic, so the downbeat stays aligned and the resync is inaudible beyond the gap itself. Measured in the browser: a 17.2 s stall is 146.5 missed sixteenths, which the naive loop would have dumped into one instant and the cursor answers with three notes, all in the future.
>
> **The bed is scene-scoped.** `PlayScene` starts it on `enter` and stops it on `exit`; the title screen stays silent but for its menu blips, because a techno bed under a motionless title screen spends the escalation before the player has done anything to earn it. `setIntensity` is both the target-setter and the pump — called once per frame with the live `speedNorm`, which is exactly the cadence a lookahead scheduler wants, so there is no `setInterval` to outlive the scene and no second `update(dt)` beside it.
>
> **Death and the goal are punctuated by the bed dropping out.** Intensity is fed **0** in `dying` and `won` rather than `speedNorm` — the body keeps simulating through the death fade (§5), so the un-ducked version has the music swell as the corpse accelerates out of shot. Measured at 0.875 before the duck was added.
>
> **`muted` is an accessor, not a flag read at play time.** With a running scheduler, muting has to duck the master gain and stop scheduling, and unmuting has to resync onto the grid — which is the same path as the stall, for free.
>
> **The one clock rule.** The scheduler reads a wall clock, which is legitimate for the same reason `dateIso` is legitimate on the persistence path: it is not a logic path. The corollary is absolute, and lives on the module: **nothing in the simulation may ever read the music clock.** Syncing a jump to the beat would break determinism outright.

## 10. Level editor

An in-browser scene (`E` from the title or from a level-select row, the title's EDITOR menu item, or `?editor=1`), not a separate app.

**It opens on a picker, not on a level** *(added after 0.2)*. `E`, the menu item and `?editor=1` all land on `EditorSelectScene`: `+ NEW LEVEL`, `+ IMPORT A LEVEL`, then every work-in-progress draft, then every shipped level marked `BUILT-IN - OPENS AS A COPY`. `Enter` opens a row, `X` deletes a draft after a `Y`/`N` prompt, `Esc` goes back to the title. The reason is the draft shelf below: once there can be more than one level in progress, "the editor" is no longer one level, and opening whichever one was touched last is wrong most of the time.

| Input | Verb |
| --- | --- |
| `B` `X` `V` | brush / rectangle / select tool |
| left-drag | brush: paint · rect: fill the rectangle · select: mark out a region, or drag one you already marked |
| right-drag | brush and rect: erase (paint `.`) · select: drop the selection |
| `Shift`+click | flood-fill the connected region of equal character (4-connected); brush tool only |
| middle-drag, `Space`-drag, arrows | pan |
| `1`–`9` | select `. # ^ v < > o S G` |
| `+` `-` | zoom one rung in / out (also `Numpad +` / `Numpad -`) |
| `H` or `?` | the CONTROLS AND TOOLS panel; the bar has a button for it too |
| `Ctrl+Z` / `Ctrl+Y` | undo / redo |
| `[` `]` `,` `.` | shrink / grow an edge (with `Shift` for the opposite edge) |
| `R` | set the size outright — type `W X H` |
| `N` | edit the id, then the name |
| `Enter` | playtest in place |
| `Ctrl+S` | export the `.json` to your downloads |
| `Esc` | cancel the drag, then drop the selection, then back to the picker |

**The editor edits characters, not tiles, and `world/level.ts` is therefore its entire format layer.** The obvious model is a `TileMap` with a spawn and a goal beside it; it is wrong, and the reason is `S` and `G` — they are metadata on an empty cell in a `Level`, but they are *paintable cells* in an editor, and a `TileMap` cannot hold them. Modelling the grid as `readonly string[]` — §8's own on-disk shape — makes validation `validateLevel(rows)` verbatim, saving `JSON.stringify({ id, name, rows })` byte-identical to `serializeLevel`, playtesting `parseLevel` handing the **real** `PlayScene` a **real** `Level`, and a resize from the left or the top carries the spawn and the goal along for free because they are characters in the rows being shifted. Under a coordinates-beside-the-map model those are two pairs to fix up at every edge, and the one that gets forgotten is the one nobody notices until a level spawns you inside a wall.

The palette is **nine** characters, not the "1–7" this section used to say: `. # ^ v < > o S G`, which is §8's table plus the pickup and the two markers. Six is the tile enum and nine is what an author paints; seven was neither. The pickup is ordinary in every way the editor cares about — no singleton rule, painted, filled, moved and erased like a wall — which is the payoff of the grid being characters rather than tiles.

Two edits the model makes **unrepresentable**, which is worth more than any validation panel: painting `S` *moves* the spawn rather than adding a second one (same for `G`, and neither can be erased — only relocated), and a rectangular array of equal-length rows cannot go ragged. Between those and a fixed palette, every error `validateLevel` can report is unreachable from the editor except one — a resize that crops the spawn or the goal off the grid. That is not an argument against the panel; it is what the panel is *for*.

**Errors and warnings are different things.** `validateLevel` reports errors and only errors block a save. `gridWarnings` reports the legal-but-probably-wrong: a marker enclosed on all four sides, a marker on the top or bottom row where the death planes are. *(Amended after 0.2: a pad firing into solid geometry was warned about too, and is now silent — with the pad debounce in place it is an ordinary authored shape, and warning about it trained the author to ignore the panel.)* Those cannot be errors: the grid is well-formed, `parseLevel` must accept it, and `src/levels/index.ts` throws on anything `validateLevel` rejects — so promoting a level-design footgun to a format error would make a shipped level a build failure.

**A level is any size the author says it is.** Width and height are derived from `rows` and nothing downstream assumes a number: the camera centres a map smaller than the view on either axis and clamps a larger one, and the shipped levels are already two different sizes. The editor therefore offers the same resize in two forms, because they are two different jobs. `[` `]` `,` `.` nudge one edge by a tile while you are looking at it. `R` opens a size field prefilled with the current `W X H` and applies the destination in **one** undo step — 190 taps of `]` is not a way to author a 200-wide level, and two delta resizes for one command would cost two `Ctrl+Z` to take back. Growing anchors top-left and cropping takes from the right and the bottom, so the content an author is looking at stays put; both forms clamp to `[1, EDITOR_MAX_*]`, and a crop that loses a marker is reported by the panel rather than refused — same as it has always been.

**Three tools, and only the brush edits as it drags.** *(Added after 0.2, because the work from here is levels.)* The rectangle tool and the select tool both commit on the button coming **up**: the drag is a preview, so a rectangle can be re-aimed and a block can be carried past where it will land. That is not a detail of the implementation, it is what makes them usable at half zoom, where the cell under the pointer is 16 px.

- **Rectangle** (`X`) fills the dragged rectangle, both corners inclusive, in one undo step. It is `paint` in a loop under one `atomic` — so the marker rules, the undo commit and the changed-anything answer are the brush's, not a second set that agrees with them today. A drag off the edge **clips** rather than refusing: overshooting the edge is an author filling to the edge.
- **Select** (`V`) marks out a region, and a press *inside* an existing selection picks it up and drags it — the marquee convention every editor already shares, and the reason it needs no second button. The move **lifts the whole region before stamping any of it**, which is what makes an overlapping drag a move rather than a smear, and it carries the empty cells with it: a selection is opaque, so dragging a block over other geometry replaces it rather than merging into it. Markers inside travel; a marker *outside* survives being stamped on, exactly as it survives a brush. Anything that lands off the grid is dropped.

Both are one undo step, both refuse to overwrite `S` and `G`, and filling **with** a marker places exactly one — at the anchor corner, because the singleton rule outranks the rectangle the same way it outranks a flood.

**Undo granularity is the stroke**, and the snapshot is pushed before the first cell of it. Per-cell snapshots make `Ctrl+Z` undo one pixel of a drag, which is not an undo stack, it is a diary. A stroke that changed nothing pushes nothing, and any new edit clears the redo stack.

**Playtest in place** (`Enter`) hands the current grid to a `PlayScene` in a `playtest` context and returns to the **same scene instance** — grid, undo stack and view intact, because the scene itself survived. A playtest writes no best time and does not advance progress; see §3.

**Export** (`Ctrl+S`) *(renamed from "save" after 0.2)*. The editor already saves — every stroke ends in a write to the draft shelf below — so calling this "save" answered a question nobody was asking and left two real ones unanswered: an author who never pressed it wondered whether their work was kept, and one who did believed the file was the only copy. Export answers the question the shelf cannot: **how does this level leave this browser.** It hands the browser a `<id>.json` download, and the payload is byte-identical to `serializeLevel`, so the file can be moved into `src/levels/` and committed verbatim — the one-line import in `src/levels/index.ts` stays manual, because generating it would be codegen against a file under version control.

It used to `POST /__level` to a dev-only Vite middleware that wrote `src/levels/<id>.json`. That was behaviour-detected rather than build-flag gated, which was right, and it was still aimed at the wrong place: it made the editor's one way out work for exactly one person, whoever had the repo checked out. A download works identically in dev, in `vite preview` and on a static host, and it produces a file you can *send to somebody*. The fallbacks are the clipboard and then `bw.editor.draft`, reported honestly — a message claiming the clipboard when the clipboard refused sends an author to paste nothing into an empty file. `Ctrl+S` is suppressed at the window so the browser's own save-page dialog never opens over the editor.

**Import is a drop, and the drop is the same act everywhere.** `+ IMPORT A LEVEL` is a row on the editor's picker *and* on CUSTOM LEVELS, `Enter` on it opens the file picker, and a `.json` dropped anywhere on the window imports wherever you are. A file is validated by the same `validateLevel` the editor's own panel uses, and it **never overwrites**: an id something already holds is renamed on the way in and the rename is reported, because silently replacing an evening's work with a file somebody happened to name `cellar` is the one thing an import must not do.

**A shelf of drafts, not one draft** *(added after 0.2)*. The grid is autosaved on every stroke end, so a reload never costs more than the stroke in progress — but it is autosaved to `bw.editor.draft.<id>`, with a JSON array of ids under `bw.editor.drafts` as the index, so an author can have as many levels in progress as they like. A serialised 60×20 level is ~1.3 KB, which is 0.03 % of a 5 MB quota; the shelf is not what fills it. **The id is the key**, because the id is already the filename and the best-time key, and a second identifier beside it would be a second thing to keep in step. So a rename is a *move*, two drafts can never share an id (the id field refuses, rather than merging two levels), and the pre-shelf single `bw.editor.draft` is imported once on the first visit to the picker and then cleared.

**A built-in is opened as a copy, from the first frame.** A level in `src/levels/` is a file under version control, and an editor that let you save over it would make the tool the fastest way to lose a shipped level. So opening one from the picker or from a level-select row hands the editor every cell of the real level under a *new* id — `<id>-copy`, suffixed again if that is taken — written straight to the shelf, with `COPY OF <ID>` in the header for as long as it is open. Saying so at the save would be too late to be a design; handing back a copy is the design. The id field refuses to type a built-in's id back, and `save` checks once more before it writes.

**Zoom is a ladder, and the level decides how far it goes** *(added after 0.2; it was a `Z` toggle between `1×` and `½×`)*. The rungs are `¼ ½ 1 2 4`, every one a whole-pixel cell — 8, 16, 32, 64, 128 px — because a fractional cell seams between adjacent cells, which is the exact problem §6's coordinate policy exists to avoid. Which rungs an author can reach is a function of the grid: **out** stops at the step that already shows the whole level (below it the level is a speck on a field of nothing) but never above `1×`, and **in** stops at `2×`, or at the fit step when a level is small enough to sit whole at `4×`. `+` and `-` step it, the ends hold rather than wrapping, and the view holds its centre across the change. A level opens at the widest rung that shows all of it, which for a 60-wide level is `½×` — 60 × 32 × ½ = 960 = `VIEW_W`, one screen per sixty tiles.

**Controls are a panel, not a first-run hint** *(added after 0.2)*. `H`, `?` or the button on the bar opens one screen listing every tool with a description, every palette character with what it is, every key and every shortcut — including the ones nothing else announces, like `Shift`+click to flood and "a built-in saves as a copy". It closes on any key or click. The content is a table (`scenes/editorhelp.ts`), not draw calls, so a test can assert that every key the editor binds is named in it: a reference that silently falls behind the tool it describes is worse than none.

A pending rectangle is drawn with **both** a tint and an outline, and the selection with the outline alone. Neither cue covers both grounds on its own: an `ink` wash at `EDITOR_MARQUEE_ALPHA` is the only thing visible over `paper` cells at a glance, and an outline is the only thing visible over `ink` ones. The resting selection skips the tint because it is not about to change anything, and a permanent wash would misreport the colours of the level underneath it.

The palette bar draws **the tiles themselves**, not their characters. It is WYSIWYG for free, and it sidesteps the fact that `^` has no glyph in the 5×7 font — `v` resolves to `V`, which is worse, because it looks deliberate.

Editor state (grid, undo stack, validation) is a pure module so it unit-tests in node. So does the scene: the mouse arrives as `Input.onPointerDown(vx, vy, button)` in view space, already through the letterbox inverse, so a test paints a stroke, undoes it, resizes the grid, playtests it and comes back with no canvas anywhere.

## 11. Out of scope for 0.2

Moving platforms, breakable tiles, one-way platforms, slopes, wall jumps, checkpoints, gamepads, mobile/touch, leaderboards, colour-gated geometry (the tile format has no colour field — adding one later is a format change, and that's accepted).

**The colour ending** for the final level is designed but deliberately unbuilt. It lands after the level set is finished, so the reveal can be tuned against the real final approach rather than a placeholder.

## 12. Module contracts

Signatures are binding; phase briefs fill in the detail.

- **`engine/rng.ts`** — unchanged `Rng` (mulberry32). Now serving particles, editor jitter, and test determinism rather than level generation. `hashStringToSeed`, `mixSeeds` stay; `dailySeed` / `dailyDateString` are deleted.
- **`engine/input.ts`** — `class Input` as before, minus the two-player split. Actions: `left right up down jump flip restart confirm back pause mute fullscreen`. `onKey` stays pure. *(Amended in phase 7: **three layers, not one.** Beside the action layer there is now a **raw code layer** — every `KeyboardEvent.code` recorded whether or not it is bound, as `codeDown` / `codePressed` / `pressedCodes` / `shiftDown` / `ctrlDown` — because the editor needs `Digit1`–`Digit9`, `ShiftLeft` and letters, and not one of those is a game verb; "paint" is not an `Action` and must not become one. The raw layer also settles `Space`, which is bound to both `flip` and `confirm`: the editor's space-drag pan reads the code, not either action. And a **pure pointer core** — `onPointerDown/Move/Up(vx, vy, button)`, `pointerX` / `pointerY` / `pointerIn`, and `down` / `pressed` / `released` per button — cleared by the same `update()` that clears the keys. `attach(win, canvas?)` converts to view space **on the way in** via `screenToView`, so the pure core never learns that a scale exists, and suppresses `contextmenu` for the right-drag erase. A press that lands in the letterbox is not a press at all.)*
- **`engine/font.ts`** — unchanged 5×7 bitmap font.
- **`engine/palette.ts`** *(new)* — `class Palette { phase: 0 | 1; flip(): void; paper: string; ink: string; accent: string }`, plus `paperRgba(a)` / `accentRgba(a)` and `inkRgba(a, phase?)`. Pure. The single source of every colour in the game. *(Phase 5 adds `inkRgba`, whose optional `phase` exists so the death fade can be sampled once and held: the palette resets to phase A at the fade's peak, and under a live token the screen would jump from white to black at exactly the covered moment.)*
- **`engine/renderer.ts`** — 960×540 offscreen buffer, antialiased, integer-scaled present. Adds `applyPost(speedNorm)` for vignette + chromatic aberration, and world/UI space draws. *(Phase 7 adds `screenToView(canvasW, canvasH, clientX, clientY)`, the exact inverse of `present`'s blit, returning an `inFrame` flag rather than clamping. It is the one place in the project where the letterbox arithmetic lives, and therefore the one place it can be wrong — dropping the offset is a fifteen-tile error at a 1920×1000 window, not a sub-pixel one.)*
- **`engine/particles.ts`** — pooled system, accent-coloured: `class ParticleSystem { aliveCount; emit(x, y, vx, vy, life, size, gravity, drag): boolean; update(dt); render(ctx, camX, camY); clear() }` plus the emitters `spawnDust`, `spawnBurst`, `spawnSplash`, `spawnRing`, `spawnStream`. *(Amended in phase 6, three ways. Particles **store no colour**: `render` assigns the live accent once for the whole pass, so sparks invert in flight — a spawn-time colour would leave a flip trailing a cloud of the outgoing phase, and worse, the flip's own ring is emitted before `PlayScene` moves the palette, so the one thing announcing the flip would be the last thing still wearing the old colour. The pool's free-slot scan starts at a **rotating cursor**, making a spawn amortised O(1) instead of O(512), with drop-newest overflow. And the options-bag `spawn`/`ParticleOpts` are **gone**: once the emitter set landed they had no caller in `src/`, and an API kept alive only by its own tests is the placeholder the phase 3/4 rule forbids.)*
- **`engine/audio.ts`** — split in two, the way `renderer.ts` splits `vignetteAlpha` from `applyPost`. Pure: `scheduleWindow(state, now, intensity, out): number` over a beat grid, plus `layerTarget`, `activeLayers`, `musicGain`, `delayFeedback`, `patternAt`, `createSchedulerState`, `createNoteBuffer`. Impure: `class AudioSys { constructor(makeCtx?); play(name); setIntensity(speedNorm); startMusic(); stopMusic(); get/set muted }`. *(Amended in phase 6, three ways. The effect player is `play(name)`, not `sfx(name)` — that was already true in the code and §12 had drifted. `setMuted(b)` becomes a **getter/setter pair**: with a running scheduler, muting is no longer "return early from `play`" but an action — duck the master, stop scheduling — and unmuting has to resync onto the grid, while every existing `audio.muted = x` call site compiles unchanged. And the constructor takes an **injected context factory**, defaulting to the guarded `new AudioContext()`, so the tests drive the real graph through a fake and count every node created against every `stop` scheduled.)*
- **`engine/save.ts`** — `SaveStore` with injectable storage, `bw.` keys: `bw.progress`, `bw.best.<levelId>`, `bw.muted`, `bw.editor.draft`. *(Phase 7 adds `getProgress()` / `setProgress(n)` over the one key nothing had ever written, and `getText` / `setText` for the editor's draft. A corrupt or missing progress reads as **0**, which unlocks exactly one level — not zero, which would lock a player out of their own game, and not all, which would make the key pointless — and `setProgress` is **monotone**, because completing an early level again must not re-lock the later ones. After this phase all four keys have a writer, which is the first time that has been true.)*
- **`engine/levelio.ts`** *(new, phase 7)* — `buildLevelPayload(p): string` (byte-identical to `serializeLevel`), `isValidLevelId` / `LEVEL_ID_PATTERN`, and `saveLevel(p, deps?): Promise<SaveOutcome>` reporting `disk` or `local`. Never rejects: a save that throws mid-session is a save that loses work. *(Amended after 0.2: `saveLevel` is **`exportLevel(p, deps?): Promise<ExportOutcome>`**, reporting `download`, `clipboard` or `storage`, plus `levelFileName(id)` and the **`FileDropbox`** — the one DOM listener in the module, turning a window `drop` or an OS file picker into a queue that node-safe scenes drain in `update`. A callback fired from the DOM handler would run scene logic outside the fixed-step loop, and put a browser API on a scene's path. The pure import half is `editor/transfer.ts`: `importLevelText(text, taken, filename?)` and `importDroppedFiles(save, files, taken)`.)*
- **`world/obb.ts`** *(new, pure)* — `vertices(box, out)`, `projectRadius(box, ax, ay)`, `tileRadius(tile, ax, ay)`, `deepestVertex(box, nx, ny, out)`, `satOverlap(box, tile, out, interiorFaces): boolean`, `contactCandidates(box, tile, nx, ny, tileAxis, out): number`, and the `FACE_*` flags with `faceBlocked`. No tilemap knowledge, fully unit-tested. *(Amended in phase 4: `satOverlap` writes into a caller-supplied result and returns a boolean rather than allocating `{ hit, normal, depth } | null` — the doc's shape was redundant with itself, and this keeps the hot path allocation-free, consistent with `forEachRun`. `projectOnto` is named for what it returns.)*
- **`world/physics.ts`** — rewritten: `interface RigidBody { x, y, vx, vy, angle, angVel, size }` (centre origin), `stepBody(body, map, dt, opts): StepResult { grounded, landed, hitCeiling, contacts, contactCount }`, plus `createBody`, `rightAngleError` and `subStepCount`. Sub-stepped, SAT-resolved, impulse response. Node-safe. *(Amended in phase 4: `stepBody` owns gravity — it needs `opts.gravitySign` and the rise/fall split anyway — which deletes `applyGravity`, `moveBody` and `isSupported`; support stops being a positional query, because "the floor" is whichever surface opposes gravity this instant. `StepResult.contacts` is a **fixed-capacity buffer reused across calls**, valid only until the next `stepBody`, carrying point, normal and impulse per contact so phase 6's landing splash has somewhere to read impact strength.)* *(Amended in phase 5: `Contact` also carries `pad: Tile` and `onSolid: boolean`, because pads became collidable and `grounded` can no longer answer "does this recharge the flip?" — see PHYSICS.md § Grounded.)*
- **`world/level.ts`** *(new)* — `parseLevel(raw: unknown): { ok: true; level } | { ok: false; errors: string[] }`, `Level { id, name, map: TileMap, spawn, goal, pads }`, `serializeLevel(level): string`, `validateLevel(rows: unknown): string[]`. *(Amended in phase 5, twice. `Level` holds a **`TileMap`**, not a raw `Uint8Array`: every consumer downstream — the solver's broadphase, `forEachRun`, the phase 7 editor — already takes one, so an array would be re-wrapped at each use site with the stride and the OOB rule agreed independently in every one of them. And `parseLevel` returns a **discriminated** union rather than `Level | LevelError`, because an untagged union of two object types cannot be narrowed in strict TS without a hand-written guard, and the editor's validation panel wants the whole error list rather than the first thing wrong. It never throws.)*
- **`world/tiles.ts`** — `enum Tile { Empty, Solid, PadUp, PadDown, PadLeft, PadRight }`, `class TileMap` with the seal-sides / open-vertically bounds rule. *(Phase 5 adds `isBlocking(t)`, `isPad(t)`, `padDirection(t)` and the `tileFromChar` / `charFromTile` mapping over §8's six grid characters. The char table lives beside the enum because the phase 7 editor's palette needs exactly this one; `S` and `G` stay `level.ts`'s business and the enum does not grow.)*
- **`world/camera.ts`** — follow with lookahead, clamp horizontally to the level, screen bounce, no shake.
- **`entities/player.ts`** — the controller: input → linear velocity, jump + spin, flip + charge, pad response, death detection. Owns no rendering beyond a small `render(r)`. *(Phase 6 adds the emitters it owns — the running dust and the step cadence off ONE distance accumulator, the landing splash, the flip ring, the jump and pad bursts — plus the pure `splashCount(impulse)` ramp. `PlayerEvents` deliberately did **not** grow to carry a landing impulse: the player was already walking `StepResult.contacts` for the recharge and the pad, so the splash reads the largest-impulse ground contact right there.)* *(Amended in phase 5: `update(dt, inputs, world)` **returns** a reused `PlayerEvents { flipped, died }`, so the scene — not the player — moves the palette. `spawnAt` is the whole reset, including `gravitySign` and the charge.)*
- **`scenes/`** — `TitleScene`, `LevelSelectScene`, `PlayScene(level, ctx)`, `ResultsScene(stats)`, `EditorScene`, plus `menu.ts`'s shared `updateMenu` and `tiledraw.ts`'s shared draws. *(Amended in phase 7: `PlayScene` takes an explicit **`PlayContext`** — `{ kind: 'campaign'; index }` or `{ kind: 'playtest'; back: Scene }` — and the union decides three things at once: where a win goes, whether `bw.progress` advances, and **whether a best time is written at all**. Phase 5's defaulted `index` meant a level not in `LEVELS`, which is exactly what a playtest hands over, advanced into `LEVELS[1]` on completion; the honest fix is not a better default but to stop defaulting. The bug under that bug is the save — a draft carrying the id of a shipped level would otherwise overwrite its best time with a run set on a grid that exists only in someone's browser. `tiledraw.ts` exists because the editor's palette bar draws real tiles, and a second copy of the chevron is a second thing to retune the next time `PAD_CHEVRON_WIDTH` moves.)*
- **`editor/grid.ts`** *(new, pure)* — grid model over `readonly string[]`: `class EditorGrid` (paint, flood, `fillRect`, `moveRect`, resize from four edges, `setSize` to an absolute size, stroke-scoped undo/redo), `GRID_CHARS`, `blankRows`, `isGridChar`, `gridWarnings`, `parseSizeInput`, and `forEachCharRun`. Unit-tested in node. *(Amended in phase 7: `gridWarnings` is **separate from** `validateLevel` rather than an extension of it — see §10. And `forEachCharRun` is `world/tiles.ts`'s `forEachRun` over characters instead of a `TileMap`: the editor's draw overran its 1 ms budget at 1.11 ms for 2040 per-cell fills, and run-merging the rows directly is the same fix without a second model that could not hold `S` and `G` anyway.)*
- **`game.ts`** — unchanged fixed-step loop and `Scene` interface. Still the most reusable thing in the repo.
