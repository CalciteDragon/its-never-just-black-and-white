/**
 * What you just did, and where to go next. It replaces the `COMPLETE` readout
 * `PlayScene.renderHud` drew as a shell placeholder since phase 5.
 *
 * **It owns no clock.** `GOAL_HOLD` stays in `PlayScene`, where it is the
 * punctuation on the frozen winning frame — this screen appears after that hold
 * and simply waits. GAME-DESIGN §6's description of the constant is amended to
 * match ("how long the frozen frame holds before the results screen").
 */

import { VIEW_H, VIEW_W } from '../constants';
import { palette } from '../engine/palette';
import type { Renderer } from '../engine/renderer';
import type { Game, Scene } from '../game';
import { LEVELS, nextLevel } from '../levels/index';
import { LevelSelectScene } from './levelselect';
import { updateMenu } from './menu';
import { PlayScene, formatTime } from './play';

/**
 * Everything the results screen shows, gathered by the scene that measured it.
 * `index` is a campaign index — a playtest never reaches this screen, which is
 * why nothing here is optional.
 */
export interface ResultsStats {
  readonly levelId: string;
  readonly levelName: string;
  readonly index: number;
  readonly timeMs: number;
  readonly previousBestMs: number | null;
  readonly isNewBest: boolean;
}

export class ResultsScene implements Scene {
  private readonly stats: ResultsStats;
  private readonly items: readonly string[];
  private index = 0;

  constructor(stats: ResultsStats) {
    this.stats = stats;
    // NEXT is absent rather than disabled at the end of the set: a menu item
    // that cannot be chosen is a menu item that has to explain itself.
    this.items = nextLevel(stats.index)
      ? ['NEXT', 'RETRY', 'LEVELS']
      : ['RETRY', 'LEVELS'];
  }

  /**
   * Back to phase A. The palette is the only readout of GRAVITY there is
   * (GAME-DESIGN §2), and there is no gravity on a menu — so a shell screen
   * that inherited the phase from however the last run happened to end would be
   * showing a readout of nothing, and would look different on every visit.
   */
  enter(): void {
    palette.reset();
  }

  update(_dt: number, game: Game): void {
    const input = game.input;
    if (input.pressed('mute')) {
      game.toggleMute();
    }
    if (input.pressed('back')) {
      game.setScene(new LevelSelectScene());
      return;
    }
    const step = updateMenu(game, this.index, this.items.length);
    this.index = step.index;
    if (!step.picked) {
      return;
    }
    switch (this.items[this.index]) {
      case 'NEXT': {
        const next = nextLevel(this.stats.index);
        if (next) {
          game.setScene(new PlayScene(next, { kind: 'campaign', index: this.stats.index + 1 }));
        }
        break;
      }
      case 'RETRY':
        game.setScene(
          new PlayScene(LEVELS[this.stats.index], {
            kind: 'campaign',
            index: this.stats.index,
          }),
        );
        break;
      default:
        game.setScene(new LevelSelectScene());
        break;
    }
  }

  render(r: Renderer, game: Game): void {
    r.setCamera(0, 0);
    r.clear(palette.paper);

    r.textCentered(this.stats.levelName, VIEW_W / 2, 70, palette.ink, 3);
    r.textCentered('COMPLETE', VIEW_W / 2, 118, palette.ink, 2);
    r.textCentered(formatTime(this.stats.timeMs), VIEW_W / 2, 165, palette.ink, 6);

    // The previous best is the number that makes the time above mean anything,
    // so it is always shown — even, and especially, when it was just beaten.
    const { previousBestMs, isNewBest } = this.stats;
    if (isNewBest) {
      r.textCentered('NEW BEST', VIEW_W / 2, 230, palette.ink, 3);
      if (previousBestMs !== null) {
        r.textCentered(`PREVIOUS ${formatTime(previousBestMs)}`, VIEW_W / 2, 268, palette.ink);
      }
    } else if (previousBestMs !== null) {
      r.textCentered(`BEST ${formatTime(previousBestMs)}`, VIEW_W / 2, 235, palette.ink, 2);
    }

    for (let i = 0; i < this.items.length; i++) {
      const label = i === this.index ? `> ${this.items[i]} <` : this.items[i];
      r.textCentered(label, VIEW_W / 2, 330 + i * 46, palette.ink, 3);
    }

    if (game.audio.muted) {
      r.text('MUTED', 16, 16, palette.ink);
    }
    r.textCentered('ESC  LEVELS', VIEW_W / 2, VIEW_H - 40, palette.ink);

    // At rest, so vignette only — the frame stays consistent between screens
    // rather than the post pass appearing when play starts.
    r.applyPost(0);
  }
}
