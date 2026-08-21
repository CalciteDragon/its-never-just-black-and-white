# it's never just black and white — agent guide

Minimalist momentum platformer: a rigid-body square with real corner collision, a flip that inverts both the palette and gravity, hand-authored levels, and an in-browser editor. TypeScript + HTML5 Canvas. **Zero runtime dependencies** (dev deps only: vite, vitest, typescript).

The design source of truth is `docs/GAME-DESIGN.md`. Read it before writing code. The build plan and current phase status are in `docs/PHASES.md`.

> **The overhaul is complete.** This repo was Pixel Quest — a procedural dungeon platformer with co-op and a daily challenge — until the seven-phase plan in `docs/PHASES.md`, which finished at phase 7. Nothing of the old build survives in `src/`; it is in git history before `d7a54ff` if you need it. When the docs and the code disagree, the code is what shipped and the doc is the bug — `ARCHITECTURE.md` and `PHYSICS.md` were refreshed from as-built code at the end of phase 7, and each phase's *As built* section records where the plan was wrong.
>
> **The work from here is levels**, authored in the in-game editor (`E` from the title). That is what phase 7 built the tool for. `docs/GAME-DESIGN.md` §11 lists what is deliberately out of scope for 0.2, including the final level's colour ending, which is designed and intentionally unbuilt.

## Commands

- `npm run dev` — vite dev server on port 5173
- `npm test` — run unit tests (vitest, `tests/*.test.ts`)
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — typecheck + vite production build

## Layout

- `src/constants.ts` — ALL tuning numbers, commented with units (px/s, rad/s, tiles, seconds). Append your phase's constants here; never scatter magic numbers.
- `src/engine/` — platform-level utilities: rng, input, font, palette, renderer, audio, save, particles, levelio, tuning.
- `src/world/` — tiles, obb (pure geometry), physics (rigid-body solver), level (parse/validate/serialise), camera.
- `src/entities/player.ts` — the controller. The only entity.
- `src/scenes/` — title, levelselect, play, results, credits, editor, plus `menu.ts` (one shared vertical menu) and `tiledraw.ts` (the draws play and the editor share). `finale.ts` is the colour ending and the swirl the credits roll on.
- `src/editor/` — pure grid model over `readonly string[]`: paint, flood, resize, stroke-scoped undo, warnings.
- `src/levels/` — hand-authored level JSON, one file per level.
- `src/game.ts` — fixed-timestep loop + scene management. `src/main.ts` — browser bootstrap. `src/devtuner.ts` — dev-only wind-up tuner, mounted only behind `?tune=1`; `src/devperf.ts` — dev-only performance monitor (panel + `window.__perf` scripting API), mounted only behind `?perf=1`, measuring half in `src/engine/perf.ts`.
- `tests/` — vitest unit tests, node environment (no DOM).

## Hard rules

1. **No new dependencies. No binary assets.** Levels are JSON grids, audio is synthesised WebAudio, the font is a 5×7 bitmap, and the art is two hex values.
2. **Logic must be node-safe.** Game logic modules must not touch `document`/`window`/canvas/AudioContext at import time or in logic paths — that's what makes them unit-testable. Only `main.ts`, `devtuner.ts` (dev-only, flag-gated, never imported by anything but `main.ts`), `engine/renderer.ts`, `engine/audio.ts`, `engine/levelio.ts` (guarded fetch/storage/clipboard) and `Input.attach()` may touch browser APIs, and even those must be importable in node (guard access, don't execute it at import). **`Input.attach` owns the pointer**, and converts it to view space via `screenToView` on the way in — which is what lets `EditorScene` unit-test with the mouse included.
3. **All randomness goes through `engine/rng.ts` (`Rng` class).** Never `Math.random()` in game logic — it would break the physics determinism test. (`Math.random` is tolerable for pure cosmetics like particle jitter, but prefer a fixed-seed `Rng` even there, so visual variation can never perturb the simulation.)
4. **Strict TypeScript.** No `any`, no default exports, no file extensions in imports, single quotes, semicolons, 2-space indent.
5. **Determinism:** the physics is reproducible. Same start state + same input sequence ⇒ bit-identical trajectory. Fixed timestep only; no wall-clock reads on a logic path. Guard this with tests.
6. **Two colours, structurally.** No hex literal may appear outside `engine/palette.ts`. Draw calls ask for `paper` / `ink` — there is no third token; particles composite an inversion of the frame instead of wearing a colour — and they never branch on the current phase. An `if (phase === …)` inside a draw call means a colour has escaped the palette — that's a bug, not a shortcut.
7. **Linear motion is arcade, angular motion is simulated.** Collision response must never take horizontal control away from the player, and the velocity component into a surface is clamped dead on contact. See `docs/PHYSICS.md` — this split is the design, not a compromise to be tidied up later.
8. **`PLAYER_SIZE` ≤ 22.6 px.** Above `TILE/√2`, one-tile gaps become angle-dependent and every level breaks. It is 20 for a reason.
9. Before finishing any task: `npm run typecheck` AND `npm test` must pass.
10. The project path contains a space (`...\VSCode\Pixel Quest`) — always quote paths in shell commands. The directory keeps its old name; only the project is renamed.
