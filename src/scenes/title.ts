/**
 * Title screen (GAME-DESIGN §11): logo, 4-item menu, parallax backdrop,
 * best-score display, footer hints.
 */

import { VIEW_H, VIEW_W } from '../constants';
import { dailyDateString, dailySeed, hashStringToSeed } from '../engine/rng';
import type { Renderer } from '../engine/renderer';
import { SAVE_KEYS } from '../engine/save';
import { PALETTE } from '../engine/sprites';
import type { Game, Scene } from '../game';
import { drawBackdrop } from './backdrop';
import { HowToScene } from './howto';
import { PlayScene } from './play';

/** Seed for a fresh (non-daily) run; time-derived but hashed through Rng math. */
export function freshRunSeed(now = Date.now()): number {
  return hashStringToSeed(`PQ-RUN-${now}`);
}

const MENU = ['1P ADVENTURE', '2P CO-OP', 'DAILY CHALLENGE', 'HOW TO PLAY'] as const;

export interface TitleOpts {
  /** From ?seed= — forces the adventure/co-op seed (shareable runs). */
  forcedSeed?: number;
}

export class TitleScene implements Scene {
  private sel = 0;
  private t = 0;
  private readonly opts: TitleOpts;

  constructor(opts: TitleOpts = {}) {
    this.opts = opts;
  }

  update(dt: number, game: Game): void {
    this.t += dt;
    const input = game.input;
    if (input.anyPressed('up')) {
      this.sel = (this.sel + MENU.length - 1) % MENU.length;
      game.audio.play('menuMove');
    }
    if (input.anyPressed('down')) {
      this.sel = (this.sel + 1) % MENU.length;
      game.audio.play('menuMove');
    }
    if (input.anyPressed('mute')) {
      game.toggleMute();
    }
    if (input.anyPressed('confirm')) {
      game.audio.play('menuPick');
      const seed = this.opts.forcedSeed ?? freshRunSeed();
      switch (this.sel) {
        case 0:
          game.setScene(new PlayScene({ mode: 'adventure', seed, players: 1 }));
          break;
        case 1:
          game.setScene(new PlayScene({ mode: 'coop', seed, players: 2 }));
          break;
        case 2:
          game.setScene(
            new PlayScene({
              mode: 'daily',
              seed: dailySeed(),
              players: 1,
              dateKey: dailyDateString(),
            }),
          );
          break;
        case 3:
          game.setScene(new HowToScene());
          break;
      }
    }
  }

  render(r: Renderer, game: Game): void {
    r.setCamera(0, 0);
    drawBackdrop(r, this.t * 12, 0);

    // Logo with drop shadow.
    r.textCentered('PIXEL QUEST', VIEW_W / 2 + 2, 34, PALETTE.B, 4);
    r.textCentered('PIXEL QUEST', VIEW_W / 2, 32, PALETTE.C, 4);
    r.textCentered('A DUNGEON PLATFORMER', VIEW_W / 2, 66, PALETTE.t);

    // Menu.
    for (let i = 0; i < MENU.length; i++) {
      const y = 108 + i * 16;
      const label = MENU[i];
      if (i === this.sel) {
        const pulse = Math.floor(this.t * 4) % 2 === 0;
        r.textCentered(`> ${label} <`, VIEW_W / 2, y, pulse ? PALETTE.W : PALETTE.o);
      } else {
        r.textCentered(label, VIEW_W / 2, y, PALETTE.t);
      }
    }

    // Bests.
    const adv = game.save.getBest(SAVE_KEYS.adventure);
    const daily = game.save.getBest(SAVE_KEYS.daily(dailyDateString()));
    let by = 186;
    if (adv) {
      r.textCentered(`BEST ADVENTURE ${adv.score}`, VIEW_W / 2, by, PALETTE.c);
      by += 10;
    }
    if (daily) {
      r.textCentered(`TODAYS DAILY ${daily.score}`, VIEW_W / 2, by, PALETTE.c);
    }

    r.textCentered(`DAILY SEED ${dailyDateString()}`, VIEW_W / 2, VIEW_H - 40, PALETTE.s);
    r.textCentered('ARROWS/WS MOVE · ENTER SELECT', VIEW_W / 2, VIEW_H - 26, PALETTE.s);
    r.textCentered('M MUTE · F FULLSCREEN · V0.1.0', VIEW_W / 2, VIEW_H - 16, PALETTE.s);
    if (game.audio.muted) {
      r.text('MUTED', 6, 6, PALETTE.R);
    }
  }
}
