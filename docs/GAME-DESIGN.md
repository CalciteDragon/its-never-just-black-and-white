# it's never just black and white — Game Design Document

Source of truth for gameplay, visuals, and module contracts. Every implementation phase builds against this document. Version 0.2.0.

> This document replaces the Pixel Quest design doc wholesale. The old game (procedural dungeons, co-op, daily challenge, enemies, coins, hearts) is gone; see git history before `d7a54ff` for it.

## 1. Vision & pillars

A minimalist momentum platformer. You are a square. The world is two colours. Press space and both of them — along with gravity — turn inside out.

Four pillars:

1. **Two colours, total commitment.** Paper and ink, nothing else. Colour is rationed so hard that the few places it survives (particles, the vignette, chromatic fringing at speed) read as events rather than decoration. The final level's ending breaks this deliberately — that's the twist, and it only lands because everything before it holds the line.
2. **A body, not a sprite.** The player is a real rigid body: it spins when it jumps, its corners genuinely catch on geometry, and it can land tilted and settle. Nothing is animated — everything you see is the simulation.
3. **Speed you can feel.** The vignette closes in, the screen bounces, colour fringes split at the edges, and the music adds layers. The game gets louder the better you play.
4. **Authored, not generated.** Levels are hand-built in an in-browser editor and stored as readable JSON. Difficulty is a design decision, not a seed.

There is no combat, no collectibles, no score. There is a start, a goal, and the space between them.

## 2. Visual identity

Internal resolution **960×540** (`VIEW_W`×`VIEW_H`), integer-scaled to the window with letterboxing. Unlike the old build, `imageSmoothingEnabled` stays **on** and shapes are drawn antialiased — a square that rests at 37° has to have a clean edge. Tiles are **32×32 px** (`TILE`), giving a 30×16.9 tile viewport.

### Palette

The entire game uses two colours plus three sanctioned exceptions.

| Token | Phase A | Phase B | Usage |
| --- | --- | --- | --- |
| `paper` | `#0A0A0A` | `#F2F2F2` | background, player core |
| `ink` | `#F2F2F2` | `#0A0A0A` | geometry, player body, text, UI |

**The flip swaps which hex each token resolves to.** Nothing in the drawing code branches on phase; it asks for `paper` or `ink` and the palette answers. That is the whole trick, and it must stay that way — a single `if (phase === …)` in a draw call is a bug.

Sanctioned exceptions:

| Exception | Colour | Rule |
| --- | --- | --- |
| Particles | `#4CC9F0` phase A / `#F0A44C` phase B | The only saturated colour on screen. Cool in phase A, warm in phase B — the flip is legible even from a single spark. |
| Vignette | `paper`-toned, gaining a faint accent tint as speed rises | Alpha is a function of speed (§7). |
| Chromatic aberration | R/B channel split | Sub-pixel below the threshold, up to `CA_MAX_OFFSET` px at top speed (§7). |

### Reading the player against the world

The player is `ink`-filled — the same colour as the geometry it touches. A **`paper`-coloured inset core** (a smaller concentric square, `PLAYER_CORE_INSET` px in from each edge, rotating with the body) keeps it legible against a wall it's flush with, and doubles as the rotation tell: a plain square gives no visual cue about its angle, but a square with a core does at a glance.

The core is also where the "recharged" state shows: charged reads as a solid core, spent reads as a hollow outline. No HUD icon, no meter.

### Rendering style

- Geometry: flat `ink` rectangles, merged into runs per row so a 40-tile floor is one `fillRect`, not 40. No outlines, no texture, no gradients.
- Jump pads: an `ink` slab with an animated chevron of particles streaming in the pad's direction (§5).
- Goal: an `ink` square outline that pulses in scale, with a slow particle drift toward its centre.
- Bitmap font stays — the 5×7 grid from the old build, drawn as fill-rects, scaled ×2 or ×3. It's the one deliberately low-res element and it earns its place as a signature.

## 3. Modes & flow

```
Title ─▶ Play (level 1 ─▶ 2 ─▶ … ─▶ n) ─▶ Results
      ─▶ Level Select
      ─▶ Editor  (dev builds: writes to disk; production: localStorage + JSON export)
```

No co-op, no daily challenge, no seeds, no procedural generation. Progress (furthest level reached, best time per level) persists in `localStorage` under the `bw.` key prefix.

## 4. Controls

| Action | Keys |
| --- | --- |
| Move | `A` / `D`, or `←` / `→` |
| Jump | `W`, `↑`, or `Z` |
| **Flip** (invert colours + gravity) | `Space` |
| Restart level | `R` |
| Pause / back | `Esc` or `P` |
| Mute | `M` |
| Fullscreen | `F` |
| Editor (dev) | `E` from the title screen |

There is no double jump. The flip is the air move.

## 5. Mechanics

### The flip

Pressing `Space`:

1. Swaps `paper` and `ink` throughout the palette.
2. Negates the gravity direction (`gravitySign`: `+1` down, `−1` up).
3. Zeroes `vy` so the reversal is immediate and predictable, then applies `FLIP_SPIN_KICK` angular velocity in the direction of travel.
4. Spends the charge. **The charge only comes back on ground contact** — meaning contact with a surface whose normal opposes current gravity. Landing on what is now the floor (previously the ceiling) recharges you.

One flip per airtime is therefore the hard rule, and level design is built around it: every gap is either a jump, a flip, or a jump-then-flip.

### Jumping and rotation

Jump applies `JUMP_VELOCITY` against gravity **and** an angular impulse — `JUMP_SPIN_BASE` plus a term proportional to horizontal speed, signed by travel direction so the square appears to roll forward. Accounting for air damping, a standing jump turns the square ≈ 73° and a full-speed jump ≈ 178°, so a fast jump lands on the opposite face.

Coyote time (`COYOTE_TIME`), jump buffering (`JUMP_BUFFER`), and jump cut (releasing mid-rise multiplies `vy` by `JUMP_CUT_FACTOR` once) all carry over from the old build. They're what keep a physics body feeling like a platformer.

### Rotation, control, and settling

Linear motion is **arcade**: left/right set horizontal velocity through acceleration and friction, exactly as a normal platformer does. Angular motion is **simulated**: real angular velocity, real torque from off-centre impacts, real damping.

This split is deliberate and load-bearing. Spin is dramatic and physical; it never takes the controls away from you. You have full movement authority at any angle.

When grounded, a soft restoring torque pulls the square toward the nearest multiple of 90° (visually identical for a square, so it's always the short way round) and settles it in roughly 0.3 s. Tilted landings happen, read as physical, and resolve themselves. Details and equations in [PHYSICS.md](PHYSICS.md).

### Corner collision

The player is an **oriented** box, tested against tiles with SAT. Corners are real: they catch ledges, wedge into gaps, and push the body back out with an impulse that spins it.

The square is `PLAYER_SIZE` = 20 px against a 32 px tile. Its diagonal is 20√2 ≈ 28.3 px, so a one-tile corridor leaves **3.7 px of clearance at the worst angle** — it fits at any rotation, but tightly enough that corners scrape constantly on the way through. That tension, always possible and never comfortable, is the core sensation of moving through this game.

The hard ceiling is `PLAYER_SIZE ≤ TILE/√2 = 22.6`. Above it, one-tile gaps become angle-dependent — a spinning entry would sometimes wedge and sometimes pass, which reads as a bug however physically honest it is. 20 leaves deliberate headroom below that cliff; raising it invalidates every level.

### Jump pads

A tile that applies a fixed impulse in its facing direction (`up`, `down`, `left`, `right`) when the player contacts it. Pads:

- Override the relevant velocity component rather than adding to it, so a pad's launch height is predictable regardless of approach speed.
- Emit a continuous animated particle chevron in their direction (the pad's idle state), plus a burst on trigger.
- Do **not** recharge the flip. Only ground contact does. A pad chain is a real commitment.
- Impart angular velocity proportional to how off-centre the contact was — hitting a pad with a corner sends you spinning.

### Hazards & death

The only hazard is leaving the world vertically. Left and right map edges read as solid; above the top row and below the bottom row are lethal, and with gravity flipping, both directions matter equally.

Death → `DEATH_FADE_OUT` fade, respawn at the level's spawn point with gravity reset to phase A and the flip recharged, `DEATH_FADE_IN` fade back. No lives, no penalty, no checkpoint. Restart is instant enough that failure isn't a punishment.

## 6. Tuning constants

All live in `src/constants.ts` with units in comments. Values below are the design targets; the physics phase tunes within them and `tests/physics.test.ts` asserts the derived properties, so retuning that breaks level geometry fails CI instead of shipping.

### Linear

| Constant | Value | Meaning |
| --- | --- | --- |
| `TILE` | 32 px | tile size |
| `PLAYER_SIZE` | 20 px | square edge; diagonal 28.3 px in a 32 px gap |
| `RUN_SPEED` | 256 px/s | 8 tiles/s |
| `GROUND_ACCEL` / `AIR_ACCEL` | 2100 / 1300 px/s² | full speed in ~0.12 s; ~62 % air control |
| `GROUND_FRICTION` | 3600 px/s² | stop from full speed in ~0.07 s |
| `JUMP_VELOCITY` | 700 px/s | against gravity |
| `GRAVITY_RISE` / `GRAVITY_FALL` | 2200 / 3520 px/s² | 1.6× heavier descending |
| `MAX_FALL_SPEED` | 768 px/s | 24 tiles/s terminal |
| `COYOTE_TIME` | 0.09 s | grace after leaving a ledge |
| `JUMP_BUFFER` | 0.12 s | early press honoured on landing |
| `JUMP_CUT_FACTOR` | 0.45 | release mid-rise, once |
| `MAX_SUBSTEP` | 8 px | anti-tunnelling sub-step cap |

Derived, and asserted by tests:

- **Jump peak** = v²/2g = 700²/4400 ≈ 111.4 px ≈ **3.48 tiles**.
- **Rise time** ≈ 0.318 s; fall from peak ≈ 0.252 s; **airtime ≈ 0.570 s**.
- **Full-speed jump clearance** ≈ 0.570 × 256 ≈ 146 px ≈ **4.56 tiles**. Levels may use 4-tile gaps; 5 requires a flip or a pad.

### Angular

| Constant | Value | Meaning |
| --- | --- | --- |
| `PLAYER_INERTIA` | 66.7 | moment of inertia of a square about its centre, s²/6 at unit mass |
| `GROUND_NORMAL_DOT` | 0.7 | contact normal within ≈45° of up counts as ground |
| `JUMP_SPIN_BASE` | 2.5 rad/s | spin imparted by a standing jump |
| `JUMP_SPIN_PER_SPEED` | 0.014 rad/s per px/s | added spin scaled by |vx| |
| `FLIP_SPIN_KICK` | 3.0 rad/s | spin imparted by a flip |
| `MAX_ANG_SPEED` | 14 rad/s | clamp |
| `ANG_DAMP_AIR` | 0.4 /s | light exponential damping in flight |
| `ANG_DAMP_GROUND` | 8 /s | strong damping once supported |
| `RIGHT_STIFFNESS` | 240 rad/s² | restoring spring toward nearest 90° |
| `RIGHT_DAMPING` | 31 /s | ≈ 2√k, critically damped, settles in ~0.26 s |
| `SPIN_TRANSFER` | 0.6 | fraction of collision torque actually applied |
| `RESTITUTION` | 0.0 | no bounce; impacts spin you, they don't launch you |

### Feel & effects

| Constant | Value | Meaning |
| --- | --- | --- |
| `SPEED_REF` | 320 px/s | speed that normalises to 1.0 for all effects |
| `CA_THRESHOLD` | 0.45 | normalised speed where aberration becomes visible |
| `CA_MAX_OFFSET` | 3.0 px | channel split at normalised speed 1 |
| `VIGNETTE_MIN` / `VIGNETTE_MAX` | 0.15 / 0.55 | alpha at rest / at full speed |
| `BOUNCE_AMP` | 2.5 px | screen bounce amplitude at full speed |
| `BOUNCE_FREQ` | 9.0 rad/s | bounce frequency at full speed |
| `PAD_IMPULSE` | 820 px/s | jump pad launch velocity |
| `DEATH_FADE_OUT` / `DEATH_FADE_IN` | 0.35 / 0.25 s | respawn timing |

## 7. Speed-driven effects

One number drives all of them. `speedNorm = clamp(|v| / SPEED_REF, 0, 1)`, smoothed with a short exponential lag so a single frame of contact doesn't flicker the whole screen.

| Effect | Response |
| --- | --- |
| Vignette | alpha lerps `VIGNETTE_MIN → VIGNETTE_MAX`; accent tint fades in over the top half of the range |
| Chromatic aberration | zero below `CA_THRESHOLD`, then ramps to `CA_MAX_OFFSET` px |
| Screen bounce | vertical camera offset `sin(t · BOUNCE_FREQ · speedNorm) · BOUNCE_AMP · speedNorm` |
| Music | layer gates at 0.0 / 0.25 / 0.45 / 0.70; master gain ramps across the range |
| Movement SFX | step rate scales with speed; delay feedback rises slightly |

Because they share an input, they arrive together — the game visibly and audibly "opens up" as you get fast, and closes back down when you stall.

## 8. Level format

One JSON file per level in `src/levels/`, imported directly (Vite handles JSON natively — no loader, no new dependency).

```json
{
  "id": "01-first-steps",
  "name": "FIRST STEPS",
  "rows": [
    "................................",
    "..S..........^..............G...",
    "################....############"
  ]
}
```

`rows` is the whole level: a rectangular grid of characters, one string per row. Width and height are derived from it and validated on load (all rows equal length, exactly one `S`, exactly one `G`).

| Char | Meaning |
| --- | --- |
| `.` | empty |
| `#` | solid |
| `S` | spawn (empty tile; exactly one) |
| `G` | goal (empty tile; exactly one) |
| `^` `v` `<` `>` | jump pad, facing up / down / left / right |

Chosen because it diffs cleanly in git, reads as a picture in any editor, and round-trips through the browser editor without a serialiser. Level order lives in `src/levels/index.ts`.

Bounds behaviour: out-of-bounds reads are **solid** to the left and right, **empty** above and below — so the sides seal the level and the top and bottom kill.

### The example stage

`01-first-steps` ships with phase 5 and exercises every feature in one screen-and-a-bit: a flat run to build speed, a 3-tile gap (plain jump), a ceiling section that requires a flip to cross, an up-pad, a tight one-tile corridor that only clears if you're spinning through it cleanly, and a goal placed so the final approach is a flip landing on the ceiling.

## 9. Audio

Fully synthesised WebAudio, no assets, node-safe import.

**SFX** run through a shared feedback-delay send (delay ~0.18 s, feedback ~0.35, lowpass ~2 kHz) for the echoey character: `step`, `jump`, `land`, `flip`, `pad`, `goal`, `death`, `menuMove`, `menuPick`. Sources are short filtered noise bursts and sine/triangle blips with fast envelopes — no square-wave chiptune, that's the old game.

**Music** is a synthesised techno bed at ~128 BPM, built from four layers gated by `speedNorm` (§7): kick (always), hats (> 0.25), bass (> 0.45), arp lead (> 0.70). Scheduled with a lookahead scheduler against `AudioContext.currentTime`, not `setInterval` drift. Layers cross-fade over `MUSIC_FADE` rather than hard-switching.

Mute on `M`, persisted at `bw.muted`. The AudioContext is created lazily on first gesture and every access is guarded so the module imports cleanly under node.

## 10. Level editor

An in-browser scene (`E` from the title, or `?editor=1`), not a separate app.

- Paint tiles with the mouse; number keys 1–7 select from the char palette; right-drag erases; middle-drag or space-drag pans.
- Resize the grid from any edge; the grid is the level, so there's no separate metadata to keep in sync.
- `Ctrl+Z` / `Ctrl+Y` undo stack over whole-grid snapshots (levels are small; simplicity beats cleverness here).
- **Playtest in place** (`Enter`): hands the current grid straight to a `PlayScene` and returns on `Esc` with edits intact.
- **Save**: in dev, `POST /__level` writes `src/levels/<id>.json` through a Vite middleware modelled on the existing `screenshotSink`. In a production build that endpoint doesn't exist, so it falls back to `localStorage` plus a copy-to-clipboard JSON export.

Editor state (grid, undo stack, validation) is a pure module so it unit-tests in node; only the scene touches the DOM.

## 11. Out of scope for 0.2

Moving platforms, breakable tiles, one-way platforms, slopes, wall jumps, checkpoints, gamepads, mobile/touch, leaderboards, colour-gated geometry (the tile format has no colour field — adding one later is a format change, and that's accepted).

**The colour ending** for the final level is designed but deliberately unbuilt. It lands after the level set is finished, so the reveal can be tuned against the real final approach rather than a placeholder.

## 12. Module contracts

Signatures are binding; phase briefs fill in the detail.

- **`engine/rng.ts`** — unchanged `Rng` (mulberry32). Now serving particles, editor jitter, and test determinism rather than level generation. `hashStringToSeed`, `mixSeeds` stay; `dailySeed` / `dailyDateString` are deleted.
- **`engine/input.ts`** — `class Input` as before, minus the two-player split. Actions: `left right up down jump flip restart confirm back pause mute fullscreen`. `onKey` stays pure.
- **`engine/font.ts`** — unchanged 5×7 bitmap font.
- **`engine/palette.ts`** *(new)* — `class Palette { phase: 0 | 1; flip(): void; paper: string; ink: string; accent: string }`. Pure. The single source of every colour in the game.
- **`engine/renderer.ts`** — 960×540 offscreen buffer, antialiased, integer-scaled present. Adds `applyPost(speedNorm)` for vignette + chromatic aberration, and world/UI space draws.
- **`engine/particles.ts`** — pooled system, reworked for accent-coloured emitters: `spawnDust`, `spawnBurst`, `spawnStream` (jump pads), `update(dt)`, `render(r)`.
- **`engine/audio.ts`** — `class AudioSys { sfx(name); setIntensity(speedNorm); setMuted(b) }` with the delay send and the layered music scheduler.
- **`engine/save.ts`** — `SaveStore` with injectable storage, `bw.` keys: `bw.progress`, `bw.best.<levelId>`, `bw.muted`, `bw.editor.draft`.
- **`world/obb.ts`** *(new, pure)* — `vertices(box)`, `projectOnto(box, axis)`, `satOverlap(obb, aabb): { hit, normal, depth } | null`, `deepestVertex(...)`. No tilemap knowledge, fully unit-tested.
- **`world/physics.ts`** — rewritten: `interface RigidBody { x, y, vx, vy, angle, angVel, size }` (centre origin), `stepBody(body, map, dt, opts): StepResult { grounded, contacts, landed, hitCeiling }`. Sub-stepped, SAT-resolved, impulse response. Node-safe.
- **`world/level.ts`** *(new)* — `parseLevel(json): Level | LevelError`, `Level { id, name, w, h, tiles: Uint8Array, spawn, goal, pads }`, `serializeLevel(level): string`, `validateLevel(rows): string[]`.
- **`world/tiles.ts`** — `enum Tile { Empty, Solid, PadUp, PadDown, PadLeft, PadRight }`, `class TileMap` with the seal-sides / open-vertically bounds rule.
- **`world/camera.ts`** — follow with lookahead, clamp horizontally to the level, screen bounce, no shake.
- **`entities/player.ts`** — the controller: input → linear velocity, jump + spin, flip + charge, pad response, death detection. Owns no rendering beyond a small `render(r)`.
- **`scenes/`** — `TitleScene`, `LevelSelectScene`, `PlayScene(level)`, `ResultsScene(stats)`, `EditorScene`.
- **`editor/grid.ts`** *(new, pure)* — grid model, paint/erase/resize, undo stack, validation. Unit-tested in node.
- **`game.ts`** — unchanged fixed-step loop and `Scene` interface. Still the most reusable thing in the repo.
