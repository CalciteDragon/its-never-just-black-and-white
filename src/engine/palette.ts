/**
 * The entire colour system (GAME-DESIGN §2). Two tokens — `paper` and `ink` —
 * that swap hex values when the world flips, plus the one sanctioned accent.
 *
 * This is the ONLY module in the project allowed to contain a hex literal.
 * Draw calls ask for a token and never branch on the phase; an
 * `if (phase === …)` anywhere else means a colour escaped, which is a bug.
 * Pure and node-safe.
 */

/** Phase A (0) then phase B (1). Index by `phase`. */
const PAPER = ['#0A0A0A', '#F2F2F2'] as const;
const INK = ['#F2F2F2', '#0A0A0A'] as const;
/** Cool in phase A, warm in phase B — the flip is legible from a single spark. */
const ACCENT = ['#4CC9F0', '#F0A44C'] as const;

export type Phase = 0 | 1;

/**
 * Compositing OPERANDS, not palette colours — nobody ever sees these as a
 * colour. The chromatic aberration pass multiplies the frame by a pure channel
 * mask to decompose it ((1,0,0) × frame = (r,0,0)) and accumulates onto black
 * with `lighter`. They live here only because hard rule 6 says every hex does;
 * they are deliberately outside the Palette class and never move with a flip.
 */
export const CHANNEL_RED = '#FF0000';
export const CHANNEL_GREEN = '#00FF00';
export const CHANNEL_BLUE = '#0000FF';
/** The additive identity the aberration accumulator starts from. */
export const COMPOSITE_BLACK = '#000000';

/** '#0A0A0A' → [10, 10, 10]. Runs once per constant at module load. */
function hexToRgb(hex: string): readonly [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

const PAPER_RGB = PAPER.map(hexToRgb);
const INK_RGB = INK.map(hexToRgb);
const ACCENT_RGB = ACCENT.map(hexToRgb);

function rgba(c: readonly [number, number, number], a: number): string {
  // NaN fails both comparisons and falls through to 0 — an invalid alpha must
  // never reach the context, where it would silently void the whole draw.
  const clamped = a > 0 ? (a < 1 ? a : 1) : 0;
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${clamped})`;
}

export class Palette {
  phase: Phase = 0;

  /** Invert the world. Flipping twice is the identity. */
  flip(): void {
    this.phase = this.phase === 0 ? 1 : 0;
  }

  /** Back to phase A (level start, respawn). */
  reset(): void {
    this.phase = 0;
  }

  /** Background, and the player's inset core. */
  get paper(): string {
    return PAPER[this.phase];
  }

  /** Geometry, player body, text, UI. */
  get ink(): string {
    return INK[this.phase];
  }

  /** Particles only — the single saturated colour on screen. */
  get accent(): string {
    return ACCENT[this.phase];
  }

  /**
   * `paper` at a given alpha, for gradient stops. The vignette's inner stop is
   * transparent paper, which needs the colour in components — so the parsing
   * lives here with the hex rather than leaking a `#` into the renderer.
   */
  paperRgba(a: number): string {
    return rgba(PAPER_RGB[this.phase], a);
  }

  /**
   * `ink` at a given alpha, for the death fade. Fading to `paper` is what the
   * vignette already does, so a death that dimmed toward the background colour
   * would read as a speed effect rather than as dying.
   *
   * `phase` is explicit because the fade has to be SAMPLED ONCE at the death
   * instant and held: the palette resets to phase A at the fade's peak, and
   * under a live token the screen would jump from white to black at exactly the
   * covered moment. Under a held colour the reset is invisible.
   */
  inkRgba(a: number, phase: Phase = this.phase): string {
    return rgba(INK_RGB[phase], a);
  }

  /** `accent` at a given alpha. Particles only; the vignette tints with ink. */
  accentRgba(a: number): string {
    return rgba(ACCENT_RGB[this.phase], a);
  }
}

/** The game's one palette. Everything that draws reads its tokens from here. */
export const palette = new Palette();
