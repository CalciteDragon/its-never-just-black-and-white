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
}

/** The game's one palette. Everything that draws reads its tokens from here. */
export const palette = new Palette();
