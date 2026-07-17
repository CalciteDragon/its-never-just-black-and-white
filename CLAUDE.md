# Pixel Quest — agent guide

2D pixel-art dungeon platformer: custom AABB physics, seeded procedural dungeons, local 2-player co-op, daily challenge. TypeScript + HTML5 Canvas. **Zero runtime dependencies** (dev deps only: vite, vitest, typescript).

The design source of truth is `docs/GAME-DESIGN.md`. Read it before writing code.

## Commands

- `npm run dev` — vite dev server on port 5173
- `npm test` — run unit tests (vitest, `tests/*.test.ts`)
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — typecheck + vite production build

## Layout

- `src/constants.ts` — ALL tuning numbers, commented with units (px/s, tiles, seconds). Append your phase's constants here; never scatter magic numbers.
- `src/engine/` — platform-level utilities: rng, input, renderer, sprites, font, audio, save, particles.
- `src/world/` — tiles, physics, dungeon generation, camera.
- `src/entities/` — player, slime, coin, door, torch.
- `src/scenes/` — title, how-to, play, results.
- `src/game.ts` — fixed-timestep loop + scene management. `src/main.ts` — browser bootstrap.
- `tests/` — vitest unit tests, node environment (no DOM).

## Hard rules

1. **No new dependencies. No binary assets.** All art is code-generated (string-grid sprites), all audio is synthesized (WebAudio).
2. **Logic must be node-safe.** Game logic modules must not touch `document`/`window`/canvas/AudioContext at import time or in logic paths — that's what makes them unit-testable. Only `main.ts`, `engine/renderer.ts`, `engine/audio.ts`, and `Input.attach()` may touch browser APIs, and even those must be importable in node (guard access, don't execute it at import).
3. **All randomness goes through `engine/rng.ts` (`Rng` class).** Never `Math.random()` in game logic — determinism powers the daily challenge and the tests. (`Math.random` is fine for pure cosmetics like particle jitter, but prefer `Rng` there too.)
4. **Strict TypeScript.** No `any`, no default exports, no file extensions in imports, single quotes, semicolons, 2-space indent.
5. **Determinism:** same seed ⇒ identical dungeon, always. Guard this with tests.
6. Before finishing any task: `npm run typecheck` AND `npm test` must pass.
7. **Do not `git commit`** — the orchestrator reviews and commits.
8. The project path contains a space (`...\VSCode\Pixel Quest`) — always quote paths in shell commands.
