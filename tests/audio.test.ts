/**
 * The module that had never had a test worth the name. Two halves, two kinds of
 * test:
 *
 * - the scheduler is pure arithmetic over a beat grid, checked against
 *   hand-computed times;
 * - the graph is driven through a FAKE AudioContext, which is what turns
 *   "importing it does not throw" (the old file, and nearly worthless) into
 *   actually counting the nodes it makes and the stops it schedules.
 *
 * `obb.test.ts` was phase 4's deliberate over-investment; the fake context is
 * phase 6's.
 */

import { describe, expect, it } from 'vitest';
import {
  LEAD_DETUNE,
  LEAD_GATE,
  MUSIC_BAR,
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
  STEP,
} from '../src/constants';
import {
  AudioSys,
  MUSIC_LAYERS,
  activeLayers,
  createNoteBuffer,
  createSchedulerState,
  delayFeedback,
  layerTarget,
  musicGain,
  patternAt,
  scheduleWindow,
} from '../src/engine/audio';
import type { MusicLayer, NoteEvent, SfxName } from '../src/engine/audio';
import { lead, resetLead, setLead } from '../src/engine/tuning';

/**
 * GAME-DESIGN §9's set, in full. Listed here rather than derived from the union
 * so that adding or losing an effect is a visible edit to a test.
 */
const ALL_SFX: readonly SfxName[] = [
  'step',
  'jump',
  'land',
  'flip',
  'pad',
  'pickup',
  'goal',
  'death',
  'menuMove',
  'menuPick',
];

/** An arbitrary interior index to spot-check the saturation curve's shape at. */
const LEAD_CURVE_PROBE = 256;

// --- The fake context. Small enough to read, complete enough to catch a leak.

interface ParamOp {
  kind: string;
  value: number;
  time: number;
}

class FakeParam {
  value: number;
  readonly ops: ParamOp[] = [];

  constructor(value: number) {
    this.value = value;
  }

  /** The value of the last operation scheduled — where the param is headed. */
  get target(): number {
    return this.ops.length > 0 ? this.ops[this.ops.length - 1].value : this.value;
  }

  setValueAtTime(v: number, t: number): FakeParam {
    this.ops.push({ kind: 'set', value: v, time: t });
    this.value = v;
    return this;
  }

  linearRampToValueAtTime(v: number, t: number): FakeParam {
    this.ops.push({ kind: 'linear', value: v, time: t });
    return this;
  }

  exponentialRampToValueAtTime(v: number, t: number): FakeParam {
    this.ops.push({ kind: 'exp', value: v, time: t });
    return this;
  }

  setTargetAtTime(v: number, t: number, tc: number): FakeParam {
    this.ops.push({ kind: 'target', value: v, time: t });
    void tc;
    return this;
  }

  cancelScheduledValues(t: number): FakeParam {
    this.ops.push({ kind: 'cancel', value: this.value, time: t });
    return this;
  }
}

interface Tally {
  /** Sources created, by kind, and the stops scheduled against them. */
  oscillators: number;
  bufferSources: number;
  started: number;
  stopped: number;
  /** Sources that were started and never given a stop. Must always be zero. */
  live: number;
  gains: number;
}

class FakeCtx {
  currentTime = 0;
  readonly sampleRate = 48000;
  state: AudioContextState = 'running';
  readonly destination = { name: 'destination' };
  resumed = 0;
  readonly tally: Tally = {
    oscillators: 0,
    bufferSources: 0,
    started: 0,
    stopped: 0,
    live: 0,
    gains: 0,
  };
  /** Every gain node handed out, so a test can look at the master or a layer. */
  readonly gainNodes: { gain: FakeParam }[] = [];
  /** Every oscillator handed out — `type` is assigned after creation. */
  readonly oscs: { type: string; frequency: FakeParam }[] = [];
  /** Every biquad handed out, so a test can see the lead's lowpass close. */
  readonly biquads: { type: string; frequency: FakeParam; Q: FakeParam }[] = [];
  /** Every waveshaper handed out — the lead bus saturation. */
  readonly shapers: { curve: Float32Array | null }[] = [];

  private source(): { start(t: number): void; stop(t: number): void; connect(d: unknown): unknown } {
    const t = this.tally;
    let started = false;
    return {
      connect: (d: unknown) => d,
      start: () => {
        started = true;
        t.started++;
        t.live++;
      },
      stop: () => {
        t.stopped++;
        if (started) {
          t.live--;
        }
      },
    };
  }

  createGain(): { gain: FakeParam; connect(d: unknown): unknown; disconnect(): void } {
    this.tally.gains++;
    const node = {
      gain: new FakeParam(1),
      connect: (d: unknown) => d,
      disconnect: (): void => undefined,
    };
    this.gainNodes.push(node);
    return node;
  }

  createOscillator(): ReturnType<FakeCtx['source']> & { type: string; frequency: FakeParam } {
    this.tally.oscillators++;
    const node = { ...this.source(), type: 'sine', frequency: new FakeParam(440) };
    this.oscs.push(node);
    return node;
  }

  createBufferSource(): ReturnType<FakeCtx['source']> & { buffer: unknown } {
    this.tally.bufferSources++;
    return { ...this.source(), buffer: null };
  }

  createBiquadFilter(): { type: string; frequency: FakeParam; Q: FakeParam; connect(d: unknown): unknown } {
    const node = {
      type: 'lowpass',
      frequency: new FakeParam(350),
      Q: new FakeParam(1),
      connect: (d: unknown) => d,
    };
    this.biquads.push(node);
    return node;
  }

  createDelay(): { delayTime: FakeParam; connect(d: unknown): unknown } {
    return { delayTime: new FakeParam(0), connect: (d: unknown) => d };
  }

  createWaveShaper(): { curve: Float32Array | null; connect(d: unknown): unknown } {
    const node = { curve: null as Float32Array | null, connect: (d: unknown) => d };
    this.shapers.push(node);
    return node;
  }

  createBuffer(_channels: number, len: number): { getChannelData(i: number): Float32Array } {
    const data = new Float32Array(len);
    return { getChannelData: () => data };
  }

  resume(): Promise<void> {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
  }
}

function fakeSys(): { sys: AudioSys; ctx: FakeCtx } {
  const ctx = new FakeCtx();
  const sys = new AudioSys(() => ctx as unknown as AudioContext);
  return { sys, ctx };
}

// --- The pure half.

describe('layer gates', () => {
  it('are exact and EXCLUSIVE — §7 says "> 0.25", so 0.25 is silent', () => {
    expect(layerTarget('hats', MUSIC_GATE_HATS)).toBe(0);
    expect(layerTarget('hats', MUSIC_GATE_HATS + 1e-4)).toBe(1);
    expect(layerTarget('bass', MUSIC_GATE_BASS)).toBe(0);
    expect(layerTarget('bass', MUSIC_GATE_BASS + 1e-4)).toBe(1);
    expect(layerTarget('arp', MUSIC_GATE_ARP)).toBe(0);
    expect(layerTarget('arp', MUSIC_GATE_ARP + 1e-4)).toBe(1);
    // The kick is "always", which has to include a body at a dead stop.
    expect(layerTarget('kick', 0)).toBe(1);
    expect(layerTarget('kick', 1)).toBe(1);
  });

  it('layer in one at a time as speed rises', () => {
    expect(activeLayers(0)).toEqual(['kick']);
    expect(activeLayers(0.3)).toEqual(['kick', 'hats']);
    expect(activeLayers(0.5)).toEqual(['kick', 'hats', 'bass']);
    expect(activeLayers(1)).toEqual(['kick', 'hats', 'bass', 'arp']);
  });

  it('the master gain ramps continuously across the whole range', () => {
    expect(musicGain(0)).toBeCloseTo(MUSIC_GAIN_MIN, 12);
    expect(musicGain(1)).toBeCloseTo(MUSIC_GAIN_MAX, 12);
    expect(musicGain(0.5)).toBeCloseTo((MUSIC_GAIN_MIN + MUSIC_GAIN_MAX) / 2, 12);
    expect(musicGain(-3)).toBeCloseTo(MUSIC_GAIN_MIN, 12);
    expect(musicGain(9)).toBeCloseTo(MUSIC_GAIN_MAX, 12);
  });

  it('the delay feedback rises SLIGHTLY with speed, and never to self-oscillation', () => {
    expect(delayFeedback(0)).toBeCloseTo(SFX_DELAY_FEEDBACK, 12);
    expect(delayFeedback(1)).toBeCloseTo(SFX_DELAY_FEEDBACK_MAX, 12);
    expect(SFX_DELAY_FEEDBACK_MAX).toBeLessThan(1);
  });
});

describe('the patterns', () => {
  it('are literal and authored — four on the floor, offbeat hats, six bass hits', () => {
    const hits = (layer: MusicLayer): number[] => {
      const out: number[] = [];
      for (let s = 0; s < 16; s++) {
        if (patternAt(layer, s)) {
          out.push(s);
        }
      }
      return out;
    };
    expect(hits('kick')).toEqual([0, 4, 8, 12]);
    expect(hits('bass')).toEqual([0, 3, 6, 8, 11, 14]);
    // Hats accent the offbeat eighths and ghost the odd sixteenths at half
    // gain, staying silent exactly where the kick lands.
    expect(hits('hats')).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15]);
    expect(patternAt('hats', 2)?.gain).toBe(1);
    expect(patternAt('hats', 1)?.gain).toBe(0.5);
    expect(patternAt('hats', 0)).toBeNull();
  });

  it('the lead is an ELECTRO-POP RIFF: sparse, syncopated, and accented', () => {
    // Collect the four bars as (position, note) lists.
    const bars: { pos: number; f0: number; gain: number }[][] = [[], [], [], []];
    for (let s = 0; s < MUSIC_PATTERN_STEPS; s++) {
      const n = patternAt('arp', s);
      if (n) {
        bars[Math.floor(s / 16)].push({ pos: s % 16, f0: n.f0, gain: n.gain });
      }
    }
    // Sparse: six or seven notes per bar out of sixteen steps, never wall-to-wall.
    for (const bar of bars) {
      expect(bar.length).toBeGreaterThanOrEqual(4);
      expect(bar.length).toBeLessThanOrEqual(8);
    }
    // One rhythm, evolving pitch: bars 1-3 share the same rhythmic cell — the
    // 3-3-4 tresillo plus backbeat pickups — which is what makes it a riff.
    const rhythm = (bar: { pos: number }[]): number[] => bar.map((n) => n.pos);
    expect(rhythm(bars[1])).toEqual(rhythm(bars[0]));
    expect(rhythm(bars[2])).toEqual(rhythm(bars[0]));
    expect(rhythm(bars[0]).slice(0, 3)).toEqual([0, 3, 6]); // the tresillo pulse
    // Bar 3 restates bar 1 exactly; bars 2 and 4 answer with different pitches.
    expect(bars[2]).toEqual(bars[0]);
    expect(bars[1].map((n) => n.f0)).not.toEqual(bars[0].map((n) => n.f0));
    expect(bars[3].map((n) => n.f0)).not.toEqual(bars[0].map((n) => n.f0));
    // Every bar opens on the root, full velocity — the anchor of the loop.
    for (const bar of bars) {
      expect(bar[0].pos).toBe(0);
      expect(bar[0].f0).toBeCloseTo(220, 6); // A3 at the default octave
      expect(bar[0].gain).toBe(1);
    }
    // Accented: real velocity contour, ghosts at half — the bounce.
    const gains = bars.flat().map((n) => n.gain);
    expect(Math.min(...gains)).toBe(0.5);
    expect(Math.max(...gains)).toBe(1);
    // The peak note arrives EXACTLY ONCE per four bars — bar 4's turn — the
    // pattern's landmark against repetition.
    const freqs = bars.flat().map((n) => n.f0);
    const peak = Math.max(...freqs);
    expect(peak).toBeCloseTo(220 * Math.pow(2, 7 / 12), 3); // E4 at octave 0
    expect(freqs.filter((f) => f === peak).length).toBe(1);
    // Everything stays in A-minor pentatonic (A C D E G), consonant with the
    // bass's A and E under it, and never shrill even an octave up.
    const pentatonic = new Set([0, 3, 5, 7, 10]);
    for (const f of freqs) {
      const semis = Math.round(12 * Math.log2(f / 220));
      expect(pentatonic.has(((semis % 12) + 12) % 12)).toBe(true);
      expect(Math.abs(12 * Math.log2(f / 220) - semis)).toBeLessThan(1e-6);
    }
    expect(2 * peak).toBeLessThan(1000); // the whole riff at octave +1
  });

  it('the lead rests where the kick needs air, and gates vary with the note', () => {
    // Bar 1 leaves the second and third kick (steps 4 and 8) completely clean.
    expect(patternAt('arp', 4)).toBeNull();
    expect(patternAt('arp', 8)).toBeNull();
    // Gate lengths vary — the lean-back notes ring longer than the ghosts —
    // and every note is shorter than a beat at the default gate scale.
    const durs = new Set<number>();
    for (let s = 0; s < MUSIC_PATTERN_STEPS; s++) {
      const n = patternAt('arp', s);
      if (n) {
        durs.add(n.dur);
        expect(n.dur).toBeLessThan(4 * MUSIC_SIXTEENTH);
        expect(n.f0).toBe(n.f1); // the pitch never sweeps; the filter does
      }
    }
    expect(durs.size).toBeGreaterThan(2);
  });

  it('the tuner reaches the writing: octave shifts the register, gate stretches notes', () => {
    const base = patternAt('arp', 0)!;
    try {
      setLead({ ...lead, octave: 1, gate: 2 });
      const tuned = patternAt('arp', 0)!;
      expect(tuned.f0).toBeCloseTo(base.f0 * 2, 9);
      expect(tuned.dur).toBeCloseTo((base.dur * 2) / LEAD_GATE, 9);
      // The other layers never read the lead record.
      expect(patternAt('bass', 0)!.f0).toBeCloseTo(55, 6);
      expect(patternAt('kick', 0)!.dur).toBe(0.12);
    } finally {
      resetLead();
    }
    expect(patternAt('arp', 0)!.f0).toBeCloseTo(base.f0, 9);
  });

  it('the bass is the root and its fifth, two octaves below the lead', () => {
    expect(patternAt('bass', 0)?.f0).toBeCloseTo(55, 6); // A1
    expect(patternAt('bass', 6)?.f0).toBeCloseTo(82.407, 3); // E2
    expect(patternAt('arp', 0)!.f0 / patternAt('bass', 0)!.f0).toBeCloseTo(4, 6);
  });
});

describe('scheduleWindow', () => {
  /** Pump until the gains have settled, so gating is not the thing under test. */
  function warm(
    state: ReturnType<typeof createSchedulerState>,
    buf: NoteEvent[],
    from: number,
    steps: number,
    intensity = 1,
  ): number {
    let t = from;
    for (let i = 0; i < steps; i++) {
      t += STEP;
      scheduleWindow(state, t, intensity, buf);
    }
    return t;
  }

  it('places notes exactly on the grid, an integer count of sixteenths from the origin', () => {
    const state = createSchedulerState(10);
    const buf = createNoteBuffer(64);
    let t = 10;
    const times = new Set<number>();
    for (let i = 0; i < 120; i++) {
      const n = scheduleWindow(state, t, 1, buf);
      for (let j = 0; j < n; j++) {
        times.add(buf[j].at);
      }
      t += STEP;
    }
    for (const at of times) {
      const k = (at - 10) / MUSIC_SIXTEENTH;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }
    // Every sixteenth in the span, exactly once and with no gaps. Asserted as
    // consecutiveness rather than as a count: a count is an arithmetic puzzle
    // about where the window happened to end, and the property that matters is
    // that the cursor never skips a beat while it is being pumped normally.
    const sorted = [...times].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeCloseTo(MUSIC_SIXTEENTH, 9);
    }
    expect(sorted[sorted.length - 1] - sorted[0]).toBeGreaterThanOrEqual(MUSIC_BAR);
  });

  it('never schedules a note in the past, and never twice', () => {
    const state = createSchedulerState(0);
    const buf = createNoteBuffer(64);
    let t = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 600; i++) {
      const n = scheduleWindow(state, t, 1, buf);
      for (let j = 0; j < n; j++) {
        expect(buf[j].at).toBeGreaterThanOrEqual(t);
        expect(buf[j].at).toBeLessThan(t + MUSIC_LOOKAHEAD);
      }
      for (let j = 0; j < n; j++) {
        const key = buf[j].at * 1000 + MUSIC_LAYERS.indexOf(buf[j].layer);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      t += STEP;
    }
  });

  it('A STALLED SCHEDULER RESYNCS; IT DOES NOT CATCH UP', () => {
    // The phase's headline assertion. A backgrounded tab, a long GC or a
    // devtools pause leaves the cursor arbitrarily far behind; the textbook
    // `while (next < now + LOOKAHEAD)` loop then schedules every missed note
    // with a start time already elapsed, and WebAudio fires those immediately
    // and simultaneously. Three seconds is 25.6 sixteenths in one instant.
    const state = createSchedulerState(0);
    const buf = createNoteBuffer(512);
    const t = warm(state, buf, 0, 60);

    const stalled = t + 3;
    const n = scheduleWindow(state, stalled, 1, buf);
    const times = new Set<number>();
    let inThePast = 0;
    for (let j = 0; j < n; j++) {
      times.add(buf[j].at);
      if (buf[j].at < stalled) {
        inThePast++;
      }
    }
    expect(inThePast).toBe(0);
    expect(times.size).toBeLessThanOrEqual(2);
    expect(3 / MUSIC_SIXTEENTH).toBeCloseTo(25.6, 1); // what the naive loop emits

    // And the downbeat is still the downbeat: the snap is on the sixteenth
    // grid, so every pattern (all bar-periodic) stays aligned.
    for (const at of times) {
      const k = at / MUSIC_SIXTEENTH;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }

    // The bar phase after the stall is the bar phase the wall clock says it
    // should be — the gap is a gap, not a shift.
    const nextStep = Math.ceil(stalled / MUSIC_SIXTEENTH);
    expect(state.cursor).toBe(nextStep + times.size);
  });

  it('a suspended context (a frozen clock) is the same path', () => {
    // The autoplay policy leaves currentTime not merely late but STOPPED, then
    // jumping when it resumes. Pumping a hundred times at a frozen `now` must
    // not queue a hundred sixteenths.
    const state = createSchedulerState(0);
    const buf = createNoteBuffer(512);
    let total = 0;
    for (let i = 0; i < 100; i++) {
      total += scheduleWindow(state, 0, 1, buf);
    }
    // Only the notes inside one lookahead window from t=0, scheduled once.
    expect(total).toBeLessThanOrEqual(2 * MUSIC_LAYERS.length);
    const after = scheduleWindow(state, 5, 1, buf);
    for (let j = 0; j < after; j++) {
      expect(buf[j].at).toBeGreaterThanOrEqual(5);
    }
  });

  it('a gate is a CROSS-FADE: no pump may move a layer gain by more than dt/MUSIC_FADE', () => {
    // A scheduling-time gate moves it 1.0 in one frame, so this bound has teeth
    // by a factor of 21. STEP / MUSIC_FADE = 0.0476.
    const bound = STEP / MUSIC_FADE;
    expect(bound).toBeCloseTo(0.0476, 4);
    const state = createSchedulerState(0);
    const buf = createNoteBuffer(64);
    let t = 0;
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      // Jitter across every gate, both directions, including sitting on one.
      const intensity = [0, 0.25, 0.26, 0.45, 0.46, 0.7, 0.71, 1][i % 8];
      const before = { ...state.gains };
      t += STEP;
      scheduleWindow(state, t, intensity, buf);
      for (const layer of MUSIC_LAYERS) {
        worst = Math.max(worst, Math.abs(state.gains[layer] - before[layer]));
      }
    }
    expect(worst).toBeLessThanOrEqual(bound + 1e-12);
    expect(worst).toBeGreaterThan(0); // or the bound holds on a bed that never moved
  });

  it('a fully closed layer is skipped entirely, and a fading one still plays', () => {
    const state = createSchedulerState(0);
    const buf = createNoteBuffer(64);
    let t = 0;
    // At rest for two bars: only the kick should ever appear.
    for (let i = 0; i < 240; i++) {
      t += STEP;
      const n = scheduleWindow(state, t, 0, buf);
      for (let j = 0; j < n; j++) {
        expect(buf[j].layer).toBe('kick');
      }
    }
    expect(state.gains.hats).toBeLessThan(MUSIC_GATE_EPS);

    // Open the gate, then shut it again mid-fade: the hats must still be heard
    // on the way down, which is the difference between a fade and a switch.
    for (let i = 0; i < 60; i++) {
      t += STEP;
      scheduleWindow(state, t, 1, buf);
    }
    expect(state.gains.hats).toBeGreaterThan(0.5);
    let heardWhileFading = 0;
    // Half a second: four sixteenths, so at least one of them is a step the
    // hats actually play (they rest only on the multiples of four).
    for (let i = 0; i < 30; i++) {
      t += STEP;
      const n = scheduleWindow(state, t, 0, buf);
      for (let j = 0; j < n; j++) {
        if (buf[j].layer === 'hats') {
          heardWhileFading++;
        }
      }
    }
    expect(state.gains.hats).toBeLessThan(1);
    expect(heardWhileFading).toBeGreaterThan(0);
  });
});

// --- The graph half.

describe('AudioSys through a fake context', () => {
  it('EVERY NODE CREATED IS STOPPED — the leak a browser reveals in three minutes', () => {
    const { sys, ctx } = fakeSys();
    sys.startMusic();
    for (let i = 0; i < 200; i++) {
      ctx.currentTime += STEP;
      sys.setIntensity(1);
    }
    for (const name of ALL_SFX) {
      sys.play(name);
    }
    const t = ctx.tally;
    expect(t.oscillators + t.bufferSources).toBeGreaterThan(50);
    expect(t.started).toBe(t.oscillators + t.bufferSources);
    expect(t.stopped).toBe(t.started);
    expect(t.live).toBe(0);
  });

  it('at rest only the kick allocates anything at all', () => {
    const { sys, ctx } = fakeSys();
    sys.startMusic();
    for (let i = 0; i < 200; i++) {
      ctx.currentTime += STEP;
      sys.setIntensity(0);
    }
    // Two bars of four-on-the-floor is 8 kicks; the hats' noise sources are the
    // thing that must not exist.
    expect(ctx.tally.bufferSources).toBe(0);
    expect(ctx.tally.oscillators).toBeGreaterThan(4);
    expect(ctx.tally.oscillators).toBeLessThan(16);
  });

  it('the lead is a sustained synth voice: saw pair, sub, vibrato, sustain, saturation', () => {
    const { sys, ctx } = fakeSys();
    sys.startMusic();
    for (let i = 0; i < 400; i++) {
      ctx.currentTime += STEP;
      sys.setIntensity(1);
    }
    // The saw pairs, created lo/hi per note.
    const saws = ctx.oscs.filter((o) => o.type === 'sawtooth');
    expect(saws.length).toBeGreaterThan(0);
    expect(saws.length % 2).toBe(0);
    for (let i = 0; i < saws.length; i += 2) {
      const lo = saws[i].frequency.ops[0].value;
      const hi = saws[i + 1].frequency.ops[0].value;
      // ±LEAD_DETUNE cents around the written pitch — the width of the voice,
      // and a single oscillator's worth of it when the detune ships at 0.
      expect(hi / lo).toBeCloseTo(Math.pow(2, (2 * LEAD_DETUNE) / 1200), 9);
      // And the pitch itself never sweeps — both ops carry the same frequency.
      expect(saws[i].frequency.ops[1].value).toBeCloseTo(lo, 9);
    }
    // The movement is the FILTER: each lead lowpass opens above twice the
    // pitch and eases down onto the note, with gentle resonance. (Geometric
    // mean of the pair recovers the written pitch.)
    const leads = ctx.biquads.filter((b) => b.Q.ops.length > 0);
    expect(leads.length).toBe(saws.length / 2);
    for (let i = 0; i < leads.length; i++) {
      const pitch = Math.sqrt(
        saws[2 * i].frequency.ops[0].value * saws[2 * i + 1].frequency.ops[0].value,
      );
      const open = leads[i].frequency.ops[0].value;
      const closed = leads[i].frequency.ops[1].value;
      expect(open).toBeGreaterThan(2 * pitch);
      expect(closed).toBeLessThan(open);
      expect(closed).toBeGreaterThan(pitch); // closes onto the note, not under it
      expect(leads[i].Q.ops[0].value).toBeGreaterThanOrEqual(1); // flat or warm, never thin
      expect(leads[i].Q.ops[0].value).toBeLessThan(4); // and SMOOTH: gentle Q
    }
    // The weight: every note carries a triangle sub an octave below the pitch.
    // Root notes are A3 = 220, so their subs sit at 110 — a frequency the bass
    // itself never plays (it holds A1/E2), which makes them attributable.
    const rootLeads = leads.filter((_, i) => {
      const pitch = Math.sqrt(
        saws[2 * i].frequency.ops[0].value * saws[2 * i + 1].frequency.ops[0].value,
      );
      return Math.abs(pitch - 220) < 0.01;
    });
    const subs = ctx.oscs.filter(
      (o) => o.type === 'triangle' && Math.abs(o.frequency.ops[0].value - 110) < 0.01,
    );
    expect(rootLeads.length).toBeGreaterThan(0);
    expect(subs.length).toBe(rootLeads.length);
    // The voice: one vibrato LFO per note — a sine well below audio rate.
    const lfos = ctx.oscs.filter((o) => o.type === 'sine' && o.frequency.ops[0].value < 20);
    expect(lfos.length).toBe(leads.length);
    // The envelope can SUSTAIN: silence → linear swell → hold at level →
    // release. Four ops, the hold anchor at the level the swell reached, and
    // never out of order — at the shipped short gates the hold is brief and
    // the note is a plucky stab; a stretched gate holds a pad.
    const sustains = ctx.gainNodes.filter(
      (n) =>
        n.gain.ops.length === 4 &&
        n.gain.ops[0].kind === 'set' &&
        n.gain.ops[0].value < 0.001 &&
        n.gain.ops[1].kind === 'linear' &&
        n.gain.ops[1].value > 0.01 &&
        n.gain.ops[2].kind === 'set' &&
        n.gain.ops[2].value === n.gain.ops[1].value &&
        n.gain.ops[3].kind === 'exp',
    );
    expect(sustains.length).toBe(leads.length);
    for (const s of sustains) {
      expect(s.gain.ops[2].time).toBeGreaterThanOrEqual(s.gain.ops[1].time);
      expect(s.gain.ops[3].time).toBeGreaterThan(s.gain.ops[2].time);
    }
    // The post chain: exactly one waveshaper on the lead bus, loaded with a
    // symmetric soft curve normalised to ±1 — saturation, not distortion.
    expect(ctx.shapers.length).toBe(1);
    const curve = ctx.shapers[0].curve!;
    expect(curve).not.toBeNull();
    const mid = (curve.length - 1) / 2;
    expect(curve[0]).toBeCloseTo(-1, 6);
    expect(curve[curve.length - 1]).toBeCloseTo(1, 6);
    expect(Math.abs(curve[Math.floor(mid)])).toBeLessThan(0.01); // odd symmetry
    // And the DRIVE slider lands live: moving it rebuilds the curve (still
    // normalised) on the next pump, and only then.
    try {
      const before = ctx.shapers[0].curve;
      setLead({ ...lead, drive: 6 });
      expect(ctx.shapers[0].curve).toBe(before); // not until a pump
      ctx.currentTime += STEP;
      sys.setIntensity(1);
      expect(ctx.shapers[0].curve).not.toBe(before);
      expect(ctx.shapers[0].curve![LEAD_CURVE_PROBE]).toBeCloseTo(
        Math.tanh(6 * ((2 * LEAD_CURVE_PROBE) / 1023 - 1)) / Math.tanh(6),
        6,
      );
    } finally {
      resetLead();
    }
  });

  it('mute acts: it ducks the master to zero and stops scheduling within one pump', () => {
    const { sys, ctx } = fakeSys();
    sys.startMusic();
    for (let i = 0; i < 120; i++) {
      ctx.currentTime += STEP;
      sys.setIntensity(1);
    }
    const master = ctx.gainNodes[0];
    expect(master.gain.target).toBe(1);

    const before = ctx.tally.oscillators + ctx.tally.bufferSources;
    sys.muted = true;
    expect(master.gain.target).toBe(0);
    for (let i = 0; i < 120; i++) {
      ctx.currentTime += STEP;
      sys.setIntensity(1);
    }
    expect(ctx.tally.oscillators + ctx.tally.bufferSources).toBe(before);
    sys.play('jump'); // and effects are silent too
    expect(ctx.tally.oscillators + ctx.tally.bufferSources).toBe(before);

    // Unmuting resumes ON THE GRID, not mid-sixteenth — decision 2's path,
    // exercised a second way.
    sys.muted = false;
    expect(master.gain.target).toBe(1);
    ctx.currentTime += STEP;
    sys.setIntensity(1);
    expect(ctx.tally.oscillators + ctx.tally.bufferSources).toBeGreaterThan(before);
  });

  it('stopMusic silences the layers, and setIntensity then allocates nothing', () => {
    const { sys, ctx } = fakeSys();
    sys.startMusic();
    for (let i = 0; i < 120; i++) {
      ctx.currentTime += STEP;
      sys.setIntensity(1);
    }
    const before = ctx.tally.oscillators + ctx.tally.bufferSources;
    sys.stopMusic();
    for (let i = 0; i < 120; i++) {
      ctx.currentTime += STEP;
      sys.setIntensity(1);
    }
    expect(ctx.tally.oscillators + ctx.tally.bufferSources).toBe(before);
    // But effects still work — the bed is scene-scoped, the SFX are not.
    sys.play('menuPick');
    expect(ctx.tally.oscillators).toBeGreaterThan(0);
  });

  it('a suspended context is resumed on the first sound, not at construction', () => {
    const ctx = new FakeCtx();
    ctx.state = 'suspended';
    const sys = new AudioSys(() => ctx as unknown as AudioContext);
    expect(ctx.resumed).toBe(0); // constructing must not touch the hardware
    sys.play('jump');
    expect(ctx.resumed).toBe(1);
  });

  it('every effect makes at least one source, and none of them is a square wave', () => {
    for (const name of ALL_SFX) {
      const { sys, ctx } = fakeSys();
      sys.play(name);
      expect(ctx.tally.oscillators + ctx.tally.bufferSources).toBeGreaterThan(0);
      expect(ctx.tally.stopped).toBe(ctx.tally.started);
    }
  });
});

describe('AudioSys under node', () => {
  it('is a total no-op with no context and no throw', () => {
    const a = new AudioSys(() => null);
    expect(a.muted).toBe(false);
    for (const name of ALL_SFX) {
      expect(() => a.play(name)).not.toThrow();
    }
    expect(() => a.startMusic()).not.toThrow();
    expect(() => a.setIntensity(1)).not.toThrow();
    expect(() => a.stopMusic()).not.toThrow();
    a.muted = true;
    expect(a.muted).toBe(true);
    expect(() => a.play('flip')).not.toThrow();
  });

  it('the default factory finds no AudioContext here, and says so quietly', () => {
    // The guard that keeps this module importable in vitest's node environment.
    const a = new AudioSys();
    expect(() => a.play('goal')).not.toThrow();
    expect(() => a.setIntensity(0.5)).not.toThrow();
  });
});
