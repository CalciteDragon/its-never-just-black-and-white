/**
 * The work-in-progress shelf: every level an author has open, keyed by its id.
 *
 * The editor used to hold exactly one autosaved draft, which made "start the
 * next level" and "throw away the last one" the same act. This module is the
 * whole of the fix, and it is deliberately dumb: a JSON array of ids under
 * `bw.editor.drafts`, one record per id under `bw.editor.draft.<id>`, and
 * every read defensive because the value is JSON from a previous session's
 * browser — absent, truncated, from an older shape, or something else that
 * happens to share the key.
 *
 * **The id is the key**, because the id is already the filename
 * (`src/levels/<id>.json`) and the best-time key (`bw.best.<id>`). A second
 * identifier beside it would be a second thing to keep in step, and the first
 * time they disagreed an author would save over the wrong level. Renaming is
 * therefore a move (`renameDraft`), and two drafts can never share an id — the
 * editor refuses the rename rather than merging them.
 *
 * Node-safe and pure over `SaveStore`, so the picker screen and the editor are
 * both testable without a browser.
 */

import { SAVE_KEYS } from '../engine/save';
import type { SaveStore } from '../engine/save';
import { isValidLevelId } from '../engine/levelio';

/** A level as the editor holds it: §8's on-disk shape, and nothing else. */
export interface DraftRecord {
  readonly id: string;
  readonly name: string;
  readonly rows: readonly string[];
}

/** Serialised the way `levelio.buildLevelPayload` would: 2-space JSON, newline. */
function encode(rec: DraftRecord): string {
  const { id, name, rows } = rec;
  return `${JSON.stringify({ id, name, rows }, null, 2)}\n`;
}

/**
 * Everything here is a guard, because the value is whatever the last session
 * left behind. Anything that is not a level-shaped object with at least one row
 * of text is not a draft, and `null` is how this module says so — never a
 * half-built record for a scene to trip over.
 */
export function decodeDraft(raw: string | null): DraftRecord | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const rows = obj.rows;
    if (typeof obj.id !== 'string' || typeof obj.name !== 'string' || !Array.isArray(rows)) {
      return null;
    }
    if (!rows.every((row): row is string => typeof row === 'string') || rows.length === 0) {
      return null;
    }
    return { id: obj.id, name: obj.name, rows };
  } catch {
    return null;
  }
}

/** The index, as ids. Deduplicated and filtered to legal ids on the way out. */
function readIndex(save: SaveStore): string[] {
  const raw = save.getText(SAVE_KEYS.editorDrafts);
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: string[] = [];
    for (const id of parsed) {
      if (isValidLevelId(id) && !out.includes(id)) {
        out.push(id);
      }
    }
    return out;
  } catch {
    return [];
  }
}

function writeIndex(save: SaveStore, ids: readonly string[]): boolean {
  return save.setText(SAVE_KEYS.editorDrafts, JSON.stringify(ids));
}

/**
 * What a write to the shelf did. Three outcomes rather than a boolean, because
 * "the id belongs to another draft" and "the browser refused to store this" are
 * different problems with different answers — pick another id, and get the file
 * out of the browser before it is lost.
 */
export type DraftWriteResult = 'ok' | 'taken' | 'failed';

/**
 * Import the pre-multi-draft single draft, once. Idempotent twice over: the
 * legacy key is blanked afterwards, and a draft whose id is already on the
 * shelf is left alone rather than overwriting newer work with older.
 *
 * Called by the picker on entry, which is the only screen that can be reached
 * before an author touches a draft.
 */
export function migrateLegacyDraft(save: SaveStore): void {
  const rec = decodeDraft(save.getText(SAVE_KEYS.editorDraft));
  save.setText(SAVE_KEYS.editorDraft, '');
  if (rec === null || !isValidLevelId(rec.id) || readIndex(save).includes(rec.id)) {
    return;
  }
  writeDraft(save, rec);
}

/** Every draft on the shelf, oldest first. Entries that no longer decode are dropped. */
export function listDrafts(save: SaveStore): DraftRecord[] {
  const out: DraftRecord[] = [];
  for (const id of readIndex(save)) {
    const rec = decodeDraft(save.getText(SAVE_KEYS.draft(id)));
    // The record's own id wins over the index's copy of it: the record is what
    // the editor wrote, and a disagreement means the index is the stale half.
    if (rec !== null) {
      out.push({ ...rec, id });
    }
  }
  return out;
}

export function readDraft(save: SaveStore, id: string): DraftRecord | null {
  return decodeDraft(save.getText(SAVE_KEYS.draft(id)));
}

export function draftExists(save: SaveStore, id: string): boolean {
  return readIndex(save).includes(id);
}

/**
 * Upsert. The autosave path, so it is called on every stroke end.
 *
 * Reports whether the draft is really on the shelf, and **both halves have to
 * land**: a record written under an id the index never gained is a level that
 * exists in storage and appears nowhere, which is indistinguishable from lost
 * to the only person who cares. The caller is expected to say so out loud.
 */
export function writeDraft(save: SaveStore, rec: DraftRecord): boolean {
  if (!save.setText(SAVE_KEYS.draft(rec.id), encode(rec))) {
    return false;
  }
  const ids = readIndex(save);
  if (ids.includes(rec.id)) {
    return true;
  }
  ids.push(rec.id);
  return writeIndex(save, ids);
}

/**
 * Move a draft to a new id, taking its record with it. Refuses — reporting
 * `'taken'` — when something already lives at the destination, because the only
 * other options are silently merging two levels or silently losing one.
 *
 * **The order of the three writes is the whole of the failure story.** The new
 * record goes down first, then the index, and the old record is blanked last
 * and only once both have stuck: a storage refusal at any point therefore
 * leaves the draft readable under one id or the other, never under neither.
 * The old order blanked the source before writing the destination, so a quota
 * error in between deleted the level outright.
 */
export function renameDraft(save: SaveStore, from: string, rec: DraftRecord): DraftWriteResult {
  if (rec.id !== from && draftExists(save, rec.id)) {
    return 'taken';
  }
  const ids = readIndex(save);
  const at = ids.indexOf(from);
  if (at === -1) {
    return writeDraft(save, rec) ? 'ok' : 'failed';
  }
  if (!save.setText(SAVE_KEYS.draft(rec.id), encode(rec))) {
    return 'failed';
  }
  // In place, so a rename does not shuffle the picker's rows under the author.
  ids[at] = rec.id;
  if (!writeIndex(save, ids)) {
    return 'failed';
  }
  if (rec.id !== from) {
    save.setText(SAVE_KEYS.draft(from), '');
  }
  return 'ok';
}

/**
 * Forget a draft. `SaveStore` has no remove — every writer here is `setItem` —
 * so the record is blanked and the id leaves the index; `decodeDraft` reads a
 * blank as absent, which is the same thing from every reader's point of view.
 */
export function deleteDraft(save: SaveStore, id: string): void {
  save.setText(SAVE_KEYS.draft(id), '');
  writeIndex(
    save,
    readIndex(save).filter((x) => x !== id),
  );
}

/**
 * `base`, or `base-2`, `base-3`… — the first id nothing on `taken` claims.
 *
 * `taken` is passed in rather than read here because the ids that are spoken
 * for are not only the drafts: a copy of a shipped level must not land on the
 * shipped level's own id, which is the whole of "built-ins save as a copy".
 */
export function uniqueDraftId(base: string, taken: readonly string[]): string {
  const root = isValidLevelId(base) ? base : 'untitled';
  if (!taken.includes(root)) {
    return root;
  }
  for (let n = 2; ; n++) {
    const candidate = `${root}-${n}`;
    if (!taken.includes(candidate)) {
      return candidate;
    }
  }
}
