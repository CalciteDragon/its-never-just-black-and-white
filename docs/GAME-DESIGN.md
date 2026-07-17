# Pixel Quest — Game Design Document

Source of truth for gameplay, visuals, and module contracts. All implementation phases build against this document. Version 0.1.0.

## 1. Vision & pillars

A love letter to classic dungeon platformers, built with modern tooling. Four pillars:

1. **Readable pixel art** — a small neon-on-navy palette, 480×270 internal resolution, chunky 16px tiles.
2. **Fair procedural dungeons** — every generated level is beatable *by construction*, and a validator proves it in tests.
3. **Tight game feel** — fixed 60 Hz physics, coyote time, jump buffering, variable jump height, particles and screen shake.
4. **Couch co-op & competition** — two players on one keyboard; a daily seed everyone in the world plays the same day.

A **run** = 3 procedurally generated dungeon levels of rising difficulty. Reach the exit door of each level; finish level 3 to win. Coins raise your score; spikes, pits and slimes hurt.

## 2. Visual identity

Internal resolution **480×270** (`VIEW_W`×`VIEW_H`), integer-scaled to the window with letterboxing, `imageSmoothingEnabled = false`. Tiles are **16×16 px** (`TILE`).

### Palette

Sprites are authored as string grids; each character maps to a palette color. `.` (and space) = transparent.

| Char | Hex       | Name      | Usage                              |
| ---- | --------- | --------- | ---------------------------------- |
| `B`  | `#020617` | black     | outlines, darkest shadow           |
| `K`  | `#0F172A` | dark      | wall fill shadow, door interior    |
| `S`  | `#1E293B` | slate     | wall/tile fill                     |
| `s`  | `#475569` | slate-lt  | tile texture flecks, spike base    |
| `t`  | `#94A3B8` | steel     | spike points, metal                |
| `C`  | `#22D3EE` | cyan      | player 1, tile top edges, doors    |
| `c`  | `#0E7490` | cyan-dim  | player 1 shading, rune glints      |
| `O`  | `#FB923C` | orange    | player 2, torch flame              |
| `o`  | `#F59E0B` | amber     | coins, torch core                  |
| `y`  | `#FDE68A` | pale-gold | coin glint, flame tip              |
| `W`  | `#F1F5F9` | white     | eyes, text, sparkle                |
| `R`  | `#EF4444` | red       | hearts, damage flash               |
| `V`  | `#A78BFA` | violet    | slime body                         |
| `v`  | `#6D28D9` | violet-dk | slime shading                      |

Background layers (not in sprite palette): void `#0B1120`, far silhouettes `#111B33`, near silhouettes `#162240`.

### Rendering style

- Solid tiles: `S` fill with a 1px `C` top-edge highlight on surfaces exposed to air, `B` bottom/side shading, occasional `s` fleck (position-hashed, deterministic — no rng needed).
- One-way platforms: 4px-thick slab, `S` fill, `C` top edge.
- Parallax: 2 silhouette layers of blocky ruins/clouds drifting at 0.2× and 0.5× camera speed.
- Sprite sizes: players 12×14, slime 14×10, coin 8×8 (4 spin frames), spikes 16×8 (drawn in the lower half of their tile), door 16×32 (2 tiles tall), torch 6×12, heart 9×8.
- Player look (matches the cover art): rounded-square head-body, 2×2 white eyes, 2px antenna, two 2×3 legs that alternate when running. P1 in cyan (`C`/`c`), P2 in orange (`O`/`o`).

## 3. Modes & flow

```
Title ─▶ 1P Adventure  (random seed)
      ─▶ 2P Co-op      (random seed, 2 players)
      ─▶ Daily Challenge (seed from UTC date, 1 player)
      ─▶ How to Play
Run: Level 1 ─▶ 2 ─▶ 3 ─▶ Victory results   (any point: all players dead ─▶ Game-over results)
```

- **Seeds**: `runSeed` is a uint32. Adventure/co-op: random. Daily: `hashStringToSeed('PIXEL-QUEST-DAILY-' + YYYY-MM-DD)` using the **UTC** date. Level *n* generates with `seed = hash(runSeed, levelIndex)` (mix, don't reuse raw).
- URL param `?seed=<string>` forces the adventure seed (hash the string). Show the seed on the HUD and results screen so runs are shareable.
- **Retry** replays the same seed. **New Run** rerolls (daily has no reroll — retry only).
- Best score per mode persists in `localStorage`: keys `pq.best.adventure`, `pq.best.coop`, `pq.daily.<YYYY-MM-DD>`.

## 4. Controls

| Action        | Player 1        | Player 2 | Menus           |
| ------------- | --------------- | -------- | --------------- |
| Move          | A / D           | ← / →    | navigate ↑↓/W S |
| Jump          | W or Space      | ↑        | —               |
| Drop through platform | S + jump | ↓ + jump | —          |
| Confirm       | —               | —        | Enter or Space  |
| Pause / Back  | Esc or P        | same     | Esc             |
| Mute          | M               | same     | M               |
| Fullscreen    | F               | same     | F               |

In 1-player modes, BOTH binding sets control player 1.

## 5. Player kinematics (targets)

Constants live in `src/constants.ts`; exact values are tuned by the physics phase but must hit these targets, enforced by tests:

- Run speed ≈ **7 tiles/s** (112 px/s). Ground accel reaches full speed in ~0.15 s; strong ground friction; air control ≈ 60% of ground accel.
- Jump peak height **≥ 3.2 and ≤ 4.0 tiles**. Rise time ~0.30–0.35 s. Falling gravity ≈ 1.6× rising gravity. Max fall speed ≈ 22 tiles/s.
- Horizontal jump clearance at full run speed **≥ 3.5 tiles** (generator relies on max 3-tile gaps).
- **Coyote time** 90 ms, **jump buffer** 120 ms, **jump cut** (release while rising) multiplies `vy` by 0.45.
- Collision box 10×13 px, feet at sprite bottom. Fixed timestep `STEP = 1/60`; sub-step movement so nothing tunnels.

Feel juice: 2-frame squash on landing, stretch on jump, dust particles on jump/land, camera shake on damage (3px, 0.2s) and stomp (2px, 0.12s).

## 6. Health, damage, death

- Each player has **3 hearts**, shown in the HUD. Damage = −1 heart + knockback (away from hazard, up-biased) + **1.2 s invulnerability** (sprite flickers).
- Damage sources: spike contact, slime side-contact. **Pit fall** (below the map): −1 heart and teleport to `lastSafe` — the last position standing on a solid (non-spike-adjacent) tile.
- 0 hearts ⇒ dead. Solo: run ends. Co-op: partner plays on; the dead player **respawns after 2.5 s at the partner's position** with 1 heart and 1.5 s invulnerability. Both dead ⇒ run ends.
- Level clear: every living player regains +1 heart (max 3).

## 7. Scoring

`score = coins×10 + stomps×50 + levelsCleared×100`. Results screen shows score, coins, time (mm:ss.t), levels cleared, seed. Faster time is the tiebreaker on equal score for "new best".

## 8. Dungeon generation

Side-view dungeon, one continuous map per level. Grid **H = 36 tiles** tall; width and hazards scale with level:

| Level | Width (tiles) | Max gap | Spike patches | Slimes | Coins ≈ |
| ----- | ------------- | ------- | ------------- | ------ | ------- |
| 1     | 120           | 2       | ~4            | 4      | 30      |
| 2     | 150           | 3       | ~8            | 7      | 40      |
| 3     | 180           | 3       | ~13           | 10     | 50      |

Pipeline (all via one `Rng` seeded per level — fully deterministic):

1. **Fill** all solid; seal borders (left/right/top stay solid; bottom row of *gaps* is open = pit).
2. **Carve the golden path** left→right as floor segments: flat runs of 3–7 tiles at height `f`, then a step `dy ∈ [−3, +3]` (biased small). Between some segments insert a **gap** (≤ max gap; if `dy > 0` across a gap, gap ≤ 2). Clamp `f` to [10, H−4]. Carve generous air above the floor (headroom ≥ 5 tiles). Every step is jumpable by construction (§5 guarantees).
3. **Ceiling** wanders 3–8 tiles below the top border, always keeping ≥ 4 tiles of clearance above the floor.
4. **Decorate**: floating one-way platforms 4–6 tiles above the path (with coin rows), coin arcs over gaps, spike patches (1–2 tiles wide, never at segment edges, never under the spawn/door, always with ≥ 2 clear landing tiles on each side), slimes on flat segments ≥ 4 wide without spikes, torches on walls every 10–14 columns.
5. **Spawn & exit**: spawn on the first segment (x≈3) with 3 tiles of clearance; exit door (2 tiles tall) stands on the last segment. Both players spawn side by side.
6. **Validate**: BFS from spawn over "standable" cells (empty with ≥2 headroom atop solid/platform). Moves: walk ±1 column; jump up ≤ 3 rows with |dx| ≤ 3; fall any depth with |dx| ≤ 5. Exit must be reachable — this model is deliberately *weaker* than real physics, so passing = definitely beatable. Generation retries with a derived sub-seed on the (rare) validation failure; tests assert solvability across many seeds.

## 9. Entities

| Entity | Behavior |
| ------ | -------- |
| **Player** | See §5/§6. Anim states: idle, run (2 frames), jump, fall, hurt-flicker. Faces movement direction. |
| **Slime** | Patrols at ~1.5 tiles/s; turns at walls and ledge edges. **Stomp** (player falling, player's feet above slime's midline) kills it: +50 pts, player bounces (~60% jump velocity), poof particles. Side contact = damage. |
| **Coin** | 4-frame spin, ~8 Hz. Pickup radius 10 px: +10 pts, sparkle burst, sfx. |
| **Door** | 16×32. Level exit — any player overlapping it triggers level clear (whole team advances). Glows/pulses. |
| **Torch** | Decorative; 2-frame flicker + drifting ember particles. |

## 10. Audio

All synthesized via WebAudio (no assets): square/triangle blips with fast envelopes. Sfx: `jump`, `land`, `coin`, `hurt`, `stomp`, `door` (level clear), `menuMove`, `menuPick`, `victory` (short arpeggio), `gameover`. Master mute on **M** (persisted in localStorage `pq.muted`). AudioContext is created lazily and resumed on first user gesture; the module must no-op safely in node.

## 11. Screens & HUD

- **Title**: big "PIXEL QUEST" bitmap-font logo, animated parallax + drifting coin sparkles behind, 4-item menu, footer `v0.1.0 · M mute · F fullscreen`.
- **How to Play**: controls table + goal, any key back.
- **Play HUD** (top): P1 hearts left, P2 hearts right (co-op), coins ×N center-left, timer center, `LEVEL n/3` right, seed bottom-right corner, mute icon when muted. Daily shows `DAILY YYYY-MM-DD`.
- **Level transition**: 1.2 s banner "LEVEL n" with fade.
- **Pause overlay**: Resume / Restart Run / Quit to Title.
- **Results** (victory & game over share a scene): big header, stats block, NEW BEST! flash when applicable, Retry (same seed) / New Run / Title.

## 12. Out of scope for v0.1

Keys/locks, shops/upgrades, more enemy types, boss fights, gamepads, online leaderboards, netplay, mobile/touch, save-states beyond best scores.

## 13. Module contracts

Phase ownership and key public APIs (signatures are binding; details in each phase brief):

- **engine/rng.ts**: `hashStringToSeed(s): number`, `mixSeeds(a, b): number`, `class Rng { next(): number; int(min, max): number; float(min, max): number; chance(p): boolean; pick(arr): T; shuffle(arr): T[] }`, `dailyDateString(d?): string`, `dailySeed(d?): number`.
- **engine/input.ts**: `class Input { onKey(code, down): void; attach(win): void; down/pressed/released(player, action): boolean; anyPressed(action): boolean; update(): void }` — `onKey` is pure (testable); actions: `left right up down jump confirm back pause mute fullscreen`.
- **engine/font.ts**: 5×7 bitmap font, `drawText(ctx, text, x, y, color, scale?)`, `measureText(text, scale?): number`.
- **engine/sprites.ts**: `decodeGrid(rows): { w, h, px: Uint8Array }` (pure), `PALETTE`, `SPRITES` registry, `buildSpriteCache(): Map<string, HTMLCanvasElement>` (browser only).
- **engine/save.ts**: `class SaveStore { getBest(key): ScoreEntry | null; submit(key, entry): { isNewBest } }` with injectable storage, in-memory fallback.
- **engine/particles.ts**: pooled `class ParticleSystem { spawnBurst/spawnDust/spawnSparkle(...); update(dt); render(ctx, camX, camY) }`.
- **engine/renderer.ts**: offscreen 480×270 → integer-scaled present; camera offset; `computeScale(winW, winH)` pure. Wraps sprite/text/rect draws in world or UI space.
- **game.ts**: `interface Scene { enter?; exit?; update(dt, game); render(r, game) }`, `class Game` fixed-step loop (accumulator, clamp 0.25 s), `class FixedStepper` pure + tested.
- **world/tiles.ts**: `enum Tile { Empty, Solid, Platform, Spike }`, `class TileMap` (`get` out-of-bounds ⇒ `Solid` for sides/top, `Empty` below the bottom so pits kill).
- **world/physics.ts**: `interface Body { x, y, w, h, vx, vy }` (top-left, px), `moveBody(body, map, dt, opts?): MoveResult { onGround, hitWall, hitCeiling, landed }` axis-separated, sub-stepped; `applyGravity(body, dt, rising)`; `rectOverlapsTile(map, rect, tile)`.
- **world/dungeon.ts**: `generateDungeon({ seed, level }): Dungeon { map, spawn, exit, coins, slimes, torches, widthPx, heightPx }` + `isSolvable(dungeon): boolean`.
- **world/camera.ts**: follow midpoint of living players, lookahead, clamp to map, `shake(mag, dur)`.
- **entities/**: `Player`, `Slime`, `Coin`, `Door`, `Torch` with `update(dt, world)` / `render(r)`; world context interface keeps them canvas-free.
- **scenes/**: `TitleScene`, `HowToScene`, `PlayScene(runConfig)`, `ResultsScene(stats)`; pure `RunState` class holds score/hearts/level logic for testing.
