# Architecture

How *it's never just black and white* is put together, and why it tests so easily.

> **Status:** describes the target architecture from [GAME-DESIGN.md](GAME-DESIGN.md). Phases 2–7 land it; see [PHASES.md](PHASES.md). This document is refreshed from as-built code at the end of phase 7.

## Layering

```mermaid
graph TD
  subgraph browser["browser-only shell"]
    MAIN[main.ts]
    REN[engine/renderer.ts]
    AUD[engine/audio.ts]
  end
  subgraph scenes["scenes/"]
    TITLE[title] --> SELECT[level select]
    SELECT --> PLAY[play]
    PLAY --> RESULTS[results]
    RESULTS --> SELECT
    TITLE --> EDIT[editor]
    EDIT -.playtest.-> PLAY
  end
  subgraph logic["pure logic (node-safe)"]
    GAME[game.ts loop]
    PLAYER[entities/player]
    WORLD[world/* tiles·obb·physics·level·camera]
    GRID[editor/grid]
    ENG[engine/* rng·input·font·palette·save·particles]
  end
  MAIN --> GAME --> scenes
  scenes --> PLAYER --> WORLD --> ENG
  EDIT --> GRID --> WORLD
```

**The rule that holds it together**, inherited unchanged from the old build: game logic never touches `document`, `window`, canvas, or `AudioContext` at import time or on logic paths. Only four places may reach browser APIs at runtime — `main.ts`, `Renderer`, `AudioSys` (lazily, guarded), and `Input.attach`. Everything else runs under vitest's node environment with no DOM shim.

The overhaul makes this rule *more* valuable, not less. A rigid-body solver with angular impulses has far more room for subtle error than an AABB sweep, and the only affordable way to pin it down is a few hundred headless assertions running in milliseconds.

## The loop

`Game.start()` runs a requestAnimationFrame loop feeding `FixedStepper`, a pure accumulator: wall-clock time in, zero-or-more callbacks of exactly `STEP = 1/60 s` out, remainder carried, long frames clamped to 250 ms so a background tab never triggers a catch-up spiral. Scenes implement `update(dt, game)` / `render(r, game)`; rendering happens once per animation frame after all fixed steps.

The fixed step is now load-bearing for correctness, not just consistency — variable-dt rigid-body integration would make the physics non-reproducible and the determinism test meaningless.

Input edge state (`pressed`/`released`) clears **after each consumed fixed step**, not per animation frame — a two-step frame must not double-fire a menu move, and a zero-step frame must not drop a press before any step saw it. This matters more than it used to: dropping a flip press is a death.

`Game.stepFrame(elapsed)` exposes one full frame cycle publicly, so automation can drive the game deterministically through `window.__bw.game.stepFrame(...)` even in a hidden tab where RAF is suspended.

## Rendering pipeline

Everything draws into an offscreen **960×540** canvas, then `present()` blits it to the visible canvas at the largest integer scale that fits, centred with letterbox bars.

The significant break from the old build is that shapes are **antialiased**: a square resting at 37° needs a clean edge, and the vignette needs a smooth gradient. Integer scaling survives only to keep the post-processing costs predictable and the bitmap font crisp.

What delivers that is the **coordinate policy**, not `imageSmoothingEnabled` — Canvas 2D antialiases `fillRect` and paths unconditionally, and the flag only affects `drawImage` and pattern scaling. The old build's crispness came from rounding every draw to whole pixels, so antialiasing is a question of where that rounding survives:

| Path | Rounds? | Why |
| --- | --- | --- |
| `setCamera` | yes | Tile coords are multiples of 32; a whole-pixel camera keeps static geometry crisp and stops seams appearing between adjacent runs. |
| `rect`, `rectRotated`, `rectRotatedOutline` | no | Sub-pixel positioning is the whole point — this is what antialiases a rotated body. |
| `text`, `textCentered` | yes | The 5×7 bitmap font is the one deliberately low-res element (GAME-DESIGN §2). Blurring it throws away the signature. |
| `ParticleSystem.render` | yes | A spark is 1–3 px, and sub-pixel placement spreads a 2 px square into a dim 3×3 smear — on the only saturated colour in the game, whose whole job is to read as an event. A sanctioned exception, not an oversight. |
| `present` | n/a — `imageSmoothingEnabled = false` | Smoothing an integer-scaled blit would soften the entire frame. The only place softness is wanted is inside `applyPost`, and the offscreen buffer sets the flag **on** for exactly that reason: the aberration pass blits it at sub-pixel offsets. |

Draw order per frame:

1. Clear to `paper`.
2. World geometry in `ink`, camera-translated, with per-row run merging so a 40-tile floor is one `fillRect`.
3. Entities — the player as a rotated rect plus its `paper` core.
4. Particles (the only accent-coloured pass).
5. UI in `ink`, untranslated.
6. `applyPost(speedNorm)` — vignette always, chromatic aberration only above `CA_THRESHOLD`.

The particle pass also assigns `fillStyle` exactly **once** per frame and then issues N `fillRect`s, because particles store no colour of their own — they read the live accent. That is why a flip inverts every spark already in the air, including the flip's own ring.

### Colour

No hex literal appears anywhere except `engine/palette.ts`. Drawing code asks for `paper`, `ink`, or `accent` and the palette resolves it against the current phase. The flip is therefore a single field assignment, and any `if (phase === …)` inside a draw call is a bug — it means a colour has escaped the palette.

## Physics

Full treatment in [PHYSICS.md](PHYSICS.md). Architecturally, it's a two-layer split:

- **`world/obb.ts`** — pure oriented-box geometry with no knowledge of tilemaps, gravity, or the player. SAT, projections, contact points. This is the layer that gets hammered with unit tests, because it's where a sign error would poison everything above it.
- **`world/physics.ts`** — integration, broadphase against the `TileMap`, resolution order, impulse response, grounded detection, damping and the auto-right spring.

Linear motion is arcade (velocity set directly by input); angular motion is simulated. That split lives in the boundary between `entities/player.ts` (which owns linear intent) and `world/physics.ts` (which owns everything rotational).

## Audio

Two halves in one module, split on exactly the line `renderer.ts` splits `vignetteAlpha` from `applyPost`.

The **upper half is pure**: a beat grid, four literal pattern tables, and `scheduleWindow(state, now, intensity, out)`, which advances the layer cross-fades, resyncs the cursor if it fell behind, and fills a caller-supplied buffer with the notes starting inside the lookahead window. It is arithmetic, it is node-safe, and it is unit-tested against hand-computed times.

The **lower half is nodes**: `AudioSys` takes an injected context factory — defaulting to a guarded `new AudioContext()` — so the tests drive the real class through a ~90-line fake and count every source created against every `stop` scheduled. "The module imports without throwing under node" was the old test, and it was worth almost nothing.

```
destination ◀── master ◀┬── music ◀── layer gains (kick·hats·bass·arp)
                        ├── per-voice envelopes (SFX, dry)
                        └── lowpass ◀── delay ◀── send ◀── per-voice taps + arp
                                └───── feedback ─────┘
```

One shared feedback-delay send gives every effect the same room instead of nine effects each with their own, and its feedback rises with `speedNorm`. The lowpass sits *inside* the loop, so successive repeats darken rather than merely quieten.

Three rules the module is built on:

- **No source is ever created without a scheduled `stop`.** WebAudio node lifetime is the classic leak here and it degrades slowly enough to ship; one node-making path with one rule is the mitigation, and a unit test counts the balance. Measured over 16 s of real play: 492 started, 492 stopped, 0 live.
- **A stalled scheduler resyncs, it does not catch up.** See GAME-DESIGN §9 — this is the difference between a gap and a bar of notes fired into one instant.
- **Nothing in the simulation may ever read the music clock.** The scheduler reads `AudioContext.currentTime`, which is legitimate for the same reason `dateIso` is on the persistence path: it is not a logic path. A "sync the jump to the beat" idea would break determinism outright.

`setIntensity(speedNorm)` is the pump as well as the target-setter, called once per frame by `PlayScene` — which also starts the bed in `enter` and stops it in `exit`, and feeds **0** rather than `speedNorm` while dying or won, so death and the goal are punctuated by the bed dropping out.

## State & flow

```
TitleScene ─▶ LevelSelectScene ─▶ PlayScene ─▶ ResultsScene ─▶ LevelSelectScene
     └──────▶ EditorScene ⇄ PlayScene (playtest)
```

`PlayScene` owns the level lifecycle — spawn, death and respawn fades, goal detection, the timer — and delegates the numbers to `constants.ts`, where every tuning value lives with its unit. Tests assert derived properties of those numbers, so retuning that breaks level geometry fails CI rather than shipping.

The editor's playtest path reuses the real `PlayScene` against an in-memory level rather than a preview mode, so what you test is what ships.

## Persistence

`SaveStore` wraps an injectable `StorageLike` (localStorage when available, in-memory fallback otherwise; every access try/caught). Keys use the `bw.` prefix: `bw.progress`, `bw.best.<levelId>`, `bw.muted`, `bw.editor.draft`. Best times are times — lower wins.

## Determinism

One seeded mulberry32 `Rng` still serves all randomness, but its job has changed. With procedural generation gone, determinism is no longer about reproducing a dungeon from a seed — it's about the **physics being reproducible**: same start state plus same input sequence must produce a bit-identical trajectory over hundreds of steps, and a test asserts exactly that.

Cosmetic randomness (particle jitter) uses separate fixed-seed `Rng` instances so visual variation can never perturb the simulation. `Math.random` appears nowhere in logic.

## Dev tooling

- `vite.config.ts` ships dev-only middleware: `POST /__shot?file=…` writes a base64 PNG to disk (canvas self-screenshotting for docs), and `POST /__level` writes `src/levels/<id>.json` so the in-browser editor saves straight into the repo. Neither exists in a production build; the editor falls back to localStorage and clipboard export there.
- `window.__bw` exposes the `Game` for deterministic frame-driving from the console or automation.
- `.claude/launch.json` describes the dev server for tooling; CI (`.github/workflows/ci.yml`) runs typecheck, tests, and the production build.
