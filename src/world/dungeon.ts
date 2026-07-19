/**
 * Seeded procedural dungeon generation (GAME-DESIGN §8). The golden path is
 * carved left→right with every step jumpable BY CONSTRUCTION; a conservative
 * BFS validator (isSolvable) then proves the exit is reachable using a
 * movement model strictly weaker than real player physics. Same seed ⇒
 * byte-identical dungeon, always. Pure logic, node-safe.
 */

import { mixSeeds, Rng } from '../engine/rng';
import { Tile, TileMap } from './tiles';

/** Dungeon height in tiles (all levels). */
export const DUNGEON_H = 36;

export interface DungeonSpec {
  seed: number;
  /** 1-based level index (runs are levels 1..3). */
  level: number;
}

export interface TilePoint {
  tx: number;
  ty: number;
}

export interface Dungeon {
  map: TileMap;
  /** Feet tile: the Empty tile whose bottom edge is the floor. */
  spawn: TilePoint;
  /** Feet tile of the exit door (door art occupies this tile + the one above). */
  exit: TilePoint;
  coins: TilePoint[];
  slimes: TilePoint[];
  torches: TilePoint[];
  level: number;
  seed: number;
}

export interface LevelParams {
  widthTiles: number;
  maxGap: number;
  spikePatches: number;
  slimes: number;
  coins: number;
}

/** Difficulty table (GAME-DESIGN §8); levels beyond 3 clamp to level 3. */
export function levelParams(level: number): LevelParams {
  const l = Math.min(Math.max(Math.round(level), 1), 3);
  const table: readonly LevelParams[] = [
    { widthTiles: 120, maxGap: 2, spikePatches: 4, slimes: 4, coins: 30 },
    { widthTiles: 150, maxGap: 3, spikePatches: 8, slimes: 7, coins: 40 },
    { widthTiles: 180, maxGap: 3, spikePatches: 13, slimes: 10, coins: 50 },
  ];
  return table[l - 1];
}

interface Segment {
  x0: number;
  x1: number;
  /** Row of the top solid floor tile; entities stand with feet at row f-1. */
  f: number;
}

/** Weighted floor step: small steps common, ±3 rare. Negative = upward. */
const STEP_CHOICES: readonly number[] = [-3, -2, -2, -1, -1, -1, 0, 0, 0, 0, 1, 1, 1, 2, 2, 3];

const MIN_FLOOR = 10; // highest the floor may rise (row index)
const MAX_FLOOR = DUNGEON_H - 4; // lowest the floor may sink
const HEADROOM = 5; // guaranteed air rows above every floor tile on the path

export function generateDungeon(spec: DungeonSpec): Dungeon {
  let last: Dungeon | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const rng = new Rng(mixSeeds(spec.seed, spec.level * 101 + attempt * 7919));
    const d = generateOnce(spec, rng);
    if (isSolvable(d)) {
      return d;
    }
    last = d;
  }
  // Deterministic per seed; construction makes this effectively unreachable.
  return last as Dungeon;
}

function generateOnce(spec: DungeonSpec, rng: Rng): Dungeon {
  const params = levelParams(spec.level);
  const W = params.widthTiles;
  const H = DUNGEON_H;
  const map = new TileMap(W, H, Tile.Solid);

  // --- 1. Golden path: floor segments separated by gaps/steps. ---
  const segments: Segment[] = [];
  let x = 1;
  let f = 28;
  for (;;) {
    const isFirst = segments.length === 0;
    const remaining = W - 1 - x;
    const len = remaining < 12 ? remaining : isFirst ? rng.int(6, 9) : rng.int(3, 7);
    segments.push({ x0: x, x1: x + len - 1, f });
    x += len;
    if (x >= W - 1) {
      break;
    }
    let gap = rng.chance(0.3 + spec.level * 0.06) ? rng.int(1, params.maxGap) : 0;
    let dy = rng.pick(STEP_CHOICES);
    if (gap > 0 && dy < 0) {
      // Jumping UP across a gap: keep it comfortably within jump reach.
      gap = Math.min(gap, 2);
      dy = Math.max(dy, -2);
    }
    if (x + gap >= W - 7) {
      gap = 0; // never end the map on a gap
    }
    x += gap;
    f = Math.min(Math.max(f + dy, MIN_FLOOR), MAX_FLOOR);
  }

  // Column → floor row (-1 = pit shaft, open to the map bottom).
  const floorY = new Int32Array(W).fill(-1);
  for (const seg of segments) {
    for (let col = seg.x0; col <= seg.x1; col++) {
      floorY[col] = seg.f;
    }
  }

  // --- 2. Ceiling: random walk, always ≥ HEADROOM above the local floor. ---
  const ceilY = new Int32Array(W).fill(3);
  let c = rng.int(3, 6);
  let lastF = segments[0].f;
  for (let col = 1; col < W - 1; col++) {
    c += rng.int(-1, 1);
    c = Math.min(Math.max(c, 3), 8);
    if (floorY[col] >= 0) {
      lastF = floorY[col];
    }
    ceilY[col] = Math.max(3, Math.min(c, lastF - HEADROOM));
  }

  // --- 3. Carve air (borders at col 0, W-1 and row 0 stay solid). ---
  for (let col = 1; col < W - 1; col++) {
    const bottom = floorY[col] >= 0 ? floorY[col] - 1 : H - 1;
    for (let row = ceilY[col]; row <= bottom; row++) {
      map.set(col, row, Tile.Empty);
    }
  }

  const first = segments[0];
  const lastSeg = segments[segments.length - 1];
  const spawn: TilePoint = { tx: first.x0 + 1, ty: first.f - 1 };
  const exit: TilePoint = { tx: lastSeg.x1 - 2, ty: lastSeg.f - 1 };

  const coins: TilePoint[] = [];
  const slimes: TilePoint[] = [];
  const torches: TilePoint[] = [];
  const middle = segments.slice(1, -1);

  // --- 4a. Floating one-way platforms with coin rows. ---
  for (const seg of middle) {
    const segLen = seg.x1 - seg.x0 + 1;
    if (segLen < 4 || !rng.chance(0.55)) {
      continue;
    }
    const py = seg.f - rng.int(4, 6);
    const plen = Math.min(rng.int(2, 4), segLen - 1);
    const px0 = rng.int(seg.x0, seg.x1 - plen + 1);
    let clear = true;
    for (let col = px0; col < px0 + plen; col++) {
      if (
        map.get(col, py) !== Tile.Empty ||
        map.get(col, py - 1) !== Tile.Empty ||
        map.get(col, py - 2) !== Tile.Empty
      ) {
        clear = false;
        break;
      }
    }
    if (!clear) {
      continue;
    }
    for (let col = px0; col < px0 + plen; col++) {
      map.set(col, py, Tile.Platform);
      coins.push({ tx: col, ty: py - 1 });
    }
  }

  // --- 4b. Coin arcs over gaps. ---
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i];
    const b = segments[i + 1];
    if (b.x0 - a.x1 <= 1) {
      continue; // no gap between these segments
    }
    const arcY = Math.min(a.f, b.f) - 3;
    for (let col = a.x1 + 1; col < b.x0; col++) {
      if (map.get(col, arcY) === Tile.Empty) {
        coins.push({ tx: col, ty: arcY });
      }
    }
  }

  // --- 4c. Spike patches on interior flat segments. ---
  const spikySegs = new Set<Segment>();
  let spikesPlaced = 0;
  for (const seg of rng.shuffle(middle.filter((s) => s.x1 - s.x0 + 1 >= 5))) {
    if (spikesPlaced >= params.spikePatches) {
      break;
    }
    const w = rng.int(1, 2);
    const col0 = rng.int(seg.x0 + 2, seg.x1 - 1 - w);
    let ok = true;
    for (let col = col0; col < col0 + w; col++) {
      if (map.get(col, seg.f - 1) !== Tile.Empty) {
        ok = false;
        break;
      }
    }
    if (!ok) {
      continue;
    }
    for (let col = col0; col < col0 + w; col++) {
      map.set(col, seg.f - 1, Tile.Spike);
    }
    spikySegs.add(seg);
    spikesPlaced++;
  }

  // --- 4d. Slimes patrol spike-free interior segments. ---
  for (const seg of rng.shuffle(middle.filter((s) => s.x1 - s.x0 + 1 >= 4))) {
    if (slimes.length >= params.slimes) {
      break;
    }
    if (spikySegs.has(seg)) {
      continue;
    }
    const tx = Math.floor((seg.x0 + seg.x1) / 2);
    if (map.get(tx, seg.f - 1) === Tile.Empty) {
      slimes.push({ tx, ty: seg.f - 1 });
    }
  }

  // --- 4e. Floor coin sprinkles (skip spike columns) until the target. ---
  outer: for (const seg of middle) {
    for (let col = seg.x0; col <= seg.x1; col += rng.int(2, 4)) {
      if (coins.length >= params.coins) {
        break outer;
      }
      if (map.get(col, seg.f - 1) === Tile.Empty && map.get(col, seg.f - 2) === Tile.Empty) {
        coins.push({ tx: col, ty: seg.f - 2 });
      }
    }
  }

  // --- 4f. Torches every 10–14 columns at path height. ---
  for (let col = 8; col < W - 4; col += rng.int(10, 14)) {
    if (floorY[col] >= 0 && map.get(col, floorY[col] - 3) === Tile.Empty) {
      torches.push({ tx: col, ty: floorY[col] - 3 });
    }
  }

  return { map, spawn, exit, coins, slimes, torches, level: spec.level, seed: spec.seed };
}

// --- Solvability validator (deliberately weaker than real physics). ---

const JUMP_UP_MAX = 3; // rows
const JUMP_DX_UP = 3; // columns while rising
const JUMP_DX_FLAT = 4; // columns at the same height
const FALL_DX_MAX = 5; // columns while falling (deep falls)

function standable(map: TileMap, tx: number, ty: number): boolean {
  if (map.get(tx, ty) !== Tile.Empty || map.get(tx, ty - 1) === Tile.Solid) {
    return false;
  }
  const below = map.get(tx, ty + 1);
  return below === Tile.Solid || below === Tile.Platform;
}

/** BFS from spawn over standable cells using conservative jump/fall moves. */
export function isSolvable(d: Dungeon): boolean {
  const map = d.map;
  if (!standable(map, d.spawn.tx, d.spawn.ty)) {
    return false;
  }
  const seen = new Set<number>();
  const key = (tx: number, ty: number): number => ty * map.w + tx;
  const queue: TilePoint[] = [{ ...d.spawn }];
  seen.add(key(d.spawn.tx, d.spawn.ty));

  const tryPush = (tx: number, ty: number): void => {
    const k = key(tx, ty);
    if (!seen.has(k) && standable(map, tx, ty)) {
      seen.add(k);
      queue.push({ tx, ty });
    }
  };

  while (queue.length > 0) {
    const { tx, ty } = queue.shift() as TilePoint;
    if (Math.abs(tx - d.exit.tx) <= 1 && Math.abs(ty - d.exit.ty) <= 1) {
      return true;
    }

    // Walk one column left/right.
    tryPush(tx - 1, ty);
    tryPush(tx + 1, ty);

    // Jump up: rise ≤ 3 rows, drift ≤ 3 columns, own column must be clear.
    for (let up = 1; up <= JUMP_UP_MAX; up++) {
      if (map.get(tx, ty - up) === Tile.Solid) {
        break; // ceiling blocks any higher rise from this cell
      }
      for (let dx = -JUMP_DX_UP; dx <= JUMP_DX_UP; dx++) {
        tryPush(tx + dx, ty - up);
      }
    }

    // Flat jump across a gap (landing at the same height OR dropping straight
    // down from the far column — covers "gap + step down" path steps).
    for (const dir of [-1, 1]) {
      for (let dist = 2; dist <= JUMP_DX_FLAT; dist++) {
        const nx = tx + dir * dist;
        let clear = true;
        for (let k = 1; k < dist; k++) {
          const ix = tx + dir * k;
          if (map.get(ix, ty) === Tile.Solid || map.get(ix, ty - 1) === Tile.Solid) {
            clear = false;
            break;
          }
        }
        if (!clear) {
          break;
        }
        tryPush(nx, ty);
        if (map.get(nx, ty - 1) !== Tile.Solid) {
          for (let ny = ty + 1; ny < map.h; ny++) {
            if (map.get(nx, ny - 1) === Tile.Solid) {
              break; // drop column blocked
            }
            if (standable(map, nx, ny)) {
              tryPush(nx, ny);
              break;
            }
          }
        }
      }
    }

    // Fall: drift grows with depth (1 column per row fallen, up to 5). The
    // target column must be open the whole way down — no diagonal clipping
    // through overhangs.
    for (let dx = -FALL_DX_MAX; dx <= FALL_DX_MAX; dx++) {
      const nx = tx + dx;
      if (nx < 0 || nx >= map.w) {
        continue;
      }
      for (let ny = ty + 1; ny < map.h; ny++) {
        if (map.get(nx, ny - 1) === Tile.Solid) {
          break; // fall path blocked below this point
        }
        if (Math.abs(dx) > 1 + (ny - ty)) {
          continue; // column still open, but can't have drifted this far yet
        }
        if (standable(map, nx, ny)) {
          tryPush(nx, ny);
          break;
        }
      }
    }
  }
  return false;
}
