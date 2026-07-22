import { describe, expect, it } from 'vitest';
import { COIN_SCORE, LEVEL_SCORE, STOMP_SCORE } from '../src/constants';
import { SAVE_KEYS } from '../src/engine/save';
import { formatTime, RunState } from '../src/run';

function mkRun(mode: 'adventure' | 'coop' | 'daily' = 'adventure'): RunState {
  return new RunState({
    mode,
    seed: 42,
    players: mode === 'coop' ? 2 : 1,
    dateKey: mode === 'daily' ? '2026-07-21' : undefined,
  });
}

describe('RunState', () => {
  it('computes score from coins, stomps, and cleared levels', () => {
    const r = mkRun();
    r.addCoin();
    r.addCoin();
    r.addStomp();
    r.clearLevel();
    expect(r.score).toBe(2 * COIN_SCORE + STOMP_SCORE + LEVEL_SCORE);
  });

  it('progresses levels and reports victory after the third clear', () => {
    const r = mkRun();
    expect(r.level).toBe(1);
    expect(r.clearLevel()).toBe('next');
    expect(r.level).toBe(2);
    expect(r.clearLevel()).toBe('next');
    expect(r.level).toBe(3);
    expect(r.clearLevel()).toBe('victory');
    expect(r.finished).toBe(true);
    expect(r.victory).toBe(true);
    expect(r.levelsCleared).toBe(3);
  });

  it('gameOver finishes without victory and freezes the clock', () => {
    const r = mkRun();
    r.tick(1.5);
    r.gameOver();
    const t = r.timeMs;
    r.tick(2);
    expect(r.timeMs).toBe(t);
    expect(r.finished).toBe(true);
    expect(r.victory).toBe(false);
  });

  it('maps modes to their persistence keys', () => {
    expect(mkRun('adventure').saveKey()).toBe(SAVE_KEYS.adventure);
    expect(mkRun('coop').saveKey()).toBe(SAVE_KEYS.coop);
    expect(mkRun('daily').saveKey()).toBe(SAVE_KEYS.daily('2026-07-21'));
  });

  it('produces a persistable entry with an injected timestamp', () => {
    const r = mkRun();
    r.addCoin();
    r.tick(1.2345);
    const e = r.toEntry('2026-07-21T10:00:00Z');
    expect(e).toEqual({
      score: COIN_SCORE,
      timeMs: Math.round(1234.5),
      coins: 1,
      dateIso: '2026-07-21T10:00:00Z',
    });
  });
});

describe('formatTime', () => {
  it('formats mm:ss.t', () => {
    expect(formatTime(0)).toBe('00:00.0');
    expect(formatTime(83_456)).toBe('01:23.4');
    expect(formatTime(605_990)).toBe('10:05.9');
    expect(formatTime(-50)).toBe('00:00.0');
  });
});
