# Build plan

The overhaul from Pixel Quest to *it's never just black and white*, in seven phases. Each phase ends with `npm run typecheck` and `npm test` green, and is committed separately.

Design decisions are settled in [GAME-DESIGN.md](GAME-DESIGN.md) — phases implement it, they don't renegotiate it. Where a phase discovers the spec is wrong, the spec gets amended in that phase's commit.

| # | Phase | Status |
| --- | --- | --- |
| 1 | Design doc, docs, rename | ✅ done |
| 2 | Demolition | ✅ done |
| 3 | Renderer & post-processing | ✅ done |
| 4 | Rigid-body physics | ✅ done |
| 5 | Player, world & level format | ⬜ |
| 6 | Particles & audio | ⬜ |
| 7 | Editor & shell | ⬜ |

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

## Phase 5 — Player, world & level format ⬜

Turn the simulation into a game.

- **`world/tiles.ts`** — pads, and the seal-sides / open-vertically bounds rule.
- **`world/level.ts`** (new) — parse, validate, and serialise the row-string format from GAME-DESIGN §8. Validation returns a list of human-readable errors (the editor shows them verbatim).
- **`entities/player.ts`** (rewritten) — input to horizontal velocity with accel/friction; jump with the spin impulse, coyote time, buffer, and cut; the flip with its charge and ground-only recharge; pad response including off-centre torque; out-of-bounds death detection.
- **`scenes/play.ts`** — level lifecycle, death and respawn fades, goal detection, timer, level advance.
- **`src/levels/01-first-steps.json`** and `src/levels/index.ts` — the example stage from GAME-DESIGN §8.

**Tests:** level parse round-trips, validation catches ragged rows and missing/duplicate `S`/`G`; flip charge cannot be spent twice without ground contact; pads override rather than add; death fires above the top row and below the bottom row; a scripted input sequence completes the example stage headlessly (the direct descendant of the old bot-playthrough test, and the best regression guard in the suite).

**Exit:** the example stage is playable start to finish in the browser.

---

## Phase 6 — Particles & audio ⬜

The layer that makes speed feel like something.

- **`engine/particles.ts`** — pooled, fixed-capacity, accent-coloured. Emitters: dust while running, a directional burst on jump, a splash on landing scaled by impact speed, a ring on flip, and the jump pads' continuous directional stream. Pure update path so it tests in node; `render` is the only browser-facing part.
- **`engine/audio.ts`** — rebuilt:
  - Shared feedback-delay send for the echoey character, per GAME-DESIGN §9.
  - SFX as short filtered-noise and sine/triangle blips with fast envelopes.
  - The four-layer techno bed with a lookahead scheduler on `AudioContext.currentTime`, layers gated and cross-faded by `speedNorm`.
  - `setIntensity(speedNorm)` as the single hook the play scene calls.
- Wire `speedNorm` from the player through to the renderer's post pass, the camera bounce, and the audio intensity — one value, four consumers.

**Tests:** particle pool never exceeds capacity and recycles oldest-first; emitter counts and lifetimes; the audio module imports and every public method no-ops safely with no `AudioContext`; layer gate thresholds map `speedNorm` to the expected active-layer set.

**Exit:** running fast visibly and audibly escalates — vignette closing, colour fringing, music layering in — and stopping brings it back down.

---

## Phase 7 — Editor & shell ⬜

Make it a thing you can build levels in and actually play.

- **`editor/grid.ts`** (new, pure) — grid model, paint/erase/flood, resize from any edge, whole-snapshot undo stack, validation. Unit-tested in node with no DOM.
- **`scenes/editor.ts`** — mouse painting, char palette on 1–7, pan and zoom, in-place playtest on `Enter` returning to the editor with edits intact.
- **Persistence** — a `levelSink` Vite middleware (`POST /__level`) modelled directly on the existing `screenshotSink` in `vite.config.ts`, writing `src/levels/<id>.json`. Production builds fall back to `localStorage` plus clipboard JSON export. No new dependencies either way.
- **Shell** — `TitleScene` (the logo, a menu, controls in the footer), `LevelSelectScene`, `ResultsScene` (time, best time, next level). Minimal, monochrome, consistent with everything else.
- **Docs & verification** — refresh `ARCHITECTURE.md` and `PHYSICS.md` from as-built code, capture a new `docs/screenshot.png` through the existing screenshot sink, browser-verify the whole flow.

**Exit:** a level can be drawn in the browser, saved to disk, and played from the title screen without touching an editor outside the game.

---

## Deferred: the colour ending

The final level's ending breaks the two-colour rule as a thematic reveal. It is deliberately not scheduled here — it needs the finished level set to tune against, and building it early against a placeholder would waste the one moment in the game where colour means anything.
