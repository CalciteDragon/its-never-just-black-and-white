/**
 * Everything the game makes a sound with: nine synthesised effects through a
 * shared feedback-delay send, and a four-layer techno bed gated by `speedNorm`.
 * No assets, no dependencies — the whole thing is oscillators and one buffer of
 * noise.
 *
 * SPLIT IN TWO, exactly as `renderer.ts` splits `vignetteAlpha` from
 * `applyPost`. The upper half of this file is arithmetic over a beat grid:
 * pure, node-safe, and unit-tested against hand-computed times. The lower half
 * is `createOscillator` / `connect` / `start` / `stop`, which no pure test
 * could ever have caught — so it takes an INJECTED CONTEXT FACTORY and the
 * tests drive it through a fake. "The module imports without throwing under
 * node" is not a test; driving the graph and counting the nodes is.
 *
 * THE ONE CLOCK RULE: the scheduler reads `AudioContext.currentTime`, which is
 * a wall clock. That is legitimate here for the same reason `dateIso` is
 * legitimate on the persistence path — it is not a logic path — but the
 * corollary is absolute: **nothing in the simulation may ever read the music
 * clock.** Syncing a jump to the beat would break determinism outright.
 */

import {
  MUSIC_BAR_STEPS,
  MUSIC_FADE,
  MUSIC_GAIN_MAX,
  MUSIC_GAIN_MIN,
  MUSIC_GATE_ARP,
  MUSIC_GATE_BASS,
  MUSIC_GATE_EPS,
  MUSIC_GATE_HATS,
  MUSIC_LOOKAHEAD,
  MUSIC_PATTERN_STEPS,
  MUSIC_SIXTEENTH,
  SFX_DELAY_FEEDBACK,
  SFX_DELAY_FEEDBACK_MAX,
  SFX_DELAY_LOWPASS,
  SFX_DELAY_TIME,
} from '../constants';
import { Rng } from './rng';

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

export type MusicLayer = 'kick' | 'hats' | 'bass' | 'arp';

/** Scheduling order, which is also the order events come out of the window. */
export const MUSIC_LAYERS: readonly MusicLayer[] = ['kick', 'hats', 'bass', 'arp'];

// ---------------------------------------------------------------------------
// The pure half: the grid, the patterns, and the window.
// ---------------------------------------------------------------------------

/** One note, ready to become nodes. `at` is absolute audio-clock time. */
export interface NoteEvent {
  at: number;
  layer: MusicLayer;
  /** Start and end frequency (Hz). For `hats` this is the highpass cutoff. */
  f0: number;
  f1: number;
  dur: number;
  /** Velocity WITHIN the layer, 0..1. The layer's own gain is a node. */
  gain: number;
}

/**
 * The cursor. `cursor` is an INTEGER count of sixteenths from `origin`, never
 * an accumulated float — three minutes of playing is still exactly on the grid,
 * and the resync below is then a single `Math.max`.
 */
export interface SchedulerState {
  /** Audio time of pattern step 0. */
  origin: number;
  /** Index of the next sixteenth to schedule. */
  cursor: number;
  /** Audio time of the previous pump, for the cross-fade's lag. */
  lastTime: number;
  /** Mirrored layer gains — the same numbers the GainNodes carry. */
  gains: Record<MusicLayer, number>;
}

export function createSchedulerState(now: number): SchedulerState {
  return {
    origin: now,
    cursor: 0,
    lastTime: now,
    gains: { kick: 0, hats: 0, bass: 0, arp: 0 },
  };
}

/** The gate each layer opens above (GAME-DESIGN §7). Strictly greater-than. */
export function layerGate(layer: MusicLayer): number {
  switch (layer) {
    case 'kick':
      return -1; // always: no speed can fail to exceed it, including 0
    case 'hats':
      return MUSIC_GATE_HATS;
    case 'bass':
      return MUSIC_GATE_BASS;
    case 'arp':
      return MUSIC_GATE_ARP;
  }
}

/**
 * A gate is a TARGET GAIN, not a switch. Gating at scheduling time would be a
 * hard switch however the gain node behaved afterwards, because a note carries
 * the gain it was scheduled with up to MUSIC_LOOKAHEAD before it sounds.
 */
export function layerTarget(layer: MusicLayer, intensity: number): 0 | 1 {
  return intensity > layerGate(layer) ? 1 : 0;
}

/** Which layers are gated open at this intensity. Readability, and a test hook. */
export function activeLayers(intensity: number): MusicLayer[] {
  return MUSIC_LAYERS.filter((l) => layerTarget(l, intensity) === 1);
}

/** Master music gain: the bed swells continuously between the gates too. */
export function musicGain(intensity: number): number {
  const n = intensity > 0 ? (intensity < 1 ? intensity : 1) : 0;
  return MUSIC_GAIN_MIN + (MUSIC_GAIN_MAX - MUSIC_GAIN_MIN) * n;
}

/** SFX delay feedback rises slightly with speed (GAME-DESIGN §7). */
export function delayFeedback(intensity: number): number {
  const n = intensity > 0 ? (intensity < 1 ? intensity : 1) : 0;
  return SFX_DELAY_FEEDBACK + (SFX_DELAY_FEEDBACK_MAX - SFX_DELAY_FEEDBACK) * n;
}

/**
 * The patterns, as literal tables. NO RANDOMNESS ANYWHERE — the bed is authored,
 * so the tests can assert it note for note and hard rule 3 never comes up.
 *
 * All four are written over one bar of sixteenths except the arp, which ascends
 * over two and is therefore indexed against MUSIC_PATTERN_STEPS.
 */

/** Four on the floor. */
const KICK_STEPS: readonly number[] = [0, 4, 8, 12];

/**
 * Offbeat eighths accented, odd sixteenths as ghosts at half gain, and silence
 * exactly where the kick lands so the two never mask each other.
 */
const HATS_GAIN: readonly number[] = [
  0, 0.5, 1, 0.5, 0, 0.5, 1, 0.5, 0, 0.5, 1, 0.5, 0, 0.5, 1, 0.5,
];

/** A1 and E2 — the root and its fifth, an octave apart from the arp's register. */
const A1 = 55;
const E2 = A1 * Math.pow(2, 7 / 12);
const BASS_NOTES: readonly (number | 0)[] = buildBass();

function buildBass(): readonly number[] {
  const out = new Array<number>(MUSIC_BAR_STEPS).fill(0);
  const hits: readonly [number, number][] = [
    [0, A1],
    [3, A1],
    [6, E2],
    [8, A1],
    [11, A1],
    [14, E2],
  ];
  for (const [step, f] of hits) {
    out[step] = f;
  }
  return out;
}

/**
 * A-minor pentatonic (A C D E G) ascending over two octaves and cycling, so the
 * lead climbs continuously without walking off the top of the register: ten
 * distinct notes from A3, three ascents and a bit per two-bar pattern.
 */
const PENTATONIC_SEMITONES: readonly number[] = [0, 3, 5, 7, 10];
const ARP_ROOT = 220;
const ARP_NOTES: readonly number[] = Array.from({ length: 10 }, (_, d) => {
  const semis = PENTATONIC_SEMITONES[d % 5] + 12 * Math.floor(d / 5);
  return ARP_ROOT * Math.pow(2, semis / 12);
});

/** The note a layer plays on a pattern step, or null for a rest. */
export function patternAt(
  layer: MusicLayer,
  step: number,
): { f0: number; f1: number; dur: number; gain: number } | null {
  const bar = step % MUSIC_BAR_STEPS;
  switch (layer) {
    case 'kick':
      // A sine dropped from 120 to 45 Hz in 120 ms is the whole kick drum.
      return KICK_STEPS.includes(bar) ? { f0: 120, f1: 45, dur: 0.12, gain: 1 } : null;
    case 'hats': {
      const g = HATS_GAIN[bar];
      // f0 is the HIGHPASS CUTOFF here, not a pitch — the voice is noise.
      return g > 0 ? { f0: 7000, f1: 7000, dur: 0.02, gain: g } : null;
    }
    case 'bass': {
      const f = BASS_NOTES[bar];
      return f > 0 ? { f0: f, f1: f, dur: 0.09, gain: 1 } : null;
    }
    case 'arp': {
      const f = ARP_NOTES[step % ARP_NOTES.length];
      return { f0: f, f1: f, dur: 0.06, gain: 0.5 };
    }
  }
}

/** A reusable event buffer — the window is pumped every frame, forever. */
export function createNoteBuffer(size: number): NoteEvent[] {
  return Array.from({ length: size }, () => ({
    at: 0,
    layer: 'kick' as MusicLayer,
    f0: 0,
    f1: 0,
    dur: 0,
    gain: 0,
  }));
}

/**
 * Advance the cross-fades, resync the cursor if it fell behind, and fill `out`
 * with every note starting inside the lookahead window. Returns the count.
 *
 * A STALLED SCHEDULER RESYNCS; IT DOES NOT CATCH UP. The textbook loop is
 * `while (next < now + LOOKAHEAD) { schedule(next); next += SIXTEENTH; }` and it
 * is correct only while it is pumped faster than it advances. It is pumped from
 * the frame loop, and `FixedStepper.maxFrame` is 250 ms against a 100 ms window
 * — a backgrounded tab, a long GC or a devtools pause leaves the cursor
 * arbitrarily far in the past, and the loop then schedules every missed note
 * with a start time already elapsed. WebAudio fires those immediately and
 * simultaneously: a three-second stall is 25.6 sixteenths dumped into one
 * instant, which is not a glitch you have to listen for.
 *
 * So the cursor snaps forward to the next grid position at or after `now` and
 * drops what was missed. Every pattern is bar-periodic and the snap is on the
 * sixteenth grid, so the downbeat stays aligned and the resync is inaudible
 * beyond the gap itself. The same path covers two other cases for free: a
 * context still suspended by the autoplay policy (whose `currentTime` does not
 * advance, then jumps), and unmuting mid-bar.
 */
export function scheduleWindow(
  state: SchedulerState,
  now: number,
  intensity: number,
  out: NoteEvent[],
): number {
  const dt = now > state.lastTime ? now - state.lastTime : 0;
  state.lastTime = now;
  const k = Math.min(1, dt / MUSIC_FADE);
  for (const layer of MUSIC_LAYERS) {
    const target = layerTarget(layer, intensity);
    state.gains[layer] += (target - state.gains[layer]) * k;
  }

  const behind = Math.ceil((now - state.origin) / MUSIC_SIXTEENTH);
  if (state.cursor < behind) {
    state.cursor = behind;
  }

  let n = 0;
  const horizon = now + MUSIC_LOOKAHEAD;
  while (state.origin + state.cursor * MUSIC_SIXTEENTH < horizon) {
    // Leave room for a full sixteenth rather than truncating one mid-chord; the
    // next pump resyncs past anything dropped here.
    if (n + MUSIC_LAYERS.length > out.length) {
      break;
    }
    const at = state.origin + state.cursor * MUSIC_SIXTEENTH;
    const step = ((state.cursor % MUSIC_PATTERN_STEPS) + MUSIC_PATTERN_STEPS) % MUSIC_PATTERN_STEPS;
    for (const layer of MUSIC_LAYERS) {
      // A closed layer allocates no nodes at all; a FADING one still plays and
      // is audibly fading. Both facts read the same number, so they cannot
      // disagree.
      if (state.gains[layer] < MUSIC_GATE_EPS) {
        continue;
      }
      const note = patternAt(layer, step);
      if (!note) {
        continue;
      }
      const ev = out[n++];
      ev.at = at;
      ev.layer = layer;
      ev.f0 = note.f0;
      ev.f1 = note.f1;
      ev.dur = note.dur;
      ev.gain = note.gain;
    }
    state.cursor++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// The graph half: nodes, and nothing that could have been a pure function.
// ---------------------------------------------------------------------------

/**
 * Smoothing time constant for node parameters that track a value computed at
 * frame rate (s). A graph detail rather than a feel knob — like `TINT_START` in
 * `renderer.ts`, it is deliberately private to the module that uses it.
 */
const PARAM_SMOOTH = 0.02;
/** Floor for exponential ramps, which cannot reach zero. */
const SILENCE = 0.0001;
/** Tail added to every source's stop time, so an envelope is never clipped. */
const STOP_TAIL = 0.02;
/** Length of the shared noise buffer (s). Longer than any burst that reads it. */
const NOISE_SECONDS = 1;

/** One voice of one effect. `kind` decides oscillator versus filtered noise. */
interface SfxNote {
  kind: OscillatorType | 'noise';
  /** Start/end frequency (Hz) — the filter cutoff when `kind` is 'noise'. */
  f0: number;
  f1: number;
  dur: number;
  vol: number;
  /** Start offset within the effect (s). */
  at: number;
  /** How much of this voice goes to the shared delay send, 0..1. */
  send: number;
}

/**
 * GAME-DESIGN §9: short filtered noise bursts and sine/triangle blips with fast
 * envelopes. No square waves anywhere — that was the old game's voice.
 */
const RECIPES: Record<SfxName, readonly SfxNote[]> = {
  /** A footfall: a scrape, not a tone. Quiet — it fires five times a beat. */
  step: [{ kind: 'noise', f0: 1500, f1: 800, dur: 0.03, vol: 0.05, at: 0, send: 0.15 }],
  jump: [{ kind: 'triangle', f0: 300, f1: 720, dur: 0.1, vol: 0.13, at: 0, send: 0.3 }],
  /** A body hitting a slab: filtered noise falling away, no pitch at all. */
  land: [{ kind: 'noise', f0: 900, f1: 200, dur: 0.09, vol: 0.2, at: 0, send: 0.25 }],
  /** The world turning inside out: one sweep down, one back up through it. */
  flip: [
    { kind: 'triangle', f0: 880, f1: 220, dur: 0.09, vol: 0.14, at: 0, send: 0.5 },
    { kind: 'triangle', f0: 220, f1: 880, dur: 0.12, vol: 0.12, at: 0.06, send: 0.5 },
  ],
  pad: [
    { kind: 'noise', f0: 400, f1: 3000, dur: 0.12, vol: 0.14, at: 0, send: 0.4 },
    { kind: 'triangle', f0: 220, f1: 900, dur: 0.16, vol: 0.12, at: 0, send: 0.4 },
  ],
  goal: [
    { kind: 'sine', f0: 523, f1: 523, dur: 0.12, vol: 0.14, at: 0, send: 0.6 },
    { kind: 'sine', f0: 659, f1: 659, dur: 0.12, vol: 0.14, at: 0.12, send: 0.6 },
    { kind: 'sine', f0: 784, f1: 784, dur: 0.12, vol: 0.14, at: 0.24, send: 0.6 },
    { kind: 'sine', f0: 1047, f1: 1047, dur: 0.35, vol: 0.16, at: 0.36, send: 0.6 },
  ],
  death: [
    { kind: 'triangle', f0: 392, f1: 392, dur: 0.16, vol: 0.18, at: 0, send: 0.5 },
    { kind: 'triangle', f0: 311, f1: 311, dur: 0.16, vol: 0.18, at: 0.16, send: 0.5 },
    { kind: 'triangle', f0: 233, f1: 110, dur: 0.45, vol: 0.18, at: 0.32, send: 0.5 },
  ],
  menuMove: [{ kind: 'sine', f0: 700, f1: 700, dur: 0.04, vol: 0.08, at: 0, send: 0.2 }],
  menuPick: [
    { kind: 'sine', f0: 700, f1: 700, dur: 0.05, vol: 0.1, at: 0, send: 0.3 },
    { kind: 'sine', f0: 1050, f1: 1050, dur: 0.09, vol: 0.1, at: 0.05, send: 0.3 },
  ],
};

/** How this module gets a context. Injectable so tests can drive a fake one. */
export type ContextFactory = () => AudioContext | null;

/** The guarded default: null under node, null if the constructor throws. */
function defaultContext(): AudioContext | null {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    return null;
  }
  try {
    return new AudioContext();
  } catch {
    return null;
  }
}

interface Graph {
  ctx: AudioContext;
  /** Everything passes through this; muting ramps it to zero. */
  master: GainNode;
  /** The music bus, swelling with intensity under the master. */
  music: GainNode;
  layers: Record<MusicLayer, GainNode>;
  /** The shared feedback-delay send — the echoey character of every effect. */
  send: GainNode;
  feedback: GainNode;
  noise: AudioBuffer;
}

export class AudioSys {
  private readonly makeCtx: ContextFactory;
  private graph: Graph | null = null;
  private mutedFlag = false;
  private intensity = 0;
  private musicOn = false;
  private scheduler: SchedulerState | null = null;
  private readonly buffer = createNoteBuffer(32);
  /**
   * Fills the noise buffer. Cosmetic randomness, but seeded anyway (hard rule
   * 3's spirit): the same build should make the same noise every run.
   */
  private readonly rng = new Rng(0x9e3779b9);

  constructor(makeCtx: ContextFactory = defaultContext) {
    this.makeCtx = makeCtx;
  }

  /**
   * MUTE IS AN ACTION, NOT A FLAG READ AT PLAY TIME. With a running scheduler
   * "return early from play()" is no longer enough: muting has to duck the
   * master and stop scheduling, and unmuting has to resync onto the grid. The
   * accessor pair does both while every existing `audio.muted = x` call site
   * compiles unchanged.
   */
  get muted(): boolean {
    return this.mutedFlag;
  }

  set muted(v: boolean) {
    if (v === this.mutedFlag) {
      return;
    }
    this.mutedFlag = v;
    const g = this.graph;
    if (!g) {
      return;
    }
    const t = g.ctx.currentTime;
    g.master.gain.cancelScheduledValues(t);
    g.master.gain.setValueAtTime(g.master.gain.value, t);
    g.master.gain.linearRampToValueAtTime(v ? 0 : 1, t + PARAM_SMOOTH);
    // Nothing resets the cursor here: it is now behind, so the next pump takes
    // the resync path and comes back in on the grid rather than mid-sixteenth.
  }

  play(name: SfxName): void {
    if (this.mutedFlag) {
      return;
    }
    const g = this.ensureGraph();
    if (!g) {
      return;
    }
    this.resumeIfNeeded(g.ctx);
    const t0 = g.ctx.currentTime;
    for (const n of RECIPES[name]) {
      this.voice(g, n.kind, n.f0, n.f1, t0 + n.at, n.dur, n.vol, n.send, null);
    }
  }

  /**
   * THE PUMP. Called once per frame by `PlayScene` with the live `speedNorm`,
   * which is exactly the cadence a lookahead scheduler wants — so it sets the
   * target *and* advances the cursor. No `setInterval` (which would outlive the
   * scene and drift against the audio clock) and no second `update(dt)`.
   */
  setIntensity(n: number): void {
    this.intensity = n > 0 ? (n < 1 ? n : 1) : 0;
    const g = this.graph;
    if (!g) {
      return;
    }
    g.music.gain.setTargetAtTime(musicGain(this.intensity), g.ctx.currentTime, PARAM_SMOOTH);
    g.feedback.gain.setTargetAtTime(
      delayFeedback(this.intensity),
      g.ctx.currentTime,
      PARAM_SMOOTH,
    );
    if (!this.musicOn || this.mutedFlag || !this.scheduler) {
      return;
    }
    const now = g.ctx.currentTime;
    const count = scheduleWindow(this.scheduler, now, this.intensity, this.buffer);
    for (const layer of MUSIC_LAYERS) {
      g.layers[layer].gain.setTargetAtTime(this.scheduler.gains[layer], now, PARAM_SMOOTH);
    }
    for (let i = 0; i < count; i++) {
      this.note(g, this.buffer[i]);
    }
  }

  /**
   * The bed is SCENE-SCOPED: `PlayScene` starts it on enter and stops it on
   * exit, and the title screen stays silent but for its menu blips. A techno bed
   * under a motionless title screen spends the escalation before the player has
   * done anything to earn it.
   */
  startMusic(): void {
    const g = this.ensureGraph();
    if (!g) {
      return;
    }
    this.resumeIfNeeded(g.ctx);
    this.musicOn = true;
    this.scheduler = createSchedulerState(g.ctx.currentTime);
  }

  stopMusic(): void {
    this.musicOn = false;
    this.scheduler = null;
    const g = this.graph;
    if (!g) {
      return;
    }
    const t = g.ctx.currentTime;
    for (const layer of MUSIC_LAYERS) {
      g.layers[layer].gain.cancelScheduledValues(t);
      g.layers[layer].gain.setValueAtTime(0, t);
    }
  }

  private resumeIfNeeded(ctx: AudioContext): void {
    if (ctx.state === 'suspended') {
      // Fire and forget; the first user gesture unlocks it. Until then the
      // clock does not advance and the scheduler's resync covers the jump.
      void ctx.resume();
    }
  }

  /** One music note. The layer decides the voice; the event decides the rest. */
  private note(g: Graph, ev: NoteEvent): void {
    const dest = g.layers[ev.layer];
    switch (ev.layer) {
      case 'kick':
        this.voice(g, 'sine', ev.f0, ev.f1, ev.at, ev.dur, ev.gain, 0, dest);
        break;
      case 'hats':
        this.voice(g, 'noise', ev.f0, ev.f1, ev.at, ev.dur, ev.gain * 0.5, 0, dest, 'highpass');
        break;
      case 'bass':
        this.voice(g, 'triangle', ev.f0, ev.f1, ev.at, ev.dur, ev.gain * 0.9, 0, dest, 'lowpass');
        break;
      case 'arp':
        // The arp is the only layer on the send: its blips are what the delay
        // has anything interesting to do with.
        this.voice(g, 'triangle', ev.f0, ev.f1, ev.at, ev.dur, ev.gain * 0.35, 0, dest);
        break;
    }
  }

  /**
   * The single node-making path, for effects and for the bed alike.
   *
   * NO SOURCE IS EVER CREATED WITHOUT A SCHEDULED STOP. WebAudio node lifetime
   * is the classic leak in a module like this and it degrades slowly enough to
   * ship; one path with one rule is the mitigation, and `tests/audio.test.ts`
   * counts creations against stops.
   */
  private voice(
    g: Graph,
    kind: OscillatorType | 'noise',
    f0: number,
    f1: number,
    at: number,
    dur: number,
    vol: number,
    send: number,
    dest: AudioNode | null,
    filter: BiquadFilterType = 'bandpass',
  ): void {
    const ctx = g.ctx;
    const env = ctx.createGain();
    env.gain.setValueAtTime(Math.max(vol, SILENCE), at);
    env.gain.exponentialRampToValueAtTime(SILENCE, at + dur);

    let source: AudioScheduledSourceNode;
    if (kind === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = g.noise;
      const biq = ctx.createBiquadFilter();
      biq.type = filter;
      biq.frequency.setValueAtTime(Math.max(1, f0), at);
      biq.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
      src.connect(biq).connect(env);
      source = src;
    } else {
      const osc = ctx.createOscillator();
      osc.type = kind;
      osc.frequency.setValueAtTime(Math.max(1, f0), at);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
      osc.connect(env);
      source = osc;
    }

    env.connect(dest ?? g.master);
    if (send > 0) {
      const tap = ctx.createGain();
      tap.gain.setValueAtTime(send, at);
      env.connect(tap).connect(g.send);
    }
    source.start(at);
    source.stop(at + dur + STOP_TAIL);
  }

  private ensureGraph(): Graph | null {
    if (this.graph) {
      return this.graph;
    }
    const ctx = this.makeCtx();
    if (!ctx) {
      return null; // node / unsupported: stay silent
    }
    const master = ctx.createGain();
    master.gain.setValueAtTime(this.mutedFlag ? 0 : 1, ctx.currentTime);
    master.connect(ctx.destination);

    // send → delay → lowpass → master, with the lowpass feeding back into the
    // delay. Filtering INSIDE the loop is what makes successive repeats darker
    // rather than just quieter.
    const send = ctx.createGain();
    send.gain.setValueAtTime(1, ctx.currentTime);
    const delay = ctx.createDelay(1);
    delay.delayTime.setValueAtTime(SFX_DELAY_TIME, ctx.currentTime);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(SFX_DELAY_LOWPASS, ctx.currentTime);
    const feedback = ctx.createGain();
    feedback.gain.setValueAtTime(delayFeedback(this.intensity), ctx.currentTime);
    send.connect(delay).connect(lowpass).connect(feedback).connect(delay);
    lowpass.connect(master);

    const music = ctx.createGain();
    music.gain.setValueAtTime(musicGain(this.intensity), ctx.currentTime);
    music.connect(master);

    const layers = {} as Record<MusicLayer, GainNode>;
    for (const layer of MUSIC_LAYERS) {
      const node = ctx.createGain();
      node.gain.setValueAtTime(0, ctx.currentTime);
      node.connect(music);
      layers[layer] = node;
    }
    // The arp is the one layer with a wet path.
    const arpSend = ctx.createGain();
    arpSend.gain.setValueAtTime(0.5, ctx.currentTime);
    layers.arp.connect(arpSend).connect(send);

    this.graph = { ctx, master, music, layers, send, feedback, noise: this.makeNoise(ctx) };
    return this.graph;
  }

  /** One second of white noise, shared by every noise voice in the game. */
  private makeNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = this.rng.float(-1, 1);
    }
    return buf;
  }
}
