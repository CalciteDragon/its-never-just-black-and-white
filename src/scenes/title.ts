/**
 * Title screen: the name, and three ways into the game.
 *
 * The controls footer renders **from `BINDINGS`**, not from a hardcoded string,
 * so a rebinding cannot silently leave the front door of the game lying about
 * which key does what.
 */

import { VIEW_H, VIEW_W } from '../constants';
import { bindingLabel } from '../engine/input';
import type { Action } from '../engine/input';
import { palette } from '../engine/palette';
import type { Renderer } from '../engine/renderer';
import type { Game, Scene } from '../game';
import { LEVELS } from '../levels/index';
import { EditorScene, draftFromSave } from './editor';
import { LevelSelectScene } from './levelselect';
import { updateMenu } from './menu';
import { PlayScene } from './play';

const ITEMS: readonly string[] = ['PLAY', 'LEVELS', 'EDITOR'];

/**
 * Which bindings the footer names, in the order they are worth learning. Not
 * every action — `left`/`right`/`up`/`down` are the one thing nobody needs
 * telling, and `confirm` and `back` are the menu itself.
 */
const FOOTER: readonly Action[] = ['jump', 'flip', 'restart', 'pause', 'mute', 'fullscreen'];

/** e.g. `SPACE FLIP · R RESTART`. Derived, so it cannot drift from BINDINGS. */
export function controlsFooter(): string {
  return FOOTER.map((a) => `${bindingLabel(a)} ${a.toUpperCase()}`).join('  ·  ');
}

export class TitleScene implements Scene {
  private t = 0;
  private index = 0;

  /**
   * Back to phase A. The palette is the only readout of GRAVITY there is
   * (GAME-DESIGN §2), and there is no gravity on a menu — so a shell screen
   * that inherited the phase from however the last run happened to end would be
   * showing a readout of nothing, and would look different on every visit.
   */
  enter(): void {
    palette.reset();
  }

  update(dt: number, game: Game): void {
    this.t += dt;
    const input = game.input;
    if (input.pressed('mute')) {
      game.toggleMute();
    }
    // GAME-DESIGN §4's "Editor (dev): E from the title screen", kept as a raw
    // code beside the menu item — the shortcut and the menu are both real.
    if (input.codePressed('KeyE')) {
      game.audio.play('menuPick');
      game.setScene(new EditorScene(draftFromSave(game.save) ?? undefined));
      return;
    }
    const step = updateMenu(game, this.index, ITEMS.length);
    this.index = step.index;
    if (!step.picked) {
      return;
    }
    switch (ITEMS[this.index]) {
      case 'PLAY': {
        // Continue where the campaign got to, clamped to the set that exists.
        const i = Math.min(game.save.getProgress(), LEVELS.length - 1);
        game.setScene(new PlayScene(LEVELS[i], { kind: 'campaign', index: i }));
        break;
      }
      case 'LEVELS':
        game.setScene(new LevelSelectScene());
        break;
      default:
        game.setScene(new EditorScene(draftFromSave(game.save) ?? undefined));
        break;
    }
  }

  render(r: Renderer, game: Game): void {
    r.setCamera(0, 0);
    r.clear(palette.paper);

    r.textCentered("IT'S NEVER JUST", VIEW_W / 2, 90, palette.ink, 5);
    r.textCentered('BLACK AND WHITE', VIEW_W / 2, 150, palette.ink, 5);

    for (let i = 0; i < ITEMS.length; i++) {
      const selected = i === this.index;
      // The cursor blinks rather than the item, so the menu never has a frame
      // in which nothing at all looks selected.
      const cursor = selected && Math.floor(this.t * 2) % 2 === 0 ? '>' : ' ';
      r.textCentered(`${cursor} ${ITEMS[i]}`, VIEW_W / 2, 270 + i * 50, palette.ink, 3);
    }

    r.textCentered(controlsFooter(), VIEW_W / 2, VIEW_H - 40, palette.ink);
    if (game.audio.muted) {
      r.text('MUTED', 16, 16, palette.ink);
    }

    // At rest, so vignette only — but the frame is consistent from the very
    // first screen rather than the post pass appearing when play starts.
    r.applyPost(0);
  }
}
