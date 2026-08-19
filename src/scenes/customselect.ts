/**
 * CUSTOM LEVELS: everything that is not in the campaign, and the whole of
 * sharing on the play side.
 *
 * It exists because the two lists answer different questions. LEVELS is a
 * ladder — ordered, locked ahead of you, and it grows with every level this
 * repo ships. A custom level has no rung: it is on this machine because
 * somebody drew it here or somebody sent it. Mixing them would put an
 * imported level at row 27 of a list that is mostly not theirs, and would make
 * the answer to "where did the thing I just imported go" depend on how far
 * through the campaign the reader happens to be. So this screen is one
 * keystroke off the level select and pinned to the top of it, which is what
 * "easily reached past a long list of built-ins" has to mean.
 *
 * **The shelf is the list.** There is no separate library of imported levels:
 * a draft the editor autosaved and a file dropped on the window land in exactly
 * the same place (`editor/drafts.ts`), which is why a level made here needs no
 * importing and why the instructions say so out loud. One store, so a level
 * cannot be playable and un-editable, or the reverse.
 *
 * Node-safe like every scene: files arrive through `game.files`, a queue
 * `engine/levelio.ts` fills from the DOM and this screen drains in `update`.
 */

import { VIEW_H, VIEW_W } from '../constants';
import { deleteDraft, listDrafts, migrateLegacyDraft } from '../editor/drafts';
import type { DraftRecord } from '../editor/drafts';
import { importDroppedFiles } from '../editor/transfer';
import { exportLevel } from '../engine/levelio';
import { palette } from '../engine/palette';
import type { Renderer } from '../engine/renderer';
import { SAVE_KEYS } from '../engine/save';
import type { Game, Scene } from '../game';
import { parseLevel } from '../world/level';
import { EditorScene, builtinIds } from './editor';
import { LevelSelectScene } from './levelselect';
import { updateMenu } from './menu';
import { PlayScene, formatTime } from './play';

/** One row: the import verb, or a level. */
type Row = { readonly kind: 'import' } | { readonly kind: 'draft'; readonly draft: DraftRecord };

/** How many rows fit between the heading and the instructions. */
const VISIBLE = 6;
const ROW_H = 30;
const TOP = 122;
const LEFT = 130;
const RIGHT = VIEW_W - 130;

/** Alpha of the trailing detail on a row, and of the instructions block. */
const DETAIL_ALPHA = 0.55;

/**
 * The instructions, as data rather than as three draw calls, so a test can
 * assert that the screen says the three things it has to say: that drafts
 * arrive on their own, that a file is dropped or picked, and that exporting is
 * how a level leaves. Brief on purpose — a menu is not a manual, and the long
 * version lives in the editor's CONTROLS AND TOOLS panel.
 */
export const CUSTOM_HELP: readonly string[] = [
  'LEVELS YOU DRAW IN THE EDITOR APPEAR HERE BY THEMSELVES - NOTHING TO IMPORT.',
  "TO ADD SOMEONE ELSE'S: DROP ITS .JSON ANYWHERE ON THIS WINDOW, OR PRESS ENTER ON IMPORT.",
  'TO SHARE ONE: PRESS E AND SEND THE FILE THAT LANDS IN YOUR DOWNLOADS.',
];

export class CustomSelectScene implements Scene {
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
    // The same one-shot the editor's picker runs, for the same reason: this is
    // now a second door to the shelf, and an author who reaches the game
    // through it must not find their pre-multi-draft level missing.
    migrateLegacyDraft(game.save);
    this.rebuild(game);
  }

  private rebuild(game: Game): void {
    this.rows = [
      { kind: 'import' },
      ...listDrafts(game.save).map((draft): Row => ({ kind: 'draft', draft })),
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
    // Drops are drained BEFORE the confirm guard: a file that arrived while a
    // delete prompt was up is still a file the author meant to import, and
    // leaving it in the queue would import it onto whatever screen came next.
    this.drain(game);
    // Everything else the confirm swallows, for the reason the editor's picker
    // does: a key that means one thing on this screen and another inside a
    // prompt is how somebody deletes a level while trying to leave.
    if (this.confirming !== null) {
      this.updateConfirm(game);
      return;
    }
    if (input.pressed('back')) {
      game.setScene(new LevelSelectScene());
      return;
    }
    // `E` is EXPORT here and EDIT on the level select, which is a collision
    // worth stating: on that screen `E` is the only thing to do with a level
    // you cannot delete, while on this one export is the whole point of the
    // screen — sharing is what it is for. So edit takes `D`.
    if (input.codePressed('KeyE')) {
      this.share(game);
      return;
    }
    if (input.codePressed('KeyD')) {
      this.edit(game);
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

  /** Whatever was dropped since the last frame, onto the shelf. */
  private drain(game: Game): void {
    const dropped = game.files.take();
    if (dropped.length === 0) {
      return;
    }
    // Built-ins are `taken` too: a draft that shadowed a shipped level's id
    // would break the copy rule the editor enforces everywhere else.
    const taken = [...builtinIds(), ...this.rows.flatMap((r) => (r.kind === 'draft' ? [r.draft.id] : []))];
    const batch = importDroppedFiles(game.save, dropped, taken);
    this.rebuild(game);
    this.status = batch.status;
    if (batch.lastId !== null) {
      // Onto the level that just arrived. Importing something and leaving the
      // cursor where it was makes an author hunt a list for their own act.
      this.selectId(batch.lastId);
      game.audio.play('goal');
    } else {
      game.audio.play('death');
    }
  }

  private selectId(id: string): void {
    const at = this.rows.findIndex((r) => r.kind === 'draft' && r.draft.id === id);
    if (at !== -1) {
      this.index = at;
      this.clampScroll();
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

  /** The selected draft, or null when the cursor is on the import row. */
  private selected(): DraftRecord | null {
    const row = this.rows[this.index];
    return row !== undefined && row.kind === 'draft' ? row.draft : null;
  }

  private open(game: Game): void {
    const draft = this.selected();
    if (draft === null) {
      // The picker needs user activation, which the Enter that got here
      // satisfies. When there is none to open, the drop is still the answer.
      this.status = game.files.openPicker()
        ? 'PICK A LEVEL .JSON'
        : 'DROP A LEVEL .JSON ANYWHERE ON THIS WINDOW';
      return;
    }
    // The real parser, on the way in — the same one `levels/index.ts` uses. A
    // draft is a grid mid-edit and can perfectly well have no goal yet, so
    // "play" has to be allowed to say no.
    const res = parseLevel(draft);
    if (!res.ok) {
      this.status = `CANNOT PLAY: ${res.errors[0]}`;
      game.audio.play('death');
      return;
    }
    game.setScene(new PlayScene(res.level, { kind: 'custom', back: this }));
  }

  private edit(game: Game): void {
    const draft = this.selected();
    if (draft === null) {
      return;
    }
    game.audio.play('menuPick');
    // The draft itself, NOT a copy: this list is the shelf, so editing a row
    // here is editing the level the row stands for. The copy rule is about
    // shipped levels, which cannot appear on this screen at all.
    game.setScene(new EditorScene(draft));
  }

  private share(game: Game): void {
    const draft = this.selected();
    if (draft === null) {
      return;
    }
    this.status = 'EXPORTING...';
    // Never rejects; it reports which transport it took, so the only thing to
    // do with the promise is print what it says.
    void exportLevel(draft).then((outcome) => {
      this.status = outcome.message;
      game.audio.play(outcome.ok ? 'goal' : 'death');
    });
  }

  private askDelete(game: Game): void {
    const draft = this.selected();
    if (draft === null) {
      return;
    }
    this.confirming = draft.id;
    game.audio.play('menuMove');
  }

  render(r: Renderer, game: Game): void {
    r.setCamera(0, 0);
    r.clear(palette.paper);
    r.textCentered('CUSTOM LEVELS', VIEW_W / 2, 44, palette.ink, 4);
    r.textCentered(
      'MADE HERE OR SENT BY SOMEBODY ELSE',
      VIEW_W / 2,
      84,
      palette.inkRgba(DETAIL_ALPHA),
    );

    const end = Math.min(this.rows.length, this.scroll + VISIBLE);
    for (let i = this.scroll; i < end; i++) {
      this.renderRow(r, this.rows[i], i, TOP + (i - this.scroll) * ROW_H, game);
    }
    if (this.rows.length > VISIBLE) {
      r.text(`${this.index + 1}/${this.rows.length}`, RIGHT + 12, TOP, palette.inkRgba(DETAIL_ALPHA));
    }
    // Only when the shelf is empty, and in place of the rows rather than under
    // them: an empty list with a footer full of verbs is a screen that looks
    // broken, and this is the one moment the instructions below are the point.
    if (this.rows.length === 1) {
      r.text('NOTHING HERE YET.', LEFT, TOP + ROW_H + 6, palette.inkRgba(DETAIL_ALPHA));
    }

    let y = 330;
    for (const line of CUSTOM_HELP) {
      r.textCentered(line, VIEW_W / 2, y, palette.inkRgba(DETAIL_ALPHA));
      y += 16;
    }

    if (this.confirming !== null) {
      r.textCentered(
        `DELETE ${this.confirming.toUpperCase()}? Y DELETES, N KEEPS IT`,
        VIEW_W / 2,
        VIEW_H - 78,
        palette.ink,
        2,
      );
    } else if (game.files.hovering) {
      // While a file is over the window this replaces the status line: it is
      // the only feedback drag-and-drop has, and it is worth more right now
      // than whatever the last act reported.
      r.textCentered('DROP IT ANYWHERE', VIEW_W / 2, VIEW_H - 78, palette.ink, 2);
    } else if (this.status !== '') {
      r.textCentered(this.status, VIEW_W / 2, VIEW_H - 72, palette.ink);
    }

    r.textCentered(
      'ENTER  PLAY   ·   E  EXPORT   ·   D  EDIT   ·   X  DELETE   ·   ESC  BACK',
      VIEW_W / 2,
      VIEW_H - 40,
      palette.ink,
    );
    if (game.audio.muted) {
      r.text('MUTED', 16, 16, palette.ink);
    }
    r.applyPost(0);
  }

  private renderRow(r: Renderer, row: Row, i: number, y: number, game: Game): void {
    if (i === this.index) {
      r.text('>', LEFT - 30, y, palette.ink, 2);
    }
    if (row.kind === 'import') {
      r.text('+ IMPORT A LEVEL', LEFT, y, palette.ink, 2);
      r.text('DROP A .JSON, OR ENTER', RIGHT - 200, y + 4, palette.inkRgba(DETAIL_ALPHA));
      return;
    }
    const d = row.draft;
    r.text(d.name, LEFT, y, palette.ink, 2);
    // The best time is what makes a custom level worth replaying, and it is
    // the one thing this list has that the editor's picker does not.
    const best = game.save.getBest(SAVE_KEYS.best(d.id));
    r.text(
      `${best ? formatTime(best.timeMs) : '--:--.--'}   ${d.rows[0].length} X ${d.rows.length}`,
      RIGHT - 200,
      y + 4,
      palette.inkRgba(DETAIL_ALPHA),
    );
  }
}
