# Pixel Quest

A pixel-art dungeon platformer built from scratch with **TypeScript and the Canvas API** — custom AABB physics, seeded procedural dungeons, local two-player co-op, and a worldwide daily challenge. **Zero runtime dependencies**: every sprite is a string grid in code, every sound is synthesized WebAudio, every level is generated math.

![Gameplay: two players exploring a procedurally generated dungeon](docs/screenshot.png)

## Play

```bash
npm install
npm run dev        # → http://localhost:5173
```

| Mode | What it is |
| ---- | ---------- |
| **1P Adventure** | A fresh 3-level run on a random seed. |
| **2P Co-op** | Same run, two heroes on one keyboard. Fallen partners respawn at your side. |
| **Daily Challenge** | One shared seed per UTC day — everyone in the world gets the same dungeon. Best score saved locally. |

Add `?seed=anything` to the URL to force a shareable seed for Adventure/Co-op runs (the seed also shows on the HUD and results screen).

### Controls

| Action | Player 1 | Player 2 |
| ------ | -------- | -------- |
| Move | A / D | ← / → |
| Jump | W or Space | ↑ |
| Drop through platform | S + jump | ↓ + jump |
| Pause | Esc or P | Esc or P |
| Mute / Fullscreen | M / F | M / F |

In 1-player modes both binding sets steer player 1. Menus: navigate with ↑↓ (or W/S), confirm with Enter/Space.

### Rules

Reach the exit door; clear 3 levels of rising difficulty to win. Coins are +10, stomping a slime +50, each cleared level +100. You have 3 hearts — spikes, slime side-contact, and pit falls each cost one (pits also teleport you back to the last safe ledge). Clearing a level restores a heart.

## Development

```bash
npm run dev         # vite dev server (port 5173)
npm test            # vitest unit suite (18 files, 145 tests)
npm run typecheck   # strict tsc, no emit
npm run build       # typecheck + production bundle → dist/
```

### Project structure

```
src/
  constants.ts     every tuning number, commented with units
  game.ts          fixed-timestep loop (60 Hz) + scene management
  run.ts           pure run state: scoring, level flow, persistence keys
  main.ts          browser bootstrap (canvas, resize, ?seed=, fullscreen)
  engine/          platform utilities: rng, input, font, sprites, save,
                   particles, renderer, audio
  world/           tiles, AABB physics, dungeon generator, camera
  entities/        player, slime, coin, door, torch (+ EntityWorld context)
  scenes/          title, how-to, play, results, shared backdrop
tests/             vitest, node environment — no DOM required
docs/              design doc + architecture/physics/generation deep-dives
```

### Design & internals

- [docs/GAME-DESIGN.md](docs/GAME-DESIGN.md) — the design source of truth (palette, modes, tuning targets, module contracts)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — module graph, game loop, scene flow, testing strategy
- [docs/PHYSICS.md](docs/PHYSICS.md) — the sub-stepped AABB solver and the game-feel numbers
- [docs/DUNGEON-GENERATION.md](docs/DUNGEON-GENERATION.md) — how levels are built and *proven* beatable

### The three load-bearing decisions

1. **Determinism everywhere.** All gameplay randomness flows through a seeded `Rng` (mulberry32). Same seed ⇒ byte-identical dungeon — that's what makes the daily challenge fair and the generator testable (120 seed×level combos are BFS-verified solvable in CI).
2. **Logic never touches the DOM.** Entities, physics, generation, and run state import no browser APIs, so the whole suite runs in plain node — including a headless 30-second bot playthrough of the real `PlayScene`.
3. **Assets are code.** Sprites are string grids mapped through a 14-color palette, the font is a 5×7 bitmap, audio is oscillator envelopes. The repo has no binary game assets and the production build is a single small bundle.

## License

[MIT](LICENSE)
