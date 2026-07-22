/**
 * How to Play (GAME-DESIGN §11): controls table + goal, any confirm/back exits.
 */

import { VIEW_H, VIEW_W } from '../constants';
import type { Renderer } from '../engine/renderer';
import { PALETTE } from '../engine/sprites';
import type { Game, Scene } from '../game';
import { drawBackdrop } from './backdrop';
import { TitleScene } from './title';

const LINES: readonly (readonly [string, string])[] = [
  ['GOAL', 'REACH THE DOOR. CLEAR 3 LEVELS.'],
  ['', 'COINS +10 · STOMP +50 · LEVEL +100'],
  ['', ''],
  ['PLAYER 1', 'A D MOVE · W OR SPACE JUMP'],
  ['', 'S + JUMP DROP THROUGH'],
  ['PLAYER 2', 'ARROWS MOVE · UP JUMP'],
  ['', 'DOWN + JUMP DROP THROUGH'],
  ['', ''],
  ['CO-OP', 'FALLEN FRIENDS RESPAWN AT YOUR SIDE'],
  ['DAILY', 'ONE SHARED DUNGEON PER UTC DAY'],
  ['', ''],
  ['PAUSE', 'ESC OR P · MUTE M · FULLSCREEN F'],
];

export class HowToScene implements Scene {
  private t = 0;

  update(dt: number, game: Game): void {
    this.t += dt;
    if (game.input.anyPressed('confirm') || game.input.anyPressed('back')) {
      game.audio.play('menuPick');
      game.setScene(new TitleScene());
    }
    if (game.input.anyPressed('mute')) {
      game.toggleMute();
    }
  }

  render(r: Renderer, _game: Game): void {
    r.setCamera(0, 0);
    drawBackdrop(r, 40, 0);
    r.textCentered('HOW TO PLAY', VIEW_W / 2, 20, PALETTE.C, 2);
    let y = 52;
    for (const [label, text] of LINES) {
      if (label) {
        r.text(label, 70, y, PALETTE.o);
      }
      r.text(text, 150, y, PALETTE.W);
      y += 12;
    }
    const blink = Math.floor(this.t * 2) % 2 === 0;
    if (blink) {
      r.textCentered('PRESS ENTER TO RETURN', VIEW_W / 2, VIEW_H - 20, PALETTE.t);
    }
  }
}
