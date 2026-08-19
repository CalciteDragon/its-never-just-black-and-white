/**
 * The campaign, one row per level: name, best time, and a lock past
 * `bw.progress`. `confirm` plays it, `back` returns to the title, and the raw
 * `KeyE` opens a COPY of that level in the editor — raw, because "edit this
 * row" is not a game verb and GAME-DESIGN §12 pins the `Action` list, and a
 * copy because a shipped level is a file under version control, which
 * `editorInitFromLevel` explains at length.
 *
 * **CUSTOM LEVELS is pinned above the campaign and bound to `C`.** It is the
 * one row that is not a level, and it is first for the reason it is also a
 * shortcut: the built-in list grows with every level this repo ships, and a
 * door to your own work that sinks below the fold as the campaign gets longer
 * is a door that stops being found. The rows scroll; row 0 does not scroll off
 * so much as arrive back the moment you press `C` from anywhere in the list.
 *
 * Locked entries are drawn at `inkRgba(0.35)`: the palette already has the
 * accessor, and dimming is the only two-colour way to say "not yet".
 */

import { VIEW_H, VIEW_W } from '../constants';
import { listDrafts, writeDraft } from '../editor/drafts';
import { palette } from '../engine/palette';
import type { Renderer } from '../engine/renderer';
import { SAVE_KEYS } from '../engine/save';
import type { Game, Scene } from '../game';
import { LEVELS } from '../levels/index';
import { CustomSelectScene } from './customselect';
import { EditorScene, editorInitFromLevel } from './editor';
import { updateMenu } from './menu';
import { PlayScene, formatTime } from './play';
import { TitleScene } from './title';

/** Alpha of a locked row. Legible enough to read, dim enough to read as off. */
const LOCKED_ALPHA = 0.35;

/** How many rows fit between the heading and the footer. */
const VISIBLE = 8;
const ROW_H = 40;
const TOP = 150;

/**
 * The pinned row, at index 0. A campaign level is therefore at `row - 1`, and
 * that offset lives in exactly one place: `levelAt`.
 */
const CUSTOM_ROW = 0;

export class LevelSelectScene implements Scene {
  private index = 1;
  /** First visible row. Follows the cursor rather than centring on it. */
  private scroll = 0;
  /**
   * Read once on entry rather than every frame. Nothing can advance progress
   * while this screen is up — the only writer is a campaign win — so a per-frame
   * `localStorage` read would be sixty reads a second for a number that cannot
   * move.
   */
  private progress = 0;
  /** How many custom levels the shelf holds, for the pinned row's detail. */
  private customCount = 0;

  /**
   * Back to phase A. The palette is the only readout of GRAVITY there is
   * (GAME-DESIGN §2), and there is no gravity on a menu — so a shell screen
   * that inherited the phase from however the last run happened to end would be
   * showing a readout of nothing, and would look different on every visit.
   */
  enter(game: Game): void {
    palette.reset();
    this.progress = game.save.getProgress();
    this.customCount = listDrafts(game.save).length;
    // Open on the furthest unlocked level: for anyone mid-campaign that is the
    // row they came here for, and for a new player it is the first level. The
    // +1 steps over the pinned row, which is reached by `C` rather than by
    // being what the cursor starts on.
    this.index = Math.min(this.progress, LEVELS.length - 1) + 1;
    this.clampScroll();
  }

  /** Total rows: the pinned one, then the campaign. */
  private get rowCount(): number {
    return LEVELS.length + 1;
  }

  /** The campaign index a row stands for, or null for the pinned row. */
  private levelAt(row: number): number | null {
    return row === CUSTOM_ROW ? null : row - 1;
  }

  private clampScroll(): void {
    this.scroll = Math.min(this.scroll, this.index);
    this.scroll = Math.max(this.scroll, this.index - VISIBLE + 1);
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.rowCount - VISIBLE)));
  }

  /** Unlocked count is progress + 1, so a missing or corrupt key unlocks one. */
  private unlocked(i: number): boolean {
    return i <= this.progress;
  }

  /** What a headless test reads. Nothing in `render` uses it. */
  get state(): { index: number; rowCount: number; customCount: number } {
    return { index: this.index, rowCount: this.rowCount, customCount: this.customCount };
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
    // `C` from anywhere in the list, so the pinned row never has to be scrolled
    // back to — which is the whole point of pinning it in the first place.
    if (input.codePressed('KeyC')) {
      game.audio.play('menuPick');
      game.setScene(new CustomSelectScene());
      return;
    }
    const at = this.levelAt(this.index);
    // The editor opens a LOCKED row too. The lock is about play order, not
    // about whether the file exists, and refusing to open it would make the
    // tool hostage to the campaign.
    if (input.codePressed('KeyE') && at !== null) {
      game.audio.play('menuPick');
      // As a COPY, with its own id, and written to the draft shelf on the way
      // in — a shipped level is a file in this repo, and the editor's job is to
      // give you one beside it rather than one on top of it.
      const init = editorInitFromLevel(LEVELS[at], listDrafts(game.save).map((d) => d.id));
      writeDraft(game.save, init);
      game.setScene(new EditorScene(init));
      return;
    }
    const step = updateMenu(game, this.index, this.rowCount);
    if (step.index !== this.index) {
      this.index = step.index;
      this.clampScroll();
    }
    if (!step.picked) {
      return;
    }
    const picked = this.levelAt(this.index);
    if (picked === null) {
      game.setScene(new CustomSelectScene());
      return;
    }
    if (this.unlocked(picked)) {
      game.setScene(new PlayScene(LEVELS[picked], { kind: 'campaign', index: picked }));
    }
  }

  render(r: Renderer, game: Game): void {
    r.setCamera(0, 0);
    r.clear(palette.paper);
    r.textCentered('LEVELS', VIEW_W / 2, 60, palette.ink, 4);

    const end = Math.min(this.rowCount, this.scroll + VISIBLE);
    for (let i = this.scroll; i < end; i++) {
      this.renderRow(r, game, i, TOP + (i - this.scroll) * ROW_H);
    }
    if (this.rowCount > VISIBLE) {
      r.text(
        `${this.index + 1}/${this.rowCount}`,
        VIEW_W - 130,
        TOP - 26,
        palette.inkRgba(LOCKED_ALPHA),
      );
    }

    r.textCentered(
      'ENTER  PLAY   ·   C  CUSTOM LEVELS   ·   E  EDIT   ·   ESC  BACK',
      VIEW_W / 2,
      VIEW_H - 40,
      palette.ink,
    );
    if (game.audio.muted) {
      r.text('MUTED', 16, 16, palette.ink);
    }
    r.applyPost(0);
  }

  private renderRow(r: Renderer, game: Game, row: number, y: number): void {
    const at = this.levelAt(row);
    if (at === null) {
      if (row === this.index) {
        r.text('>', 180, y, palette.ink, 2);
      }
      r.text('CUSTOM LEVELS', 210, y, palette.ink, 2);
      r.text(
        this.customCount === 1 ? '1 LEVEL   C' : `${this.customCount} LEVELS   C`,
        VIEW_W - 300,
        y,
        palette.inkRgba(LOCKED_ALPHA),
      );
      return;
    }
    const level = LEVELS[at];
    const open = this.unlocked(at);
    const color = open ? palette.ink : palette.inkRgba(LOCKED_ALPHA);
    if (row === this.index) {
      r.text('>', 180, y, color, 2);
    }
    r.text(`${pad2(at + 1)}  ${level.name}`, 210, y, color, 2);
    const best = game.save.getBest(SAVE_KEYS.best(level.id));
    const right = open ? (best ? formatTime(best.timeMs) : '--:--.--') : 'LOCKED';
    r.text(right, VIEW_W - 300, y, color, 2);
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
