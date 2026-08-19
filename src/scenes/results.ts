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
import { nextLevel } from '../levels/index';
import type { Level } from '../world/level';
import { LevelSelectScene } from './levelselect';
import { updateMenu } from './menu';
import { PlayScene, formatTime } from './play';
import type { PlayContext } from './play';

/**
 * Everything the results screen shows, gathered by the scene that measured it.
 * A playtest never reaches this screen, so nothing here is about the editor.
 *
 * `index` and `back` are the two shapes a finished run comes in, and exactly
 * one of them is set. A campaign run has a rung on the ladder (`index`), which
 * is what NEXT walks; a custom level has no ladder and a screen to return to
 * (`back`), which is what the last item goes to. The level itself is carried
 * rather than looked up, because a custom one is not in `LEVELS` to look up.
 */
export interface ResultsStats {
  readonly level: Level;
  /** Campaign index, or null for a level off the CUSTOM LEVELS shelf. */
  readonly index: number | null;
  /** Where the last menu item goes for a custom level; null for a campaign. */
  readonly back: Scene | null;
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
    // NEXT is absent rather than disabled at the end of the set, and for a
    // custom level it is absent because there is no set: a menu item that
    // cannot be chosen is a menu item that has to explain itself.
    const last = stats.index === null ? 'BACK' : 'LEVELS';
    this.items =
      stats.index !== null && nextLevel(stats.index) ? ['NEXT', 'RETRY', last] : ['RETRY', last];
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
      this.goBack(game);
      return;
    }
    const step = updateMenu(game, this.index, this.items.length);
    this.index = step.index;
    if (!step.picked) {
      return;
    }
    switch (this.items[this.index]) {
      case 'NEXT': {
        const at = this.stats.index;
        const next = at === null ? null : nextLevel(at);
        if (next !== null && at !== null) {
          game.setScene(new PlayScene(next, { kind: 'campaign', index: at + 1 }));
        }
        break;
      }
      case 'RETRY':
        // From `stats.level`, not from `LEVELS[index]`: a custom level is not
        // in that array, and a campaign one is the same object either way.
        game.setScene(new PlayScene(this.stats.level, this.replayContext()));
        break;
      default:
        this.goBack(game);
        break;
    }
  }

  /** The context a RETRY runs under: the one this result was measured in. */
  private replayContext(): PlayContext {
    const at = this.stats.index;
    return at === null
      ? { kind: 'custom', back: this.stats.back ?? new LevelSelectScene() }
      : { kind: 'campaign', index: at };
  }

  /**
   * Where ESC and the last menu item go. Both, so they cannot disagree — and
   * named `goBack` rather than `exit` because `Scene.exit` is the lifecycle
   * hook the loop calls, and one of the two would eventually shadow the other.
   */
  private goBack(game: Game): void {
    game.setScene(this.stats.back ?? new LevelSelectScene());
  }

  render(r: Renderer, game: Game): void {
    r.setCamera(0, 0);
    r.clear(palette.paper);

    r.textCentered(this.stats.level.name, VIEW_W / 2, 70, palette.ink, 3);
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
    r.textCentered(
      this.stats.index === null ? 'ESC  BACK' : 'ESC  LEVELS',
      VIEW_W / 2,
      VIEW_H - 40,
      palette.ink,
    );

    // At rest, so vignette only — the frame stays consistent between screens
    // rather than the post pass appearing when play starts.
    r.applyPost(0);
  }
}
