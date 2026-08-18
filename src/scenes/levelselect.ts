/**
 * The campaign, one row per level: name, best time, and a lock past
 * `bw.progress`. `confirm` plays it, `back` returns to the title, and the raw
 * `KeyE` opens that level in the editor — raw, because "edit this row" is not a
 * game verb and GAME-DESIGN §12 pins the `Action` list.
 *
 * Locked entries are drawn at `inkRgba(0.35)`: the palette already has the
 * accessor, and dimming is the only two-colour way to say "not yet".
 */

import { VIEW_H, VIEW_W } from '../constants';
import { palette } from '../engine/palette';
import type { Renderer } from '../engine/renderer';
import { SAVE_KEYS } from '../engine/save';
import type { Game, Scene } from '../game';
import { LEVELS } from '../levels/index';
import { EditorScene, editorInitFromLevel } from './editor';
import { updateMenu } from './menu';
import { PlayScene, formatTime } from './play';
import { TitleScene } from './title';

/** Alpha of a locked row. Legible enough to read, dim enough to read as off. */
const LOCKED_ALPHA = 0.35;

export class LevelSelectScene implements Scene {
  private index = 0;
  /**
   * Read once on entry rather than every frame. Nothing can advance progress
   * while this screen is up — the only writer is a campaign win — so a per-frame
   * `localStorage` read would be sixty reads a second for a number that cannot
   * move.
   */
  private progress = 0;

  /**
   * Back to phase A. The palette is the only readout of GRAVITY there is
   * (GAME-DESIGN §2), and there is no gravity on a menu — so a shell screen
   * that inherited the phase from however the last run happened to end would be
   * showing a readout of nothing, and would look different on every visit.
   */
  enter(game: Game): void {
    palette.reset();
    this.progress = game.save.getProgress();
    // Open on the furthest unlocked level: for anyone mid-campaign that is the
    // row they came here for, and for a new player it is row 0 either way.
    this.index = Math.min(this.progress, LEVELS.length - 1);
  }

  /** Unlocked count is progress + 1, so a missing or corrupt key unlocks one. */
  private unlocked(i: number): boolean {
    return i <= this.progress;
  }

  update(_dt: number, game: Game): void {
    const input = game.input;
    if (input.pressed('mute')) {
      game.toggleMute();
    }
    if (input.pressed('back')) {
      game.setScene(new TitleScene());
      return;
    }
    // The editor opens a LOCKED row too. The lock is about play order, not
    // about whether the file exists, and refusing to open it would make the
    // tool hostage to the campaign.
    if (input.codePressed('KeyE')) {
      game.audio.play('menuPick');
      game.setScene(new EditorScene(editorInitFromLevel(LEVELS[this.index])));
      return;
    }
    const step = updateMenu(game, this.index, LEVELS.length);
    this.index = step.index;
    if (step.picked && this.unlocked(this.index)) {
      game.setScene(new PlayScene(LEVELS[this.index], { kind: 'campaign', index: this.index }));
    }
  }

  render(r: Renderer, game: Game): void {
    r.setCamera(0, 0);
    r.clear(palette.paper);
    r.textCentered('LEVELS', VIEW_W / 2, 60, palette.ink, 4);

    for (let i = 0; i < LEVELS.length; i++) {
      const level = LEVELS[i];
      const open = this.unlocked(i);
      const color = open ? palette.ink : palette.inkRgba(LOCKED_ALPHA);
      const y = 150 + i * 40;
      if (i === this.index) {
        r.text('>', 180, y, color, 2);
      }
      r.text(`${pad2(i + 1)}  ${level.name}`, 210, y, color, 2);
      const best = game.save.getBest(SAVE_KEYS.best(level.id));
      const right = open ? (best ? formatTime(best.timeMs) : '--:--.--') : 'LOCKED';
      r.text(right, VIEW_W - 300, y, color, 2);
    }

    r.textCentered('ENTER  PLAY   ·   E  EDIT   ·   ESC  BACK', VIEW_W / 2, VIEW_H - 40, palette.ink);
    if (game.audio.muted) {
      r.text('MUTED', 16, 16, palette.ink);
    }
    r.applyPost(0);
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
