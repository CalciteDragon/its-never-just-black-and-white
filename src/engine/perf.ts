/**
 * THE PROFILER — the measuring half of the performance monitor. Pure, clocked
 * through an injectable `now`, and node-safe: it touches no DOM, no canvas and
 * no `performance` at import time, so the whole thing unit-tests and the
 * statistics can be trusted rather than eyeballed off a panel.
 *
 * The browser half is `src/devperf.ts`, mounted only behind `?perf=1`.
 *
 * Three kinds of number, and the distinction is the whole design:
 *
 * - **Spans** are elapsed times inside one frame — `update`, `render`,
 *   `present` — measured by `begin`/`end` pairs. Their sum is not the frame:
 *   `cpu` is measured end-to-end around all of them, so whatever is NOT in a
 *   named span still shows up as the gap. An optimisation pass that only ever
 *   sees named spans optimises the parts somebody already suspected.
 * - **Counters** accumulate within a frame and reset at its end (fixed steps
 *   consumed, draw calls issued).
 * - **Gauges** are levels sampled at the end of a frame (particles alive,
 *   speedNorm, JS heap). They are dynamic by name so that any module can
 *   report one without this file learning what it is.
 *
 * **Everything is a no-op while `enabled` is false**, which is how it can be
 * compiled into the shipped loop at all: `Game.stepFrame` pays one boolean test
 * per call site and the ring buffer never allocates. Nothing turns `enabled`
 * on except `devperf.ts` and the tests.
 *
 * `wall` vs `cpu` is the other distinction that matters. `wall` is the real
 * gap between frames, so it — and only it — gives fps; `cpu` is what the game
 * actually spent. A game pinned at vsync has a healthy `wall` and says nothing
 * about how close to the cliff it is; `cpu` against `PERF_BUDGET_MS` is the
 * number that answers that, and it is the number optimisation moves.
 */

import { PERF_BUDGET_MS, PERF_HISTORY } from '../constants';

/** The named spans. Fixed: they are the phases of `Game.stepFrame` itself. */
export const SPANS = ['update', 'render', 'present'] as const;
export type SpanName = (typeof SPANS)[number];

/** The per-frame counters. Fixed, for the same reason. */
export const COUNTERS = ['steps', 'draws'] as const;
export type CounterName = (typeof COUNTERS)[number];

/** One frame of measurement. Plain data — serialisable, and safe to keep. */
export interface FrameSample {
  /** Frame index since the last reset. */
  readonly n: number;
  /** Wall-clock gap since the previous frame, ms (vsync idle included). */
  readonly wall: number;
  /** CPU spent inside `stepFrame`, ms, end to end. */
  readonly cpu: number;
  readonly update: number;
  readonly render: number;
  readonly present: number;
  readonly steps: number;
  readonly draws: number;
  readonly gauges: Readonly<Record<string, number>>;
}

/** Distribution of one series. Percentiles interpolate; nothing is rounded. */
export interface Stat {
  readonly n: number;
  readonly min: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export interface PerfReport {
  readonly label: string;
  readonly frames: number;
  /** Wall seconds the window covers. */
  readonly seconds: number;
  readonly fps: { readonly mean: number; readonly p1Low: number; readonly min: number };
  readonly budgetMs: number;
  /** Frames whose CPU cost exceeded the budget, and that as a percentage. */
  readonly overBudget: number;
  readonly overBudgetPct: number;
  readonly wall: Stat;
  readonly cpu: Stat;
  readonly spans: Readonly<Record<SpanName, Stat>>;
  readonly counters: Readonly<Record<CounterName, Stat>>;
  readonly gauges: Readonly<Record<string, Stat>>;
  /** The five most expensive frames, worst first — where to go looking. */
  readonly worst: readonly FrameSample[];
}

const EMPTY_STAT: Stat = { n: 0, min: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };

/**
 * Linear-interpolated percentile of an ASCENDING-sorted series, `p` in [0, 1].
 *
 * Interpolated rather than nearest-rank because the interesting windows are
 * short: over 120 frames the nearest-rank p99 is simply the second-worst
 * frame, so p95 and p99 collapse onto the same sample and the tail stops
 * having a shape. Empty returns 0 — a report over no frames states zeros
 * rather than NaNs that then poison every average downstream.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const clamped = p < 0 ? 0 : p > 1 ? 1 : p;
  const pos = clamped * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) {
    return sorted[lo];
  }
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Distribution of an UNSORTED series. Copies before sorting; input survives. */
export function summarize(values: readonly number[]): Stat {
  if (values.length === 0) {
    return EMPTY_STAT;
  }
  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) {
    sum += v;
  }
  return {
    n: sorted.length,
    min: sorted[0],
    mean: sum / sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
  };
}

/**
 * The default clock. Read through `globalThis` and INSIDE the function, not at
 * import time: node has `performance` and browsers have it too, but the point
 * is that this module can be imported anywhere and only reads a clock once
 * somebody has already turned measurement on.
 */
function defaultNow(): number {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p ? p.now() : Date.now();
}

export class Profiler {
  /** Nothing is measured, allocated or timed while this is false. */
  enabled = false;
  /** What a recording is called. Carried into the report. */
  label = 'live';

  private readonly now: () => number;
  private readonly capacity: number;
  private readonly ring: FrameSample[] = [];
  /** Next write position once the ring is full. */
  private head = 0;
  private frames = 0;

  private frameStart = 0;
  private wall = 0;
  private readonly spanStart: Record<SpanName, number> = { update: 0, render: 0, present: 0 };
  private readonly spanAcc: Record<SpanName, number> = { update: 0, render: 0, present: 0 };
  private readonly counterAcc: Record<CounterName, number> = { steps: 0, draws: 0 };
  private readonly gaugeAcc = new Map<string, number>();

  constructor(opts?: { now?: () => number; capacity?: number }) {
    this.now = opts?.now ?? defaultNow;
    this.capacity = Math.max(1, opts?.capacity ?? PERF_HISTORY);
  }

  /** Frames captured since the last reset (may exceed what the ring holds). */
  get frameCount(): number {
    return this.frames;
  }

  /** Open a frame. `elapsedSec` is the wall gap the loop was handed. */
  beginFrame(elapsedSec: number): void {
    if (!this.enabled) {
      return;
    }
    this.wall = elapsedSec * 1000;
    this.spanAcc.update = 0;
    this.spanAcc.render = 0;
    this.spanAcc.present = 0;
    this.counterAcc.steps = 0;
    this.counterAcc.draws = 0;
    this.frameStart = this.now();
  }

  begin(span: SpanName): void {
    if (this.enabled) {
      this.spanStart[span] = this.now();
    }
  }

  /**
   * Close a span, ADDING to the frame's total for it rather than replacing it.
   * A span that opens twice in one frame (a scene that renders a sub-scene, an
   * update split around a scene change) has to sum, or the second pair silently
   * discards the first.
   */
  end(span: SpanName): void {
    if (this.enabled) {
      this.spanAcc[span] += this.now() - this.spanStart[span];
    }
  }

  /** Add to a per-frame counter. */
  count(counter: CounterName, n = 1): void {
    if (this.enabled) {
      this.counterAcc[counter] += n;
    }
  }

  /** Record a level for this frame. Last write per frame wins. */
  gauge(name: string, value: number): void {
    if (this.enabled) {
      this.gaugeAcc.set(name, value);
    }
  }

  /** Close the frame and commit one sample. */
  endFrame(): void {
    if (!this.enabled) {
      return;
    }
    const gauges: Record<string, number> = {};
    for (const [k, v] of this.gaugeAcc) {
      gauges[k] = v;
    }
    const sample: FrameSample = {
      n: this.frames,
      wall: this.wall,
      cpu: this.now() - this.frameStart,
      update: this.spanAcc.update,
      render: this.spanAcc.render,
      present: this.spanAcc.present,
      steps: this.counterAcc.steps,
      draws: this.counterAcc.draws,
      gauges,
    };
    this.frames++;
    if (this.ring.length < this.capacity) {
      this.ring.push(sample);
      return;
    }
    this.ring[this.head] = sample;
    this.head = this.head + 1 < this.capacity ? this.head + 1 : 0;
  }

  /** Drop all history. Does not change `enabled`. */
  reset(label = this.label): void {
    this.ring.length = 0;
    this.head = 0;
    this.frames = 0;
    this.label = label;
    this.gaugeAcc.clear();
  }

  /** History, oldest first. A copy: the ring keeps being written to. */
  samples(): FrameSample[] {
    if (this.ring.length < this.capacity) {
      return [...this.ring];
    }
    return [...this.ring.slice(this.head), ...this.ring.slice(0, this.head)];
  }

  /** The most recent frame, or null before the first one closes. */
  last(): FrameSample | null {
    if (this.ring.length === 0) {
      return null;
    }
    const i =
      this.ring.length < this.capacity
        ? this.ring.length - 1
        : (this.head + this.capacity - 1) % this.capacity;
    return this.ring[i];
  }

  /**
   * Summarise the window. `tail` limits it to the last N frames — the live
   * panel wants the last second, a recording wants everything.
   */
  report(tail = Number.POSITIVE_INFINITY): PerfReport {
    const all = this.samples();
    const rows = tail < all.length ? all.slice(all.length - tail) : all;
    return buildReport(this.label, rows);
  }
}

/** Summarise an arbitrary set of samples. Exported for tests and for replays. */
export function buildReport(label: string, rows: readonly FrameSample[]): PerfReport {
  const pick = (f: (s: FrameSample) => number): Stat => summarize(rows.map(f));
  const wall = pick((s) => s.wall);
  const cpu = pick((s) => s.cpu);
  let seconds = 0;
  let over = 0;
  for (const s of rows) {
    seconds += s.wall / 1000;
    if (s.cpu > PERF_BUDGET_MS) {
      over++;
    }
  }
  const gaugeNames = new Set<string>();
  for (const s of rows) {
    for (const k of Object.keys(s.gauges)) {
      gaugeNames.add(k);
    }
  }
  const gauges: Record<string, Stat> = {};
  for (const name of [...gaugeNames].sort()) {
    // Only the frames that actually reported the gauge. A gauge that starts
    // being reported halfway through a recording (entering a level mid-window)
    // must not have the first half averaged in as zeros.
    const vals: number[] = [];
    for (const s of rows) {
      const v = s.gauges[name];
      if (typeof v === 'number') {
        vals.push(v);
      }
    }
    gauges[name] = summarize(vals);
  }
  return {
    label,
    frames: rows.length,
    seconds,
    fps: {
      mean: wall.mean > 0 ? 1000 / wall.mean : 0,
      p1Low: wall.p99 > 0 ? 1000 / wall.p99 : 0,
      min: wall.max > 0 ? 1000 / wall.max : 0,
    },
    budgetMs: PERF_BUDGET_MS,
    overBudget: over,
    overBudgetPct: rows.length > 0 ? (over / rows.length) * 100 : 0,
    wall,
    cpu,
    spans: {
      update: pick((s) => s.update),
      render: pick((s) => s.render),
      present: pick((s) => s.present),
    },
    counters: {
      steps: pick((s) => s.steps),
      draws: pick((s) => s.draws),
    },
    gauges,
    worst: [...rows].sort((a, b) => b.cpu - a.cpu).slice(0, 5),
  };
}

/**
 * A report as fixed-width text. This is what gets read — in the console, in a
 * commit message, in a diff between two optimisation attempts — so it is
 * aligned and stable rather than pretty.
 */
export function reportText(r: PerfReport): string {
  const ms = (n: number): string => n.toFixed(2).padStart(7, ' ');
  const line = (name: string, s: Stat): string =>
    `  ${name.padEnd(9)} ${ms(s.mean)} ${ms(s.p50)} ${ms(s.p95)} ${ms(s.p99)} ${ms(s.max)}`;
  const out = [
    `PERF ${r.label} — ${r.frames} frames, ${r.seconds.toFixed(2)}s`,
    `  fps  mean ${r.fps.mean.toFixed(1)}  1% low ${r.fps.p1Low.toFixed(1)}  min ${r.fps.min.toFixed(1)}`,
    `  over ${r.budgetMs.toFixed(2)}ms budget: ${r.overBudget}/${r.frames} (${r.overBudgetPct.toFixed(1)}%)`,
    '  ms            mean     p50     p95     p99     max',
    line('wall', r.wall),
    line('cpu', r.cpu),
  ];
  for (const span of SPANS) {
    out.push(line(span, r.spans[span]));
  }
  const rest = r.cpu.mean - (r.spans.update.mean + r.spans.render.mean + r.spans.present.mean);
  out.push(`  unnamed   ${ms(rest)}  (cpu not inside a span)`);
  for (const counter of COUNTERS) {
    const s = r.counters[counter];
    out.push(`  ${counter.padEnd(9)} mean ${s.mean.toFixed(2)}  max ${s.max.toFixed(0)}  (per frame)`);
  }
  for (const [name, s] of Object.entries(r.gauges)) {
    out.push(`  ${name.padEnd(9)} mean ${s.mean.toFixed(2)}  max ${s.max.toFixed(2)}  (gauge)`);
  }
  if (r.worst.length > 0) {
    out.push('  worst frames (cpu ms — u/r/p, steps, draws):');
    for (const w of r.worst) {
      out.push(
        `    #${String(w.n).padEnd(6)} ${w.cpu.toFixed(2)} — ` +
          `${w.update.toFixed(2)}/${w.render.toFixed(2)}/${w.present.toFixed(2)}` +
          `  steps ${w.steps}  draws ${w.draws}`,
      );
    }
  }
  return out.join('\n');
}

/**
 * The one profiler the game is instrumented against. A singleton because the
 * instrumentation points are inside the loop and the renderer, and threading an
 * instance through them would mean every module that can be slow taking a
 * profiler parameter forever. Tests construct their own `Profiler` instead.
 */
export const perf = new Profiler();
