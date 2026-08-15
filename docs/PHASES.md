# Build plan

The overhaul from Pixel Quest to *it's never just black and white*, in seven phases. Each phase ends with `npm run typecheck` and `npm test` green, and is committed separately.

Design decisions are settled in [GAME-DESIGN.md](GAME-DESIGN.md) — phases implement it, they don't renegotiate it. Where a phase discovers the spec is wrong, the spec gets amended in that phase's commit.

| # | Phase | Status |
| --- | --- | --- |
| 1 | Design doc, docs, rename | ✅ done |
| 2 | Demolition | ✅ done |
| 3 | Renderer & post-processing | ⬜ |
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

## Phase 3 — Renderer & post-processing ⬜

The look. Everything visible in the finished game is decided here.

- ~~**`engine/palette.ts`** (new)~~ — built in phase 2 (decision 1), including its tests. Nothing left to do here beyond consuming it.
- **`engine/renderer.ts`** — already at 960×540 and rect/text only; still needs `imageSmoothingEnabled = true`, antialiased shape drawing, and rotated-rect drawing (`save`/`translate`/`rotate`/`restore`) since the player needs it in phase 4. Keep `computeScale` pure and tested.
- **Post-processing** — `applyPost(speedNorm)`:
  - **Vignette:** a cached radial gradient, alpha lerped by `speedNorm`, accent tint fading in across the top half of the range. Regenerate the gradient only on resize or phase change, never per frame.
  - **Chromatic aberration:** the buffer redrawn three times with `globalCompositeOperation = 'lighter'` and per-channel offsets, gated off entirely below `CA_THRESHOLD` so the common case costs nothing. Benchmark against a `getImageData` approach and keep the faster one.
- **`world/camera.ts`** — follow with lookahead, horizontal clamp to level bounds, vertical freedom (gravity flips, so the camera can't assume a floor), and the speed-driven screen bounce. Replace `shake()` with `bounce`.
- **Tile rendering** — row-run merging so a long floor draws as one rect.

**Tests:** palette flip symmetry (flipping twice is identity), `computeScale` bounds, camera clamp and lookahead, bounce amplitude at `speedNorm` 0 and 1, run-merging producing the expected rect count.

**Exit:** a hardcoded test grid renders in black and white at 960×540, the vignette breathes with a fake speed value, and pressing space visibly inverts the world.

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
