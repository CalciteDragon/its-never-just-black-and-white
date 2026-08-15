# it's never just black and white — agent guide

Minimalist momentum platformer: a rigid-body square with real corner collision, a flip that inverts both the palette and gravity, hand-authored levels, and an in-browser editor. TypeScript + HTML5 Canvas. **Zero runtime dependencies** (dev deps only: vite, vitest, typescript).

The design source of truth is `docs/GAME-DESIGN.md`. Read it before writing code. The build plan and current phase status are in `docs/PHASES.md`.

> **This repo is mid-overhaul.** It was Pixel Quest — a procedural dungeon platformer with co-op and a daily challenge — until phase 1 of the plan in `docs/PHASES.md`. Anything in `src/` that the design doc doesn't mention is scheduled for deletion in phase 2, not something to preserve, extend, or work around. When old and new disagree, the design doc wins.

## Commands

- `npm run dev` — vite dev server on port 5173
- `npm test` — run unit tests (vitest, `tests/*.test.ts`)
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — typecheck + vite production build

## Layout

- `src/constants.ts` — ALL tuning numbers, commented with units (px/s, rad/s, tiles, seconds). Append your phase's constants here; never scatter magic numbers.
- `src/engine/` — platform-level utilities: rng, input, font, palette, renderer, audio, save, particles.
- `src/world/` — tiles, obb (pure geometry), physics (rigid-body solver), level (parse/validate/serialise), camera.
- `src/entities/player.ts` — the controller. The only entity.
- `src/scenes/` — title, level select, play, results, editor.
- `src/editor/` — pure grid model: paint, resize, undo, validation.
- `src/levels/` — hand-authored level JSON, one file per level.
- `src/game.ts` — fixed-timestep loop + scene management. `src/main.ts` — browser bootstrap.
- `tests/` — vitest unit tests, node environment (no DOM).

## Hard rules

1. **No new dependencies. No binary assets.** Levels are JSON grids, audio is synthesised WebAudio, the font is a 5×7 bitmap, and the art is two hex values.
2. **Logic must be node-safe.** Game logic modules must not touch `document`/`window`/canvas/AudioContext at import time or in logic paths — that's what makes them unit-testable. Only `main.ts`, `engine/renderer.ts`, `engine/audio.ts`, and `Input.attach()` may touch browser APIs, and even those must be importable in node (guard access, don't execute it at import).
3. **All randomness goes through `engine/rng.ts` (`Rng` class).** Never `Math.random()` in game logic — it would break the physics determinism test. (`Math.random` is tolerable for pure cosmetics like particle jitter, but prefer a fixed-seed `Rng` even there, so visual variation can never perturb the simulation.)
4. **Strict TypeScript.** No `any`, no default exports, no file extensions in imports, single quotes, semicolons, 2-space indent.
5. **Determinism:** the physics is reproducible. Same start state + same input sequence ⇒ bit-identical trajectory. Fixed timestep only; no wall-clock reads on a logic path. Guard this with tests.
6. **Two colours, structurally.** No hex literal may appear outside `engine/palette.ts`. Draw calls ask for `paper` / `ink` / `accent`; they never branch on the current phase. An `if (phase === …)` inside a draw call means a colour has escaped the palette — that's a bug, not a shortcut.
7. **Linear motion is arcade, angular motion is simulated.** Collision response must never take horizontal control away from the player, and the velocity component into a surface is clamped dead on contact. See `docs/PHYSICS.md` — this split is the design, not a compromise to be tidied up later.
8. **`PLAYER_SIZE` ≤ 22.6 px.** Above `TILE/√2`, one-tile gaps become angle-dependent and every level breaks. It is 20 for a reason.
9. Before finishing any task: `npm run typecheck` AND `npm test` must pass.
10. **Do not `git commit`** — the user reviews and commits.
11. The project path contains a space (`...\VSCode\Pixel Quest`) — always quote paths in shell commands. The directory keeps its old name; only the project is renamed.
