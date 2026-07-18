/**
 * All art is code: sprites are authored as string grids where each character
 * is a palette entry ('.' and ' ' = transparent). decodeGrid is pure and
 * node-safe; only buildSpriteCache touches the DOM (canvas creation) and is
 * called exclusively from browser code.
 */

/** Palette characters → hex colors (GAME-DESIGN §2, binding). */
export const PALETTE: Record<string, string> = {
  B: '#020617', // black — outlines, darkest shadow
  K: '#0F172A', // dark — wall fill shadow, door interior
  S: '#1E293B', // slate — wall/tile fill
  s: '#475569', // slate-lt — tile texture flecks, spike base
  t: '#94A3B8', // steel — spike points, metal
  C: '#22D3EE', // cyan — player 1, tile top edges, doors
  c: '#0E7490', // cyan-dim — player 1 shading, rune glints
  O: '#FB923C', // orange — player 2, torch flame
  o: '#F59E0B', // amber — coins, torch core
  y: '#FDE68A', // pale-gold — coin glint, flame tip
  W: '#F1F5F9', // white — eyes, text, sparkle
  R: '#EF4444', // red — hearts, damage flash
  V: '#A78BFA', // violet — slime body
  v: '#6D28D9', // violet-dk — slime shading
};

/** Stable palette order: index in this string + 1 = palette index in PixelGrid.px. */
export const PALETTE_CHARS = 'BKSstCcOoyWRVv';

/** Palette index (1-based; 0 = transparent) for each palette char. */
export function paletteIndex(ch: string): number {
  const i = PALETTE_CHARS.indexOf(ch);
  return i === -1 ? -1 : i + 1;
}

/** Hex color for a palette index produced by decodeGrid (index ≥ 1). */
export function colorForIndex(index: number): string {
  return PALETTE[PALETTE_CHARS[index - 1]];
}

export interface PixelGrid {
  w: number;
  h: number;
  /** Row-major palette indices; 0 = transparent. */
  px: Uint8Array;
}

/** Decode a string grid to palette indices. Throws on ragged rows / unknown chars. */
export function decodeGrid(rows: readonly string[]): PixelGrid {
  if (rows.length === 0) {
    throw new Error('decodeGrid: empty grid');
  }
  const w = rows[0].length;
  const h = rows.length;
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    if (row.length !== w) {
      throw new Error(`decodeGrid: ragged row ${y} (${row.length} != ${w})`);
    }
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') {
        continue;
      }
      const idx = paletteIndex(ch);
      if (idx === -1) {
        throw new Error(`decodeGrid: unknown palette char '${ch}' at ${x},${y}`);
      }
      px[y * w + x] = idx;
    }
  }
  return { w, h, px };
}

/** Recolor helper for P2 variants (cyan family → orange family). */
function recolor(rows: readonly string[], map: Record<string, string>): readonly string[] {
  return rows.map((row) => row.replace(/./g, (ch) => map[ch] ?? ch));
}

const P1_TO_P2: Record<string, string> = { C: 'O', c: 'o' };

// --- Player 1 (12×14): rounded-square body, black outline, cyan fill,
// cyan-dim shading, 2×2 white eyes, 2px antenna, two 2×3 legs. ---

const PLAYER1_BODY: readonly string[] = [
  '......C.....',
  '......C.....',
  '..BBBBBBBB..',
  '.BCCCCCCCCB.',
  'BCCCCCCCCCcB',
  'BCCWWCCWWCcB',
  'BCCWWCCWWCcB',
  'BCCCCCCCCCcB',
  'BCcccccccccB',
  '.BccccccccB.',
  '..BBBBBBBB..',
];

const PLAYER1_IDLE: readonly string[] = [
  ...PLAYER1_BODY,
  '..cc....cc..',
  '..cc....cc..',
  '..BB....BB..',
];

const PLAYER1_RUN1: readonly string[] = [
  ...PLAYER1_BODY,
  '..cc....cc..',
  '..BB....cc..',
  '........BB..',
];

const PLAYER1_RUN2: readonly string[] = [
  ...PLAYER1_BODY,
  '..cc....cc..',
  '..cc....BB..',
  '..BB........',
];

const PLAYER1_JUMP: readonly string[] = [
  ...PLAYER1_BODY,
  '..cc....cc..',
  '..BB....BB..',
  '............',
];

// --- Slime (14×10): violet dome, darker base, 2×2 white eyes.
// Frame 2 squashes the dome by 1px. ---

const SLIME1: readonly string[] = [
  '....BBBBBB....',
  '..BBVVVVVVBB..',
  '.BVVVVVVVVVVB.',
  '.BVVWWVVWWVVB.',
  'BVVVWWVVWWVVVB',
  'BVVVVVVVVVVVVB',
  'BVVVVVVVVVVVVB',
  'BvvvvvvvvvvvvB',
  'BvvvvvvvvvvvvB',
  '.BBBBBBBBBBBB.',
];

const SLIME2: readonly string[] = [
  '..............',
  '....BBBBBB....',
  '..BBVVVVVVBB..',
  '.BVVVVVVVVVVB.',
  '.BVVWWVVWWVVB.',
  'BVVVWWVVWWVVVB',
  'BVVVVVVVVVVVVB',
  'BvvvvvvvvvvvvB',
  'BvvvvvvvvvvvvB',
  '.BBBBBBBBBBBB.',
];

// --- Coin (8×8, 4 spin frames): amber circle, pale-gold glint.
// Frames: full → 3/4 width → 2px sliver → 3/4 width. ---

const COIN1: readonly string[] = [
  '..oooo..',
  '.oyyooo.',
  'ooyyoooo',
  'oooooooo',
  'oooooooo',
  'oooooooo',
  '.oooooo.',
  '..oooo..',
];

const COIN2: readonly string[] = [
  '..oooo..',
  '.oyyooo.',
  '.oyyooo.',
  '.oooooo.',
  '.oooooo.',
  '.oooooo.',
  '.oooooo.',
  '..oooo..',
];

const COIN3: readonly string[] = [
  '...oo...',
  '...yo...',
  '...yo...',
  '...oo...',
  '...oo...',
  '...oo...',
  '...oo...',
  '...oo...',
];

const COIN4: readonly string[] = [
  '..oooo..',
  '.oooyyo.',
  '.oooyyo.',
  '.oooooo.',
  '.oooooo.',
  '.oooooo.',
  '.oooooo.',
  '..oooo..',
];

// --- Spike (16×8): 4 steel triangles on a slate base. ---

const SPIKE: readonly string[] = [
  '.t...t...t...t..',
  '.tt..tt..tt..tt.',
  '.tt..tt..tt..tt.',
  'sttssttssttsstts',
  'sttssttssttsstts',
  'ssssssssssssssss',
  'SSSSSSSSSSSSSSSS',
  'SSSSSSSSSSSSSSSS',
];

// --- Door (16×32): slate frame, cyan arch outline; closed = dark interior,
// open = cyan-glow interior with a white slit. ---

const DOOR_TOP: readonly string[] = [
  '..SSSSSSSSSSSS..',
  '.SSSSSSSSSSSSSS.',
  'SSCCCCCCCCCCCCSS',
];

const DOOR_CLOSED_SIDE = 'SSCKKKKKKKKKKCSS';
const DOOR_OPEN_SIDE = 'SSCccccWWccccCSS';

const DOOR_CLOSED: readonly string[] = [
  ...DOOR_TOP,
  ...Array.from({ length: 29 }, () => DOOR_CLOSED_SIDE),
];

const DOOR_OPEN: readonly string[] = [
  ...DOOR_TOP,
  ...Array.from({ length: 29 }, () => DOOR_OPEN_SIDE),
];

// --- Torch (6×12): steel bracket, orange flame with amber core and
// pale-gold tip; two flicker frames. ---

const TORCH1: readonly string[] = [
  '......',
  '..y...',
  '..yy..',
  '.OOOO.',
  '.OooO.',
  '.OooO.',
  '..OO..',
  '.tttt.',
  '..tt..',
  '..tt..',
  '..tt..',
  '.tttt.',
];

const TORCH2: readonly string[] = [
  '......',
  '....y.',
  '...yy.',
  '.OOOO.',
  '.OooO.',
  '.OoO..',
  '..OO..',
  '.tttt.',
  '..tt..',
  '..tt..',
  '..tt..',
  '.tttt.',
];

// --- Hearts (9×8): red filled / dark outline-only. ---

const HEART_FULL: readonly string[] = [
  '.RR...RR.',
  'RWRR.RRRR',
  'RRRRRRRRR',
  'RRRRRRRRR',
  '.RRRRRRR.',
  '..RRRRR..',
  '...RRR...',
  '....R....',
];

const HEART_EMPTY: readonly string[] = [
  '.KK...KK.',
  'K..K.K..K',
  'K...K...K',
  'K.......K',
  '.K.....K.',
  '..K...K..',
  '...K.K...',
  '....K....',
];

export type SpriteName =
  | 'player1Idle'
  | 'player1Run1'
  | 'player1Run2'
  | 'player1Jump'
  | 'player2Idle'
  | 'player2Run1'
  | 'player2Run2'
  | 'player2Jump'
  | 'slime1'
  | 'slime2'
  | 'coin1'
  | 'coin2'
  | 'coin3'
  | 'coin4'
  | 'spike'
  | 'doorClosed'
  | 'doorOpen'
  | 'torch1'
  | 'torch2'
  | 'heartFull'
  | 'heartEmpty';

export const SPRITES: Record<SpriteName, readonly string[]> = {
  player1Idle: PLAYER1_IDLE,
  player1Run1: PLAYER1_RUN1,
  player1Run2: PLAYER1_RUN2,
  player1Jump: PLAYER1_JUMP,
  player2Idle: recolor(PLAYER1_IDLE, P1_TO_P2),
  player2Run1: recolor(PLAYER1_RUN1, P1_TO_P2),
  player2Run2: recolor(PLAYER1_RUN2, P1_TO_P2),
  player2Jump: recolor(PLAYER1_JUMP, P1_TO_P2),
  slime1: SLIME1,
  slime2: SLIME2,
  coin1: COIN1,
  coin2: COIN2,
  coin3: COIN3,
  coin4: COIN4,
  spike: SPIKE,
  doorClosed: DOOR_CLOSED,
  doorOpen: DOOR_OPEN,
  torch1: TORCH1,
  torch2: TORCH2,
  heartFull: HEART_FULL,
  heartEmpty: HEART_EMPTY,
};

export const SPRITE_NAMES = Object.keys(SPRITES) as readonly SpriteName[];

/**
 * Browser-only: rasterize every sprite to a 1:1 canvas. Never called in node;
 * merely importing this module stays DOM-free.
 */
export function buildSpriteCache(): Map<SpriteName, HTMLCanvasElement> {
  if (typeof document === 'undefined') {
    throw new Error('buildSpriteCache requires a DOM (browser only)');
  }
  const cache = new Map<SpriteName, HTMLCanvasElement>();
  for (const name of SPRITE_NAMES) {
    const grid = decodeGrid(SPRITES[name]);
    const canvas = document.createElement('canvas');
    canvas.width = grid.w;
    canvas.height = grid.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('buildSpriteCache: 2d context unavailable');
    }
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const idx = grid.px[y * grid.w + x];
        if (idx !== 0) {
          ctx.fillStyle = colorForIndex(idx);
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    cache.set(name, canvas);
  }
  return cache;
}
