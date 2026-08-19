/**
 * The editor's front door: which level do you want to work on?
 *
 * The editor used to open straight onto one autosaved draft, which made the
 * shelf one deep — starting a second level threw the first one away, and there
 * was no way to say "not that one, the other one". This screen is the whole
 * answer: NEW at the top, every draft under it, and the shipped levels below
 * that marked as what they are.
 *
 * **A shipped level opens as a copy**, decided here and stated on the row
 * rather than discovered at the save (`editorInitFromLevel`). The rule is not
 * "you may not edit the built-ins" — you can, that is the point of the row —
 * it is that the copy gets its own id, because the id is the filename and a
 * level in `src/levels/` is a file under version control.
 *
 * Deleting asks. It is the one act on this screen that destroys work, the rows
 * move under the cursor as drafts come and go, and `Y`/`N` costs one keystroke
 * against a level's worth of building.
 */

import { EDITOR_DEFAULT_H, EDITOR_DEFAULT_W, VIEW_H, VIEW_W } from '../constants';
import {
  deleteDraft,
  listDrafts,
  migrateLegacyDraft,
  uniqueDraftId,
  writeDraft,
} from '../editor/drafts';
import type { DraftRecord } from '../editor/drafts';
import { blankRows } from '../editor/grid';
import { palette } from '../engine/palette';
import type { Renderer } from '../engine/renderer';
import type { Game, Scene } from '../game';
import { LEVELS } from '../levels/index';
import { EditorScene, builtinIds, editorInitFromLevel } from './editor';
import { updateMenu } from './menu';
import { TitleScene } from './title';

/** One row of the list. `new` is a verb; the other two are levels. */
type Row =
  | { readonly kind: 'new' }
  | { readonly kind: 'draft'; readonly draft: DraftRecord }
  | { readonly kind: 'builtin'; readonly index: number };

/** How many rows fit between the heading and the footer. */
const VISIBLE = 9;
const ROW_H = 34;
const TOP = 132;
const LEFT = 120;
const RIGHT = VIEW_W - 120;

/** Alpha of the trailing detail on a row — size, or what a copy came from. */
const DETAIL_ALPHA = 0.55;

export class EditorSelectScene implements Scene {
  private rows: Row[] = [];
  private index = 0;
  /** First visible row. Follows the cursor rather than centring on it. */
  private scroll = 0;
  /** The draft a `Y` would delete, or null. The only modal state here. */
  private confirming: string | null = null;
  private status = '';

  enter(game: Game): void {
    // Back to phase A, like every screen that is not play: the palette is the
    // only readout of GRAVITY there is, and a menu has none.
    palette.reset();
    game.audio.stopMusic();
    // The one place the old single draft can be picked up, because it is the
    // one screen an author must pass through to reach the editor at all.
    migrateLegacyDraft(game.save);
    this.rebuild(game);
  }

  /** Rebuilt from storage after anything that adds or removes a draft. */
  private rebuild(game: Game): void {
    const drafts = listDrafts(game.save);
    this.rows = [
      { kind: 'new' },
      ...drafts.map((draft): Row => ({ kind: 'draft', draft })),
      ...LEVELS.map((_, index): Row => ({ kind: 'builtin', index })),
    ];
    this.index = Math.min(this.index, this.rows.length - 1);
    this.clampScroll();
  }

  private clampScroll(): void {
    this.scroll = Math.min(this.scroll, this.index);
    this.scroll = Math.max(this.scroll, this.index - VISIBLE + 1);
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.rows.length - VISIBLE)));
  }

  /** What a headless test reads. Nothing in `render` uses it. */
  get state(): {
    rows: readonly Row[];
    index: number;
    confirming: string | null;
    status: string;
  } {
    return { rows: this.rows, index: this.index, confirming: this.confirming, status: this.status };
  }

  update(_dt: number, game: Game): void {
    const input = game.input;
    if (input.pressed('mute')) {
      game.toggleMute();
    }
    // The confirm swallows everything, for the same reason the editor's text
    // fields do: a key that means one thing on this screen and another inside a
    // prompt is how somebody deletes a level while trying to leave.
    if (this.confirming !== null) {
      this.updateConfirm(game);
      return;
    }
    if (input.pressed('back')) {
      game.setScene(new TitleScene());
      return;
    }
    if (input.codePressed('KeyX') || input.codePressed('Delete')) {
      this.askDelete(game);
      return;
    }
    const step = updateMenu(game, this.index, this.rows.length);
    if (step.index !== this.index) {
      this.index = step.index;
      this.clampScroll();
    }
    if (step.picked) {
      this.open(game);
    }
  }

  private updateConfirm(game: Game): void {
    const input = game.input;
    if (input.codePressed('KeyY')) {
      const id = this.confirming as string;
      deleteDraft(game.save, id);
      this.confirming = null;
      this.rebuild(game);
      this.status = `DELETED ${id.toUpperCase()}`;
      game.audio.play('menuPick');
      return;
    }
    if (input.codePressed('KeyN') || input.pressed('back')) {
      this.confirming = null;
      this.status = 'KEPT IT';
      game.audio.play('menuMove');
    }
  }

  private askDelete(game: Game): void {
    const row = this.rows[this.index];
    if (row === undefined || row.kind !== 'draft') {
      // Neither NEW nor a built-in can be deleted, and saying which is which
      // beats a keypress that silently does nothing.
      this.status = row?.kind === 'builtin' ? 'BUILT-IN LEVELS CANNOT BE DELETED' : '';
      return;
    }
    this.confirming = row.draft.id;
    game.audio.play('menuMove');
  }

  private open(game: Game): void {
    const row = this.rows[this.index];
    if (row === undefined) {
      return;
    }
    if (row.kind === 'draft') {
      game.setScene(new EditorScene(row.draft));
      return;
    }
    if (row.kind === 'builtin') {
      // The copy is written to the shelf HERE rather than on the editor's first
      // stroke, so an author who opens a built-in, looks around and leaves
      // still finds the copy waiting when they come back.
      const init = editorInitFromLevel(LEVELS[row.index], this.draftIds());
      writeDraft(game.save, init);
      game.setScene(new EditorScene(init));
      return;
    }
    const id = uniqueDraftId('untitled', [...builtinIds(), ...this.draftIds()]);
    const init = {
      id,
      name: id.toUpperCase(),
      rows: blankRows(EDITOR_DEFAULT_W, EDITOR_DEFAULT_H),
    };
    writeDraft(game.save, init);
    game.setScene(new EditorScene(init));
  }

  /** The ids the shelf already holds, so a new level cannot land on one. */
  private draftIds(): string[] {
    const ids: string[] = [];
    for (const row of this.rows) {
      if (row.kind === 'draft') {
        ids.push(row.draft.id);
      }
    }
    return ids;
  }

  render(r: Renderer, game: Game): void {
    r.setCamera(0, 0);
    r.clear(palette.paper);
    r.textCentered('EDIT A LEVEL', VIEW_W / 2, 56, palette.ink, 4);
    r.textCentered(
      'BUILT-IN LEVELS OPEN AS A COPY - THEY ARE NEVER SAVED OVER',
      VIEW_W / 2,
      100,
      palette.inkRgba(DETAIL_ALPHA),
    );

    const end = Math.min(this.rows.length, this.scroll + VISIBLE);
    for (let i = this.scroll; i < end; i++) {
      this.renderRow(r, this.rows[i], i, TOP + (i - this.scroll) * ROW_H);
    }
    // Only when the list actually runs off the end, so the ordinary case of
    // three drafts is not decorated with a scrollbar that never moves.
    if (this.rows.length > VISIBLE) {
      r.text(`${this.index + 1}/${this.rows.length}`, RIGHT + 12, TOP, palette.inkRgba(DETAIL_ALPHA));
    }

    if (this.confirming !== null) {
      r.textCentered(
        `DELETE ${this.confirming.toUpperCase()}? Y DELETES, N KEEPS IT`,
        VIEW_W / 2,
        VIEW_H - 76,
        palette.ink,
        2,
      );
    } else if (this.status !== '') {
      r.textCentered(this.status, VIEW_W / 2, VIEW_H - 72, palette.ink);
    }
    r.textCentered(
      'ENTER  OPEN   ·   X  DELETE A DRAFT   ·   ESC  BACK',
      VIEW_W / 2,
      VIEW_H - 40,
      palette.ink,
    );
    if (game.audio.muted) {
      r.text('MUTED', 16, 16, palette.ink);
    }
    r.applyPost(0);
  }

  private renderRow(r: Renderer, row: Row, i: number, y: number): void {
    const selected = i === this.index;
    if (selected) {
      r.text('>', LEFT - 30, y, palette.ink, 2);
    }
    if (row.kind === 'new') {
      r.text('+ NEW LEVEL', LEFT, y, palette.ink, 2);
      return;
    }
    if (row.kind === 'draft') {
      const d = row.draft;
      r.text(d.name, LEFT, y, palette.ink, 2);
      r.text(
        `${d.rows[0].length} X ${d.rows.length}   ${d.id.toUpperCase()}`,
        RIGHT - 260,
        y + 4,
        palette.inkRgba(DETAIL_ALPHA),
      );
      return;
    }
    const level = LEVELS[row.index];
    r.text(level.name, LEFT, y, palette.ink, 2);
    r.text('BUILT-IN - OPENS AS A COPY', RIGHT - 260, y + 4, palette.inkRgba(DETAIL_ALPHA));
  }
}
