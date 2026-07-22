# Dungeon generation

How `src/world/dungeon.ts` builds a level, and how we *prove* every level is beatable.

## Guarantees

1. **Deterministic** — one seeded `Rng` drives every decision in fixed order. Same `{seed, level}` ⇒ byte-identical tile map and entity lists (tested by structural comparison).
2. **Beatable by construction** — every step of the golden path stays inside the player's tested jump envelope (≤ 3 rows up, gaps ≤ 3 tiles, ≤ 2 when ascending).
3. **Beatable by proof** — a BFS validator using a movement model *strictly weaker* than real physics must still reach the exit. If validation fails (effectively never), generation retries with a derived sub-seed — deterministically, so a given seed always yields the same final dungeon.

The test suite runs the full pipeline for seeds 1–40 × levels 1–3 and asserts all 120 dungeons validate.

## Pipeline

Maps are 36 tiles tall; width and hazards scale per level:

| Level | Width | Max gap | Spike patches | Slimes | Coins target |
| ----- | ----- | ------- | ------------- | ------ | ------------ |
| 1 | 120 | 2 | 4 | 4 | 30 |
| 2 | 150 | 3 | 8 | 7 | 40 |
| 3 | 180 | 3 | 13 | 10 | 50 |

1. **Fill solid, carve the golden path.** The floor advances left→right as flat segments (3–7 tiles) joined by height steps (`dy ∈ [−3, +3]`, weighted toward small) and occasional gaps (probability grows with level). Ascending across a gap tightens both limits (gap ≤ 2, rise ≤ 2). Gap columns carve open to the map bottom — they are pits.
2. **Ceiling.** A random walk 3–8 tiles below the top border, always ≥ 5 rows above the local floor. Borders (sides, top) stay sealed; below-bottom reads as empty so falling out kills.
3. **Decorate.**
   - *Platforms:* one-way slabs 4–6 tiles above ~half the interior segments, each carrying a coin row.
   - *Coins:* arcs over gaps (at `min(f₁,f₂)−3`), platform rows, then floor sprinkles every 2–4 columns until the level target.
   - *Spikes:* 1–2 tile patches on interior segments ≥ 5 wide, ≥ 2 clear tiles from segment ends, never on the first/last segment (spawn/exit safety — tests assert ≥ 3 columns of separation).
   - *Slimes:* centered on spike-free interior segments ≥ 4 wide, up to the level budget.
   - *Torches:* every 10–14 columns at path height.
4. **Spawn & exit.** Spawn on the first segment (with room for two players side by side); the 2-tile-tall door stands near the end of the last segment. Both verified standable with headroom by tests.

## The validator

`isSolvable` BFS-walks "standable" cells (empty, non-spike, headroom above, solid/platform below) from spawn using four conservative moves:

| Move | Limits | vs. real physics |
| ---- | ------ | ---------------- |
| Walk | ±1 column | trivial |
| Jump up | ≤ 3 rows, drift ≤ 3 cols, own column clear of solids | real peak is 3.6 tiles |
| Flat jump | ≤ 4 columns, head-height path clear; may drop straight down from the far column | real clearance is 4.26 tiles |
| Fall | drift ≤ 1 column per row fallen (max 5), target column open the whole way | air control adds more |

Spike cells are never standable in the model, so the proven route needs no damage-tanking; extra platforms only *add* nodes and can't break the proof. Because every model move is a subset of what the tested physics can do, `validator says reachable ⇒ player can do it`.

The "flat jump + drop" move exists for a specific construction: *gap + step down*. Crossing a 3-gap that lands lower can't be done by walking off the edge (you'd fall short) — it needs a forward jump followed by a descent, so the model includes exactly that, still conservatively.

## Seeds

- **Run seed** — random per run (`hash('PQ-RUN-' + now)`), or forced via `?seed=` (hashed string), shown on the HUD/results for sharing.
- **Level seed** — `mixSeeds(runSeed, levelIndex)`: levels differ, runs reproduce.
- **Daily seed** — `hash('PIXEL-QUEST-DAILY-' + YYYY-MM-DD)` using the **UTC** date: one shared dungeon per day worldwide, no server required.
