/**
 * Title screen: the name, and a way into the game. Phase 7 gives it the real
 * menu, level select, and the controls footer.
 */

import { VIEW_H, VIEW_W } from '../constants';
import { palette } from '../engine/palette';
import type { Renderer } from '../engine/renderer';
import type { Game, Scene } from '../game';
import { PlayScene } from './play';

export class TitleScene implements Scene {
  private t = 0;

  update(dt: number, game: Game): void {
    this.t += dt;
    const input = game.input;
    if (input.pressed('mute')) {
      game.toggleMute();
    }
    if (input.pressed('confirm')) {
      game.audio.play('menuPick');
      game.setScene(new PlayScene());
    }
  }

  render(r: Renderer, game: Game): void {
    r.setCamera(0, 0);
    r.clear(palette.paper);

    r.textCentered("IT'S NEVER JUST", VIEW_W / 2, 150, palette.ink, 5);
    r.textCentered('BLACK AND WHITE', VIEW_W / 2, 210, palette.ink, 5);

    if (Math.floor(this.t * 2) % 2 === 0) {
      r.textCentered('PRESS ENTER', VIEW_W / 2, 340, palette.ink, 3);
    }

    r.textCentered('M MUTE  ·  F FULLSCREEN', VIEW_W / 2, VIEW_H - 40, palette.ink);
    if (game.audio.muted) {
      r.text('MUTED', 16, 16, palette.ink);
    }
  }
}
