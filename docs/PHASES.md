# Build plan

The overhaul from Pixel Quest to *it's never just black and white*, in seven phases. Each phase ends with `npm run typecheck` and `npm test` green, and is committed separately.

Design decisions are settled in [GAME-DESIGN.md](GAME-DESIGN.md) — phases implement it, they don't renegotiate it. Where a phase discovers the spec is wrong, the spec gets amended in that phase's commit.

| # | Phase | Status |
| --- | --- | --- |
| 1 | Design doc, docs, rename | ✅ done |
| 2 | Demolition | ✅ done |
| 3 | Renderer & post-processing | ✅ done |
| 4 | Rigid-body physics | ✅ done |
| 5 | Player, world & level format | ✅ done |
| 6 | Particles & audio | ✅ done |
| 7 | Editor & shell | ✅ done |

---

## Phase 1 — Design doc, docs, rename ✅

Rewrite the spec and the surrounding documentation before touching a line of game code, so every later phase has something to build against.

- `docs/GAME-DESIGN.md` rewritten as the new source of truth.
- `docs/ARCHITECTURE.md`, `docs/PHYSICS.md` rewritten for the target design.
- `docs/DUNGEON-GENERATION.md` and the stale `docs/screenshot.png` deleted.
- `README.md` and `CLAUDE.md` rewritten; the determinism rules re-pointed from procgen to physics.
- `package.json` name/description/version, `index.html` title, favicon, and page chrome.

**Exit:** docs describe the target game with no residue of the old one; typecheck and tests still pass (no source changed yet).

---

## Phase 2 — Demolition ✅

Delete everything the new design doesn't use, in one pass, so later phases build on an empty lot rather than working around corpses.

The goal is **not** a black screen. It's a tree that still boots to a moving square on a hardcoded test grid — the smallest thing phase 3 can point a camera at and phase 4 can swap a solver into. Demolition that leaves nothing runnable makes the next two phases blind.

### Five decisions taken from the dependency graph

These revise the original outline; the graph disagreed with it.

1. **`engine/palette.ts` moves here from phase 3.** `engine/renderer.ts` and `engine/particles.ts` both import `PALETTE` from `sprites.ts`, so sprites can't be deleted without a colour source. The palette is ~30 lines, pure, and fully specified in GAME-DESIGN §2 — building it now unblocks the deletion instead of leaving a throwaway stub for phase 3 to rip out.
2. **The full linear constants land here, not in phase 3.** `TILE` 16→32 and `VIEW_*` 480×270→960×540 have to move together with the kinematics (`RUN_SPEED` 112→256, and the rest of GAME-DESIGN §6), or the player crawls at half scale on a grid twice the size and phase 3 has nothing sane to look at. Angular constants still wait for phase 4.
3. **`world/physics.ts` stays working, stripped — not stubbed.** Drop the `Platform` and `Spike` branches, `dropThrough`, and `rectOverlapsSpikes`, leaving a solid-only AABB solver. It carries phases 2–3 so the game stays playable, and phase 4 replaces it wholesale. Anything more invested here is thrown away.
4. **`Input` loses its player index entirely.** The API is player-indexed to its core (`down(player, action)`, slots keyed `'0:jump'`, `anyDown`/`anyPressed`). Dropping co-op isn't a binding-table edit — it's collapsing to `down(action)` / `pressed(action)` / `released(action)` and touching every call site. Wide, but mechanical, and it deletes `anyDown`/`anyPressed` outright.
5. **`results.ts` and `howto.ts` are deleted, not stubbed.** Stubs would preserve the `title ↔ play ↔ results` import cycle for no benefit. Phase 7 recreates `ResultsScene` against the real design. Phase 2 leaves exactly one direction of scene flow: `main → title → play`.

### Order of work

Leaves before roots, so typecheck stays informative rather than drowning in cascades.

1. **Delete the leaves.** `world/dungeon.ts`, `entities/{slime,coin,door,torch}.ts`, `run.ts`, `scenes/{backdrop,howto,results}.ts`, and their tests: `dungeon`, `run`, `entities`, `sprites`, `playscene`.
2. **Gut the scenes.** `play.ts` (399 lines → a hardcoded test grid, a player, a camera, tile and player rects). `title.ts` → title text and a start prompt. `main.ts` → drop `?seed=` parsing and the `hashStringToSeed` import.
3. **Create `engine/palette.ts`**, repoint `renderer.ts` (paper/ink) and `particles.ts` (accent) at it, then delete `engine/sprites.ts`. Sprite drawing leaves `Renderer` with it; the player draws as a rect until phase 4.
4. **`world/tiles.ts`** — enum to `Empty, Solid, PadUp, PadDown, PadLeft, PadRight`; strip `drawTileMap` out entirely (it hardcodes 480/270 and four hex literals, and phase 3 rewrites tile drawing with row-run merging). Losing it makes `tiles.ts` fully pure — no more `Renderer` import.
5. **`world/physics.ts`** — strip to solid-only per decision 3.
6. **`constants.ts`** — retune per decision 2; delete health, scoring, slime, coin, platform and co-op blocks.
7. **The rest of the survivors** — `input.ts` per decision 4; `save.ts` from `ScoreEntry` to a time entry with `bw.` keys and lower-wins comparison; `camera.ts` loses `shake` (and with it its `Rng` import); `rng.ts` loses `dailySeed` / `dailyDateString`; `entities/context.ts` loses `shake`.
8. **Tests**, then typecheck, then a browser boot check.

### The OOB semantics change

`TileMap.get` currently returns `Solid` for left/right/**top** and `Empty` below the bottom. The new rule is sides solid, **top and bottom both empty**, because gravity flips and leaving through the ceiling has to be as lethal as falling.

Order the checks vertically-first (`ty < 0 || ty >= h` → `Empty`, then `tx` out of range → `Solid`) so a player hugging a wall on the way out of the top still escapes rather than catching on the sealed side. Worth a dedicated test — it's a two-line change that silently decides whether upward death works at all.

### Test suite

| Action | Files |
| --- | --- |
| Delete | `dungeon`, `run`, `sprites`, `entities`, `playscene` |
| Rewrite | `save` (time-based), `input` (single-player API), `constants` + `physics` (new targets), `player` (damage cases gone) |
| Prune | `rng` (daily), `camera` (shake), `particles` (palette), `tiles` (enum + OOB) |
| Keep | `font`, `game`, `renderer` |
| Add | `palette` — flipping twice is identity, and the two tokens are never equal |

**Deliberately minimal investment in `physics` and `player` tests.** Phase 4 deletes both implementations; tests written against them now are written to be thrown away. Prune to green, assert the new derived numbers from GAME-DESIGN §6 (jump peak 3.48 tiles, clearance 4.56 tiles), and stop.

### Risks

- **`Input`'s API collapse is the widest edit in the phase.** Nothing subtle, but it touches every scene and the player, and a missed call site is a typecheck error rather than a silent bug — which is the good case.
- **`save.ts` is a rework, not a rename.** Higher-score-wins becomes lower-time-wins; the comparison inverts and `ScoreEntry`'s `score`/`coins` fields go. Its test file is rewritten, not pruned.
- **The hardcoded test grid in `play.ts` is throwaway** and should look it. Phase 5 replaces it with a parsed level; a grid that starts accumulating features is a grid someone will try to keep.

**Exit:** `npm run typecheck` and `npm test` pass; `npm run dev` boots with no console errors to a square that moves and jumps on a test grid at 960×540; `src/` is roughly 40 % of its former size; no `Math.random`, no hex literal outside `palette.ts`, and no import of a deleted module anywhere.

### As built

All met. `src/` went 3866 → 1808 lines (47 %; the remaining overshoot is `audio.ts`, which phase 6 rewrites and this phase had no reason to touch). Three findings worth carrying forward:

- **The Euler apex is 5.2 % short, and that is the integrator, not the tuning.** Integrating velocity before position loses exactly `v₀·dt/2` ≈ 5.8 px, so the standing jump peaks at 3.30 tiles against the analytic 3.48. `tests/physics.test.ts` pins the error to that closed form and bounds it at 6 %. **Phase 4's ±5 % target is therefore a constraint on the integrator**: a straight sub-stepped Euler will miss it, and position needs the average velocity over the step (or the half-gravity split) to land inside.
- **`engine/palette.ts` exports a `palette` singleton** alongside the class. `renderer.ts`, `particles.ts`, `player.ts` and both scenes read tokens from it; there is exactly one palette in the game and threading it through every draw call bought nothing. The class stays independently constructible, which is what the palette tests use.
- **`tests/renderer.test.ts` was retuned, not kept.** `computeScale`'s expectations are stated in view-sizes, so doubling `VIEW_*` moved every number in the file. The pure-function contract it checks is unchanged.

`vite.config.ts`'s `screenshotSink` is untouched and still works — phase 7 models the level sink on it.

---

## Phase 3 — Renderer & post-processing ✅

The look. Everything visible in the finished game is decided here.

- ~~**`engine/palette.ts`** (new)~~ — built in phase 2 (decision 1), including its tests. Only the rgba accessors are left (decision 3).
- **`engine/renderer.ts`** — antialiased shape drawing, rotated-rect drawing (`save`/`translate`/`rotate`/`restore`) since the player needs it in phase 4, and `applyPost(speedNorm)`. Keep `computeScale` pure and tested.
- **`world/camera.ts`** — follow with lookahead, horizontal clamp to level bounds, vertical freedom (gravity flips, so the camera can't assume a floor), and the speed-driven screen bounce.
- **Tile rendering** — row-run merging so a long floor draws as one rect.

### Seven decisions taken before writing any of it

1. **`imageSmoothingEnabled = true` is not what makes shapes antialiased — it is a no-op for `fillRect` and paths.** Canvas 2D antialiases fills unconditionally; the flag only affects `drawImage`/pattern scaling. What actually delivers a clean edge on a square resting at 37° is **the coordinate policy**: `Renderer.rect` currently `Math.round`s every draw. So the real change is *where rounding survives*:
   - `setCamera` rounds the camera origin, so static geometry (tile coords are multiples of 32) still lands on whole pixels and stays crisp.
   - `rect` and the rotated draws stop rounding — they take floats and antialias.
   - `text` keeps rounding. The 5×7 bitmap font is the one deliberately low-res element (GAME-DESIGN §2) and blurring it would throw away the signature.
   - `present` keeps `imageSmoothingEnabled = false`. Smoothing an integer-scaled blit would soften the entire frame — the only place softness is wanted is inside `applyPost`.

   Amend ARCHITECTURE.md §Rendering pipeline, which currently states the flag and the antialiasing as one fact.

2. **The screen bounce integrates its phase; it cannot read absolute time.** GAME-DESIGN §7 specifies `sin(t · BOUNCE_FREQ · speedNorm) · BOUNCE_AMP · speedNorm`. With `t` large, a small change in `speedNorm` moves the sine argument by `t · BOUNCE_FREQ · Δn` — at t = 100 s, a 0.01 change in speed jumps the phase by 9 radians and the screen snaps. Correct form: `bouncePhase += BOUNCE_FREQ · speedNorm · dt`, offset `= sin(bouncePhase) · BOUNCE_AMP · speedNorm`. Frequency modulation done on the phase, not on the argument. **This amends GAME-DESIGN §7 in this phase's commit**, and gets a dedicated test (below), because it is invisible in a 10-second play session and glaring in a 3-minute one.

3. **The vignette needs `rgba()`, so the rgba formatting belongs to the palette.** A gradient's inner stop is transparent `paper`, which means parsing `#0A0A0A` into components — colour logic, and hard rule 6 says every hex lives in `palette.ts`. Add `paperRgba(a)` and `accentRgba(a)` there: pure, node-testable, still exactly one file containing hex. The chromatic aberration pass also needs pure red/green/blue and black as **compositing operands** (not palette colours); export them from `palette.ts` too, commented as such, rather than letting four hex literals leak into the renderer.

4. **Two cached gradients per phase, not one per frame.** The vignette's alpha and its accent tint both vary continuously with `speedNorm`, so a single gradient carrying both would be rebuilt every frame. Split them: one `paper` gradient and one `accent` gradient per phase, four total, built lazily and keyed on `palette.phase`. Per-frame variation is then just `globalAlpha`, which is free. Note the offscreen buffer is a fixed 960×540 — **only the visible canvas resizes** — so phase change is the *only* invalidation trigger, and the renderer can detect it itself by comparing a stored phase rather than requiring callers to notify it.

5. **Chromatic aberration must be background-agnostic, which rules out the naive version.** "Draw the buffer three times with `lighter` and per-channel offsets" only produces a channel split against a black background — and this game inverts, so half the time the background is `#F2F2F2` and additive blending saturates the whole frame to white. The correct decomposition survives the flip: for each channel, draw the pristine frame at its offset onto a staging canvas, `globalCompositeOperation = 'multiply'` with a pure channel mask (multiply by `(1,0,0)` yields `(r,0,0)`), then add that onto the accumulator with `lighter`. At zero offset the three sum back to the original exactly, whatever the background. Cost: **three canvases** — offscreen, a pristine copy, a staging buffer — allocated lazily on the first frame that exceeds `CA_THRESHOLD`, so a player who never gets fast never pays the 4 MB.

6. **Post order is aberration first, then vignette.** Two reasons, one aesthetic and one structural. The vignette is a screen-space overlay and shouldn't be channel-split. And each shifted channel copy leaves an uncovered strip up to `CA_MAX_OFFSET` px wide at the frame edge, which would read as a coloured band — the vignette covers exactly that band, and it is at its strongest (alpha ≥ 0.33) precisely when aberration is active (`speedNorm > 0.45`). The artifact and its mask arrive together.

7. **`applyPost`'s numbers are pure functions; `applyPost` is only the drawing.** `vignetteAlpha(n)`, `tintAmount(n)` and `caOffset(n)` export from `renderer.ts` and unit-test in node — the ramp, the threshold, the endpoint values. What's left inside `applyPost` is gradient fills and `drawImage` calls, which is the part a test could never have caught anyway. Same trick that keeps `computeScale` honest.

### Where `speedNorm` comes from

Nothing produces it yet — phase 6 wires it to four consumers. This phase computes it in `PlayScene` from the temporary player's velocity, which is real, not fake: `target = clamp(|v| / SPEED_REF, 0, 1)`, smoothed with an exponential lag at `SPEED_SMOOTH_RATE` so one frame of wall contact doesn't strobe the screen. Four lines and one field; **no new module**, no `SpeedMeter` abstraction for phase 6 to inherit and regret. The two consumers this phase (`camera.update`, `applyPost`) take it as an argument.

### Camera specifics

- **Lookahead** — `offset = clamp(vx · LOOKAHEAD_TIME, ±LOOKAHEAD_MAX)`, itself smoothed at `LOOKAHEAD_RATE` (deliberately *slower* than `CAMERA_FOLLOW_RATE`), then added to the follow target. Smoothing the offset rather than just the target is what stops a direction reversal — a 180 px target jump at full speed — from whipping the view.
- **Horizontal clamp** stays; `clampTo` becomes `clampX(mapWpx)`.
- **Vertical** gets `CAMERA_VSLACK` px of allowed overshoot past the map's top and bottom rather than a hard clamp, so the frame or two before an out-of-bounds death is legible instead of the square clipping off a pinned edge. **When the map is shorter than the view, centre it vertically — do not pin to the top.** Pinning to y = 0 is a hidden assumption that down is down, and this game's whole premise is that it isn't.
- **Bounce lives in `viewY`, never in `y`.** Writing it into the camera position would feed it back through follow and clamp and turn a cosmetic wobble into a physical oscillator.

### Tile run merging

A pure `forEachRun(map, tx0, ty0, tx1, ty1, cb)` in `world/tiles.ts`, merging horizontally over **equal tile values** (not just `Solid`, so pads merge too) and skipping `Empty`. Callback-based rather than array-returning: ~100 runs × 60 fps of throwaway objects is churn for nothing. `tiles.ts` stays pure and node-safe — it was deliberately freed of its `Renderer` import in phase 2 and does not get it back. The scene keeps a five-line draw loop over the callback.

### Order of work

1. **`constants.ts`** — the camera and feel/effects blocks: `LOOKAHEAD_TIME` 0.35 s, `LOOKAHEAD_MAX` 96 px, `LOOKAHEAD_RATE` 3 /s, `CAMERA_VSLACK` 64 px, `SPEED_REF` 320, `SPEED_SMOOTH_RATE` 6 /s, `CA_THRESHOLD` 0.45, `CA_MAX_OFFSET` 3.0, `VIGNETTE_MIN` 0.15, `VIGNETTE_MAX` 0.55, `VIGNETTE_INNER` 0.45, `VIGNETTE_TINT_MAX` 0.22, `BOUNCE_AMP` 2.5, `BOUNCE_FREQ` 9.0, `PLAYER_CORE_INSET` 5. The four not in GAME-DESIGN §6 (`VIGNETTE_INNER`, `VIGNETTE_TINT_MAX`, the lookahead trio, `PLAYER_CORE_INSET`) are added to the table there in the same commit.
2. **`engine/palette.ts`** — `paperRgba` / `accentRgba` / the compositing operands (decision 3).
3. **`engine/renderer.ts`** — coordinate policy (decision 1), `rectRotated` + `rectRotatedOutline`, the three pure post functions, `applyPost`.
4. **`world/camera.ts`** — lookahead, `clampX`, vertical slack, integrated bounce.
5. **`world/tiles.ts`** — `forEachRun`.
6. **`scenes/play.ts`** — run-merged tiles, `speedNorm`, `input.pressed('flip')` → `palette.flip()`, `applyPost` last. **Colours only: no gravity change.** The flip's gravity half is phase 5's, and faking it here would leave a second implementation for phase 5 to find and remove.
7. **`entities/player.ts`** — draw through `rectRotated` as an `ink` body plus a `paper` core, and add a render-only `angle` field defaulting to 0. The simulation never sets it (phase 4 does, from the rigid body), but it makes the rotated path real code on the screen instead of an untested primitive that phase 4 discovers is wrong.
8. **`scenes/title.ts`** — `applyPost(0)` so the frame is consistent from the first screen.
9. **Tests, typecheck, browser check, benchmark, doc amendments.**

### Test suite

| Action | Files |
| --- | --- |
| Rewrite | `camera` (every assertion moves: `clampTo` splits, `follow` gains a velocity argument) |
| Extend | `palette` (rgba formatting, operands), `renderer` (the three post ramps), `tiles` (run merging), `constants` (new derived relations) |
| Keep | `font`, `game`, `input`, `save`, `rng`, `particles`, `physics`, `player` |

Assertions worth naming:

- **Bounce phase continuity** — step the camera 600 times with `speedNorm` jittering every step; no single step may move the bounce offset by more than `2 · BOUNCE_AMP`. This is the test for decision 2, and it fails loudly against the spec's literal formula.
- **Bounce endpoints** — offset is exactly 0 at `speedNorm = 0` (and the phase does not advance); peak over one cycle is `BOUNCE_AMP` at 1.
- **Lookahead** — sign follows `vx`; converges to `vx · LOOKAHEAD_TIME` ahead of the player; saturates at `LOOKAHEAD_MAX`; a sign reversal moves `viewX` monotonically, no overshoot past the new target.
- **Camera vertical** — overshoot is permitted up to `CAMERA_VSLACK` and no further; a map shorter than the view centres rather than pinning.
- **Run merging** — a 40-wide floor row is 1 run; one gap makes 2; a pad in the middle of a floor splits it into 3 runs of two distinct values; the window clips runs to the requested range rather than to the map.
- **Post ramps** — `caOffset` is exactly 0 at and below `CA_THRESHOLD`, `CA_MAX_OFFSET` at 1, monotone between; `vignetteAlpha` hits `VIGNETTE_MIN`/`VIGNETTE_MAX` at the ends; `tintAmount` is 0 across the whole bottom half of the range.
- **Palette rgba** — `paperRgba(0)` and `paperRgba(1)` share rgb and differ only in alpha; flipping changes the rgb; the output never contains a `#`.

### Verification that isn't a unit test

`applyPost` cannot be node-tested, so the phase ends with a browser pass through `npm run dev`:

- **The CA benchmark the brief calls for.** Time the composite path against a `getImageData` implementation over ~120 frames via `window.__bw`, keep the faster, record both numbers in *As built*, then delete the losing implementation and the harness. The prediction: composite wins by a wide margin — `getImageData`/`putImageData` moves 2.1 MB through JS per frame while the composite path is seven GPU-side full-screen operations. Budget: **the whole post pass under 2 ms at 960×540**, measured at `speedNorm = 1`.
- Force `speedNorm` to 0 → 1 and confirm the vignette closes and the tint arrives only in the top half.
- Set the player's render `angle` to ~0.6 rad from the console and confirm the rotated body and its inset core sit correctly and read cleanly against a wall — this is also where `PLAYER_CORE_INSET` gets its final value.
- Press space repeatedly: everything inverts, including the letterbox, and nothing flickers or fails to invert (an element that survives a flip is a colour that escaped the palette).
- Capture a fresh `docs/screenshot.png` through the existing `screenshotSink`. Phase 1 deleted the stale one and the README has been missing an image since; the look is decided here, so this is the first phase that can honestly supply it.

### Risks

- **The post pass is the first thing in this project with a real frame budget.** Everything else is a handful of `fillRect`s. If CA overruns, the fallback is to run the aberration on a half-resolution staging canvas and upscale — the effect is a ≤3 px colour fringe, and it survives halving unnoticed. Gating harder than `CA_THRESHOLD` is the wrong lever; it would remove the effect exactly where the game is meant to open up.
- **Dropping `Math.round` from world draws is a wider change than it looks.** Every existing draw call inherits sub-pixel positioning at once. The mitigation is decision 1's split, and the thing to watch in the browser is a tile seam appearing between two adjacent runs — if it does, the camera rounding isn't reaching that path.
- **Run merging changes what's on screen, and no unit test sees pixels.** The rect *count* is testable; the rect *coverage* is not. Compare a screenshot against the per-tile renderer before deleting it.
- **The `angle` field on the temporary player is a hook, not a feature.** It exists so phase 4 has somewhere to write. If phase 3 ends with anything animating it, that's a second rotation source for phase 4 to fight.

**Exit:** the test grid renders in black and white at 960×540 with row-merged geometry, the vignette breathes with the player's real speed, chromatic aberration arrives above `CA_THRESHOLD` and stays under the frame budget, the camera leads and bounces without snapping, and pressing space inverts the world — palette only, gravity untouched. `npm run typecheck` and `npm test` green; GAME-DESIGN §6/§7 and ARCHITECTURE.md amended where this phase contradicted them.

### As built

All met. Tests 130 → 165, typecheck clean, `docs/screenshot.png` captured through the existing sink. Five findings worth carrying forward:

- **The CA benchmark was not close: composite 0.054 ms vs `getImageData` 2.657 ms, a 49× margin.** The whole post pass measures **0.051 ms** at `speedNorm = 1` against a 2 ms budget — the vignette alone is 0.0008 ms, since it is two cached gradients and a `globalAlpha`. The prediction held and the half-resolution fallback was never needed. Both implementations and the harness are deleted; only the composite path ships.
- **The brief's named assertion for decision 2 has no teeth, and the camera work caught it.** `no step moves the bounce offset by more than 2 · BOUNCE_AMP` is a ceiling *no bounded sine can breach* — it holds trivially for the broken implementation too. Measured: the naive `sin(t · FREQ · n)` form peaks at 4.00 px/step against a 5.0 px bound, so it would have **passed**. `tests/camera.test.ts` therefore asserts both that bound and a derived one with real teeth — `BOUNCE_AMP · (n·Δφ + Δn)` = 0.352 px for its jitter band — which the integrated form passes at 0.261 (26 % headroom) and the naive form fails by 11×. **A test named in a brief is still only a hypothesis until it is watched failing.**
- **Decision 5's decomposition is exact, and was verified as such in both phases.** Running `aberrate(0)` over a rendered frame changes **zero** pixels — bit-identical reconstruction — while a 3 px split moves pixels by up to 232. Confirmed against the dark *and* the light background; the light one is the case that would have saturated to white under the naive additive version. One refinement over the brief: basing each staging canvas on the *unshifted* frame before drawing the shifted copy removes the uncovered edge strip entirely, so the vignette no longer has to mask an artifact — it just happens to.
- **Run merging is pixel-identical to the per-tile renderer, so the risk it carried is closed rather than eyeballed.** Diffed at five fractional camera offsets (0, 0.37, 0.5, 0.99, 12.4): **0 differing pixels** every time, and **0 non-pure pixels** anywhere in the geometry — no seams, so the camera rounding does reach that path. The brief only asked for a screenshot comparison; the exact diff was cheaper and settles it.
- **`TINT_START = 0.5` is a private const in `renderer.ts`, not a tuning constant.** GAME-DESIGN §7 *defines* the tint as arriving over the top half of the range, so the half is spec, not a knob — moving it would contradict the doc rather than retune the feel. Flagged here because it is the one number in the phase that lives outside `constants.ts`.

The `angle` field on the player is a hook and nothing animates it, as the brief requires — the browser check drove it from the console only. `PLAYER_CORE_INSET` was confirmed at 5 against a wall: buried in the floor slab the ink body vanishes into the ink geometry and only the paper core reads, which is exactly the job it exists to do.

---

## Phase 4 — Rigid-body physics ✅

The hard one, and the reason this overhaul is interesting. Budget accordingly.

- **`world/obb.ts`** (new, pure) — oriented-box geometry with no tilemap knowledge: vertices, axis projection, SAT against an axis-aligned box, and the incident contact feature. Exhaustively unit-tested; this is where a sign error would poison everything above it.
- **`world/physics.ts`** (rewritten) — `stepBody`: gravity along `gravitySign`, sub-stepped advance, broadphase over the tilemap, SAT narrowphase, positional correction plus impulse response at the contact point, grounded from contact normals, angular damping and the restoring spring.
- **`entities/player.ts`** — adapted to the centre-origin rigid body (**not** rewritten; that is phase 5).
- **Determinism** — fixed timestep, no `Math.random` on this path, bit-identical trajectories over 600 steps.

### Eight decisions taken before writing any of it

Four of these contradict PHYSICS.md. The spec was written before anything ran; each contradiction below is derived, not preferred, and gets amended in this phase's commit.

1. **The integrator is "average velocity across the step", and that is *not* interchangeable with the half-gravity split.** Phase 2's note offers them as equivalent alternatives. They give identical *positions* and different *stored velocities*, and the difference decides whether a resting body reads as at rest. Kick-drift-kick ends the step having just applied the second half-kick, so a square sitting on the floor stores `vy = GRAVITY_FALL · STEP / 2` = **29.3 px/s forever** — `speedNorm` never falls below 0.09, the vignette never fully opens, and phase 5's controller has to special-case "at rest" everywhere. The correct form integrates gravity in full, drifts by the **average of the pre- and post-gravity velocity**, and resolves against the full velocity, so the arcade clamp leaves `vy` exactly 0. Take the average from the actual pair rather than subtracting `g·dt/2`, or the `MAX_FALL_SPEED` clamp desynchronises it at terminal. Scope: the correction applies to the acceleration `stepBody` itself applies. Velocity the *caller* wrote (input accel, the jump impulse) is treated as an impulse at the step boundary — 0.29 px of position error during the 0.12 s accel ramp, on an axis no derived number depends on.

2. **The deepest-vertex rule cannot rest a flat square, and the failure is loud.** A 20 px square flush on a floor has two bottom corners at equal depth; the tie-break picks one, giving `r × n = ∓10` and, per resting step, `j = 58.67/2.5 = 23.5` → `Δω = 0.6 · 23.5 · 10/66.7 = ` **2.11 rad/s**. Injection tapers as the corner's own velocity cancels gravity's and balances the 12.5 %/step ground damping at **≈4.4 rad/s** — a permanent 250°/s roll, deterministic, so *every* flat landing rolls the same way. Spanning two tiles does not save it: the first contact's impulse zeroes `vy`, so the second is already separating and contributes no counter-torque. So contacts are **merged into a manifold before resolution**, not resolved one tile at a time:
   - candidate points are **clipped to the incident face** — box vertices within the tile's extent along the contact tangent (or tile corners within the box face's extent, when a box axis wins);
   - contacts sharing a normal merge across tiles, taking the maximum depth;
   - the contact point is the **centroid of every candidate within `CONTACT_TOL` of the deepest**.

   Flush on one tile or straddling two, both bottom corners tie, the centroid is the face centre, `r × n = 0`, the denominator collapses to `1/m` and the impulse is a clean full stop with zero torque. Overhanging a ledge, only the corner actually over the tile is a candidate, so it tips off. Tilted, one vertex is clearly deepest and the corner physics is untouched. `CONTACT_TOL` = 0.25 px puts the tie band at `asin(0.25/20)` = **±0.72°**, which is below the settled residual and far below any real tilt.

3. **A resting contact is still a contact, so the spring's suppression condition inverts its own purpose.** With `SLOP` residual penetration, gravity re-penetrates a resting body by 0.489 px *every* step, so "a contact resolved this step" is permanently true — and PHYSICS.md suppresses the auto-right spring exactly then. The spring would never run for a body on the ground, which is the only place it is supposed to run. Discriminate by **impact, not by contact**: `IMPACT_SPEED_MIN = 2 · GRAVITY_FALL · STEP` = 117.3 px/s, twice the largest approach speed gravity alone can produce in one step (a 1.96 px drop). One threshold, two jobs:
   - **above it** — a genuine impact: apply the angular impulse, suppress the spring for that step;
   - **below it** — resting or scraping: linear stop only, no torque, spring runs.

   The second job is what stops a square resting at 1° from buzzing: a single-corner resting contact injects 2.11 rad/s per step, which rotates it 2° in one frame — straight past flat and onto the other corner. The gate makes the split explicit and honest: **impacts own spin, the spring owns settling.** Decision 2 is still needed alongside it, for the flat landing at 400 px/s that a single vertex would answer with `Δω = 14.4` rad/s — over `MAX_ANG_SPEED`, from landing perfectly flat.

4. **Resolution runs inside the sub-step loop, and every ordering in it is pinned.** PHYSICS.md lists sub-stepping and resolution as sequential steps 2–4; read that way, sub-stepping is decorative — advancing the full distance in pieces with no test between them lands in the same place. Resolve after each sub-step advance. The orderings that determinism rests on, all of which are free if chosen deliberately and unfindable if not: broadphase iterates tiles **row-major**; manifolds resolve **deepest first**; SAT keeps an axis only on strict improvement, so **tile axes win ties over box axes** (which is also what makes a flush contact resolve as a face contact rather than a degenerate box-axis one); `MAX_CONTACT_ITERS` = 4 is a natural cap once manifolds are merged, since there are only four tile-axis normals. Sub-step count uses `hypot(vx, vy) · dt`, not the larger of the two components — max-of-components under-counts diagonal motion by up to √2. At full run plus terminal fall that is 13.5 px/step → 2 sub-steps; at 4000 px/s, 9.

5. **The outline's "velocity-based sleep threshold" is unnecessary and is dropped; a sub-degree angular settle replaces it.** Positional correction to exactly `SLOP` makes rest a **fixed point** — the body descends 0.489 px and is pushed back to the same y, bit-identically, forever — so linear sleep would guard nothing. Only ω is asymptotic: critical damping approaches zero without reaching it, leaving a permanent sub-pixel wobble and no exactly-still state to assert. Snap it: grounded, `|ω| < ANG_SETTLE_VEL` (0.05 rad/s) and error under `ANG_SETTLE_EPS` (0.002 rad) ⇒ set the angle to the target and zero ω. At 0.002 rad a corner moves 0.028 px, so the snap the design otherwise forbids is a third of a pixel below visible — and a constants test pins it there.

6. **`PLAYER_INERTIA` is derived, not typed in.** `s²/6` at unit mass; writing 66.7 as a literal means `PLAYER_SIZE` and the inertia can disagree silently, and every angular result scales with the ratio. `export const PLAYER_INERTIA = (PLAYER_SIZE * PLAYER_SIZE) / 6;`, with the constants test asserting it still lands on 66.7.

7. **`stepBody` owns gravity, which deletes three exports and changes the body origin.** `applyGravity`, `moveBody` and `isSupported` all go: gravity moves inside the step (it needs `opts.gravitySign` and the rise/fall split anyway), and support stops being a positional query — grounded is a property of the contact normals, and has to be, because "the floor" is whichever surface opposes gravity this instant. Two API details the module contract in GAME-DESIGN §12 leaves open, decided here and amended there: `satOverlap` writes into a caller-supplied result and returns a boolean rather than returning `{ hit } | null` (the doc's shape is redundant with itself, and this keeps the hot path allocation-free, consistent with `forEachRun`); and `StepResult.contacts` is a **fixed-capacity buffer reused across calls**, valid only until the next `stepBody`, carrying point, normal and impulse per contact because phase 6's landing splash is specified as scaled by impact speed and needs somewhere to read it.

8. **The jump's angular impulse lands here. The flip's does not.** Phase 3's rule was that nothing gets faked; the corollary is that nothing real gets withheld either. `JUMP_SPIN_BASE + JUMP_SPIN_PER_SPEED · |vx|` on an already-existing action is two lines of final code that phase 5 will keep verbatim, and without it the entire angular half of the solver is dead on screen for a whole phase — the same reasoning that made phase 3 compute `speedNorm` from real velocity rather than deferring it. The flip's spin kick, the charge, pads and death stay in phase 5, because each needs state that does not exist yet; adding them here would be a placeholder, and placeholders are what the rule is actually about.

### The centre origin, and how far it reaches

`RigidBody` is `{ x, y, vx, vy, angle, angVel, size }` with **`x, y` at the centre**, against the old top-left AABB. Outside `physics.ts` and `player.ts` the blast radius is three lines in `play.ts` — the camera already tracks `player.centerX/centerY`, which become one-line getters over `body.x/body.y`, so only the out-of-bounds check changes. `spawnAt` becomes `spawnAt(cx, cy)`, which is the shape phase 5 wants anyway when it spawns from a tile centre in the level data.

The render-only `angle` field phase 3 parked on the player is **retired**, not written to: `render` reads `body.angle`. That hook existed so this phase would find a working rotated draw path instead of an untested primitive, and it has done its job the moment the simulation drives it.

### Predictions worth recording

Phase 3's benchmark prediction was worth more written down than guessed at afterwards. Three here:

- **The apex overshoots ±5 % by three orders of magnitude.** Average-velocity integration is exact for constant acceleration, so sampled positions lie *on* the parabola and the only error is that the true apex falls between samples: peak sampled at step 19 is 111.361 px against the analytic 111.364, **0.003 %**, versus phase 2's 5.2 %. If the measured number is anywhere near 5 %, the integrator is not what this brief says it is.
- **Airtime 0.5697 s = 34.2 steps**, and the rise/fall gravity switch mid-step costs at most 0.18 px.
- **Solver cost under 0.15 ms/step** at terminal velocity inside a corner — the post pass measures 0.051 ms and the frame budget is 16.7 ms, so this is a smoke alarm, not a constraint.

### Order of work

Bottom-up: the geometry layer poisons everything above it, so it goes first and gets tested before anything depends on it.

1. **`constants.ts`** — the angular block from GAME-DESIGN §6 in full, plus the solver constants this brief adds: `CONTACT_SLOP` 0.01 px, `CONTACT_TOL` 0.25 px, `MAX_CONTACT_ITERS` 4, `IMPACT_SPEED_MIN` (derived, decision 3), `ANG_SETTLE_EPS` 0.002 rad, `ANG_SETTLE_VEL` 0.05 rad/s, `PLAYER_INERTIA` (derived, decision 6). The six new ones are added to §6's table in the same commit.
2. **`world/obb.ts`** — square-only (the projection-radius shortcut `r = (s/2)(|a·u| + |a·w|)` depends on it, and there is exactly one body in the game). Normals point **tile → box**, the push-out direction; write that on the module and in the tests, because it is the one convention that silently inverts every result downstream.
3. **`tests/obb.test.ts`** — before `physics.ts` exists, against hand-computed numbers.
4. **`world/physics.ts`** — `stepBody`, in the order of decisions 1–5.
5. **`entities/player.ts`** — centre origin, `onGround` from `StepResult.grounded`, jump spin, `render` off `body.angle`.
6. **`scenes/play.ts`** — the out-of-bounds check against the centre origin. Nothing else; the test grid is still throwaway and still must look it.
7. **Tests, typecheck, browser pass, doc amendments.**

### Test suite

| Action | Files |
| --- | --- |
| Add | `obb` — the largest new test file in the repo, and deliberately so |
| Rewrite | `physics` — the solver is new; only the §6 derived-number assertions survive |
| Retune | `player` (centre origin, `spawnAt`), `constants` (angular block, the derived relations) |
| Keep | `camera`, `renderer`, `palette`, `tiles`, `font`, `game`, `input`, `save`, `rng`, `particles`, `audio` |

Assertions worth naming:

- **Normal direction, stated four ways.** A box overlapping a tile from above, below, left and right yields `(0,−1)`, `(0,1)`, `(−1,0)`, `(1,0)` and the hand-computed depth. Half the value of `obb.test.ts` is in these four lines.
- **Projection radius** at 0° is `s/2`, at 45° is `s/√2`, and matches `(s/2)(|a·u| + |a·w|)` at 30° — checked against explicit vertex projection, not against itself.
- **Axis selection** — a flush face contact resolves on a tile axis, never a box axis; a tilted box on a ledge corner resolves on a box axis.
- **Contact clipping** — a flush box centred over one tile gives the face centre; overhanging a ledge by half its width gives the corner that is still over the tile; a 20° tilt gives a single vertex.
- **The flat rest, watched failing.** Drop a flat square onto a floor within a single tile's width, run 300 steps: `|ω| < 1e-6`, `vy === 0`, and the last 100 positions **bit-identical**. Then confirm the naive single-deepest-vertex version fails it at ≈4.4 rad/s before deleting that version. Phase 3's lesson stands — a test named in a brief is a hypothesis until it is watched failing.
- **Spin sign off a ledge.** Box falling with its centre past a ledge's right edge contacts at `r = (−a, +b)`, `n = (0,−1)`, so `r × n = +a` and ω goes **positive** — clockwise on screen, right side down, tipping off the ledge. State the sign in the test, not just its non-zeroness.
- **Auto-right** — 25° grounded settles under 0.02 rad within 24 steps (0.4 s), monotonically, no overshoot past zero.
- **Flipped gravity** — with `gravitySign = −1` a body falls *up*, lands on what was the ceiling, and reports `grounded`. Nothing else exercises this path until phase 5 depends on it.
- **The one-tile corridor**, two ways: a *vertical* shaft dropped through at 0°, 22.5° and 45° with a 1 px lateral offset (gravity drives it, no floor contact rights the angle, so the geometry is tested and nothing else), and a *horizontal* run through at `RUN_SPEED` with ω = 8 rad/s. Both assert exit, plus that ω never exceeds `MAX_ANG_SPEED`.
- **Horizontal control survives contact** — running flat for 300 steps loses exactly zero `vx`. The floor normal is vertical and the model is frictionless, so the arcade clamp must be a no-op on the tangent (hard rule 7).
- **No tunnelling** at 4000 px/s through a one-tile floor, and the inside-corner fixed point: 300 steps wedged in a corner, last 100 positions bit-identical.
- **Determinism** over 600 steps with a scripted input sequence, compared with `toBe`, **plus a guard that the trajectory is non-trivial** — that it moved, rotated and contacted — or the assertion passes on a body that never left the spawn.
- **Derived numbers** — jump peak, airtime, and spin per jump (73.0° standing, 177.6° at full speed, ±2 %: applying damping after the advance biases the discrete sum +0.33 %).

### Verification that isn't a unit test

`npm run dev`, with the phase 3 test grid:

- A standing jump turns ≈73°; a full-speed jump turns ≈178° and lands on the opposite face. This is the phase's headline and no unit test can tell you whether it *reads*.
- Land tilted on one of the grid's ledges — it settles in ~0.26 s with no snap, no wobble, and no fight between the spring and the contact.
- Run into a wall at full speed: no spin, no stick, and horizontal control returns the instant you press away.
- Fall into the 4-tile gap at terminal velocity — no tunnelling, and the landing is dead, not mushy.
- The paper core now reads a *simulated* angle rather than a console-driven one; confirm it still does its job flush against ink geometry.
- Time the solver over ~600 frames through `window.__bw`, worst case first (terminal velocity into a corner), record it in *As built*, delete the harness.
- Press space: colours invert, **gravity does not**. Phase 4 passes `gravitySign = +1` and nothing else; if the world falls upward, decision 8's line got crossed.

### Risks

- **Wedge oscillation in tight corners** is the failure this phase actually risks. Four things fight it, and they are all in decision 4: merged manifolds (a corner is one contact per normal, not one per tile), deepest-first, the iteration cap, and the `SLOP` fixed point. The corner test asserts convergence directly rather than trusting them.
- **`IMPACT_SPEED_MIN` is a cheat, and it has a boundary.** A contact at exactly the threshold either spins you or does not. It sits at a 1.96 px drop, which is not a speed anything in the game arrives at, but it is a discontinuity and it is worth knowing where it is when something looks wrong.
- **The centre-origin migration is wide and mechanical**, like phase 2's `Input` collapse — and, like it, every missed site is a typecheck error rather than a silent bug. The one place that is *not* type-checked is arithmetic that happened to be right for a top-left origin: the out-of-bounds check in `play.ts` is the whole of it.
- **`obb.ts` is where a sign error hides.** It is pure, cheap to test exhaustively, and the only layer where a wrong sign produces plausible-looking motion instead of a crash. If any test in this phase is over-invested, make it that one.

**Exit:** a headless test drives a body through a hand-built grid and lands it, spinning, on a target tile; a flat square lands flat and stays bit-identically still; the browser shows a square that tumbles when it jumps, catches on corners, and rights itself. `npm run typecheck` and `npm test` green; PHYSICS.md §Per-step algorithm, §Contact point and §Rotational damping, and GAME-DESIGN §6/§12, amended where this phase contradicted them.

### As built

All met. Tests 165 → 226, typecheck clean. The eight decisions held; the brief's *predictions* mostly did not, and the two failures the phase actually hit were not on its risk list.

- **The integrator prediction was exact and the apex is 0.002 % off.** Sampled peak 111.361 px against the analytic 111.364 — three orders of magnitude better than the ±5 % target, exactly as decision 1 said, because average-velocity integration is exact for constant acceleration and the only residual is that the true apex falls between samples. `vy` at rest is `0`, not `0.0`-ish: the arcade clamp can be shown never to overshoot into separation, so `v·n` lands on exactly zero. Airtime 34.2 steps, spin per jump 72.87° / 177.3° measured in the browser against 73.0 / 177.6, with the +0.33 % discrete bias landing precisely where predicted.
- **Two real bugs, both from tile *seams*, and neither is in the brief.** They are the same shape — a surface that is one thing to a player and several things to a solver — and between them they cost more than every decision in the brief combined.
  1. **A contiguous floor is not a floor.** A square landing across a tile seam barely overlaps the second tile horizontally, so *that* tile's cheapest separating axis is sideways: measured, an ordinary landing was shoved along the floor with **8.07 rad/s** of spin. The fix is exact rather than heuristic — if the neighbour in the push direction is solid, the push drives the box into solid material, so the contact is spurious and the neighbour owns the real one. `FACE_*` / `faceBlocked` in `obb.ts`, four `map.get` calls per tile in the broadphase. Out-of-bounds reads do the right thing for free.
  2. **Resting slop clips the corner off the wall beside it.** A resting body sits `CONTACT_SLOP` inside the floor and sinks a further 0.489 px each step before resolution, so its lower corner hangs past the bottom of the adjacent wall tile. Clipped strictly, that corner is discarded, the wall contact degenerates to its single upper corner, and **walking into a wall answered with 3.65 rad/s of spin conjured out of nothing but slop.** Hence `CLIP_TOL` — tangential, and necessarily larger than the depth band `CONTACT_TOL`, which is the whole reason it is a separate constant.
- **Decision 4's ordering was under-specified in the direction that matters, and the inside corner found it.** "Resolve the deepest first" can be read as "resolve all of them, deepest first", and that reading oscillates: the wall push moves the body 5 px, and the floor manifold behind it is then resolved against candidate points from *before* the move. **Only one manifold is resolved per pass**, then straight back to the broadphase — which is what PHYSICS.md said all along, and is also what makes `MAX_CONTACT_ITERS` = 4 mean what decision 4 claims it means.
- **The named "flat rest, watched failing" assertion had no teeth, and its predicted number was wrong twice over.** Phase 3's lesson repeating, exactly. Measured against the naive single-deepest-vertex contact point: the landing is kicked to **−12.25 rad/s**, but the spring then returns it to *exactly* zero within 100 steps — so the brief's end-state assertion (`|ω| < 1e-6`, positions bit-identical) **passes on the very implementation it is named for**. It now asserts the whole trajectory — a flat landing must produce no rotation at *any* point — and fails against the naive version at 12.25. The brief's ≈4.4 rad/s permanent roll needs decision 3 removed as well, and is then **2.20 rad/s** (126°/s), not 4.4: the taper is stronger than the estimate. Three other tests caught the naive version unaided; the headline one did not.
- **The wedge oscillation the brief called "the failure this phase actually risks" is closed by decision 3, not by decision 4's four mechanisms.** It is reachable, but only by re-supplying a large velocity every step. A controller cannot: after the arcade clamp, the next frame approaches at `GROUND_ACCEL · STEP` = 35 px/s, under the 117.3 gate, so no torque and the spring keeps running. The corner test now accelerates the way the controller does and converges to a bit-identical fixed point; forcing 300 px/s every step instead gives a clean period-2 limit cycle at ±6 rad/s. Worth knowing which lever actually holds it.
- **`RIGHT_DAMPING` is critically damped on paper and overdamped in practice, and the docs quoted the paper number.** The angle is advanced before the spring is evaluated, so the step map's eigenvalues at 60 Hz are 0.844 and 0.573 — real and positive, hence still no overshoot, but slower than the continuous envelope. Measured 2 % settling is **0.433 s**, not 0.26 s. The design's "~0.3 s" survives at the threshold that reads as square (5 % of a tilt = 1.25°, at 0.350 s), so this is amended in the docs rather than retuned; hitting 0.26 s would want `RIGHT_DAMPING` ≈ 27, which is a feel decision for phase 5.
- **Solver cost is 0.0023 ms/step** at terminal velocity wedged in a corner — the worst case, and **64× under** the brief's 0.15 ms prediction, 0.014 % of the frame budget. Free fall 0.0012, resting flat 0.0005. No harness was added to measure it: `window.__bw.game` from phase 2 plus `Game.stepFrame`'s documented manual-drive path was enough to run the entire browser pass from the console, including the jump angles, the wall, the terminal drop, the flip and the pixel checks on the rotating core.
- **One refinement to decision 4 worth naming:** the sub-step count is taken from the step's actual *displacement*, not from `hypot(vx, vy)`. They agree everywhere in normal play, but a caller handing in a velocity past terminal would otherwise have the clamp shrink the count while the average-velocity drift kept the distance. Measured: a body entering a floor at 4000 px/s never penetrates deeper than `CONTACT_SLOP`.

`gravitySign` is a field on the player that nothing writes — phase 4 passes `+1` and the browser confirms space inverts the palette while the body keeps falling down. It is a real API the solver requires and the tests drive both signs through, not a placeholder. The render-only `angle` hook from phase 3 is retired; `render` reads `body.angle`, and the paper core was pixel-checked rotating with it at 0, 0.6 and 45°.

---

## Phase 5 — Player, world & level format ✅

Turn the simulation into a game. Phase 4 built a body that falls, spins and settles in a room with no entrance and no exit; this phase gives it a level to be in, a reason to cross it, and the two verbs — the flip and the pad — that the level design is built around.

- **`world/tiles.ts`** — the blocking predicate, pad directions, and the char ↔ tile mapping.
- **`world/level.ts`** (new) — parse, validate, and serialise the row-string format from GAME-DESIGN §8. Validation returns human-readable errors (the phase 7 editor shows them verbatim).
- **`world/physics.ts`** — pads are collidable geometry, and contacts carry tile identity.
- **`entities/player.ts`** (rewritten) — the flip with its charge and ground-only recharge; pad response including off-centre torque; out-of-bounds death; the hollow-core charge tell.
- **`scenes/play.ts`** — level lifecycle, death and respawn fades, goal detection, timer, level advance.
- **`src/levels/01-first-steps.json`** and `src/levels/index.ts` — the example stage from GAME-DESIGN §8.

### Eight decisions taken before writing any of it

Four are structural changes to modules phase 4 finished, and each is derived from a conflict between two things GAME-DESIGN already says. The contradictions get amended in this phase's commit.

1. **Pads are blocking geometry, and the blocking predicate has to reach the interior-face test as well as the collision test.** §5 gives pads an off-centre contact torque and §2 draws them as an `ink` slab — both require a real contact point, so a pad is a tile the solver collides with, not a trigger volume. That is a one-word change in `collectManifolds` (`=== Tile.Solid` → `isBlocking(t)`) and a four-word one in the `interior` neighbour lookups beside it — **and skipping the second is phase 4's tile-seam bug, rebuilt at every pad in the game.** A pad set into a floor row would leave its neighbours' faces toward it unmasked, so running over it would find a sideways cheapest-axis and shove the player along the floor, spinning. Phase 4 measured that failure at 8.07 rad/s; the prediction here is the same order, and it is written as a test that is watched failing with the old predicate before the new one lands. The masking also disposes of a rule that reads badly on paper: §5 fires a pad on *contact*, not on contact with its facing side, so brushing the side of an up-pad launches you upward — but a pad set into geometry has its sides masked as interior faces, so the case mostly cannot arise, and where it can (a free-standing pad slab) the simple rule is the readable one.

2. **`StepResult.grounded` and "recharges the flip" are different predicates, so contacts have to carry tile identity.** §5 is explicit that pads do not recharge the flip and only ground contact does — but a pad is now collidable, so landing on one *is* a ground-normal contact and would recharge through the phase 4 API. `Contact` therefore gains `pad: Tile` (`Tile.Empty` when none) and `onSolid: boolean`, copied from the manifold that produced it; the manifold sets `pad` from the first pad tile pooled into it and `onSolid` from whether any plain solid was. Both bits are needed rather than one enum, because a body straddling a pad and the floor beside it must both launch (the pad fired) and recharge (it genuinely touched ground). The alternative — the player running its own positional overlap query for pads after the step — was rejected: the torque in decision 4 needs the contact *point*, and only the solver has one.

3. **The controller's horizontal clamp becomes one-sided, or sideways pads do not exist.** `PAD_IMPULSE` is 820 px/s and the current controller re-clamps `vx` to ±`RUN_SPEED` = 256 on every frame the player holds a direction — so a left/right pad is erased within one frame of firing, and holding *toward* the launch is what erases it. Suppressing control for a few frames instead is not available: hard rule 7 says collision response never takes horizontal control away. The fix is that input may never push `|vx|` **past** `RUN_SPEED`, but may not brake an existing overspeed either: accelerate, then clamp to `max(RUN_SPEED, |vx| before this frame)` in the direction held. Pressing *against* an overspeed decelerates at the normal rate, so turning around at 820 px/s still works. Overspeed then bleeds off at `GROUND_FRICTION` whenever the body is grounded — held direction or not — and is preserved in the air: a pad is a launch, not a permanent speed upgrade, and the ground is where the controller is supposed to govern speed. **Below `RUN_SPEED` the new branch is arithmetically identical to the old one**, which is the prediction: every existing movement assertion in `tests/player.test.ts` passes unchanged.

4. **Pad spin needs its own scale, because the physical impulse form saturates.** Reusing the solver's torque with `j = PAD_IMPULSE` gives `Δω = SPIN_TRANSFER · 820 · (r×n) / 66.7` = 73.7 rad/s at a full corner — five times `MAX_ANG_SPEED`, so it clamps to 14 for any contact more than ~2 px off centre and every off-centre pad hit looks identical. So the pad gets `PAD_SPIN_MAX` = 8.0 rad/s at a full-corner contact, scaled linearly by the arm: `Δω = PAD_SPIN_MAX · (r × n) / (PLAYER_SIZE / 2)`, clamped. `r` is from the **body's** centre (it is a torque arm, not a measure of where the pad was hit), so a flat landing anywhere on a pad gives `r × n = 0` and no spin at all, which is what makes "clip it with a corner and you leave spinning" a real distinction rather than a constant tumble. Sign, stated once so it can be asserted rather than discovered: for an up-pad, `n = (0, −1)` and `r × n = −r_x`, so contact right of centre sends ω **negative** — counter-clockwise on screen, right side lifting. New constant, added to GAME-DESIGN §6 in the same commit.

5. **The palette flip is downstream of the charge check, so `Player.update` returns events.** The scene currently flips the palette straight off the key press. With a charge, a refused flip that still inverted every colour in the world would be the most confusing bug this game could ship — the palette is the only readout of gravity there is. So authority moves into the player (`flipPressed` joins `PlayerInputs`) and the scene learns what actually happened: `update` returns a reused `PlayerEvents { flipped, died }`, and `PlayScene` turns `flipped` into `palette.flip()`. This also keeps a global singleton out of the player's logic path, so headless tests do not mutate the world's colour as a side effect of stepping a body. Deliberately **not** on the events object: a landing impulse for phase 6's splash. Nothing in phase 5 would read it, `StepResult.contacts` already carries impulse per contact, and a field with no consumer is the placeholder the phase 3/4 rule exists to forbid.

6. **No flip buffer, and the jump keeps its.** `JUMP_BUFFER` exists because a jump pressed just before landing is unambiguous — the player wants to leave the ground the instant they touch it. A *flip* buffer means "flip as soon as I can", and the moment the flip becomes possible is the moment you land, so a buffered flip fires you off the floor you just fought to reach. The cost is one frame of strictness: the flip is consumed before `stepBody`, the recharge is read from its result afterwards, so a flip pressed on the exact frame of landing is refused and has to be pressed again 16.7 ms later. That is the right side of the trade, and it is written down here so that if the browser pass disagrees, it is a decision being revisited rather than a bug being found.

7. **`Level` owns a `TileMap`, and parsing returns a discriminated result.** §12 specifies `Level { …, tiles: Uint8Array, … }`, but every consumer downstream — the solver's broadphase, `forEachRun`, the phase 7 editor — takes a `TileMap`, so a raw array would be re-wrapped at every use site and the two would have to agree independently about stride and the seal-sides OOB rule. `Level` therefore holds `map: TileMap` plus `id`, `name`, `spawn`, `goal` (tile coords) and `pads` (positions and directions, kept as a list so phase 6's chevron emitters do not rescan the grid every frame). `parseLevel(raw: unknown)` returns `{ ok: true; level } | { ok: false; errors: string[] }` rather than §12's `Level | LevelError` — the union needs a discriminant to be usable in strict TS, and the editor wants the whole error list, not the first one. Both amended in §12. `S` and `G` are level metadata on `Tile.Empty` cells, not tile values; the enum does not grow.

8. **`SfxName` is aligned with GAME-DESIGN §9 now; the synthesis still waits for phase 6.** The flip, pads, the goal and death all want a sound, and `audio.ts` still carries `coin`, `stomp`, `hurt`, `door` and `gameover` from a game that no longer exists — phase 2's *As built* flagged that module as its one remaining overshoot. Renaming the union to §9's set (`step jump land flip pad goal death menuMove menuPick`) and pointing the new names at the nearest existing recipes is ~10 lines, deletes the last residue of the old game, and means phase 6 rewrites the synthesis behind a name set that is already correct rather than changing every call site it finds.

### Derived numbers worth recording

- **Up-pad**: peak = 820²/(2·2200) = **152.8 px = 4.78 tiles**; rise 0.373 s, fall 0.295 s, **airtime 0.667 s = 40.0 steps**; horizontal clearance at `RUN_SPEED` = **170.9 px = 5.34 tiles**. Against the plain jump's 4.56 tiles, so a gap of 5 tiles is the smallest that *requires* a pad, which is what the example stage's pad section is sized to.
- **A down-pad pointing along gravity delivers 768 px/s, not 820** — the directional `MAX_FALL_SPEED` clamp catches it on the next step, 93.7 % of nominal. Pointing against gravity it delivers the full 820. Not a bug to fix: terminal velocity is terminal, a down-pad under normal gravity is a slam rather than a launch, and level design should read it that way.
- **A full-corner pad hit turns the square 268°** over its own airtime (8.0 rad/s decaying at `ANG_DAMP_AIR`), against 178° for a full-speed jump. Three-quarters of a turn: every corner pad hit lands on a different face.
- **The flip's kick turns it ≈49°** across a 0.3 s ceiling crossing — a legible tilt, not a tumble, which is the intent: the flip's drama is the world inverting, not the square spinning.

### The example stage

`01-first-steps` is the phase's real deliverable and the only part of it no test can prove is *good*. Beats, in order, each sized from the numbers above: a flat run long enough to reach `RUN_SPEED` (~0.12 s, 2 tiles) and then some; a **3-tile gap** cleared by a plain jump with margin; a **ceiling section** whose slab sits within jump reach of the floor, crossed by flipping at the apex and running along what is now the floor; an **up-pad** under a 5-tile rise that the jump cannot clear; a **one-tile corridor** entered while spinning, which is the game's signature sensation and its most likely place to get stuck; and a goal placed so the final approach is a flip landing on the ceiling. Roughly 48 × 20 tiles — a screen and a half wide, one and a bit tall.

### Order of work

Bottom-up again, and for the same reason as phase 4: the layers that poison everything above them go first.

1. **`tsconfig.json`** — add `"resolveJsonModule": true`. It is absent today, so the very first `import level from './01-first-steps.json'` fails `npm run typecheck` while vite and vitest both resolve it happily. Cheap to fix, confusing to hit at step 8.
2. **`constants.ts`** — `PAD_IMPULSE` 820 px/s and `DEATH_FADE_OUT` / `DEATH_FADE_IN` 0.35 / 0.25 s (specified in §6, never yet implemented), plus this phase's additions: `PAD_SPIN_MAX` 8.0 rad/s (decision 4), `GOAL_HOLD` 1.2 s and `CORE_OUTLINE_WIDTH` (both shell-scoped; see below). The new ones join §6's table in the same commit.
3. **`world/tiles.ts`** — `isBlocking(t)`, `padDirection(t): {dx, dy} | null`, and `tileFromChar` / `charFromTile` for the four pad chars plus `.` and `#`. The char mapping lives beside the enum because the phase 7 editor palette needs exactly the same table; `S` and `G` stay `level.ts`'s business.
4. **`world/level.ts`** + tests, before anything depends on it.
5. **`world/physics.ts`** — decisions 1 and 2. Small, and the riskiest edit in the phase.
6. **`engine/audio.ts`** — decision 8.
7. **`entities/player.ts`** — the flip and its charge, the pad response, the one-sided clamp, death detection, and the hollow core: §2 specifies the charge state as *the* readout (solid `paper` core when charged, a `paper` outline when spent — no HUD, no meter), so `render` branches on the charge, never on the palette phase.
8. **`src/levels/01-first-steps.json`** and **`src/levels/index.ts`**, which parses eagerly and throws with the joined error list — a level that fails validation is a build-time bug and must never reach a player as a blank screen.
9. **`scenes/play.ts`** — the lifecycle state machine (`Running → Dying → Respawning → Running`, plus `Won`), the timer, goal detection, best-time submission, level advance.
10. **Tests, typecheck, browser pass, doc amendments.**

### PlayScene specifics

- **Spawn** is the `S` tile's centre, at rest and square. Not "feet on the floor" — that would require knowing where the floor is; the 6 px drop onto it costs two frames and is invisible.
- **Goal** fires when the body's **centre** is inside the goal tile's rect. Rotation-independent, one condition, trivially testable, and it means the goal reads as "get *in* the square" rather than "graze it with a corner".
- **Death** fires when the body is *entirely* past the top or bottom edge (`y + half < 0` or `y − half > heightPx`). The camera's `CAMERA_VSLACK` exists to keep that frame legible, so the body keeps simulating through the fade-out rather than freezing — it flies out of shot, which reads as a consequence instead of a pause.
- **The fade is to `ink`.** Fading to `paper` is what the vignette already does, so a death that dimmed toward the background colour would read as a speed effect. It needs `palette.inkRgba(a)` alongside the existing `paperRgba` (hard rule 6: the hex stays in the palette), and the colour is **sampled once at the death instant and held**, because the palette resets to phase A at the fade's peak — under a held colour that reset is invisible, and under a live token the screen would jump from white to black at the covered moment.
- **`R` restarts instantly, with no fade.** The fade is death's punctuation; a restart the player asked for does not need punctuating, and §5's promise is that failure is not a punishment.
- **Gravity and palette phase are one piece of state in two places** — `gravitySign = +1 ⟺ palette.phase = 0` — maintained only by this scene, across flips, deaths, restarts and level advance. It gets a dedicated test because nothing in the type system holds it.
- **The timer** accumulates fixed steps (hard rule 5: no wall-clock on a logic path), runs only in `Running`, and resets on death or restart. The `dateIso` written to `bw.best.<id>` on completion is a wall-clock read on a persistence path, which is not a logic path — noted here so it does not look like a violation later.
- **Level advance and the completion readout are shell placeholders** and must look it, exactly like phase 2's test grid: freeze, hold `GOAL_HOLD`, fade, next level or back to the title. Phase 7 replaces them with `ResultsScene`, and `GOAL_HOLD` goes with them.

### Test suite

| Action | Files |
| --- | --- |
| Add | `level` (parse, validate, serialise, round-trip), `playscene` (lifecycle, and the scripted playthrough) |
| Extend | `player` (flip, charge, pads, one-sided clamp, death — the existing movement assertions must survive **unchanged**, per decision 3), `physics` (pads block; interior faces; contact tile identity), `tiles` (`isBlocking`, pad directions, char mapping), `constants` (the pad derived numbers) |
| Keep | `obb`, `camera`, `renderer`, `palette`, `font`, `game`, `input`, `save`, `rng`, `particles`, `audio` |

`PlayScene` is node-testable without a canvas: `update` touches only `game.input`, `game.audio`, `game.save` and `game.setScene`, all three of which construct fine under node, and `render` is never called. A ~15-line `fakeGame()` helper cast through `unknown` is the whole harness — and the scripted playthrough then drives real `KeyboardEvent.code` strings through `Input.onKey`, so the binding table is on the tested path too. The alternative, extracting the lifecycle into a pure session module, is rejected: phase 7's editor playtest is specified to hand a level to the *real* `PlayScene`, and a second owner of the level lifecycle is exactly what it must not find.

Assertions worth naming:

- **The pad seam, watched failing.** A `PadUp` set into a floor row, run over at `RUN_SPEED`: no angular velocity is produced at any point. Then confirm the `=== Tile.Solid` interior predicate fails it — the prediction is spin of the same order as phase 4's 8.07 rad/s — before the new predicate lands. Phase 3 and phase 4 both found a named assertion in the brief that passed against the very implementation it was written to catch; this one is only worth writing if it is watched failing.
- **Pads override, not add.** Approaching one pad at 100 px/s and at 700 px/s produces the identical launch velocity. And a down-pad along gravity settles to `MAX_FALL_SPEED`, not `PAD_IMPULSE`.
- **Pad spin sign**, stated explicitly as in phase 4's ledge test: contact right of centre on an up-pad ⇒ ω negative. Plus: a flat landing centred on a pad produces exactly zero spin.
- **The charge cannot be spent twice.** A second flip in the air is refused and leaves the body **bit-identical** — not merely un-flipped: `gravitySign`, `vy` and `angVel` all untouched, since the failure mode that matters is a partly-applied flip.
- **Recharge discriminates by tile, not by normal.** Landing on solid recharges; landing on a pad does not; landing across a pad/floor seam does; and a body balanced on a corner within `GROUND_NORMAL_DOT` recharges, because §5 says standing on a corner is standing.
- **The one-sided clamp**, four ways: input alone never exceeds `RUN_SPEED`; input held toward an 820 px/s overspeed preserves it; input held against it decelerates at the normal rate; and grounding bleeds the overspeed off at `GROUND_FRICTION` even with the direction held.
- **Death planes** — fires fully above the top row and fully below the bottom row, does not fire on a body pressed against a sealed side, and does not fire on a body resting on the bottom row.
- **Gravity/palette lockstep** across a scripted sequence of flips, a death, a restart and a level advance.
- **Level validation** catches ragged rows, zero or two `S`, zero or two `G`, an unknown character (reporting its row and column), an empty `rows` array, and a non-string row — each with a message a human can act on. `parse(serialize(level))` deep-equals the original. **Every level in `LEVELS` parses with zero errors**, which is the assertion that stops a broken grid shipping.
- **The scripted playthrough completes the example stage.** The direct descendant of the old bot-playthrough test and the best regression guard in the suite — but it asserts **completion, not trajectory**: a coarse program of held directions and timed presses with slack, so it fails when something meaningful changed rather than every time a constant moves by a percent. Bit-identity is already pinned by the physics determinism test and does not need pinning twice. On failure it reports how far it got and why it stopped (died where, or ran out of steps), because a bare `expect(won).toBe(true)` on a 40-second simulation is close to undebuggable.

### Verification that isn't a unit test

`npm run dev`, on the real level:

- **The stage, start to finish**, more than once. This is the phase's headline and the one thing with no test behind it.
- **Pads read as pads.** The chevron is two `paper` bars drawn through `rectRotated` at the pad's angle — one primitive, one code path, all four directions — and the check is that a pad set flush into a floor row is unmistakable at a glance, in both phases.
- **The hollow core reads.** With `PLAYER_CORE_INSET` = 5 the core is 10×10, so a 1 px outline may be too thin to see at speed; `CORE_OUTLINE_WIDTH` gets its final value here, against ink geometry and while rotating, exactly as `PLAYER_CORE_INSET` did in phase 3.
- **One flip per airtime is felt, not just true.** Flip mid-jump, land on the ceiling, confirm the recharge; then try to flip twice and confirm nothing at all happens — no colour twitch, no gravity stutter.
- **The death fade**, including that the phase reset at its peak is invisible, and that dying while in phase B comes back in phase A cleanly.
- **The one-frame flip strictness** (decision 6) — press flip on the landing frame repeatedly. If it reads as unresponsive rather than as strict, that is the decision to revisit, and the revision is `JUMP_BUFFER`'s three lines.
- **A corner pad hit into the one-tile corridor**, which is the phase's worst case for wedging: 268° of turn arriving at 3.7 px of clearance.

### Risks

- **Decision 1 is a two-word edit in the solver and the only change in the phase that can break phase 4's work.** The existing physics tests all use `Tile.Solid`, so they will pass either way — which is precisely why the pad-seam test has to be watched failing rather than trusted.
- **The example stage is authored, not derived, and "playable" is not "good".** The tests can prove it can be completed; nothing can prove it teaches the flip in the right order or that the corridor is thrilling rather than infuriating. Budget browser time for pacing, and expect the grid to change more than the code does.
- **The playthrough script is authored by iteration and will be the most brittle file in the repo.** Slack in the script and a diagnostic failure message are the mitigation; committing the level and the script together is the other half. If it starts needing a re-record on every retune, the level geometry has margins that are too tight, and that is level feedback rather than a test problem.
- **The one-sided clamp sits in the most-played code path in the game.** A sign error there means you cannot turn around at speed — a bug that would feel like ice physics and read like a physics bug rather than a controller bug. Its four assertions are cheap; write them first.
- **`R` and death share a respawn path but not a presentation.** The reset is the thing to keep in one place: gravity, palette, charge, timer, camera snap, particles, `speedNorm`. A reset that forgets one field is the classic source of "the second attempt plays differently from the first".

**Exit:** the example stage is playable start to finish in the browser — run, jump, flip across the ceiling, take the pad, thread the corridor, land on the goal — with a working timer, best time persisted under `bw.best.01-first-steps`, and death and respawn that read as intended. `npm run typecheck` and `npm test` green; GAME-DESIGN §5/§6/§12 and PHYSICS.md § Grounded / § Game feel amended where this phase contradicted them.

### As built

All met. Tests 226 → 311, typecheck clean, the stage completes in **405 steps / 6.77 s** headlessly and in the browser at the same step count. The eight decisions all held. What the brief got wrong was arithmetic about its own level, and — for the third phase running — the assertion it named as the phase's headline.

- **The named pad-seam assertion was watched failing, and this time it had teeth: 8.32 rad/s**, against the brief's prediction of "the same order as phase 4's 8.07". But only after the test was rewritten. The obvious version — *run over a pad set into a floor and assert no spin* — **passes against the broken predicate**, because a sliding body penetrates by half a pixel and the sideways axis is never the cheapest one. The failure needs a body *landing* across the seam, straddled so the floor tile (not the pad) is the one left with a sliver of horizontal overlap; then its unmasked face toward the pad wins and shoves the landing sideways off one corner. Phases 3, 4 and 5 have now each found a brief's headline assertion to be vacuous as written. **The rule is not "write the test the brief names" — it is "watch it fail, and if it does not, the test is wrong before the code is."**
- **The brief's example stage does not exist, because two of its numbers are impossible.** "An up-pad under a **5-tile rise**" cannot work: the pad peaks at 152.8 px = 4.78 tiles, so 4 is the largest rise it answers (and the plain jump's 3.48 cannot, which is the property that matters). And "roughly 48 × 20" does not hold the beats at their derived sizes — the chasm has to be 6 tiles so a jump cannot cheat it, and the pad needs 3 tiles of run-up plus 4 of landing. **60 × 20** as built. GAME-DESIGN §8 amended with both.
- **A one-tile corridor entered on the ground cannot be tight, and the brief's worst case is unreachable.** The auto-right spring settles a grounded body in ~0.35 s ≈ 3 tiles, and the pad's landing needs at least that much runway to be legible, so the body is always square by the corridor mouth: measured **12.0 px of clearance**, and moving the corridor two tiles closer bought 0.55 px. Driving it in deliberately hostile — entering at `MAX_ANG_SPEED` backwards and tilted — still gives 11.45 px and zero stalled frames. The 3.7 px figure is real but only at 45°, where a grounded body scrapes and passes. **The corridor's danger is only available to a body arriving airborne**, which is a note for later levels rather than a fix for this one.
- **The timer was charging the winning frame's `dt` after recording the result**, so the persisted best time was one step behind the clock the player watched — a 16.7 ms lie on every entry. Caught by the best-time test, not by the playthrough. The timer now charges before the step.
- **Every beat of the playthrough script is load-bearing, and that was verified by deleting them one at a time.** Removing the jump dies in the 3-tile gap; removing the first flip dies in the chasm; removing the second flies out of the *top* off the end of the ceiling slab; removing the last runs to the far wall and never reaches the goal. A completion test that passes with a beat removed is testing the level's shape, not the player's.
- **Two constants got their final values from pixels, exactly as `PLAYER_CORE_INSET` did in phase 3.** `PAD_CHEVRON_WIDTH` went 3 → 5: the arms sit at 45°, so a 3 px bar antialiased into mid-grey — 70 dark pixels in the tile but only **2** pure ones. At 5 it is 129 dark and 30 pure, against 0 for a plain solid tile, and the whole thing inverts exactly on a flip (131/893 → 893/131). `CORE_OUTLINE_WIDTH` = 2 holds: the spent core measures an 80 px ring around a 64 px window against the charged core's 100 px fill, and the gap survives rotation.
- **The death fade lands on the respawn background for free.** Dying in phase B fades to phase-B `ink`, which *is* phase-A `paper` — the tokens swap, so the held colour and the world revealed under it are the same hex. Measured across the fade: mean luminance 232.9 → 10, the palette resets to phase A at exactly the frame the screen reads 10, and the reveal ramps back out. The phase reset at the peak is not merely hidden, it is a no-op on screen.

- **A pad could fire twice in one step, and only a count could see it.** Found in review, not by any test written from the brief. `StepResult.contacts` is keyed by *normal*, and one tile can be resolved on two normals inside a single `stepBody` — a body clipping the corner of a free-standing slab at 800 px/s does exactly that. The velocity override is idempotent, so the launch looked right; the spin is not, and it took two full `PAD_SPIN_MAX` terms, two sounds and two dust bursts. The fix is one flag: at most one pad per step, first contact wins, which is deterministic because contact order is pinned. **The regression test had to count `sfx('pad')` calls, because the obvious assertion cannot work** — a bound on `angVel` of `2 · PAD_SPIN_MAX` = 16 sits *above* `MAX_ANG_SPEED` = 14, so the clamp swallows the whole second term and the test passes against the bug. Written the tight way it fails at 2 and passes at 1.

Three things worth carrying to later phases. **`PlayScene`'s `index` defaults to 0**, so a level that is not in `LEVELS` — which is exactly what phase 7's editor playtest hands it — would advance into `LEVELS[1]` on completion instead of returning to the editor. Harmless today because there is one level and `nextLevel(0)` is null; phase 7 owns the fix, and the honest one is to make "part of the campaign" explicit rather than defaulting it. **A down-pad set into a floor is a trap**: its impulse drives the body back into the tile it is embedded in, so it re-fires every step and pins you. The same is true of any pad whose facing points into its own geometry. That is a level-authoring footgun rather than a code bug — §5 fires a pad on contact and being pressed into one is a legitimate consequence — so it is documented rather than special-cased, and the editor's validation in phase 7 is the right place to warn about it. And the brief's claim that `73.7` rad/s is the saturating physical pad torque is **73.8**: it was computed against the rounded 66.7 rather than `PLAYER_INERTIA`'s exact 400/6. Same conclusion, and `tests/constants.test.ts` now pins the exact one.

`world/level.ts` was built by a subagent against a written contract and needed no correction; its 31 tests and the round-trip property came back clean on the first integration.

---

## Phase 6 — Particles & audio ✅

The layer that makes speed feel like something. Phase 3 built the visual half of `speedNorm` and phase 5 built the game underneath it; this phase adds the two channels that are still silent — the accent, which is the only colour the game has, and the audio, which is the only part of the design that has never once run.

- **`engine/particles.ts`** — pooled, fixed-capacity, accent-coloured. The emitter set in full: dust while running, a directional burst on jump, a splash on landing scaled by impact speed, a ring on flip, and the pads' continuous directional stream.
- **`engine/audio.ts`** (rewritten) — the shared feedback-delay send, SFX as filtered noise and blips with fast envelopes, and the four-layer techno bed on a lookahead scheduler against `AudioContext.currentTime`, gated and cross-faded by `speedNorm`.
- **`entities/player.ts`** — the emitters it owns: the running dust and step cadence, the landing splash, the flip ring.
- **`scenes/play.ts`** — the pad streams, and `setIntensity` as the third call site of the one number.

### Nine decisions taken before writing any of it

Three contradict something already written down — two in GAME-DESIGN §12, one in this file's own phase 6 outline above — and each is amended in this phase's commit.

1. **The scheduler is a pure function that returns notes; the class only turns notes into nodes — and the node-making is testable too.** This is phase 3's split (`vignetteAlpha` is pure and exported, `applyPost` is only the drawing) applied to the one module that has never had a test worth the name. `scheduleWindow(state, now, intensity, out): number` fills a caller-supplied buffer with `{ at, layer, f0, f1, dur, gain }` events and advances the cursor; it is arithmetic over a beat grid and unit-tests in node against hand-computed times. What is left inside `AudioSys` is `createOscillator` / `connect` / `start` / `stop`, which no pure test could ever have caught — **so it gets an injected context factory instead**: `new AudioSys(makeCtx?)`, defaulting to the guarded `new AudioContext()` and taking a ~60-line fake in tests. That is the difference between "the module imports without throwing under node" (which is what `tests/audio.test.ts` asserts today, and is nearly worthless) and actually driving the graph. `obb.test.ts` was phase 4's over-investment on purpose; the fake context is this phase's.

2. **A stalled scheduler resyncs; it does not catch up.** The textbook lookahead loop is `while (next < now + LOOKAHEAD) { schedule(next); next += SIXTEENTH; }`, and it is correct only while it is pumped faster than it advances. It is pumped from the frame loop, and `FixedStepper.maxFrame` is **250 ms against a 100 ms lookahead window** — a backgrounded tab, a long GC, or a devtools pause leaves `next` arbitrarily far in the past, and the loop then schedules every missed note with a start time already elapsed. WebAudio fires those *immediately and simultaneously*: a 3-second stall is **25.6 sixteenths** dumped into one instant, which is not a glitch you have to listen carefully for. So the cursor carries a rule: if `next < now`, snap it to the next grid position at or after `now` and drop what was missed. Bars are 16 sixteenths and every pattern is bar-periodic, so snapping to `ceil` on the *sixteenth* grid keeps the downbeat aligned and the resync is inaudible beyond the gap itself. The same path covers two other cases with no extra code — the AudioContext still suspended by autoplay policy (its `currentTime` does not advance, then jumps), and unmuting mid-bar.

3. **A gate is a target gain, not a switch, and a fully closed layer costs nothing to schedule.** §7 gives four gates (0.0 / 0.25 / 0.45 / 0.70) and §9 says layers cross-fade over `MUSIC_FADE` rather than hard-switching, which rules out gating at *scheduling* time: a note carries the gain it was scheduled with, up to `MUSIC_LOOKAHEAD` ahead of when it sounds, so a scheduling-time gate is a hard switch by construction no matter what the gain node does afterwards. Each layer therefore owns a `GainNode` whose target is `speedNorm > gate ? 1 : 0`, approached exponentially at `MUSIC_FADE`. Scheduling then skips any layer whose *current* gain is below `MUSIC_GATE_EPS` — so a closed layer allocates no nodes at all, a fading one still plays and is audibly fading, and the two facts stay consistent because they read the same number. `speedNorm` is already smoothed at `SPEED_SMOOTH_RATE`, so a player hovering on a gate boundary gets a slow swell, not a flutter; no hysteresis is needed on top and none is added.

4. **`setIntensity` is the pump, and the music belongs to `PlayScene` alone.** The outline calls `setIntensity(speedNorm)` "the single hook the play scene calls", and it can be exactly that: it is called once per frame with the live value, which is precisely the cadence a lookahead scheduler wants, so it sets the target *and* advances the cursor. No `setInterval` (which would outlive the scene and drift against the audio clock), no second `update(dt)` beside it. The bed then starts in `PlayScene.enter` and stops in `exit` — the `Scene.exit` hook has existed since phase 2 and nothing has used it yet — and the title screen stays silent but for its menu blips, because a techno bed under a motionless title screen spends the escalation before the player has done anything to earn it. Two consequences that are one line each and easy to forget: intensity is fed **0** in `dying` and `won` rather than `speedNorm`, so death and the goal are punctuated by the bed dropping out, and the *body keeps simulating through the death fade* (phase 5), so the un-ducked version would have the music swell as the corpse accelerates out of shot.

5. **`muted` stays a property, but it has to act.** §12 specifies `setMuted(b)`; the code has a public `muted` field and `Game.toggleMute` assigns to it. Renaming is six call sites of churn, but the field cannot survive either — with a running scheduler, muting is no longer "return early from `play`", it has to duck the master gain and stop scheduling, and unmuting has to resync (decision 2). A getter/setter pair does both: every existing call site compiles unchanged, and the mute becomes an action. §12 is amended to describe the accessor rather than `setMuted`.

6. **Particles stop storing a colour and render in the live accent, one `fillStyle` for the whole pass.** `ParticleOpts.color` has no caller — `burstDust` never sets it — and the per-particle field it feeds is a placeholder by the phase 3/4 rule. Deleting it is not just tidying, it decides three things at once. §2 wants the flip legible from a single spark, and sparks that keep their spawn-time hex mean a flip leaves a cloud of the *outgoing* colour drifting through the new world. It disposes of an ordering trap that would otherwise be found by eye: the flip ring is emitted inside `Player.update`, and `PlayScene` flips the palette *after* that returns (phase 5 decision 5), so a spawn-time colour makes the flip's own ring the one thing on screen still wearing the old phase. And the render pass becomes one `fillStyle` assignment plus N `fillRect`s instead of N of each. The existing comment claiming spawn-time sampling is deliberate goes with it.
   **Particles keep their integer rounding**, which is a documented exception to phase 3's coordinate policy rather than an oversight: a spark is 1–3 px, and sub-pixel placement spreads a 2 px square into a dim 3×3 smear — on the only saturated colour in the game, whose whole job is to read as an event. ARCHITECTURE.md's policy table gains the row.

7. **Emitters are gravity-relative, and the pool gets a rotating cursor.** Every emitter in this phase is specified in terms of "down" or "away from the surface", and this game has neither: dust must fall along `gravitySign` (a flipped player kicking up dust that falls toward the ceiling they are standing on is the kind of wrongness nobody can name but everybody sees), and the landing splash sprays along the **contact normal**, which the solver already hands over, not along −y. So `spawnDust`/`spawnSplash` take the sign or the normal, and `Particle.gravity` is signed at spawn. Separately, `spawn` currently scans the pool from index 0 for a free slot, which is O(512) per call — fine for one dust burst, wrong for a continuous stream. A rotating cursor makes it amortised O(1) and, as a free side effect, turns the drop-newest overflow policy into round-robin reuse. **This supersedes this file's own phase 6 outline, which asked for oldest-first recycling**: that needs a per-particle timestamp to service a case the budget below says cannot arise (peak occupancy ≈ 120 of 512), and dropping is the policy that degrades gracefully — a full pool that starts evicting live sparks looks worse than one that quietly emits fewer.

8. **The player owns its own emitters, so `PlayerEvents` does not grow — and the dust and the step sound share one accumulator.** Phase 5 deliberately kept a landing impulse off the events object, on the grounds that `StepResult.contacts` already carries impulse per contact and a field with no consumer is a placeholder. That holds now that the consumer exists: the player is already looping the contacts (for the recharge and the pad), so the splash reads the largest-impulse ground contact right there and `PlayerEvents` stays `{ flipped, died }`. The ramp itself is pure and exported — `splashCount(impulse)` over `IMPACT_SPEED_MIN → MAX_FALL_SPEED`, tested like `caOffset`. And the running dust and the `step` sound are driven by **one distance accumulator over ground displacement**, not by two timers: distance is what makes the cadence scale with speed for free, it cannot fire while a body is pinned against a wall at full throttle with zero displacement, and one accumulator means the spark and the tick can never disagree about when a footfall happened.

9. **The pad's `paper` chevron stays; the stream is added beside it.** `scenes/play.ts` currently carries a comment saying phase 6 *replaces* the static bars with the particle stream. That is wrong and the reasoning is phase 5's own: `PAD_CHEVRON_WIDTH` got its value from counting pure pixels against a pad flush in a floor row, because the chevron is what makes a pad identifiable **at a glance and at rest**. Sparks are transient by construction — they thin out when the pool is busy, and there are none at all on the frame a level loads. §2's wording ("an `ink` slab with an animated chevron of particles") reads as replacement; §5's ("a continuous animated particle chevron … the pad's idle state") reads as animation. The slab plus the static arms are the identity and the stream is the idle animation; the comment is corrected in this phase.

### Derived numbers worth recording

- **The grid.** 128 BPM ⇒ beat 0.46875 s, **sixteenth 0.1171875 s = 7.03 frames**, bar 1.875 s = 112.5 frames. The bar is not a whole number of frames and must not be — the music runs on the audio clock, and the two clocks are deliberately unrelated.
- **The lookahead window is 0.1 s = 6 frames**, so it survives a five-frame hitch untouched; `FixedStepper.maxFrame` is 250 ms, **2.5× the window**, which is the relation that forces decision 2 rather than a preference for it. A 3-second stall is 25.6 sixteenths.
- **Footfalls at `STEP_SFX_DIST` = 24 px land five to the beat at `RUN_SPEED`** — 256/24 = 10.67 Hz against a 0.46875 s beat, exactly 5.0. A quintuplet against a 4/4 grid, and it only sits there at flat-out speed; any other speed phases against the bed. Worth knowing before deciding the tick sounds wrong.
- **Pad stream**: 90 px/s × 0.45 s life = **40.5 px = 1.27 tiles** of travel, one particle every 0.07 s ⇒ 6.4 alive per pad, ⇒ 51 for eight pads on screen.
- **Splash**: impulse is per unit mass with `RESTITUTION` 0, so it is the approach speed. Floor at `IMPACT_SPEED_MIN` = 117.3 ⇒ 2 particles; terminal at `MAX_FALL_SPEED` = 768 ⇒ 20.
- **Predicted peak pool occupancy ≈ 120 of 512** (51 stream + 20 splash + 20 ring + 8 jump + ~5 dust + slack), a 4.3× margin. This is the prediction the playthrough test checks, and the whole basis of decision 7's drop-newest policy.
- **Cost predictions**, in the tradition of phase 3's benchmark: particle render at a full 512 **under 0.15 ms** (the post pass is 0.051 ms and the solver 0.0023 ms, so this would be the second-largest per-frame cost in the game), and the scheduler pump **under 0.02 ms** on a frame that schedules nothing, which is most frames.

### The music, concretely

Four layers, all bar-periodic over 16 sixteenths, all in A minor. No randomness anywhere — the patterns are literal arrays, so the tests can assert them and hard rule 3 never comes up:

| Layer | Gate | Pattern | Voice |
| --- | --- | --- | --- |
| kick | always | 4-on-the-floor (0, 4, 8, 12) | sine 120 → 45 Hz, 0.12 s, no send |
| hats | > 0.25 | offbeat eighths (2, 6, 10, 14) + 16th ghosts at half gain | filtered noise burst, 0.02 s, highpass ~7 kHz |
| bass | > 0.45 | 0, 3, 6, 8, 11, 14 on A1/E2 | triangle through a lowpass, 0.09 s |
| arp | > 0.70 | all 16, A-minor pentatonic ascending over two bars | triangle blip, low gain, **on the delay send** |

The master gain ramps `MUSIC_GAIN_MIN → MUSIC_GAIN_MAX` across the whole range, so the bed swells continuously between the gates as well as stepping at them.

SFX keep phase 5's name set unchanged (that was decision 8 of that phase, and its whole point was that this phase would find the call sites already correct). What changes is underneath: noise-based `step`/`land`/`pad`, sine and triangle blips for the rest, every voice with a fast envelope and an explicit `stop`, and a **shared feedback-delay send** (0.18 s, feedback 0.35, lowpass 2 kHz) whose feedback rises to `SFX_DELAY_FEEDBACK_MAX` with intensity, per §7's "delay feedback rises slightly".

### Order of work

Bottom-up, and the pure layers first so the impure ones are built against something already pinned.

1. **`constants.ts`** — the audio and particle block: `MUSIC_BPM` 128, `MUSIC_FADE` 0.35 s, `MUSIC_LOOKAHEAD` 0.1 s, `MUSIC_GATE_HATS` / `_BASS` / `_ARP` 0.25 / 0.45 / 0.70, `MUSIC_GATE_EPS`, `MUSIC_GAIN_MIN` / `_MAX`, `SFX_DELAY_TIME` 0.18 s, `SFX_DELAY_FEEDBACK` 0.35, `SFX_DELAY_FEEDBACK_MAX`, `SFX_DELAY_LOWPASS` 2000 Hz, `STEP_SFX_DIST` 24 px, `DUST_COUNT`, `JUMP_BURST_COUNT` 8, `SPLASH_COUNT_MIN` / `_MAX` 2 / 20, `FLIP_RING_COUNT` 20, `PAD_STREAM_INTERVAL` 0.07 s, `PAD_STREAM_SPEED` 90 px/s, `PAD_STREAM_LIFE` 0.45 s, `PARTICLE_CULL_MARGIN` 64 px. The gates move out of §7's prose and into the table with the rest.
2. **`engine/particles.ts`** — the cursor, the colour deletion, and the emitter set (`spawnDust`, `spawnBurst`, `spawnSplash`, `spawnRing`, `spawnStream`), replacing `burstDust`. The ring distributes its angles **by index, not by `Rng`** — a randomly-angled ring is a puff, and the flip is the one moment in the game that deserves a shape.
3. **`engine/audio.ts`, pure half** — the beat grid, `activeLayers`, `layerTarget`, the patterns, `scheduleWindow` with decision 2's resync. Tested before a single node exists.
4. **`engine/audio.ts`, graph half** — injected context factory, master → delay send, the voices, the four layer gains, `setIntensity` as the pump, `startMusic` / `stopMusic`, the `muted` accessor.
5. **`entities/player.ts`** — the distance accumulator (dust + `step`), the splash off the contacts, the flip ring, the pad burst.
6. **`scenes/play.ts`** — pad streams from `level.pads` with view culling, `setIntensity` in the update tail beside the existing `speedNorm` smoothing, ducking in `dying`/`won`, `enter`/`exit` for the bed.
7. **Tests, typecheck, browser pass, doc amendments.**

`level.pads` exists for step 6 and for nothing else — phase 5 decision 7 built it so this phase would not rescan the grid every frame. One accumulator on the scene drives **every** visible pad on the same tick rather than one per pad: it is deterministic, it is a single number instead of an array, and pads pulsing in unison reads as intentional.

### Test suite

| Action | Files |
| --- | --- |
| Rewrite | `audio` — currently two tests asserting nothing throws; it becomes one of the larger files in the suite |
| Extend | `particles` (emitters, gravity relativity, cursor reuse, live-accent render), `player` (step cadence, splash, ring, no `PlayerEvents` growth), `playscene` (pool ceiling, intensity call pattern, bed lifecycle), `constants` (the grid relations) |
| Keep | `obb`, `physics`, `camera`, `renderer`, `palette`, `tiles`, `level`, `font`, `game`, `input`, `save`, `rng` |

Assertions worth naming — and phases 3, 4 and 5 each found the brief's headline assertion to be vacuous as written, so **each of these is worth writing only if it is watched failing first**:

- **The stall resync, watched failing.** Pump the scheduler normally, then jump `now` forward 3 s. The naive `while` loop emits **26 events, every one with a start time in the past**; the resyncing cursor emits at most 2, none in the past, and the next downbeat still lands on the bar grid. The prediction is written here so the measured number can contradict it.
- **A hard switch must fail the crossfade bound.** No single frame may move a layer's gain by more than `dt / MUSIC_FADE` = 0.0476; a scheduling-time gate moves it 1.0 in one frame, so the bound has teeth by a factor of 21. Check that before trusting it.
- **Gate boundaries are exact and exclusive.** §7 says "> 0.25", so hats are silent *at* 0.25 and audible at 0.2501. Four gates, eight assertions, and they are the cheapest possible guard on a number that will get retuned by ear.
- **Every node created is stopped.** Drive the real `AudioSys` through the fake context for 100 pumps at full intensity plus a burst of SFX, and assert `createOscillator` + `createBufferSource` calls equal `stop` calls, with zero live nodes at the end. This is the leak that a browser session reveals only after three minutes and a unit test catches in a millisecond.
- **Mute acts.** Muting mid-bar stops scheduling within one pump and leaves the master at zero; unmuting resumes on the grid, not mid-sixteenth (decision 2's path, exercised a second way).
- **The bed is scene-scoped.** `PlayScene.exit` stops it; `dying` and `won` feed intensity 0 while the body is still moving fast enough that `speedNorm` is high — the assertion has to catch the *un-ducked* version, so it must sample during the death fade, not after it.
- **Emitters are gravity-relative.** With `gravitySign = −1`, dust accelerates in −y and a landing splash on the ceiling sprays downward. Stated as signs, as in phase 4's ledge test, not as non-zeroness.
- **`splashCount`** hits `SPLASH_COUNT_MIN` at `IMPACT_SPEED_MIN`, `SPLASH_COUNT_MAX` at `MAX_FALL_SPEED`, is monotone between and clamps outside.
- **The step cadence is distance-driven.** 100 grounded steps at `RUN_SPEED` emit `⌊distance / STEP_SFX_DIST⌋` footfalls; at half speed, half as many over the same duration; a body pressed into a wall at full throttle with zero displacement emits **none** — that last one is the case a timer would get wrong and the reason the accumulator exists.
- **Sparks invert in flight.** Spawn, flip the palette, render through the fake context: every `fillStyle` seen is the new accent, and none is the old one.
- **The pool ceiling under the real playthrough.** Run phase 5's scripted completion of `01-first-steps` with every emitter live and assert peak `aliveCount` stays under `MAX_PARTICLES / 2` — **and that it exceeded 50**, or the assertion passes on a build where nothing ever emitted. Phase 4's non-trivial-trajectory guard, in a new place.
- **Constants** — sixteenth = 0.1171875 s, bar = 1.875 s, `MUSIC_LOOKAHEAD` ≥ 5 frames and `< FixedStepper`'s 250 ms clamp (the relation decision 2 rests on), and `PAD_STREAM_SPEED · PAD_STREAM_LIFE` < 2 tiles.

### Verification that isn't a unit test

Sound cannot be asserted, so this phase's browser pass carries more weight than any before it. `npm run dev`, on `01-first-steps`:

- **The escalation, end to end.** Stand still, then run flat out: the vignette closes, the fringing arrives, hats then bass then arp layer in, and stopping brings all of it back down together. This is the phase's headline and the exit criterion in one.
- **The gates are felt, not counted.** Cross each threshold slowly and confirm a layer swells in rather than snapping — and that hovering on a boundary produces a wobble, not a stutter.
- **A three-minute soak.** Leave it running at speed and watch CPU and heap: the unit test proves the node accounting balances, the soak proves nothing else accumulates, and it is also the only way to hear whether a 128 BPM loop with four layers is still tolerable after two minutes. Phase 3's bounce bug was invisible in ten seconds and glaring in three minutes; assume this phase has one of those too.
- **The step tick is the most likely thing to grate.** `STEP_SFX_DIST` and its gain get their final values here by ear, exactly as `PLAYER_CORE_INSET` and `PAD_CHEVRON_WIDTH` got theirs by pixel count. It is the one constant in the phase with no derivation behind it.
- **Flip mid-flight with sparks in the air** and confirm every one of them inverts (decision 6) — and that the ring reads as a ring.
- **Pads at a glance**, in both phases: the static chevron still identifies a pad with the stream culled off-screen, and the stream reads as the same arrow when it is on.
- **Death and the goal punctuate.** The bed drops out as the body flies out of shot; the death sound is not fighting a swelling arp.
- **Land at terminal velocity, then scrape a wall.** The splash should be a slam at 768 px/s and nearly nothing at the impact threshold — and a wall scrape should produce no footfalls at all.
- **Benchmark, then delete the harness** (phase 3's rule): particle render at a forced 512 alive, and the scheduler pump on a scheduling frame vs an idle one. Record both against the predictions above.
- Mute with `M` mid-bar, unmute, reload with `bw.muted` set — the bed must come back on the grid and the setting must survive.
- Optionally recapture `docs/screenshot.png`: the look materially changes the first time the accent appears in it. Phase 7 refreshes it regardless, so this is a nicety, not a deliverable.

### Risks

- **The only judge of this phase is an ear, and the tests cannot hear.** Everything above is scaffolding around that fact: the pure/impure split makes the *timing* provable, the fake context makes the *bookkeeping* provable, and the sound itself is browser time and nothing else. Budget for it, and expect the recipes to change more than the architecture does.
- **WebAudio node lifetime is the classic leak in this kind of module**, and it degrades slowly enough to ship. The stop-accounting test is the mitigation; the rule behind it is that no node is ever created without a scheduled `stop`.
- **The scheduler is the one place in the project that reads a wall clock on a path that matters.** It is not a logic path — the same argument phase 5 made for `dateIso` on the persistence path — but the corollary has to be written on the module: **nothing in the simulation may ever read the music clock.** A "sync the jump to the beat" idea would break determinism outright.
- **`ParticleOpts.color` is deleted, which is the only breaking API change in the phase.** It has one internal caller and no external ones, so this is a typecheck error at worst — the good kind.
- **The autoplay policy can leave the context suspended** if play is reached without a gesture (`?editor=1` in phase 7, a reload straight into a level). The bed then "runs" against a frozen `currentTime` and jumps when it resumes; decision 2's resync is what makes that a gap rather than a burst, and it should be verified deliberately rather than assumed.
- **Particles are about to become the second-most expensive thing drawn each frame.** 512 `fillRect`s is not much, but it is 100× the count of everything else on screen, and the budget is measured, not assumed.

**Exit:** running fast visibly and audibly escalates — vignette closing, colour fringing, sparks trailing, hats then bass then arp layering in — and stopping brings it back down; jumps burst, landings splash in proportion to the impact, flips ring, pads stream; nothing accumulates over three minutes and nothing dumps a bar of notes into one instant after a stall. `npm run typecheck` and `npm test` green; GAME-DESIGN §6 (the new block), §7 (gates moved into constants), §9 (resync, gating, scene scope) and §12 (`AudioSys`, `ParticleSystem`) amended, along with ARCHITECTURE.md's coordinate-policy table and its missing audio section.

### As built

Met, with one exit criterion left open and flagged at the end. Tests 311 → 364, typecheck clean. The nine decisions all held. For the first time in four phases the brief's headline assertion had teeth *as written* — and its predicted numbers were right for the audio and wrong for the particles, in both cases for reasons worth keeping.

- **The stall resync was watched failing, and the browser found a bigger stall than the brief imagined.** Headless, against the naive `while` loop: **25 sixteenths / 59 note events, every one with a start time in the past**. The brief predicted 26 sixteenths; it is 25, because the cursor is already up to a sixteenth ahead of `now` when the stall begins — the prediction forgot the lookahead it was measuring. In the browser, against a real `AudioContext`, a **17.2 s stall = 146.5 missed sixteenths**: the naive loop would have queued 147 into a single instant, and the cursor answered with **3 notes, all in the future, still on the grid**.
- **The crossfade bound's predicted factor of 21 was exactly right, which is new.** A hard switch moves a layer gain by 1.0 in one frame against the `STEP / MUSIC_FADE` = 0.0476 bound. Phases 3, 4 and 5 each found their named assertion vacuous; this one failed on the first try at precisely the stated margin. Removing the `MUSIC_GATE_EPS` skip likewise allocates **22 noise sources for a silent layer over two bars**, against 0.
- **The step accumulator's whole point is the case a timer gets wrong, and the timer proves it: 14 footfalls emitted into a wall**, against 0, plus 8 during a slow crawl that should have produced none. The `wasGrounded &&` half of the gate is load-bearing too and is not in the brief: without it, the frame a long fall lands banks the entire fall as stride and fires a burst of footsteps underneath the landing sound.
- **The un-ducked bed feeds intensity 0.875 during the death fade** — the music swelling as the corpse accelerates out of shot, exactly the failure decision 4 predicted, measured rather than argued.
- **The predicted pool peak of ~120 is wrong by 2.4x, and the reason is the level, not the code: 49.** The prediction budgeted 51 for eight pads streaming at once and `01-first-steps` has **one**. The peak is dominated by the transient emitters — a 20-spark ring, a splash, a burst — not by the steady state, so the margin is 5.2x rather than 4.3x. The lower guard in the playthrough test moved to 40 accordingly; it exists so the ceiling assertion cannot pass on a build that never emitted.
- **`spawn` and `ParticleOpts` were deleted, which the brief did not ask for.** Decision 6 deletes `ParticleOpts.color` because it has no caller; once the emitter set landed, the whole options bag had no caller in `src/` either — every emitter routes through `emitCone` → `emit`. Same rule, same fate. `emit(x, y, vx, vy, life, size, gravity, drag)` is now the single spawn primitive, and the pool/physics tests read *better* against exact velocities than they did against a sampled options bag.
- **Sparks with identical lifetimes pop, and no test could see it.** `emitCone` originally gave every spark in a burst the same `life`, so a 20-spark splash vanished on one frame — a visible regression against phase 2's `burstDust`, which carried jitter for exactly this reason. Hence `SPARK_LIFE_JITTER`, applied to the sampled emitters only: **the ring is deliberately exempt**, because a ring is a shape and a shape has to leave as one. Found by reading the code during the browser pass, not by a failing test, and now guarded by one.
- **Benchmarks, against the brief's predictions.** Particle render at a forced 512 alive: **0.0775 ms** (predicted under 0.15), which does make it the second-largest per-frame cost in the game as predicted — the post pass is 0.051 ms and the solver 0.0023 ms. Scheduler pump on an idle frame: **0.0072 ms** (predicted under 0.02). A pump that actually schedules a sixteenth: **0.0624 ms**. All three predictions held.
- **Nothing accumulates.** A 139.5 s soak, 8,715 frames at 62.5 fps: **4,058 sources started, 4,058 stopped, 0 live**, zero console errors, and heap 6.1 MB → 5.0 MB (it went *down*; the GC is keeping up). The unit test's node accounting was confirmed against the real `AudioContext` rather than only the fake.
- **Decision 6 confirmed on real pixels: 160 cool / 0 warm before a flip, 0 cool / 196 warm after.** Not one spark already in flight kept the outgoing colour, and the extra warm pixels are the flip's own ring — the case the decision exists for. A corollary found by accident: at `speedNorm` 0.8 an exact-colour match finds **zero** accent pixels, because the chromatic aberration genuinely splits the accent's channels. The post pass is doing real work on the sparks, not just on the geometry.
- **RAF is suspended in a non-compositing tab, and that is a trap set for phase 7's browser pass.** Driving `stepFrame` in a synchronous loop advances the simulation without advancing the audio clock, so the bed simply never plays and the layer gains crawl — 0.12 after 420 frames, which looks exactly like a broken crossfade. The two clocks being unrelated is the design (GAME-DESIGN §9's one clock rule); manual frame-driving is the one place it becomes visible. Drive from a `setInterval` so real time passes between frames.
- **A consequence of "a gate is a target gain" worth knowing: the bed fades in rather than snapping on.** The first pump after `startMusic` has `dt = 0`, so every gain starts at 0 and the kick reaches full over `MUSIC_FADE`. It reads as the bed starting rather than being switched on, so it stays.
- **`PARAM_SMOOTH` = 0.02 s is a private const in `audio.ts`, not a tuning constant** — the smoothing on node parameters that track a frame-rate value. Flagged for the same reason phase 3 flagged `TINT_START`: it is the one number in the phase living outside `constants.ts`, and it is a graph detail rather than a feel knob.

**Left open, and it is the phase's own stated risk: the ear.** "The only judge of this phase is an ear, and the tests cannot hear." Everything measurable was measured; nothing audible was judged. The recipes, the mix balance between the bed and the effects, `STEP_SFX_DIST`'s gain, and whether a 128 BPM four-layer loop is still tolerable after two minutes are **untuned and need a listening pass**. The step tick is the brief's own nomination for the most likely thing to grate, and it is the one constant in the phase with no derivation behind it.

`docs/screenshot.png` was recaptured through the existing sink — the first one with the accent in it. `engine/particles.ts` was built by a subagent against a written contract, as `world/level.ts` was in phase 5; it came back with 21 tests, 19 watched-failing mutations, and two places where it argued the contract was wrong and was right both times (a sampled cone cannot carry a gravity-sign assertion, and "two fresh systems agree" is vacuous when the fallback `Rng` is fixed-seed).

---

## Phase 7 — Editor & shell ✅

Make it a thing you can build levels in and actually play. Six phases have built a game with one way in and one way out: `main.ts` boots the title, the title starts level 1, and level 1 ends in a placeholder that says COMPLETE. This phase gives the game its shell — a menu, a level select, a results screen, a pause — and gives the *author* a tool, which is the deliverable that outlives the phase: everything after 0.2 is levels, and levels are made in the editor or they are not made at all.

- **`editor/grid.ts`** (new, pure) — the grid model: paint, erase, flood, resize from any edge, whole-snapshot undo, and the warnings that `validateLevel` deliberately does not raise. Unit-tested in node with no DOM.
- **`engine/input.ts`** — a pointer core and a raw key-code layer beside the action layer, both pure, so the editor is as headlessly testable as `PlayScene` is.
- **`engine/renderer.ts`** — `screenToView`, the exact inverse of `present`'s integer-scaled letterboxed blit.
- **`engine/levelio.ts`** (new) — the save transport: `POST /__level` in dev, `localStorage` + clipboard export everywhere else, with the payload building and the id validation pure and tested.
- **`vite.config.ts`** — a `levelSink` middleware modelled directly on the existing `screenshotSink`, writing `src/levels/<id>.json`.
- **`scenes/`** — `EditorScene`, `LevelSelectScene`, `ResultsScene`; `TitleScene` gets its menu; `PlayScene` gets an explicit campaign context and a pause.
- **`src/levels/`** — a second level, authored **in the editor**, which is this phase's only honest proof that the tool works.
- **Docs & verification** — `ARCHITECTURE.md` and `PHYSICS.md` refreshed from as-built code, `CLAUDE.md`'s demolition banner retired, a fresh `docs/screenshot.png`, and a browser pass over the whole flow including a production build.

### Nine decisions taken before writing any of it

Two contradict something already written down — one in GAME-DESIGN §10, one in this file's own phase 7 outline above — and each is amended in this phase's commit.

1. **The editor edits *characters*, not tiles, and `world/level.ts` is therefore its entire format layer.** The obvious model is a `TileMap` plus a spawn and a goal beside it. It is wrong, and the reason is `S` and `G`: they are metadata on an empty cell in a `Level`, but they are *paintable cells* in an editor, and a `TileMap` cannot hold them. Model the grid as `readonly string[]` — §8's own on-disk shape — and five things fall out that would otherwise each need building and agreeing separately:
   - **validation is `validateLevel(rows)` verbatim**, already written in phase 5 and already returning the human-readable list §10 wants to show;
   - **saving is `JSON.stringify({ id, name, rows })`**, byte-identical to `serializeLevel`'s output, so what the editor writes is what `git diff` shows;
   - **playtesting is `parseLevel({ id, name, rows })`**, which hands the *real* `PlayScene` the *real* `Level`, with no second parser and no preview mode;
   - **a resize from the left or the top moves the spawn and the goal for free**, because they are characters in the rows being shifted. Under a `TileMap` model they are two coordinate pairs that have to be fixed up by hand at every edge, and the one that gets forgotten is the one nobody notices until a level spawns you inside a wall;
   - **undo is a `string[]` copy**, 1200 characters for a 60×20 level.

   The palette is **eight** entries, not §10's "1–7": `. # ^ v < > S G`, which is §8's table plus the two markers. Six is the tile enum and eight is what an author paints; seven is neither. §10 amended.

   Two edits the model makes *unrepresentable*, which is worth more than any panel: painting `S` **moves** the spawn rather than adding a second one (same for `G`), and a rectangular array of equal-length rows cannot go ragged. Between those and a fixed palette, **every error `validateLevel` can report is unreachable except one** — a resize that crops the spawn or the goal off the grid. That is not an argument for dropping the panel; it is the argument for what the panel is *for*. It is a safety net over one reachable mistake, it is free, and it is the same function the campaign's eager load runs.

2. **The mouse goes into `Input`, and the letterbox inverse is a pure function in `renderer.ts`.** The editor needs pointer state, and hard rule 2 says a scene may not touch the DOM — so either `Input` grows a pointer or the rule breaks, and the rule is what makes `PlayScene` unit-testable. `Input` gains a pure core (`onPointerDown/Move/Up(vx, vy, button)`, `pointerX/pointerY/pointerIn`, and `down`/`pressed`/`released` edges per button, cleared by the same `update()` that clears the keys) plus the browser half in `attach`, which is already one of the four sanctioned places. It also gains a **raw code layer** — every `KeyboardEvent.code` recorded whether or not it is bound, exposed as `codeDown` / `codePressed` — because the editor needs `Digit1`–`Digit8` for the palette, `ShiftLeft` for flood, and letters for the id field, none of which are `Action`s and none of which should become `Action`s (§12 pins that list, and "paint" is not a game verb). The raw layer also settles `Space`, which is bound to *both* `flip` and `confirm`: the editor's space-drag pan reads the code, not either action.

   **`attach` converts to view space on the way in**, so the pure core never learns that a scale exists. The arithmetic is `screenToView(canvasW, canvasH, clientX, clientY)` in `renderer.ts` beside `computeScale`, exported, node-tested, and returning an `inFrame` flag rather than clamping — a press that lands in the letterbox is not a press on the edge tile, it is not a press at all (decision 4's stroke rule depends on that being true).

3. **Zoom is two discrete steps, `1×` and `½×`, on a key — no wheel, no fractional scale.** This file's own outline asks for "pan and zoom" and GAME-DESIGN §10 asks for neither; the resolution is derived rather than split. A 60×20 level is 1920×640 px against a 960×540 view — two screens wide and 1.19 tall, so you cannot see a level you are building, and pan alone does not fix that. But `½` is not one option among many: **60 tiles × 16 px = 960 px = `VIEW_W` exactly**, so half zoom is precisely "one screen per sixty tiles", and `01-first-steps` is 60 wide. A continuous or cursor-anchored zoom buys nothing over that and costs a wheel path in `Input`, fractional tile geometry, and seams between adjacent cells at every non-integer scale — the exact problem phase 3's coordinate policy was written to avoid. Two steps, both integer tile sizes (32 and 16 px), and the editor draws cells itself rather than reusing `forEachRun`'s world path.

4. **The undo granularity is the *stroke*, and the snapshot is pushed before the first cell of it.** Per-cell snapshots make `Ctrl+Z` undo one pixel of a drag, which is not an undo stack, it is a diary. A snapshot is pushed on pointer-*down* (and before a resize, a flood, or a clear), so one `Ctrl+Z` reverts a whole drag however many frames it spanned. Two rules go with it, and both are the classic bugs: **a stroke that changed nothing pushes nothing** — dragging across cells that already hold the selected character must not fill the stack with identical snapshots — and **the redo stack clears on any new edit**. `EDITOR_UNDO_MAX` bounds it at 64 (see the derived numbers; the ceiling is memory, but the *reason* for a cap is that an unbounded stack is a leak nobody measures).

5. **Campaign membership becomes explicit, which is phase 5's flagged bug and a save-corruption bug behind it.** Phase 5's *As built* left this open: `PlayScene`'s `index` defaults to 0, so a level that is not in `LEVELS` — exactly what the editor's playtest hands it — advances into `LEVELS[1]` on completion. The honest fix is not a better default; it is to stop defaulting. `PlayScene(level, ctx: PlayContext)` where `PlayContext` is `{ kind: 'campaign'; index: number } | { kind: 'playtest'; back: Scene }`, and the union decides three things at once: where a win goes (`ResultsScene` vs straight back to the editor instance, edits intact), whether `bw.progress` advances, and **whether a best time is written at all**. That last one is the bug under the bug: a draft carrying the id of a shipped level would otherwise overwrite `bw.best.01-first-steps` with a time set on a grid that exists only in someone's browser. A playtest writes nothing.

6. **Warnings belong to the editor; errors belong to `level.ts`; conflating them would throw the campaign's eager load on a legal level.** Phase 5's *As built* documented the down-pad trap — a pad whose facing points into its own geometry re-fires every step and pins the body — and nominated the editor's validation as the place to warn about it. It cannot be an *error*: the grid is well-formed, `parseLevel` must accept it, and `src/levels/index.ts` throws on anything `validateLevel` rejects, so promoting a level-design footgun to a format error would make a shipped level a build failure. So `editor/grid.ts` exports `gridWarnings(rows): string[]`, pure and separate, covering the cases that are legal-but-probably-wrong: a pad facing into blocking geometry, a spawn or goal inside a solid tile, and a spawn or goal on the top or bottom row (where the death planes are). The panel shows errors and warnings in two lists, and **only errors block the save**.

7. **The save transport is behaviour-detected, not build-flag gated, and the sink derives its path from the id.** `import.meta.env.DEV` would work and is the wrong shape: it makes the fallback path — the one that only ever runs in a build — the path nobody exercises until it is shipped. Instead `saveLevel` attempts `POST /__level` and falls back to `localStorage` + clipboard on any non-200 or network failure, reporting which happened so the editor can say so on screen. `vite preview` and a real build then take the *same* code path they will in production, and dev takes it too the moment the plugin is missing. The middleware mirrors `screenshotSink` in every respect but one: it takes **no path from the caller**. `screenshotSink` accepts `?file=` and defends with a `..` check; the level sink accepts an `id`, validates it against `^[a-z0-9][a-z0-9-]*$`, and constructs `src/levels/<id>.json` itself — the same defence, one layer earlier, and it is the same charset the editor's id field enforces. It also does **not** touch `src/levels/index.ts`: a middleware that rewrites a TypeScript source file to add an import is codegen, and the honest alternative is a one-line manual edit which the save's on-screen confirmation names.

8. **Pause is spec, not scope creep, and Escape's double binding is resolved by who reads it.** §4's control table has had `Pause / back` on `Esc`/`P` since phase 1 and nothing has implemented it; `PlayScene` currently reads `back` and quits to the title mid-run, silently discarding the attempt. Once there is a shell to quit *to*, that is a bug. `PlayState` gains `paused`: the simulation freezes, the timer stops (it already only runs in `running`), the frame dims through the fade path that already exists, and the bed is fed intensity **0** through the same duck as `dying` and `won` — three lines, all of them already written for something else. `Esc` toggles; the overlay offers RESUME / RESTART / QUIT. Since `back` and `pause` are bound to the same two keys, **`PlayScene` reads `pause` and nothing else**, and the editor reads `back`; a scene that read both would fire twice on one keypress.

9. **The phase's proof that the editor works is a level built with it.** No test can show that a tool is usable, and the failure mode of an authoring tool is not a crash — it is being technically complete and miserable, which a browser pass measured in minutes will not surface either. So the exit criterion is a **second level, authored end to end in the editor**, saved through `POST /__level`, committed as `src/levels/02-*.json`, and added to `LEVELS`. It is also the only way the rest of the phase means anything: `LevelSelectScene` with one entry, `bw.progress` with one level to be furthest through, and `ResultsScene`'s NEXT with nowhere to go are all untestable *as designs* against a single-level campaign. Authoring the remaining set is **not** in this phase — that is the work phase 7 exists to enable, not to do.

### Derived numbers worth recording

- **Half zoom is exactly one screen per sixty tiles.** 60 × 32 × ½ = 960 = `VIEW_W`, and `01-first-steps` is 60 wide, so it fits the frame horizontally with 220 px of vertical slack (20 × 16 = 320 against 540). At `1×` the same level is 2.0 screens wide and 1.19 tall.
- **Worst-case editor draw is 2040 cells** — 60 × 34 visible at ½ zoom, all non-empty. At phase 6's measured fill rate (512 sparks in 0.0775 ms = 0.151 µs per `fillRect`) that predicts **0.31 ms**, which would make it the largest per-frame cost in the game — but only in a scene with no solver, no particles and a vignette-only post pass (0.0008 ms). Budget 1 ms. If it overruns, the fallback is `forEachRun` over a `TileMap` rebuilt on edit, not a cleverer draw.
- **An undo snapshot is 1200 characters ≈ 2.4 KB** at 60×20; `EDITOR_UNDO_MAX` = 64 puts the ceiling at 154 KB, and at the `EDITOR_MAX_W`×`EDITOR_MAX_H` cap of 200×60 at **1.5 MB**. The cap on the grid itself is not a memory argument: 200 tiles is 6400 px, 6.7 screens at `1×` and 3.3 at ½, and a level you cannot see three screens of is one the tool has stopped helping with.
- **Dropping the letterbox offset from the pointer conversion is a 15-tile error, not a sub-pixel one.** At a 1920×1000 window, `computeScale` gives scale 1 (⌊min(2.0, 1.85)⌋), `offX` 480, `offY` 230 — so a naive `clientX / scale` lands 480 px right and 230 px down, 15 tiles and 7.2 rows off. This is the prediction the round-trip test is watched failing against.
- **A serialised 60×20 level is ~1.3 KB of JSON**, so `bw.editor.draft` is 0.03 % of a 5 MB localStorage quota. Autosaving on every stroke end is free.
- **The campaign's save surface is four keys**: `bw.progress`, `bw.muted`, `bw.editor.draft`, and one `bw.best.<id>` per level. Phase 2 defined all four; after this phase all four have a writer, which is the first time that has been true.

### The shell, concretely

```
Title ─┬─▶ Play(campaign i) ─▶ Results ─┬─▶ Play(campaign i+1)
       │        ▲                       └─▶ Level select
       ├─▶ Level select ────────────────────▶ Play(campaign i)
       │        └── E on an entry ─▶ Editor
       └─▶ Editor ⇄ Play(playtest)
```

- **`TitleScene`** — the two-line logo it already draws, plus a vertical menu (PLAY · LEVELS · EDITOR) driven by `up`/`down`/`confirm`, and the controls footer rendered **from `BINDINGS`** rather than from a hardcoded string, so a rebinding cannot silently lie. `menuMove` and `menuPick` finally have both their call sites (phase 6 synthesised them for a screen that only ever picked).
- **`LevelSelectScene`** — one row per level: name, best time from `bw.best.<id>`, and a lock past `bw.progress`. `confirm` plays it, `back` returns to the title, and the raw `KeyE` opens that level in the editor. Locked entries are drawn at `inkRgba(0.35)` — the palette already has the accessor, and dimming is the only two-colour way to say "not yet".
- **`ResultsScene(stats)`** — level name, the time just set, the previous best, `NEW BEST` when it is one, and NEXT / RETRY / LEVELS. It owns no clock: `GOAL_HOLD` stays in `PlayScene`, where it is the frozen frame's punctuation, and §6's description of it is amended from "how long the completion readout holds" to "how long the frozen frame holds before the results screen". The placeholder readout in `renderHud` is deleted, which is the whole of phase 5's promise about it.
- **`SaveStore`** gains `getProgress()` / `setProgress(n)` over `bw.progress` — the one key phase 2 defined and nothing has ever written. Corrupt or missing reads as 0, and `setProgress` is monotone (`max`), because completing an early level again must not lock the later ones.

### The editor, concretely

| Input | Verb |
| --- | --- |
| left-drag | paint the selected character |
| right-drag | erase (paint `.`) |
| `Shift`+click | flood-fill the connected region of equal character (4-connected) |
| middle-drag, `Space`-drag, arrows | pan |
| `1`–`8` | select `. # ^ v < > S G` |  <!-- amended after 0.2: nine, with `o` -->
| `Z` | toggle `1×` / `½×` |
| `Ctrl+Z` / `Ctrl+Y` | undo / redo |
| `[` `]` `,` `.` | grow / shrink from an edge (with `Shift` for the opposite edge) |
| `N` | edit the id and name (single-line entry, `a-z0-9-` and `A-Z0-9 ` respectively) |
| `Enter` | playtest in place |
| `Ctrl+S` | save |
| `Esc` | back to the title |

The palette bar draws **the tiles themselves** — an `ink` slab plus the real chevron — not their characters. It is WYSIWYG for free, and it sidesteps the fact that `^` has no glyph in the 5×7 font (`v` resolves to `V`, which is worse: it looks deliberate). That means the chevron draw moves out of `PlayScene`'s private method into a shared `scenes/tiledraw.ts` used by both; a second copy of it in the editor is a second thing to retune the next time `PAD_CHEVRON_WIDTH` moves.

Entry points: `E` or the menu from the title opens the draft if `bw.editor.draft` holds one, else a blank `EDITOR_DEFAULT_W`×`EDITOR_DEFAULT_H` grid; `E` on a level-select row opens that level; `?editor=1` in `main.ts` boots straight into it. The draft is written on every stroke end, so a reload never costs more than the stroke in progress.

### Order of work

Bottom-up, as in every phase since 4: the layers that poison everything above them go first, and the pure ones before the scenes that consume them.

1. **`constants.ts`** — the editor block: `EDITOR_ZOOM_STEPS` (1, 0.5) <!-- amended after 0.2: a five-rung ladder, ¼ to 4 -->, `EDITOR_PAN_SPEED` (px/s for the keyboard pan), `EDITOR_GRID_ALPHA` 0.15, `EDITOR_UNDO_MAX` 64, `EDITOR_DEFAULT_W`/`_H` 40/20, `EDITOR_MAX_W`/`_H` 200/60. They join a new §6 table in the same commit; `GOAL_HOLD`'s description is amended there per decision 8's sibling above.
2. **`engine/input.ts`** — the raw code layer and the pointer core (decision 2), and `attach`'s pointer wiring including `contextmenu` suppression for the right-drag erase.
3. **`engine/renderer.ts`** — `screenToView`, tested against `computeScale` before anything calls it.
4. **`engine/save.ts`** — `getProgress` / `setProgress`.
5. **`editor/grid.ts`** + tests, complete and green before a scene exists — paint, erase, flood, resize from four edges, the stroke-scoped undo stack, `gridWarnings`.
6. **`engine/levelio.ts`** and **`vite.config.ts`'s `levelSink`** — the pure payload/id half tested, the transport half guarded (decision 7).
7. **`scenes/tiledraw.ts`** — the chevron and the tile-run draw, lifted out of `PlayScene` with no behaviour change.
8. **`scenes/play.ts`** — `PlayContext` (decision 5) and `paused` (decision 8). Both are small and both are the riskiest edits in the phase, because this is the one file with 531 lines of tests already pointed at it.
9. **`scenes/results.ts`**, **`scenes/levelselect.ts`**, **`scenes/title.ts`** — the shell, in that order, so each is built against a screen that already exists to return to.
10. **`scenes/editor.ts`** — last, because it consumes every layer above.
11. **The second level, authored in the editor**, and `src/levels/index.ts`.
12. **Tests, typecheck, browser pass (dev *and* a production build), doc refresh, screenshot.**

### Test suite

| Action | Files |
| --- | --- |
| Add | `grid` (the phase's largest new file: paint, flood, resize, undo, warnings), `editorscene` (headless, mouse included), `levelio` (payload, id charset, fallback selection), `shell` (title menu, level select gating, results) |
| Extend | `input` (raw codes, pointer edges), `renderer` (`screenToView` against `computeScale`), `save` (progress), `playscene` (`PlayContext`, pause, the playtest writing nothing), `constants` (the editor block and the ½-zoom relation) |
| Keep | `obb`, `physics`, `camera`, `palette`, `tiles`, `level`, `font`, `game`, `rng`, `particles`, `audio`, `player` |

`EditorScene` is node-testable for exactly the reason `PlayScene` is, and that is decision 2's real payoff: the mouse arrives as `Input.onPointerDown(vx, vy, 0)` rather than as a DOM event, so a test paints a stroke, undoes it, resizes the grid, playtests it and comes back **without a canvas anywhere**. The `fakeGame()` helper from `tests/playscene.test.ts` is lifted into a shared `tests/harness.ts` rather than copied — it is about to have four consumers.

Phases 3, 4 and 5 each found the brief's headline assertion vacuous as written, and phase 6 was the first where it had teeth on the first try. So, as ever: **each of these is worth writing only if it is watched failing first.**

- **The pointer round-trip, watched failing.** For a grid of window sizes including ones with a large letterbox, `screenToView(present(p))` returns `p`, and a point inside the letterbox reports `inFrame: false`. Against the naive `clientX / scale` the prediction is stated above and is loud: **480 px / 15 tiles** at 1920×1000. If the naive version passes, the test is choosing window sizes that happen to fit exactly.
- **One `Ctrl+Z` undoes a whole stroke.** Paint a 20-cell drag across 20 frames, undo once, assert the grid is bit-identical to before the drag. Against a per-cell snapshot it takes 20 undos, so the assertion fails at 19 cells still painted.
- **A no-op stroke pushes nothing.** Drag across cells that already hold the selected character; the undo depth is unchanged, and one `Ctrl+Z` still reaches past it to the previous real edit. This is the half of decision 4 that a stack-depth assertion alone would miss.
- **A resize from the left carries the spawn and the goal with it.** Grow two columns from the left edge, and `S` and `G` are two columns further right — which is free under decision 1's model and is the assertion that fails against a `TileMap`-plus-coordinates model, so it is worth writing even though nothing in the phase implements one.
- **A crop that loses the spawn is an error, and the save refuses it.** The one reachable member of `validateLevel`'s error list; assert the message reaches the panel verbatim and that `saveLevel` is never called.
- **The playtest writes nothing.** Run phase 5's scripted completion of `01-first-steps` through a `playtest` context and assert `bw.best.01-first-steps` and `bw.progress` are untouched, then assert the same script through a `campaign` context writes both. Watched failing against `PlayScene` as it stands today, which writes the best time *and* advances into `LEVELS[1]`.
- **Editor → playtest → `Esc` → editor preserves the grid and the undo stack.** §10's requirement, stated as an object identity: the scene returned to is the same instance, not a rebuilt one.
- **The down-pad warning fires, and is not an error.** A `v` set into a floor row produces a warning naming its row and column; `validateLevel` returns **zero** errors for the same grid; and `parseLevel` accepts it. All three, because the failure mode is a warning that quietly became a build break.
- **Progress gating.** `bw.progress` = 1 unlocks exactly two entries; a corrupt or absent value unlocks exactly one (not zero, which would lock the player out of their own game, and not all, which would make the key pointless); `setProgress` never moves backward.
- **Raw codes and actions do not leak into each other.** `Digit1` gives `codePressed('Digit1')` and no action at all; `Space` gives `codeDown('Space')` *and* both `flip` and `confirm`; every edge clears on the same `update()` as the keys, per fixed step.
- **A press in the letterbox never paints**, and a drag that leaves the frame stops painting rather than clamping to the edge tile — clamping would smear a wall of tiles down the border, which is the visible version of the same bug.
- **`saveLevel` picks its transport by behaviour.** With no `fetch` defined it reports `local` and writes the draft key; with a fake `fetch` returning 200 it reports `disk` and posts the exact bytes `serializeLevel` would produce; with one returning 404 it falls back rather than throwing. And the id charset rejects `../evil`, `A-Z`, and the empty string.
- **Pause is a freeze.** Ten frames paused advance neither the timer nor the body by any amount, `setIntensity` is fed 0 throughout, and resuming continues the same trajectory — bit-identically, which is the assertion that catches a pause that steps the world with `dt = 0` instead of not stepping it.

### Verification that isn't a unit test

`npm run dev`, and — for the first time in the project — `npm run build && npx vite preview`, because decision 7's fallback path only exists in a build:

- **Author the second level end to end**, from a blank grid to a file in `src/levels/`, and play it from the title screen without touching a text editor. This is the phase's headline and its exit criterion in one. Expect the *tool* to change while doing it; that is what the exercise is for.
- **The whole flow, twice**: title → level select → play → results → next → results → level select → title, and title → editor → playtest → editor → save. Every `back` goes where it should, no scene leaks the bed (the music must be silent on every screen but play), and no screen fails to invert on a flip.
- **The production build takes the fallback**: save in `vite preview`, confirm it reports `local`, confirm the JSON is on the clipboard and pastes into a file that `parseLevel` accepts.
- **`?editor=1` with no gesture**, which is phase 6's flagged autoplay trap: the context is suspended, and the first playtest must resync onto the grid rather than dumping a bar of notes.
- **A 200×60 grid** at both zooms — the draw budget, and whether the tool is still usable at three screens per view. Benchmark the editor draw at a full ½-zoom viewport against the 0.31 ms prediction, record it, delete the harness (phase 3's rule).
- **The palette bar reads at a glance in both phases**, including that `^` and `v` are distinguishable — the reason the bar is tiles rather than text.
- **Pause under every state**: pause mid-air, pause during the death fade, pause on the winning frame. The last two are where a naive freeze desynchronises the fade from the state clock.
- **Fresh `docs/screenshot.png`** through the existing sink, and a second one of the editor if the README wants it.

### Risks

- **`PlayScene` has 531 lines of tests pointed at it and this phase changes its constructor.** That is the good kind of breakage — every call site is a typecheck error — but decision 5 also changes *behaviour* (no best time on a playtest), and behaviour is what the existing suite pins. Expect to retune `tests/playscene.test.ts` rather than extend it, and do decision 5 before the pause so the two are separable when something fails.
- **The pointer conversion is this phase's `obb.ts`**: the one layer where a wrong constant produces plausible-looking behaviour instead of a crash. Every paint lands on the wrong tile by a fixed offset, which reads as "the editor feels off" and not as an arithmetic bug — until the window is a size where the offset is fifteen tiles. Over-invest in its tests, and choose window sizes that do not fit exactly.
- **An authoring tool's failure mode is being complete and miserable**, and nothing in the test suite can see it. Decision 9 is the mitigation and it is deliberately expensive: building a real level is the only pass that finds the missing verb, the wrong default, and the shortcut that should exist.
- **The editor is the first scene in the project with modal state** — a text field that swallows every key, a pan that owns the mouse, a stroke in progress. Mode bugs are the ones that survive a browser pass, because the tester knows which mode they are in. State the modes explicitly and make them visible on screen; an editor whose current mode is invisible is one that will paint a level's worth of `S` into a grid.
- **`Escape` now means four things** across four scenes (quit, pause, cancel a text field, leave the editor). Decision 8 settles the `back`/`pause` half; the rest is that each scene reads exactly one of them, and a scene that grows a second reader is where the double-fire returns.
- **The docs refresh is a deliverable, not a chore.** `ARCHITECTURE.md` says in its own header that it is rewritten from as-built code at the end of this phase, `CLAUDE.md` still opens with a demolition banner for an overhaul that ends here, and both have been true-ish for six phases. Leaving them is how a repo starts lying to the next person to open it.

**Exit:** a level can be drawn in the browser, saved to disk, and played from the title screen without touching an editor outside the game — proven by a second level that was built exactly that way and is in the campaign. The shell is complete: title menu, level select with progress and best times, pause, results with a next level. `npm run typecheck` and `npm test` green; `ARCHITECTURE.md`, `PHYSICS.md`, `README.md` and `CLAUDE.md` refreshed from as-built code, GAME-DESIGN §6/§10/§12 amended where this phase contradicted them, and a fresh `docs/screenshot.png`.

### As built

Nine decisions went in; seven landed unchanged, one was contradicted by a measurement and one by a screenshot. What follows is only the difference.

**The draw budget was overrun 3.6×, and the brief's own fallback fixed it.** Decision 3 predicted 0.31 ms for the worst-case 2040-cell editor draw, extrapolated from phase 6's measured fill rate. Measured on a 200×60 grid of solid at half zoom: **1.11 ms** for the cells alone, 1.72 ms for the frame. The prediction was not wrong about the call count, it was wrong about what the calls cost — phase 6's 0.151 µs came from 2 px particle squares, and these are 16 px cells, so the draw is fill-rate bound rather than call bound and the per-call figure does not transfer. The brief named the fallback in advance and it was the right one: merge the runs. `forEachCharRun` is `world/tiles.ts`'s `forEachRun` over `readonly string[]` instead of a `TileMap` — the same idea without a second model, which matters because a `TileMap` cannot hold `S` and `G` at all and would need rebuilding on every stroke. Cells went to **0.0147 ms**, a 75× improvement, and the whole editor frame to 0.69 ms.

The residue is worth recording because it is now the largest cost in the scene and it is not the grid: the header text measures 0.34–0.48 ms and the palette bar 0.17–0.30 ms, because `drawText` emits one `fillRect` per lit pixel of the 5×7 font. That is the font every screen has always used, and it is nobody's bug yet. A checkerboard — the one case run-merging cannot help, every run length 1 — measures 0.23–0.79 ms of cells and 1.3–1.8 ms of frame, over budget, and is not a level anyone builds.

**The pause veil was `ink` and had to be `paper`.** Decision 8 said the frame "dims through the fade path that already exists", and the fade path is `inkRgba`. In phase A ink is near-white, so the first build washed a black frame to grey and left the white geometry indistinguishable from the wash — legible, but the opposite of "the frozen frame visible underneath". The veil is the *background* flooding back in, so it is `paperRgba(PAUSE_DIM)` with the menu in `ink` like text on every other screen. The death fade stays `ink` for the reason already recorded in phase 5: fading toward the background is what the vignette does, so a death dimmed that way reads as a speed effect rather than as dying. Two overlays, two directions, and the difference is the whole two-colour rule doing its job. Found by looking at a screenshot, which is the only way it could have been found.

**A `dt = 0` pause is not detectable by trajectory divergence in this solver.** The brief predicted the bit-identity test would catch a freeze implemented as `update(dt = 0)` instead of an early return. Watched failing against exactly that mutation: it **passed**. `subStepCount` floors at 1, so dt = 0 does run a sub-step — but it integrates a zero displacement, and every exponential smoother in the scene takes its coefficient as `min(1, rate · dt)`, which at dt = 0 is exactly 0. A dt-zero pause really is bit-identical, and no trajectory assertion can see it. What caught the mutation was the audio scheduler: a dt-zero pause falls through to the bottom of `update` and pumps `setIntensity` a second time, so ten paused frames pump twenty times. The assertion that matters is the *length* of the intensity array, not its contents, and the test now says so.

**Two bugs the brief did not predict, both found by looking rather than by testing.** The shell scenes inherited the palette phase from however the last run happened to end, so the level select was white or black depending on whether you finished the level flipped — a gravity readout on a screen with no gravity. Every shell scene now resets to phase A on `enter`. And the editor's header printed `PAINT ^`, which the 5×7 font renders as its fallback hollow box: the readout of which tile you are painting was the one place in the editor still trying to draw a character, which is precisely what the WYSIWYG palette bar exists to avoid. The header no longer names the character; the bar's thick border is the readout.

**Decision 1's marker rule went further than the brief stated, and it had to.** The brief said painting `S` *moves* the spawn. That alone does not make "found 0 spawn markers" unreachable — painting a wall over the spawn would still erase it. So a marker cell refuses every write but its own: the spawn and the goal can be relocated and never erased, in either direction, which also stops one being dropped on top of the other. That is what leaves exactly one reachable `validateLevel` error, and the panel is the safety net over it.

Two additions the brief did not scope, both because a fourth copy of the same code was the alternative. `scenes/menu.ts` holds one vertical menu — up, down, wrap, blip, confirm — shared by the title, level select, results and pause; four copies is four places for the wrap to be off by one. And `world/level.ts` gained `levelRows`, `parseLevel`'s inverse, factored out of `serializeLevel` so that opening a shipped level for editing does not re-derive where `S` and `G` go.

`Input.attach` also grew a `blur` handler, which is not in any decision and is a bug the phase would otherwise have shipped: the window loses every held key when it loses focus and the browser sends no keyup, so alt-tabbing away mid-run came back with `right` still held and the level playing itself.

**The second level exists and is the exit criterion.** `02-second-nature` was drawn in the browser at half zoom, named through the `N` field, saved through `POST /__level`, and played from the title screen — 60×20, and it teaches the flip as a traversal verb rather than a trick: a four-tile jump, a floorless chasm crossed by flipping onto a ceiling and running it inverted, a flip back down, an up-pad onto a plateau, and a final flip onto a ceiling that a plain jump cannot reach. It completes in 6.8 s. Two things about the tool changed *while* building it, which is what decision 9 said the exercise was for: the status line was drawn underneath the palette bar and invisible, and the header and validation panels had no backing plate, so both vanished over solid geometry. Neither is the kind of thing a unit test can see.

### Verification

- `npm run typecheck` and `npm test`: **21 files, 525 tests**, green.
- The whole flow, dev: title → play → results → NEXT → play → results → LEVELS → title, plus title → editor → playtest → editor → save. Every `back` goes where it should; the bed starts on `enter` and stops on `exit` and is silent on every screen but play.
- Progress gating, fresh save: one row unlocked, the second dimmed at `inkRgba(0.35)` and refusing `confirm`. After two wins, both open with best times.
- Pause mid-air, during the death fade, and on the winning frame. The last is the one that matters: 200 frames paused on the won frame and the `GOAL_HOLD` hand-off does **not** fire.
- The production build takes the fallback. `npm run build && vite preview`: `/__level` is 404, the save reports `local`, and — because a synthetic `Ctrl+S` is not a user gesture — the clipboard refused and the message said so rather than claiming it. The 1031 bytes it wrote to `bw.editor.draft` round-trip through `parseLevel` and back out of `serializeLevel` byte-identically.
- `?editor=1` with no gesture boots straight into the editor and creates no AudioContext at all, so there is nothing to dump. The stall path got exercised for real anyway: driving the game from the console left the scheduler **37.5 s / 320 sixteenths** behind the audio clock, and the next pump scheduled **2 notes**. Phase 6's resync, confirmed in a browser rather than in a test.
- A 200×60 grid at both zooms, benchmarked as above; harness deleted.
- Fresh `docs/screenshot.png`, taken mid-flip in phase B at speedNorm 0.84 — the two-colour inversion, the rationed accent, the aberration and the vignette tint in one frame.

**Exit met.** A level can be drawn in the browser, saved to disk, and played from the title screen without touching an editor outside the game, proven by `02-second-nature`. The shell is complete. `ARCHITECTURE.md`, `PHYSICS.md`, `README.md` and `CLAUDE.md` are refreshed from as-built code; GAME-DESIGN §3, §6, §10 and §12 are amended where this phase contradicted them.


---

## After 0.2: amendments from playing it

Everything above is the record of the seven phases *as planned and as built*, and it is deliberately left standing where it is now wrong — the wrong version is the argument for the right one. Four rules changed once there were levels to run, and every one of them is a rule this document states flatly somewhere above:

1. **Pads fire from every face but their back.** Phase 5 fired on any contact; the phase 7 pass narrowed that to the face alone, to stop a body landing on the back of a down-pad being fired through the slab that caught it. Both were wrong in opposite directions: a free-standing pad that merely *stops* you when you walk into its edge reads as broken. The test is now on the back alone (`PAD_BACK_DOT`), and a side hit fires along the pad's own facing.
2. **Each pad debounces itself for `PAD_DEBOUNCE`.** The direct consequence of 1, and the reason it is listed separately: a launching face can hold a body in contact, so a pinned pad fired 38 times a second. The window is per PAD rather than per player — a player-wide one would break a chain, which is two pads a sixth of a second apart — which is why `Contact` grew `padTx` / `padTy` beside `pad`.
3. **A pad recharges the flip.** Decision 2 above (contacts carry tile identity) was built to express "pads do NOT recharge, only ground does". The mechanism survives; the rule inverted. Spending the whole of a pad chain with the flip unavailable turned "a pad chain is a commitment" into "a pad chain is a corridor", and took the game's other verb away from its most interesting line. The two bits on `Contact` are still both needed — a solid recharges only from a ground normal, a pad from any contact at all.
4. **The spin arm is `r × facing`, not `r × n`.** A consequence of 1, found in review rather than in play: the two agree only on a face hit, so once the sides fired, the normal form measured the offset *along* the launch instead of across it, and a dead-centre side hit produced no spin at all.
5. **There is one collectible.** `o`, the flip recharge, added because the charge had exactly two sources and both were surfaces. It is metadata on an empty cell like `S` and `G` — **the tile enum still does not grow** — which is the same decision 1 made in phase 7 for the editor's grid, arrived at again from the other end.

And the editor grew a front door. `EditorSelectScene` lists NEW, every draft on the shelf and every shipped level, because a single autosaved `bw.editor.draft` made "start the next level" and "throw away the last one" the same act; the shelf is keyed by the level id, which is already the filename, so a rename is a move and two drafts can never collide. A **built-in opens as a copy** with an id of its own, decided when it opens rather than refused at the save — a level in `src/levels/` is a file under version control, and an editor that could save over one would be the fastest way to lose a shipped level. Zoom became a ladder (`¼ ½ 1 2 4`) on `+` and `-` whose ends are a function of the grid's size, replacing the `Z` toggle: out stops where the whole level already fits, in stops at `2×` unless the level is small enough to sit whole at `4×`. And the controls became a panel on `H` — every tool with a description, every palette character with what it is, every shortcut including `Shift`+click to flood — because the status line's one-time hint was a reference nobody could read twice. GAME-DESIGN §10 amended for all four.

Before that, the editor grew the two tools that authoring 0.3 wanted first: a **rectangle fill** and a **select-and-drag-to-move**, both `paint` in a loop under one `atomic` so the marker rules and the undo granularity are the brush's rather than a second set. Reviewing them turned up two bugs worth recording, because both are the shape of bug this project keeps producing: a drag left open by a text field or a playtest kept painting on hover (the per-frame paint was guarded by the drag being open, not by the button being down), and a move could *destroy* a marker — the lift erases and the stamp is allowed to refuse — which is exactly the invariant the character model exists to hold.

---

## Deferred: the colour ending

The final level's ending breaks the two-colour rule as a thematic reveal. It is deliberately not scheduled here — it needs the finished level set to tune against, and building it early against a placeholder would waste the one moment in the game where colour means anything.
