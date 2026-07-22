/**
 * Pure run bookkeeping (GAME-DESIGN §3/§7): mode, seed, level progression,
 * score, and the persistence key. No entities, no rendering — fully
 * unit-testable; PlayScene is a thin shell around this.
 */

import { COIN_SCORE, LEVEL_SCORE, LEVELS_PER_RUN, STOMP_SCORE } from './constants';
import { SAVE_KEYS } from './engine/save';
import type { ScoreEntry } from './engine/save';

export type GameMode = 'adventure' | 'coop' | 'daily';

export interface RunConfig {
  mode: GameMode;
  /** Root seed for the run; each level derives its own via mixSeeds. */
  seed: number;
  players: 1 | 2;
  /** UTC YYYY-MM-DD; required when mode === 'daily'. */
  dateKey?: string;
}

export class RunState {
  readonly config: RunConfig;
  /** 1-based current level. */
  level = 1;
  coins = 0;
  stomps = 0;
  levelsCleared = 0;
  timeMs = 0;
  finished = false;
  victory = false;

  constructor(config: RunConfig) {
    this.config = config;
  }

  get score(): number {
    return this.coins * COIN_SCORE + this.stomps * STOMP_SCORE + this.levelsCleared * LEVEL_SCORE;
  }

  /** Advance the run clock (stops counting once the run is over). */
  tick(dt: number): void {
    if (!this.finished) {
      this.timeMs += dt * 1000;
    }
  }

  addCoin(): void {
    this.coins++;
  }

  addStomp(): void {
    this.stomps++;
  }

  /**
   * Level cleared. Returns 'victory' when that was the final level,
   * else 'next' (the caller then loads this.level).
   */
  clearLevel(): 'next' | 'victory' {
    if (this.finished) {
      return 'victory';
    }
    this.levelsCleared++;
    if (this.levelsCleared >= LEVELS_PER_RUN) {
      this.finished = true;
      this.victory = true;
      return 'victory';
    }
    this.level++;
    return 'next';
  }

  /** All players down. */
  gameOver(): void {
    this.finished = true;
    this.victory = false;
  }

  /** localStorage key for this run's best-score slot. */
  saveKey(): string {
    switch (this.config.mode) {
      case 'adventure':
        return SAVE_KEYS.adventure;
      case 'coop':
        return SAVE_KEYS.coop;
      case 'daily':
        return SAVE_KEYS.daily(this.config.dateKey ?? 'unknown');
    }
  }

  /** Snapshot for persistence; the timestamp is injected for testability. */
  toEntry(nowIso: string): ScoreEntry {
    return {
      score: this.score,
      timeMs: Math.round(this.timeMs),
      coins: this.coins,
      dateIso: nowIso,
    };
  }
}

/** mm:ss.t (tenths). 83_456 ms → '01:23.4'. */
export function formatTime(ms: number): string {
  const clamped = Math.max(0, ms);
  const mins = Math.floor(clamped / 60000);
  const secs = Math.floor((clamped % 60000) / 1000);
  const tenths = Math.floor((clamped % 1000) / 100);
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return `${mm}:${ss}.${tenths}`;
}
