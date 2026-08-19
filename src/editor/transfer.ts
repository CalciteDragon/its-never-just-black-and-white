/**
 * Importing a level file — the half of sharing that is not a download.
 *
 * Everything here is pure over `readonly string[]` and a list of taken ids, so
 * the two screens that import (the editor's picker and CUSTOM LEVELS) share one
 * implementation and one set of error messages, and both are testable with a
 * string and no browser anywhere.
 *
 * **A file from outside is untrusted input**, and it is the first untrusted
 * input this project has: every other level it loads is either a file in this
 * repo (validated at build time by `levels/index.ts`) or a draft this editor
 * itself wrote. So the shape is checked before the grid is, the grid is checked
 * by `validateLevel` — the *same* function the editor's own status line uses,
 * never a looser copy — and anything that fails comes back as one sentence a
 * 5×7 font can draw, rather than as a thrown error or a half-built record.
 *
 * **An import never overwrites.** The id is the key on the draft shelf, and a
 * file arriving with an id something already holds is renamed on the way in
 * (`uniqueDraftId`) and *reported* as renamed. Silently replacing a level an
 * author spent an evening on, because somebody sent them a file that happened
 * to be called `cellar`, is the one outcome this module exists to prevent.
 */

import { EDITOR_NAME_MAX } from '../constants';
import { validateLevel } from '../world/level';
import { isValidLevelId } from '../engine/levelio';
import type { DroppedFile } from '../engine/levelio';
import type { SaveStore } from '../engine/save';
import { uniqueDraftId, writeDraft } from './drafts';
import type { DraftRecord } from './drafts';

/** What a file has to be under, in characters, before anything parses it. */
const TEXT_MAX = 1 << 20;

/**
 * The outcome, and `renamed` is not decoration: it is the difference between
 * "your level is on the shelf" and "your level is on the shelf under a name you
 * did not choose", and the screen says which.
 */
export type ImportResult =
  | { readonly ok: true; readonly draft: DraftRecord; readonly renamed: boolean }
  | { readonly ok: false; readonly error: string };

/**
 * A filename as a level id: lowercase, digits and dashes, no leading dash.
 * Used only when the file itself carries no usable id — a hand-written level,
 * or one whose id field somebody edited into something illegal.
 *
 * Returns `''` when nothing survives, which the caller reads as "fall back to
 * a generic id" rather than as an error: the grid is what matters, and refusing
 * an otherwise valid level over its filename would be pedantry.
 */
export function slugifyId(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/\.json$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // A slug that is all digits or all dashes still has to pass the pattern, so
  // it is checked here rather than assumed from the substitutions above.
  return isValidLevelId(slug) ? slug : '';
}

/**
 * Parse and validate a level file, and give it an id nothing else claims.
 *
 * `taken` is every id the import must not land on — the draft shelf *and* the
 * built-ins, because a draft that shadowed a shipped level would break the
 * copy rule the editor enforces everywhere else.
 *
 * `filename` is only a fallback source for the id, and it is allowed to be
 * absent (a paste, a test) without changing any other behaviour.
 */
export function importLevelText(
  text: string,
  taken: readonly string[],
  filename = '',
): ImportResult {
  if (text.trim() === '') {
    return { ok: false, error: 'THAT FILE IS EMPTY OR TOO BIG TO BE A LEVEL' };
  }
  if (text.length > TEXT_MAX) {
    return { ok: false, error: 'THAT FILE IS EMPTY OR TOO BIG TO BE A LEVEL' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'NOT A LEVEL FILE: THAT IS NOT JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'NOT A LEVEL FILE: EXPECTED AN OBJECT WITH ROWS' };
  }

  const obj = parsed as Record<string, unknown>;
  // `validateLevel` takes `unknown` and reports on anything, so the rows go
  // straight to it — a shape check here would be a second, weaker copy of it.
  const errors = validateLevel(obj.rows);
  if (errors.length > 0) {
    // Verbatim, like the editor's own status line: `validateLevel` writes
    // sentences, and the 5×7 font draws them upper case either way.
    return { ok: false, error: `NOT A VALID LEVEL: ${errors[0]}` };
  }
  const rows = obj.rows as string[];

  // The file's own id first, then its filename, then a generic one. Each step
  // down is a fact the file failed to carry, not a failure of the import.
  const wanted =
    (typeof obj.id === 'string' && isValidLevelId(obj.id) ? obj.id : '') ||
    slugifyId(filename) ||
    'imported';
  const id = uniqueDraftId(wanted, taken);

  const rawName = typeof obj.name === 'string' ? obj.name.trim() : '';
  const name = (rawName === '' ? id.toUpperCase() : rawName).slice(0, EDITOR_NAME_MAX);

  return { ok: true, draft: { id, name, rows }, renamed: id !== wanted };
}

/**
 * What a screen shows after a drop, and what it should select afterwards.
 * `lastId` is the draft to put the cursor on — importing a level and leaving
 * the cursor where it was makes an author hunt a list for the thing they just
 * did.
 */
export interface ImportBatch {
  readonly imported: readonly DraftRecord[];
  readonly lastId: string | null;
  /** One line for the status area, already written the way the font draws it. */
  readonly status: string;
}

/**
 * Import a batch of dropped files onto the draft shelf, and say what happened.
 *
 * Shared by both import rows, because they are the same act: the editor's
 * picker and CUSTOM LEVELS differ in what they do *next* (open it, or play it),
 * never in what an import means. Each file is given the ids taken by everything
 * before it as well, so dropping the same level twice yields two drafts rather
 * than one draft and one silent collision.
 *
 * The status names one failure rather than listing every one: this line is
 * drawn in a 5×7 font on a menu, and "3 IMPORTED, 1 FAILED" plus the reason for
 * the first is what an author can act on.
 */
export function importDroppedFiles(
  save: SaveStore,
  files: readonly DroppedFile[],
  taken: readonly string[],
): ImportBatch {
  const imported: DraftRecord[] = [];
  const claimed = [...taken];
  let renamed = 0;
  let failed = 0;
  let firstError = '';

  for (const file of files) {
    const res = importLevelText(file.text, claimed, file.name);
    if (!res.ok) {
      failed++;
      if (firstError === '') {
        firstError = res.error;
      }
      continue;
    }
    writeDraft(save, res.draft);
    claimed.push(res.draft.id);
    imported.push(res.draft);
    if (res.renamed) {
      renamed++;
    }
  }

  const lastId = imported.length === 0 ? null : imported[imported.length - 1].id;
  return { imported, lastId, status: batchStatus(imported, renamed, failed, firstError) };
}

function batchStatus(
  imported: readonly DraftRecord[],
  renamed: number,
  failed: number,
  firstError: string,
): string {
  if (imported.length === 0) {
    return failed === 0 ? '' : firstError;
  }
  const one = imported.length === 1 ? imported[0] : null;
  // A single import names the level, because that is the whole of what the
  // author is looking for; a batch counts, because six names do not fit.
  let status = one === null ? `IMPORTED ${imported.length} LEVELS` : `IMPORTED ${one.name}`;
  if (renamed > 0) {
    // Named, always. An author who imports `cellar` and finds `cellar-2` has to
    // be told, or they will edit the wrong one of the two.
    status +=
      one === null
        ? ` - ${renamed} RENAMED, THAT ID WAS TAKEN`
        : ` AS ${one.id.toUpperCase()} - THAT ID WAS TAKEN`;
  }
  if (failed > 0) {
    status += ` - ${failed} FAILED: ${firstError}`;
  }
  return status;
}
