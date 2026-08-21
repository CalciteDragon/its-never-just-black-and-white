/**
 * Title screen: the name, and three ways into the game.
 *
 * The controls footer renders **from `BINDINGS`**, not from a hardcoded string,
 * so a rebinding cannot silently leave the front door of the game lying about
 * which key does what.
 */

import { VIEW_H, VIEW_W } from '../constants';
import { measureText } from '../engine/font';
import { bindingLabel, MOUSE_LEFT } from '../engine/input';
import type { Action } from '../engine/input';
import { openExternal } from '../engine/link';
import { palette } from '../engine/palette';
import type { Renderer } from '../engine/renderer';
import type { Game, Scene } from '../game';
import { LEVELS } from '../levels/index';
import { EditorSelectScene } from './editorselect';
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

/**
 * Photosensitivity warning. The flip inverts the whole screen in one frame and
 * can be spammed as fast as the player can press the key, which is exactly the
 * full-field luminance flicker that triggers seizures — so this is on the front
 * door, static (a flashing warning about flashing would be a joke at the
 * expense of the people it is for), and shown before anything can be started.
 */
const WARNING: readonly string[] = [
  'PHOTOSENSITIVITY WARNING: FLIPPING INVERTS THE',
  'ENTIRE SCREEN AND MAY CAUSE RAPID FULL-FIELD FLASHING.',
];

/**
 * The two corner links: the author's site, and the tip jar.
 *
 * A link on a canvas has no browser affordance behind it — no underline, no
 * cursor, no status bar — so the underline is drawn, and it thickens on hover.
 * That underline is the only thing on this screen that answers the mouse at
 * all, which is why both links carry it whether or not they are hovered.
 *
 * `right` mirrors the layout: the box is measured off VIEW_W instead of 0, so
 * a relabelled link stays pinned to its corner rather than drifting.
 */
interface Link {
  readonly label: string;
  readonly url: string;
  readonly right: boolean;
}

const LINKS: readonly Link[] = [
  { label: 'CALCITEDEV.ME', url: 'https://calcitedev.me', right: false },
  { label: 'SUPPORT ME ON KO-FI', url: 'https://ko-fi.com/calcitedragon', right: true },
];

/** Corner inset of a link's glyph box, and the 5x7 font's line height. */
const LINK_INSET = 16;
const LINK_Y = 16;
const LINK_H = 7;
/**
 * Slop around the glyph box, in px. A line at scale 1 is 7 px tall, and a 7 px
 * target is a target nobody hits — the padding is what makes these clickable
 * without moving the text off the corners.
 */
const LINK_PAD = 4;

/** Left edge of a link's glyph box, in view space. */
function linkX(link: Link): number {
  return link.right ? VIEW_W - LINK_INSET - measureText(link.label) : LINK_INSET;
}

/** e.g. `SPACE FLIP · R RESTART`. Derived, so it cannot drift from BINDINGS. */
export function controlsFooter(): string {
  return FOOTER.map((a) => `${bindingLabel(a)} ${a.toUpperCase()}`).join('  ·  ');
}

export class TitleScene implements Scene {
  private t = 0;
  private index = 0;
  /**
   * Index of the link under the pointer, or -1. Set in update and read in
   * render — the hover is one frame of state, not a query the draw re-runs.
   */
  private hot = -1;

  /** Which link's padded hit box contains a VIEW-space point, if any. */
  private linkAt(x: number, y: number): number {
    if (y < LINK_Y - LINK_PAD || y >= LINK_Y + LINK_H + LINK_PAD) {
      return -1;
    }
    for (let i = 0; i < LINKS.length; i++) {
      const x0 = linkX(LINKS[i]);
      if (x >= x0 - LINK_PAD && x < x0 + measureText(LINKS[i].label) + LINK_PAD) {
        return i;
      }
    }
    return -1;
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

  update(dt: number, game: Game): void {
    this.t += dt;
    const input = game.input;
    if (input.pressed('mute')) {
      game.toggleMute();
    }
    // GAME-DESIGN §4's "Editor (dev): E from the title screen", kept as a raw
    // code beside the menu item — the shortcut and the menu are both real. It
    // opens the PICKER: with a shelf of drafts, "the editor" is no longer one
    // level, and guessing which one would be wrong most of the time.
    if (input.codePressed('KeyE')) {
      game.audio.play('menuPick');
      game.setScene(new EditorSelectScene());
      return;
    }
    this.hot = input.pointerIn ? this.linkAt(input.pointerX, input.pointerY) : -1;
    if (this.hot >= 0 && input.pointerPressed(MOUSE_LEFT)) {
      game.audio.play('menuPick');
      openExternal(LINKS[this.hot].url);
      // Deliberately no scene change and no return: the tab opens beside the
      // game, and the menu below carries on as if nothing happened.
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
        game.setScene(new EditorSelectScene());
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

    for (let i = 0; i < WARNING.length; i++) {
      r.textCentered(WARNING[i], VIEW_W / 2, VIEW_H - 90 + i * 14, palette.ink);
    }

    r.textCentered(controlsFooter(), VIEW_W / 2, VIEW_H - 40, palette.ink);

    for (let i = 0; i < LINKS.length; i++) {
      const x = linkX(LINKS[i]);
      r.text(LINKS[i].label, x, LINK_Y, palette.ink);
      const thickness = i === this.hot ? 2 : 1;
      r.rect(x, LINK_Y + LINK_H + 2, measureText(LINKS[i].label), thickness, palette.ink, true);
    }

    if (game.audio.muted) {
      // Below the links rather than under one — MUTED had this corner first,
      // and two lines of ink on the same pixels would be neither of them.
      r.text('MUTED', LINK_INSET, LINK_Y + 24, palette.ink);
    }

    // At rest, so vignette only — but the frame is consistent from the very
    // first screen rather than the post pass appearing when play starts.
    r.applyPost(0);
  }
}
