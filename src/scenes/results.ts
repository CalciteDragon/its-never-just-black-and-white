/**
 * Shared victory / game-over screen (GAME-DESIGN §11): stats, NEW BEST flash,
 * Retry (same seed) / New Run (fresh seed; hidden for daily) / Title.
 */

import { VIEW_H, VIEW_W } from '../constants';
import type { Renderer } from '../engine/renderer';
import { PALETTE } from '../engine/sprites';
import type { Game, Scene } from '../game';
import { formatTime } from '../run';
import type { RunState } from '../run';
import { drawBackdrop } from './backdrop';
import { PlayScene } from './play';
import { freshRunSeed, TitleScene } from './title';

export class ResultsScene implements Scene {
  private readonly state: RunState;
  private sel = 0;
  private t = 0;
  private isNewBest = false;

  constructor(state: RunState) {
    this.state = state;
  }

  private menu(): readonly string[] {
    return this.state.config.mode === 'daily'
      ? ['RETRY', 'TITLE']
      : ['RETRY SEED', 'NEW RUN', 'TITLE'];
  }

  enter(game: Game): void {
    this.isNewBest = game.save.submit(
      this.state.saveKey(),
      this.state.toEntry(new Date().toISOString()),
    ).isNewBest;
  }

  update(dt: number, game: Game): void {
    this.t += dt;
    const input = game.input;
    const menu = this.menu();
    if (input.anyPressed('up')) {
      this.sel = (this.sel + menu.length - 1) % menu.length;
      game.audio.play('menuMove');
    }
    if (input.anyPressed('down')) {
      this.sel = (this.sel + 1) % menu.length;
      game.audio.play('menuMove');
    }
    if (input.anyPressed('mute')) {
      game.toggleMute();
    }
    if (input.anyPressed('back')) {
      game.setScene(new TitleScene());
      return;
    }
    if (input.anyPressed('confirm')) {
      game.audio.play('menuPick');
      const choice = menu[this.sel];
      if (choice === 'RETRY' || choice === 'RETRY SEED') {
        game.setScene(new PlayScene(this.state.config));
      } else if (choice === 'NEW RUN') {
        game.setScene(new PlayScene({ ...this.state.config, seed: freshRunSeed() }));
      } else {
        game.setScene(new TitleScene());
      }
    }
  }

  render(r: Renderer, _game: Game): void {
    r.setCamera(0, 0);
    drawBackdrop(r, this.t * 6, 0);

    const s = this.state;
    if (s.victory) {
      r.textCentered('VICTORY!', VIEW_W / 2, 30, PALETTE.C, 3);
    } else {
      r.textCentered('GAME OVER', VIEW_W / 2, 30, PALETTE.R, 3);
    }
    const modeLabel =
      s.config.mode === 'daily'
        ? `DAILY ${s.config.dateKey ?? ''}`
        : s.config.mode === 'coop'
          ? '2P CO-OP'
          : '1P ADVENTURE';
    r.textCentered(modeLabel, VIEW_W / 2, 58, PALETTE.t);

    const lines: readonly (readonly [string, string])[] = [
      ['SCORE', String(s.score)],
      ['COINS', String(s.coins)],
      ['STOMPS', String(s.stomps)],
      ['LEVELS', `${s.levelsCleared} / 3`],
      ['TIME', formatTime(s.timeMs)],
      ['SEED', String(s.config.seed)],
    ];
    let y = 80;
    for (const [k, v] of lines) {
      r.text(k, VIEW_W / 2 - 70, y, PALETTE.t);
      r.text(v, VIEW_W / 2 + 14, y, PALETTE.W);
      y += 12;
    }
    if (this.isNewBest && Math.floor(this.t * 3) % 2 === 0) {
      r.textCentered('NEW BEST!', VIEW_W / 2, y + 4, PALETTE.o, 2);
    }

    const menu = this.menu();
    menu.forEach((item, i) => {
      const my = VIEW_H - 66 + i * 14;
      if (i === this.sel) {
        r.textCentered(`> ${item} <`, VIEW_W / 2, my, PALETTE.W);
      } else {
        r.textCentered(item, VIEW_W / 2, my, PALETTE.t);
      }
    });
  }
}
