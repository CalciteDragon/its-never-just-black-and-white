/**
 * The editor's save transport. Two halves, and the split is the point.
 *
 * The **pure half** — `buildLevelPayload` and the id charset — is what the
 * editor and the vite middleware both have to agree on, and it is testable
 * without a server, a browser or a disk. `buildLevelPayload` produces bytes
 * identical to `world/level.ts`'s `serializeLevel`, so a level saved from the
 * editor and a level serialised from a parsed `Level` are the same file: what
 * the editor writes is what `git diff` shows (PHASES phase 7, decision 1).
 * That equality is asserted by round-tripping through the real parser, not by
 * a second copy of the formatting rules.
 *
 * The **transport half** is behaviour-detected, not build-flag gated. The
 * obvious shape is `if (import.meta.env.DEV)`, and it is wrong for one reason:
 * it makes the fallback — the branch that only ever runs in a production
 * build — the branch nobody exercises until it ships. So `saveLevel` simply
 * attempts `POST /__level` and falls back on anything that is not a 200,
 * reporting which happened so the editor can say so on its status line. A dev
 * server with the plugin takes the disk path; `vite preview`, a real build and
 * a dev server missing the plugin all take the same fallback, in that order of
 * how much it would hurt to discover it late.
 *
 * Node-safe: nothing here touches `fetch`, `localStorage` or `navigator` at
 * import time, and every access to them is guarded, because all three can be
 * absent (node, an old browser) or throw on mere property access (a sandboxed
 * iframe, private mode) — the same defence `save.ts` applies to `localStorage`.
 */

import { SAVE_KEYS } from './save';
import type { StorageLike } from './save';

/**
 * The one definition of a legal level id. The editor's id field enforces this
 * charset as you type and `vite.config.ts`'s `levelSink` re-enforces it before
 * building a path — the middleware cannot import this constant (a vite config
 * must not pull in `src/`), so the regex is duplicated there deliberately, and
 * this is the copy the duplicate is checked against by eye.
 *
 * Lowercase, digits and dashes, and it may not lead with a dash. That is not
 * cosmetic: the id becomes a filename (`src/levels/<id>.json`) and a save key
 * (`bw.best.<id>`), so it has to be safe in a path, stable across
 * case-insensitive filesystems, and free of anything a URL would re-encode.
 */
export const LEVEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Never throws, for any input at all — it is called on a text field's contents
 * and on whatever a hand-written POST puts in the query string. A non-string,
 * `''`, `../evil`, `A-Z` and `-leading` are all false.
 */
export function isValidLevelId(id: unknown): boolean {
  return typeof id === 'string' && LEVEL_ID_PATTERN.test(id);
}

/**
 * A level as the file holds it: §8's on-disk shape, which is also the editor's
 * working model (decision 1 — the editor edits characters, not tiles, so it
 * never has to convert to save).
 */
export interface LevelPayload {
  readonly id: string;
  readonly name: string;
  readonly rows: readonly string[];
}

/**
 * The exact bytes `serializeLevel` would write for the equivalent level: 2-space
 * JSON, keys in file order, trailing newline. The destructure is load-bearing
 * twice over — it pins the key order against a caller that built the object in
 * a different one, and it drops any extra field the editor happens to be
 * carrying, so nothing leaks into a committed file.
 */
export function buildLevelPayload(p: LevelPayload): string {
  const { id, name, rows } = p;
  return `${JSON.stringify({ id, name, rows }, null, 2)}\n`;
}

/** Which route the save actually took. Reported, never assumed. */
export type SaveTransport = 'disk' | 'local';

/**
 * `message` is drawn verbatim on the editor's status line by the 5×7 bitmap
 * font in `engine/font.ts`, which has A-Z, 0-9 and a little punctuation and
 * nothing else. Every message here is written the way it will render —
 * uppercase, no characters outside the glyph table — rather than being cased at
 * the draw call, so what is in this file is what an author reads.
 */
export interface SaveOutcome {
  readonly ok: boolean;
  readonly transport: SaveTransport;
  readonly message: string;
}

/**
 * The narrowest slice of `fetch` this module uses. `globalThis.fetch` satisfies
 * it structurally, so the real one needs no adapter, and a test fake needs no
 * `Response` — a `{ status }` is the whole contract.
 */
export type FetchLike = (
  url: string,
  init: { readonly method: string; readonly body: string },
) => Promise<{ readonly status: number }>;

/**
 * Every ambient the transport touches, injectable. Absent means "detect it",
 * which is what production does; a test passes all three and never reaches a
 * global.
 */
export interface LevelIoDeps {
  readonly fetch?: FetchLike;
  readonly storage?: StorageLike;
  readonly clipboard?: (text: string) => Promise<void>;
}

/** Written on a bad id. Names the charset, because "bad id" alone is a riddle. */
const BAD_ID_MESSAGE = 'BAD ID: USE LOWERCASE LETTERS, DIGITS AND -, NOT STARTING WITH -.';

/** The endpoint `vite.config.ts`'s `levelSink` serves. Dev only, by design. */
const LEVEL_SINK_PATH = '/__level';

function detectFetch(): FetchLike | null {
  try {
    return (globalThis as { fetch?: FetchLike }).fetch ?? null;
  } catch {
    return null;
  }
}

function detectStorage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null; // Access to localStorage itself can throw (sandboxed iframes).
  }
}

/**
 * `navigator.clipboard.writeText` bound to its owner — unbound it loses `this`
 * and throws an illegal-invocation TypeError, which would be a puzzling way to
 * lose a level. Null whenever the API is missing (node, http on a LAN address,
 * a browser that gates it behind a permission that was refused).
 */
function detectClipboard(): ((text: string) => Promise<void>) | null {
  try {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText?: unknown } } }).navigator;
    const write = nav?.clipboard?.writeText;
    if (typeof write !== 'function' || nav?.clipboard === undefined) {
      return null;
    }
    const clipboard = nav.clipboard as { writeText(text: string): Promise<void> };
    return (text: string) => clipboard.writeText(text);
  } catch {
    return null;
  }
}

/**
 * Best-effort: reports whether it stuck. Storage can throw on quota, in private
 * mode, or because the object itself is unreachable — none of which should cost
 * the author the clipboard copy that comes next.
 */
function writeDraft(storage: StorageLike | null, text: string): boolean {
  if (storage === null) {
    return false;
  }
  try {
    storage.setItem(SAVE_KEYS.editorDraft, text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort, and both failure shapes are real: the promise rejects (no user
 * gesture, permission denied) or the call throws synchronously (the property
 * exists but the API is disabled). Awaited rather than fired and forgotten, so
 * the outcome can say honestly whether the JSON is actually on the clipboard.
 */
async function copyToClipboard(
  clipboard: ((text: string) => Promise<void>) | null,
  text: string,
): Promise<boolean> {
  if (clipboard === null) {
    return false;
  }
  try {
    await clipboard(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save a level. Resolves to an outcome; never rejects, whatever the ambients
 * do — a save that throws in the middle of an editing session is a save that
 * loses work, and every failure here has a fallback worth reporting instead.
 *
 * Order of attempts: reject a bad id outright (no request, no draft — the id is
 * the filename and guessing at it is the middleware's job to refuse, not this
 * one's to paper over), then the dev-server disk write, then localStorage plus
 * the clipboard. The clipboard matters most in the branch that has no server:
 * in a production build it is the only way the author gets the file out.
 */
export async function saveLevel(p: LevelPayload, deps: LevelIoDeps = {}): Promise<SaveOutcome> {
  if (!isValidLevelId(p.id)) {
    return { ok: false, transport: 'local', message: BAD_ID_MESSAGE };
  }

  const body = buildLevelPayload(p);
  const shown = p.id.toUpperCase();
  const post = deps.fetch ?? detectFetch();

  if (post !== null) {
    try {
      // The id is already `[a-z0-9-]+`, so it needs no escaping in a query
      // string; encoding it anyway would only obscure that the guard above is
      // what makes this safe.
      const res = await post(`${LEVEL_SINK_PATH}?id=${p.id}`, { method: 'POST', body });
      if (res.status === 200) {
        // The sink deliberately does not touch src/levels/index.ts — rewriting
        // a TypeScript source file from a middleware is codegen. So the
        // confirmation names the one-line edit that finishes the job.
        return {
          ok: true,
          transport: 'disk',
          message: `SAVED SRC/LEVELS/${shown}.JSON - ADD IT TO SRC/LEVELS/INDEX.TS`,
        };
      }
    } catch {
      // A refused connection, a CORS failure, a dev server that died mid-edit:
      // all of them are the fallback, not an exception for the editor to catch.
    }
  }

  // Fallback. Storage first, because it is the one that survives a reload; the
  // clipboard is what gets the JSON into a file, and it is the more fragile of
  // the two (it can need a user gesture, which a Ctrl+S may not count as).
  const stored = writeDraft(deps.storage ?? detectStorage(), body);
  const copied = await copyToClipboard(deps.clipboard ?? detectClipboard(), body);

  if (copied) {
    return {
      ok: true,
      transport: 'local',
      message: `SAVED LOCALLY - JSON ON CLIPBOARD, PASTE INTO SRC/LEVELS/${shown}.JSON`,
    };
  }
  if (stored) {
    // Claiming the clipboard when the clipboard refused would send an author to
    // paste nothing into an empty file, so the message follows what happened.
    return {
      ok: true,
      transport: 'local',
      message: `DRAFT SAVED TO ${SAVE_KEYS.editorDraft.toUpperCase()} - CLIPBOARD REFUSED, COPY IT FROM THERE.`,
    };
  }
  // Nothing anywhere kept the level. `ok: true` here would be a lie of exactly
  // the kind this module exists to avoid: the author would leave the editor.
  return {
    ok: false,
    transport: 'local',
    message: 'SAVE FAILED: NO SERVER, NO STORAGE, NO CLIPBOARD. KEEP THE TAB OPEN.',
  };
}
