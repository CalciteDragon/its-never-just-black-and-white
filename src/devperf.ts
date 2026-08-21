/**
 * THE PERFORMANCE MONITOR — the browser half of `engine/perf.ts`. A dev-only
 * DOM panel plus a scripting API, mounted only behind `?perf=1`.
 *
 * It has two jobs, and they are for two different people:
 *
 * - **The panel** is for a human with the game in front of them: live fps, the
 *   frame's cost split into update / render / present, a rolling graph, the
 *   counters and gauges, and RECORD / COPY buttons for turning a run into a
 *   report that can be pasted somewhere.
 * - **`window.__perf`** is for an agent or a script driving the page. It can
 *   run a *synchronous* N-frame benchmark — no rAF, no vsync, no waiting — and
 *   get back a report with real distributions, which is what makes "did that
 *   optimisation help?" a question with an answer instead of a feeling. See
 *   `bench` and `suite`.
 *
 * Beside `main.ts` rather than in `src/engine/` for exactly the reason the dev
 * tuner is: it reaches into scenes and levels, and an engine module that knew
 * about a scene would invert the layering. Nothing imports it but `main.ts`,
 * and `main.ts` imports it dynamically, so a build nobody asks for it in never
 * runs a line of it — and `perf.enabled` stays false, which is what keeps the
 * instrumentation in `Game.stepFrame` down to a boolean test.
 *
 * **The panel does not measure itself.** Its own rAF tick runs outside
 * `stepFrame`, so the numbers it draws are the game's, not the game's plus a
 * panel's. That is also why the readout text is rewritten at 5 Hz while the
 * graph redraws every frame: reflowing a dozen lines of text sixty times a
 * second is the panel spending more than the thing it is watching.
 */

import { PERF_BUDGET_MS, STEP } from './constants';
import { copyToClipboard, detectClipboard } from './engine/levelio';
import { palette } from './engine/palette';
import { perf, reportText, SPANS } from './engine/perf';
import type { FrameSample, PerfReport, Profiler } from './engine/perf';
import type { Game, Scene } from './game';
import { LEVELS } from './levels/index';
import { PlayScene } from './scenes/play';

declare global {
  interface Window {
    /** The scripting API. Present only under `?perf=1`. */
    __perf?: PerfApi;
  }
}

/** Toggles the panel. F9 rather than a letter: every letter is a game binding. */
const TOGGLE_CODE = 'F9';

/** Frames the graph shows — the last five seconds at 60 fps. */
const GRAPH_FRAMES = 300;
const GRAPH_W = 300;
const GRAPH_H = 68;

/** Seconds between rewrites of the readout text. See the header. */
const TEXT_INTERVAL = 0.2;

/** How tall the graph is, in ms of frame cost, before it rescales. */
const GRAPH_FLOOR_MS = 20;

export interface BenchOptions {
  /** Frames to measure. Synchronous, so this blocks the tab for their sum. */
  frames?: number;
  /** Seconds fed to the loop per frame. One fixed step by default. */
  dt?: number;
  /** Unmeasured frames run first, to let JIT and lazy allocation settle. */
  warmup?: number;
  label?: string;
  /** `KeyboardEvent.code`s held down for the whole run, warmup included. */
  keys?: readonly string[];
}

export interface Scenario {
  readonly name: string;
  /** Campaign index, level id, or null to measure whatever is on screen. */
  readonly level: number | string | null;
  readonly keys?: readonly string[];
}

export interface SuiteRow {
  readonly name: string;
  readonly frames: number;
  readonly cpuMean: number;
  readonly cpuP95: number;
  readonly cpuMax: number;
  readonly updateMean: number;
  readonly renderMean: number;
  readonly presentMean: number;
  readonly drawsMean: number;
  readonly overBudgetPct: number;
  readonly gauges: Readonly<Record<string, number>>;
}

export interface SuiteResult {
  readonly rows: readonly SuiteRow[];
  readonly reports: readonly PerfReport[];
  /** The rows as an aligned table — the thing to paste into a commit. */
  readonly text: string;
}

export interface PerfApi {
  readonly profiler: Profiler;
  enable(on?: boolean): void;
  reset(label?: string): void;
  report(tail?: number): PerfReport;
  text(tail?: number): string;
  /** Print the report and return it. The one-liner for a console. */
  log(tail?: number): PerfReport;
  samples(): FrameSample[];
  /** Per-frame rows for offline analysis. Gauge columns included. */
  csv(): string;
  /** Whole history as JSON on the clipboard (and in the console regardless). */
  copy(): Promise<boolean>;
  record(label?: string): void;
  stop(): PerfReport;
  bench(opts?: BenchOptions): PerfReport;
  suite(scenarios?: readonly Scenario[], opts?: BenchOptions): SuiteResult;
  /** Load a campaign level (by index or id) so a bench has something to run. */
  level(which: number | string): boolean;
  /** Hold or release raw key codes on the live loop. */
  hold(codes: readonly string[], down: boolean): void;
}

/**
 * The default suite: the screens whose costs differ in KIND, not the ones that
 * happen to be handy. A menu is text and nothing else; a level at rest is the
 * tile draw with the post pass idle; a level being run is the same draw with
 * the aberration, the vignette tint and a live particle pool on top — which is
 * the only configuration where the expensive path is actually taken. Measuring
 * only the first two is how a game gets optimised for its title screen.
 */
export const DEFAULT_SUITE: readonly Scenario[] = [
  { name: 'title', level: null },
  { name: '00 idle', level: 0 },
  { name: '00 run', level: 0, keys: ['KeyD'] },
  { name: '10 run', level: 10, keys: ['KeyD'] },
  { name: '19 run', level: 19, keys: ['KeyD'] },
];

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.setAttribute('style', style);
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/** Used JS heap in MB, or null off Chrome — where the API simply is not there. */
function heapMB(): number | null {
  const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize / (1024 * 1024) : null;
}

function clampInt(n: number, lo: number, hi: number): number {
  const i = Math.round(n);
  return i < lo ? lo : i > hi ? hi : i;
}

/** A campaign level by index or by id, or null if there is no such level. */
function findLevel(which: number | string): (typeof LEVELS)[number] | null {
  if (typeof which === 'number') {
    return LEVELS[which] ?? null;
  }
  return LEVELS.find((l) => l.id === which || l.id.startsWith(`${which}-`)) ?? null;
}

/**
 * Mount the monitor. Returns a disposer — a dev tool with no way off the
 * window becomes permanent by accident.
 */
export function mountDevPerf(game: Game, doc: Document, win: Window): () => void {
  perf.enabled = true;
  perf.reset('live');

  // --- Panel chrome. Bottom-left, opposite the dev tuner, so `?tune=1&perf=1`
  // is a legible screen rather than two panels in a pile. ---
  const root = el(
    doc,
    'div',
    [
      'position:fixed;bottom:10px;left:10px;z-index:10',
      'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'padding:8px 10px;border-width:2px;border-style:solid',
      'width:322px;letter-spacing:0.03em',
    ].join(';'),
  );

  const head = el(doc, 'div', 'display:flex;justify-content:space-between;margin-bottom:6px');
  head.append(
    el(doc, 'strong', 'letter-spacing:0.12em', 'PERF'),
    el(doc, 'span', 'opacity:0.6', 'F9 hides'),
  );

  const big = el(doc, 'div', 'font-size:15px;font-weight:700;letter-spacing:0.06em', '—');
  const graph = doc.createElement('canvas');
  graph.width = GRAPH_W;
  graph.height = GRAPH_H;
  graph.setAttribute('style', `display:block;width:100%;height:${GRAPH_H}px;margin:6px 0`);
  const gctx = graph.getContext('2d');
  const body = el(doc, 'pre', 'margin:0;white-space:pre;font:inherit', '');
  const note = el(doc, 'div', 'margin-top:6px;min-height:1.4em;opacity:0.75', 'F9 hides · RECORD then COPY');

  const btnStyle =
    'font:inherit;letter-spacing:inherit;color:inherit;background:transparent;border:1px solid currentColor;padding:3px 7px;cursor:pointer';
  const buttons = el(doc, 'div', 'display:flex;gap:6px;margin-top:4px;flex-wrap:wrap');
  const recordBtn = el(doc, 'button', btnStyle, 'RECORD');
  const copyBtn = el(doc, 'button', btnStyle, 'COPY');
  const benchBtn = el(doc, 'button', btnStyle, 'BENCH');
  const suiteBtn = el(doc, 'button', btnStyle, 'SUITE');
  const resetBtn = el(doc, 'button', btnStyle, 'RESET');
  buttons.append(recordBtn, copyBtn, benchBtn, suiteBtn, resetBtn);

  root.append(head, big, graph, body, buttons, note);

  // Keys and pointer events stop here, exactly as in the dev tuner: `Input`
  // listens on the window in the bubble phase, so a click on BENCH would
  // otherwise also be a press the game acts on.
  for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointermove']) {
    root.addEventListener(type, (e: Event) => e.stopPropagation());
  }

  // --- Recording ---------------------------------------------------------
  let recording = false;

  const setNote = (text: string): void => {
    note.textContent = text;
  };

  const dump = (text: string, what: string): void => {
    void copyToClipboard(detectClipboard(), text).then((ok) => {
      // Logged either way. The clipboard is refused on a LAN address and in a
      // tab that has had no gesture, and losing a recording to that is absurd.
      console.info(`[perf: ${what}]\n${text}`);
      setNote(ok ? 'copied, and logged to the console' : 'clipboard refused — see console');
    });
  };

  // --- The scripting API. Everything the panel's buttons do, plus the two
  // things a human cannot do by hand: a synchronous bench and a suite. ---

  const hold = (codes: readonly string[], down: boolean): void => {
    for (const code of codes) {
      game.input.onKey(code, down);
    }
  };

  const loadLevel = (which: number | string): boolean => {
    const level = findLevel(which);
    if (!level) {
      return false;
    }
    // PLAYTEST context, always. A benchmark is not an attempt: it must not
    // write a best time, and it must not unlock the next level (see the
    // `PlayContext` comment in scenes/play.ts). `back` is whatever was on
    // screen, so a quit during a bench lands somewhere sane.
    const back: Scene = game.activeScene ?? new PlayScene(level, { kind: 'campaign', index: 0 });
    game.setScene(new PlayScene(level, { kind: 'playtest', back }));
    return true;
  };

  /**
   * Run `frames` frames as fast as the CPU can and report on them.
   *
   * Synchronous on purpose. Driving the loop by hand takes vsync, background
   * throttling and the compositor out of the measurement, which leaves the
   * thing an optimisation actually changes: how long a frame COSTS. The
   * corollary is that `wall` in a bench report is the dt that was fed in, not
   * an observation — read `cpu`, and read the headroom line the console prints.
   *
   * It borrows the shared profiler rather than using one of its own, because
   * the instrumentation points are wired to the singleton. That means a bench
   * DISCARDS the live history; the panel says so when it finishes.
   *
   * **The tab has to be visible.** A hidden or non-composited tab does not
   * drain the canvas command buffer, so `present` measures as ~0 and the debt
   * comes due as one arbitrary frame costing a second and a half — a `max` that
   * is a fact about the browser rather than about the game. It warns rather
   * than refusing: the spans and the counters are still real, and a run under a
   * closed pane is still worth having as long as nobody quotes its worst frame.
   */
  const bench = (opts: BenchOptions = {}): PerfReport => {
    if (doc.hidden) {
      console.warn(
        '[perf] the tab is hidden — canvas work is not being flushed, so `present` ' +
          'reads as zero and one frame will absorb the whole stall. Show the tab.',
      );
    }
    const frames = clampInt(opts.frames ?? 600, 1, 20000);
    const warmup = clampInt(opts.warmup ?? 60, 0, 5000);
    const dt = opts.dt ?? STEP;
    const keys = opts.keys ?? [];
    const wasEnabled = perf.enabled;

    hold(keys, true);
    // The warmup is unmeasured, not discarded afterwards: a first frame that
    // allocates the post buffers is a 4 MB outlier that would otherwise land in
    // `max` and misreport the worst case by an order of magnitude.
    perf.enabled = false;
    for (let i = 0; i < warmup; i++) {
      game.stepFrame(dt);
    }
    perf.reset(opts.label ?? 'bench');
    perf.enabled = true;
    for (let i = 0; i < frames; i++) {
      game.stepFrame(dt);
    }
    const report = perf.report();
    perf.enabled = wasEnabled;
    hold(keys, false);
    perf.reset('live');
    return report;
  };

  const suite = (
    scenarios: readonly Scenario[] = DEFAULT_SUITE,
    opts: BenchOptions = {},
  ): SuiteResult => {
    const before = game.activeScene;
    const rows: SuiteRow[] = [];
    const reports: PerfReport[] = [];
    for (const s of scenarios) {
      if (s.level !== null && !loadLevel(s.level)) {
        console.warn(`[perf: suite] no such level: ${String(s.level)} — skipped`);
        continue;
      }
      const r = bench({ ...opts, label: s.name, keys: s.keys ?? [] });
      reports.push(r);
      const gauges: Record<string, number> = {};
      for (const [name, stat] of Object.entries(r.gauges)) {
        gauges[name] = stat.mean;
      }
      rows.push({
        name: s.name,
        frames: r.frames,
        cpuMean: r.cpu.mean,
        cpuP95: r.cpu.p95,
        cpuMax: r.cpu.max,
        updateMean: r.spans.update.mean,
        renderMean: r.spans.render.mean,
        presentMean: r.spans.present.mean,
        drawsMean: r.counters.draws.mean,
        overBudgetPct: r.overBudgetPct,
        gauges,
      });
    }
    if (before) {
      game.setScene(before);
    }
    return { rows, reports, text: suiteText(rows) };
  };

  const api: PerfApi = {
    profiler: perf,
    enable: (on = true) => {
      perf.enabled = on;
    },
    reset: (label = 'live') => perf.reset(label),
    report: (tail) => perf.report(tail),
    text: (tail) => reportText(perf.report(tail)),
    log: (tail) => {
      const r = perf.report(tail);
      console.info(reportText(r));
      return r;
    },
    samples: () => perf.samples(),
    csv: () => samplesCsv(perf.samples()),
    copy: () => {
      const text = JSON.stringify({ report: perf.report(), samples: perf.samples() }, null, 2);
      return copyToClipboard(detectClipboard(), text);
    },
    record: (label = 'recording') => {
      recording = true;
      perf.reset(label);
      recordBtn.textContent = 'STOP';
    },
    stop: () => {
      recording = false;
      recordBtn.textContent = 'RECORD';
      return perf.report();
    },
    bench,
    suite,
    level: loadLevel,
    hold,
  };
  win.__perf = api;

  recordBtn.addEventListener('click', () => {
    if (recording) {
      const r = api.stop();
      dump(reportText(r), r.label);
    } else {
      api.record();
      setNote('recording — STOP ends it and copies the report');
    }
  });
  copyBtn.addEventListener('click', () => dump(reportText(perf.report()), perf.label));
  benchBtn.addEventListener('click', () => {
    setNote('benching 600 frames…');
    // Next frame, so the note is on screen before the tab locks up for it.
    win.requestAnimationFrame(() => {
      const r = bench({ label: 'bench (on screen)' });
      dump(`${reportText(r)}\n${headroomLine(r)}`, r.label);
    });
  });
  suiteBtn.addEventListener('click', () => {
    setNote('running the suite — the tab will lock up…');
    win.requestAnimationFrame(() => {
      const res = suite();
      dump(res.text, 'suite');
    });
  });
  resetBtn.addEventListener('click', () => {
    perf.reset('live');
    setNote('history cleared');
  });

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === TOGGLE_CODE && !e.repeat) {
      e.preventDefault();
      root.style.display = root.style.display === 'none' ? 'block' : 'none';
    }
  };
  win.addEventListener('keydown', onKey);

  // --- The tick. Wears the palette, so the panel flips with the game — two
  // colours structurally, dev chrome included (hard rule 6). ---
  const ms = (n: number): string => n.toFixed(2).padStart(6, ' ');
  let raf = 0;
  let textT = 0;
  let lastTickMs = performance.now();

  const tick = (): void => {
    raf = win.requestAnimationFrame(tick);
    const nowMs = performance.now();
    const dt = (nowMs - lastTickMs) / 1000;
    lastTickMs = nowMs;

    // Sampled here rather than in the loop: reading it is a real cost, and the
    // heap does not move meaningfully within one frame anyway. It lands on the
    // NEXT frame's sample, which at 60 Hz is 16 ms of skew on a number quoted
    // in megabytes.
    const mb = heapMB();
    if (mb !== null) {
      perf.gauge('heapMB', mb);
    }

    if (root.style.display === 'none') {
      return;
    }
    root.style.background = palette.paper;
    root.style.color = palette.ink;
    root.style.borderColor = palette.ink;

    const samples = perf.samples();
    drawGraph(gctx, samples);

    textT += dt;
    if (textT < TEXT_INTERVAL) {
      return;
    }
    textT = 0;

    // The live readout summarises the last second only. A mean over the whole
    // ring is a number that stops responding to what you are doing right now,
    // which is the opposite of what a live panel is for; the whole window is
    // what RECORD and COPY are for.
    const r = perf.report(60);
    const last = perf.last();
    big.textContent =
      `${r.fps.mean.toFixed(0)} fps  ${ms(r.cpu.mean)}ms cpu` +
      (r.overBudget > 0 ? `  ${r.overBudgetPct.toFixed(0)}% over` : '');
    const lines = [
      `        mean    p95    max`,
      `cpu   ${ms(r.cpu.mean)} ${ms(r.cpu.p95)} ${ms(r.cpu.max)}`,
    ];
    for (const span of SPANS) {
      const s = r.spans[span];
      lines.push(`${span.padEnd(6)}${ms(s.mean)} ${ms(s.p95)} ${ms(s.max)}`);
    }
    const heap = r.gauges.heapMB;
    lines.push(
      `steps ${r.counters.steps.mean.toFixed(2)}   draws ${r.counters.draws.mean.toFixed(0)}` +
        `   frames ${perf.frameCount}`,
    );
    const parts = r.gauges.particles;
    const speed = r.gauges.speed;
    if (parts && speed) {
      lines.push(
        `parts ${parts.mean.toFixed(0)} (max ${parts.max.toFixed(0)})   speed ${speed.mean.toFixed(2)}`,
      );
    }
    if (heap) {
      lines.push(`heap  ${heap.mean.toFixed(1)} MB (max ${heap.max.toFixed(1)})`);
    }
    if (last && last.cpu > PERF_BUDGET_MS) {
      lines.push(`last frame OVER budget: ${last.cpu.toFixed(2)}ms`);
    }
    body.textContent = lines.join('\n');
    if (recording) {
      setNote(`recording ${perf.frameCount} frames — STOP to end`);
    }
  };

  /**
   * The graph: one column per frame, the three spans stacked bottom-up, with
   * the budget as a rule across it. Stacked rather than three lines, because
   * the question a frame-time graph is asked is never "how long did render
   * take" — it is "what made THAT frame expensive", and only a stack answers
   * that at a glance.
   *
   * The spans are told apart by alpha, not by colour: `ink` at three strengths.
   * A third colour to label a bar would be a colour that escaped the palette.
   */
  function drawGraph(ctx: CanvasRenderingContext2D | null, samples: readonly FrameSample[]): void {
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, GRAPH_W, GRAPH_H);
    ctx.fillStyle = palette.paper;
    ctx.fillRect(0, 0, GRAPH_W, GRAPH_H);
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, GRAPH_W - 1, GRAPH_H - 1);

    const rows = samples.slice(Math.max(0, samples.length - GRAPH_FRAMES));
    let peak = GRAPH_FLOOR_MS;
    for (const s of rows) {
      if (s.cpu > peak) {
        peak = s.cpu;
      }
    }
    const w = GRAPH_W / GRAPH_FRAMES;
    const scale = (GRAPH_H - 2) / peak;

    ctx.fillStyle = palette.ink;
    for (let i = 0; i < rows.length; i++) {
      const s = rows[i];
      const x = i * w;
      let y = GRAPH_H - 1;
      const bar = (value: number, alpha: number): void => {
        const h = value * scale;
        if (h <= 0) {
          return;
        }
        ctx.globalAlpha = alpha;
        ctx.fillRect(x, y - h, Math.max(w, 1), h);
        y -= h;
      };
      bar(s.update, 1);
      bar(s.render, 0.62);
      bar(s.present, 0.32);
      // Whatever the spans did not account for, drawn faintest of all. If this
      // band is ever the tall one, the cost is outside every span and the fix
      // is another span, not another micro-optimisation.
      bar(Math.max(0, s.cpu - s.update - s.render - s.present), 0.16);
    }
    ctx.globalAlpha = 1;

    // The budget rule, dashed so it cannot be mistaken for data.
    const by = GRAPH_H - 1 - PERF_BUDGET_MS * scale;
    if (by > 0) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = palette.ink;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(0, by + 0.5);
      ctx.lineTo(GRAPH_W, by + 0.5);
      ctx.stroke();
      ctx.restore();
    }
  }

  doc.body.append(root);
  raf = win.requestAnimationFrame(tick);
  console.info(
    '[perf] monitor mounted. F9 hides the panel. window.__perf.bench(), ' +
      '.suite(), .level(n), .log(), .csv() — see src/devperf.ts.',
  );

  return (): void => {
    win.cancelAnimationFrame(raf);
    win.removeEventListener('keydown', onKey);
    perf.enabled = false;
    perf.reset('live');
    delete win.__perf;
    root.remove();
  };
}

/** What the frame cost would allow if nothing else were in the way. */
export function headroomLine(r: PerfReport): string {
  const mean = r.cpu.mean > 0 ? 1000 / r.cpu.mean : 0;
  const worst = r.cpu.p99 > 0 ? 1000 / r.cpu.p99 : 0;
  return (
    `  headroom: ${mean.toFixed(0)} fps at the mean frame cost, ` +
    `${worst.toFixed(0)} fps at p99 (a bench feeds a fixed dt, so ignore its wall/fps)`
  );
}

/** The suite as an aligned table. Pure, so it is what the tests assert on. */
export function suiteText(rows: readonly SuiteRow[]): string {
  const out = [
    'PERF SUITE — ms of CPU per frame',
    '  scenario      cpu    p95    max  update render present  draws  over%',
  ];
  const n = (v: number, w: number, d = 2): string => v.toFixed(d).padStart(w, ' ');
  for (const r of rows) {
    out.push(
      `  ${r.name.padEnd(12)}${n(r.cpuMean, 5)}  ${n(r.cpuP95, 5)}  ${n(r.cpuMax, 5)}  ` +
        `${n(r.updateMean, 6)} ${n(r.renderMean, 6)} ${n(r.presentMean, 7)} ` +
        `${n(r.drawsMean, 6, 0)} ${n(r.overBudgetPct, 6, 1)}`,
    );
  }
  return out.join('\n');
}

/**
 * Per-frame rows as CSV. The escape hatch: whatever question the report did not
 * anticipate can be answered from this in a spreadsheet, and a run that is
 * merely SUSPICIOUS is worth keeping in full rather than summarised away.
 */
export function samplesCsv(samples: readonly FrameSample[]): string {
  const gaugeNames = new Set<string>();
  for (const s of samples) {
    for (const k of Object.keys(s.gauges)) {
      gaugeNames.add(k);
    }
  }
  const names = [...gaugeNames].sort();
  const head = ['n', 'wall', 'cpu', 'update', 'render', 'present', 'steps', 'draws', ...names];
  const lines = [head.join(',')];
  for (const s of samples) {
    const row = [
      s.n,
      s.wall.toFixed(3),
      s.cpu.toFixed(3),
      s.update.toFixed(3),
      s.render.toFixed(3),
      s.present.toFixed(3),
      s.steps,
      s.draws,
      // An empty cell, not a zero, for a gauge this frame never reported —
      // a spreadsheet averages zeros and ignores blanks, and one of those is
      // the truth about a frame that was on a menu.
      ...names.map((name) => (typeof s.gauges[name] === 'number' ? s.gauges[name].toFixed(3) : '')),
    ];
    lines.push(row.join(','));
  }
  return lines.join('\n');
}
