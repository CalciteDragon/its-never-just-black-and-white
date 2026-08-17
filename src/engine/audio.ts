/**
 * Synthesized sound effects — no assets. The AudioContext is created lazily on
 * the first play() and resumed on demand, so construction (and merely importing
 * this module) is safe anywhere, including node, where every call is a no-op.
 *
 * THE NAME SET IS FINAL; THE SYNTHESIS IS NOT. Phase 5 aligned `SfxName` with
 * GAME-DESIGN §9 and pointed each new name at the nearest existing recipe,
 * deleting the last residue of the old game (`coin`, `stomp`, `hurt`, `door`,
 * `gameover`). Phase 6 rebuilds what is underneath — short filtered-noise and
 * sine/triangle blips through a shared feedback-delay send, plus the layered
 * music bed — behind a name set that is already correct, rather than changing
 * every call site it finds. What is here now is square-wave placeholder.
 */

export type SfxName =
  | 'step'
  | 'jump'
  | 'land'
  | 'flip'
  | 'pad'
  | 'goal'
  | 'death'
  | 'menuMove'
  | 'menuPick';

interface Note {
  /** Start/end frequency (Hz) — sweeps exponentially between them. */
  f0: number;
  f1: number;
  /** Duration (s). */
  dur: number;
  type: OscillatorType;
  /** Peak gain 0..1. */
  vol: number;
  /** Start offset within the effect (s). */
  at: number;
}

/** Every effect is a tiny score of frequency sweeps. */
const RECIPES: Record<SfxName, readonly Note[]> = {
  /** A footfall. Phase 6 gates it on speed; nothing calls it yet. */
  step: [{ f0: 180, f1: 140, dur: 0.03, type: 'triangle', vol: 0.06, at: 0 }],
  jump: [{ f0: 330, f1: 660, dur: 0.12, type: 'square', vol: 0.18, at: 0 }],
  land: [{ f0: 150, f1: 90, dur: 0.08, type: 'triangle', vol: 0.22, at: 0 }],
  /** The world turning inside out: one sweep down, one back up through it. */
  flip: [
    { f0: 880, f1: 220, dur: 0.09, type: 'triangle', vol: 0.16, at: 0 },
    { f0: 220, f1: 880, dur: 0.12, type: 'triangle', vol: 0.14, at: 0.06 },
  ],
  pad: [{ f0: 260, f1: 1040, dur: 0.16, type: 'square', vol: 0.2, at: 0 }],
  goal: [
    { f0: 523, f1: 523, dur: 0.12, type: 'square', vol: 0.16, at: 0 },
    { f0: 659, f1: 659, dur: 0.12, type: 'square', vol: 0.16, at: 0.12 },
    { f0: 784, f1: 784, dur: 0.12, type: 'square', vol: 0.16, at: 0.24 },
    { f0: 1047, f1: 1047, dur: 0.3, type: 'square', vol: 0.18, at: 0.36 },
  ],
  death: [
    { f0: 392, f1: 392, dur: 0.16, type: 'triangle', vol: 0.2, at: 0 },
    { f0: 311, f1: 311, dur: 0.16, type: 'triangle', vol: 0.2, at: 0.16 },
    { f0: 233, f1: 220, dur: 0.4, type: 'triangle', vol: 0.2, at: 0.32 },
  ],
  menuMove: [{ f0: 700, f1: 700, dur: 0.04, type: 'square', vol: 0.1, at: 0 }],
  menuPick: [
    { f0: 700, f1: 700, dur: 0.05, type: 'square', vol: 0.12, at: 0 },
    { f0: 1050, f1: 1050, dur: 0.08, type: 'square', vol: 0.12, at: 0.05 },
  ],
};

export class AudioSys {
  /** When true, play() is silent (persisted by the caller, not here). */
  muted = false;

  private ctx: AudioContext | null = null;

  play(name: SfxName): void {
    if (this.muted) {
      return;
    }
    const ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    if (ctx.state === 'suspended') {
      // Fire and forget; the first user gesture unlocks it.
      void ctx.resume();
    }
    const t0 = ctx.currentTime;
    for (const n of RECIPES[name]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type;
      osc.frequency.setValueAtTime(Math.max(1, n.f0), t0 + n.at);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, n.f1), t0 + n.at + n.dur);
      gain.gain.setValueAtTime(n.vol, t0 + n.at);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + n.at + n.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.dur + 0.02);
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) {
      return this.ctx;
    }
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
      return null; // node / unsupported: stay silent
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return null;
    }
    return this.ctx;
  }
}
