# Build plan

The overhaul from Pixel Quest to *it's never just black and white*, in seven phases. Each phase ends with `npm run typecheck` and `npm test` green, and is committed separately.

Design decisions are settled in [GAME-DESIGN.md](GAME-DESIGN.md) — phases implement it, they don't renegotiate it. Where a phase discovers the spec is wrong, the spec gets amended in that phase's commit.

| # | Phase | Status |
| --- | --- | --- |
| 1 | Design doc, docs, rename | ✅ done |
| 2 | Demolition | ✅ done |
| 3 | Renderer & post-processing | ✅ done |
| 4 | Rigid-body physics | ⬜ |
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

## Phase 4 — Rigid-body physics ⬜

The hard one, and the reason this overhaul is interesting. Budget accordingly.

- **`world/obb.ts`** (new, pure) — oriented-box geometry with no tilemap knowledge: vertices, axis projection, SAT overlap against an axis-aligned box returning `{ normal, depth }`, and the deepest incident vertex for the contact point. Exhaustively unit-tested; this is where a subtle sign error would poison everything above it.
- **`world/physics.ts`** (rewritten) — `stepBody`:
  1. Integrate gravity along `gravitySign`, integrate angular velocity, sub-step at `MAX_SUBSTEP`.
  2. Broadphase the OBB's AABB over the tilemap for candidate solids.
  3. Narrowphase SAT per candidate, resolve the deepest first, re-test (a corner wedged in a gap touches two tiles and needs both resolved).
  4. Positional correction along the MTV; impulse `j = −(1 + RESTITUTION)(v_p · n) / (1/m + (r × n)²/I)` applied at the contact point; angular response scaled by `SPIN_TRANSFER`.
  5. Grounded = any contact normal opposing current gravity.
  6. Angular damping (air vs ground), then the restoring spring toward the nearest 90° when grounded.
- **Determinism** — fixed timestep, no `Math.random` anywhere on this path. Same start state plus same inputs must produce a bit-identical trajectory, and a test asserts it over 600 steps.

**Tests:** SAT correctness against hand-computed cases; no tunnelling at terminal velocity; a square dropped flat lands flat and stays still; a square dropped on a ledge corner acquires spin of the correct sign; a tilted grounded square rights itself within 0.4 s; the 22 px square passes a one-tile corridor at 0°, 22.5° and 45°; jump peak and airtime match the analytic values from GAME-DESIGN §6 within 5 %.

> The ±5 % peak target constrains the **integrator**, not just the tuning. Phase 2 measured the temporary solver at 5.2 % short, and derived the cause: integrating velocity before position loses `v₀·dt/2` regardless of step size. Sub-stepping alone does not fix it — advance position by the average velocity across the step (or split gravity half before, half after) or this test cannot pass.

**Risks:** resolution order oscillation in tight corners (mitigate with an iteration cap and a velocity-based sleep threshold); the restoring spring fighting a genuine collision (suppress it during the frame a contact resolves).

**Exit:** a headless test can drive a body through a hand-built grid and land it, spinning, on a target tile.

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
