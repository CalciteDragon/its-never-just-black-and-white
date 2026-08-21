import { describe, expect, it } from 'vitest';
import { PERF_BUDGET_MS } from '../src/constants';
import { samplesCsv, suiteText } from '../src/devperf';
import { buildReport, percentile, Profiler, reportText, summarize } from '../src/engine/perf';
import type { FrameSample } from '../src/engine/perf';

/** A clock the test drives by hand: `now` advances only when told to. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/**
 * One frame of measurement, spans advancing the clock by the amounts asked
 * for. This is the whole instrumentation contract in miniature.
 */
function frame(
  p: Profiler,
  clock: ReturnType<typeof fakeClock>,
  spans: { update: number; render: number; present: number; gap?: number },
  wallSec = 1 / 60,
): void {
  p.beginFrame(wallSec);
  p.begin('update');
  clock.advance(spans.update);
  p.end('update');
  p.begin('render');
  clock.advance(spans.render);
  p.end('render');
  p.begin('present');
  clock.advance(spans.present);
  p.end('present');
  clock.advance(spans.gap ?? 0);
  p.endFrame();
}

describe('percentile', () => {
  it('interpolates between neighbours', () => {
    const s = [0, 10];
    expect(percentile(s, 0)).toBe(0);
    expect(percentile(s, 1)).toBe(10);
    expect(percentile(s, 0.5)).toBe(5);
    expect(percentile(s, 0.25)).toBe(2.5);
  });

  it('returns 0 for an empty series rather than NaN', () => {
    expect(percentile([], 0.95)).toBe(0);
  });

  it('clamps p outside [0, 1]', () => {
    expect(percentile([1, 2, 3], -1)).toBe(1);
    expect(percentile([1, 2, 3], 9)).toBe(3);
  });
});

describe('summarize', () => {
  it('reports the distribution of an unsorted series without mutating it', () => {
    const values = [5, 1, 3, 2, 4];
    const s = summarize(values);
    expect(values).toEqual([5, 1, 3, 2, 4]);
    expect(s.n).toBe(5);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.mean).toBe(3);
    expect(s.p50).toBe(3);
  });

  it('is all zeros over no samples', () => {
    expect(summarize([])).toEqual({ n: 0, min: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });
});

describe('Profiler', () => {
  it('measures nothing at all while disabled', () => {
    const clock = fakeClock();
    const p = new Profiler({ now: clock.now });
    frame(p, clock, { update: 4, render: 6, present: 1 });
    expect(p.frameCount).toBe(0);
    expect(p.samples()).toEqual([]);
    expect(p.last()).toBeNull();
    expect(p.report().frames).toBe(0);
  });

  it('splits one frame into its spans, and cpu covers the gap between them', () => {
    const clock = fakeClock();
    const p = new Profiler({ now: clock.now });
    p.enabled = true;
    frame(p, clock, { update: 4, render: 6, present: 1, gap: 2 });
    const s = p.last() as FrameSample;
    expect(s.update).toBe(4);
    expect(s.render).toBe(6);
    expect(s.present).toBe(1);
    // 4 + 6 + 1 + a 2 ms gap that belongs to no span: cpu is measured end to
    // end, so unattributed time is visible rather than lost.
    expect(s.cpu).toBe(13);
    expect(s.wall).toBeCloseTo(1000 / 60, 9);
  });

  it('sums a span that opens twice in one frame', () => {
    const clock = fakeClock();
    const p = new Profiler({ now: clock.now });
    p.enabled = true;
    p.beginFrame(1 / 60);
    p.begin('render');
    clock.advance(3);
    p.end('render');
    p.begin('render');
    clock.advance(5);
    p.end('render');
    p.endFrame();
    expect((p.last() as FrameSample).render).toBe(8);
  });

  it('resets counters between frames and keeps gauges as levels', () => {
    const clock = fakeClock();
    const p = new Profiler({ now: clock.now });
    p.enabled = true;
    p.beginFrame(1 / 60);
    p.count('steps', 2);
    p.count('draws', 40);
    p.gauge('particles', 12);
    p.endFrame();
    p.beginFrame(1 / 60);
    p.count('steps');
    p.endFrame();
    const [first, second] = p.samples();
    expect(first.steps).toBe(2);
    expect(first.draws).toBe(40);
    expect(second.steps).toBe(1);
    expect(second.draws).toBe(0);
    // A gauge is a level, not an event: it holds until something writes it.
    expect(second.gauges.particles).toBe(12);
  });

  it('keeps the last `capacity` frames, oldest first', () => {
    const clock = fakeClock();
    const p = new Profiler({ now: clock.now, capacity: 3 });
    p.enabled = true;
    for (let i = 0; i < 5; i++) {
      frame(p, clock, { update: i, render: 0, present: 0 });
    }
    expect(p.frameCount).toBe(5);
    expect(p.samples().map((s) => s.n)).toEqual([2, 3, 4]);
    expect((p.last() as FrameSample).n).toBe(4);
  });

  it('report(tail) summarises only the last N frames', () => {
    const clock = fakeClock();
    const p = new Profiler({ now: clock.now });
    p.enabled = true;
    for (let i = 0; i < 10; i++) {
      frame(p, clock, { update: i < 5 ? 100 : 1, render: 0, present: 0 });
    }
    expect(p.report().cpu.mean).toBeCloseTo(50.5, 9);
    expect(p.report(5).cpu.mean).toBe(1);
  });

  it('reset drops history but leaves measurement on', () => {
    const clock = fakeClock();
    const p = new Profiler({ now: clock.now });
    p.enabled = true;
    frame(p, clock, { update: 1, render: 1, present: 1 });
    p.reset('after');
    expect(p.frameCount).toBe(0);
    expect(p.enabled).toBe(true);
    expect(p.report().label).toBe('after');
    frame(p, clock, { update: 2, render: 0, present: 0 });
    expect(p.frameCount).toBe(1);
  });
});

describe('buildReport', () => {
  const sample = (over: Partial<FrameSample>): FrameSample => ({
    n: 0,
    wall: 1000 / 60,
    cpu: 5,
    update: 2,
    render: 2,
    present: 1,
    steps: 1,
    draws: 100,
    gauges: {},
    ...over,
  });

  it('derives fps from wall, not from cpu', () => {
    const rows = [sample({ wall: 1000 / 60, cpu: 1 }), sample({ n: 1, wall: 1000 / 60, cpu: 15 })];
    const r = buildReport('t', rows);
    expect(r.fps.mean).toBeCloseTo(60, 6);
    expect(r.seconds).toBeCloseTo(2 / 60, 9);
  });

  it('counts frames over the budget, exclusive of the budget itself', () => {
    const rows = [
      sample({ n: 0, cpu: PERF_BUDGET_MS }),
      sample({ n: 1, cpu: PERF_BUDGET_MS + 0.001 }),
      sample({ n: 2, cpu: 40 }),
    ];
    const r = buildReport('t', rows);
    expect(r.overBudget).toBe(2);
    expect(r.overBudgetPct).toBeCloseTo(200 / 3, 9);
  });

  it('averages a gauge over the frames that reported it, not over all frames', () => {
    const rows = [
      sample({ n: 0, gauges: {} }),
      sample({ n: 1, gauges: { particles: 10 } }),
      sample({ n: 2, gauges: { particles: 20 } }),
    ];
    const r = buildReport('t', rows);
    expect(r.gauges.particles.n).toBe(2);
    expect(r.gauges.particles.mean).toBe(15);
  });

  it('lists the five most expensive frames, worst first', () => {
    const rows = [1, 9, 3, 7, 5, 2, 8].map((cpu, n) => sample({ n, cpu }));
    const r = buildReport('t', rows);
    expect(r.worst.map((s) => s.cpu)).toEqual([9, 8, 7, 5, 3]);
  });

  it('is all zeros — never NaN — over an empty window', () => {
    const r = buildReport('empty', []);
    expect(r.frames).toBe(0);
    expect(r.fps.mean).toBe(0);
    expect(r.cpu.mean).toBe(0);
    expect(r.overBudgetPct).toBe(0);
    expect(reportText(r)).toContain('0 frames');
  });
});

describe('reportText', () => {
  it('names the unattributed time as its own line', () => {
    const rows: FrameSample[] = [
      {
        n: 0,
        wall: 16,
        cpu: 10,
        update: 2,
        render: 3,
        present: 1,
        steps: 1,
        draws: 12,
        gauges: { particles: 4 },
      },
    ];
    const text = reportText(buildReport('run', rows));
    expect(text).toContain('PERF run — 1 frames');
    expect(text).toContain('unnamed');
    // 10 − (2 + 3 + 1): the gap the spans do not explain.
    expect(text).toContain('4.00');
    expect(text).toContain('particles');
  });
});

describe('samplesCsv', () => {
  it('emits a column per gauge and leaves unreported cells blank', () => {
    const base = { wall: 16, cpu: 5, update: 2, render: 2, present: 1, steps: 1, draws: 3 };
    const csv = samplesCsv([
      { n: 0, ...base, gauges: {} },
      { n: 1, ...base, gauges: { speed: 0.5 } },
    ]);
    const [head, first, second] = csv.split('\n');
    expect(head).toBe('n,wall,cpu,update,render,present,steps,draws,speed');
    expect(first.endsWith(',')).toBe(true);
    expect(second.endsWith(',0.500')).toBe(true);
  });
});

describe('suiteText', () => {
  it('renders one aligned row per scenario', () => {
    const text = suiteText([
      {
        name: '00 run',
        frames: 600,
        cpuMean: 1.25,
        cpuP95: 2.5,
        cpuMax: 9,
        updateMean: 0.4,
        renderMean: 0.7,
        presentMean: 0.15,
        drawsMean: 420,
        overBudgetPct: 0,
        gauges: { particles: 30 },
      },
    ]);
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('00 run');
    expect(lines[2]).toContain('1.25');
    expect(lines[2]).toContain('420');
  });
});
