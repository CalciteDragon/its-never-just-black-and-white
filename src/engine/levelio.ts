/**
 * Levels in and out of the browser: the file transport. Two halves, and the
 * split is the point.
 *
 * The **pure half** — `buildLevelPayload` and the id charset — is testable
 * without a browser or a disk. `buildLevelPayload` produces bytes identical to
 * `world/level.ts`'s `serializeLevel`, so a level exported from the editor and
 * a level serialised from a parsed `Level` are the same file: an exported level
 * can be committed to `src/levels/` verbatim, and `git diff` shows exactly what
 * the editor drew (PHASES phase 7, decision 1). That equality is asserted by
 * round-tripping through the real parser, not by a second copy of the rules.
 *
 * The **transport half** is behaviour-detected, not build-flag gated. It used
 * to POST to a dev-only vite middleware that wrote `src/levels/<id>.json`,
 * which made the tool useful to exactly one person: whoever had the repo
 * checked out. Export is now a **download**, which works the same in `npm run
 * dev`, in `vite preview` and on a static host, and produces a file an author
 * can keep, send to somebody, or drop back onto an import row. The fallbacks
 * below it — clipboard, then storage — exist because a download can still be
 * refused, and each outcome says which one happened rather than assuming.
 *
 * `FileDropbox` is the way back in. It is the only DOM listener here, and it
 * converts a `drop` event into a queue a node-safe scene can drain in `update`.
 *
 * Node-safe: nothing here touches `document`, `localStorage` or `navigator` at
 * import time, and every access to them is guarded, because all three can be
 * absent (node, an old browser) or throw on mere property access (a sandboxed
 * iframe, private mode) — the same defence `save.ts` applies to `localStorage`.
 */

import { SAVE_KEYS } from './save';
import type { StorageLike } from './save';

/**
 * The one definition of a legal level id. The editor's id field enforces this
 * charset as you type, `exportLevel` re-checks it before naming a file, and an
 * imported level is renamed to fit it — a file from somebody else's machine is
 * the one place an illegal id can actually arrive.
 *
 * Lowercase, digits and dashes, and it may not lead with a dash. That is not
 * cosmetic: the id becomes a filename (`<id>.json`, and `src/levels/<id>.json`
 * for anything committed), a storage key (`bw.editor.draft.<id>`) and a save
 * key (`bw.best.<id>`), so it has to be safe in a path, stable across
 * case-insensitive filesystems, and free of anything a URL would re-encode.
 */
export const LEVEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Never throws, for any input at all — it is called on a text field's contents
 * and on whatever an imported file happens to carry in its `id`. A non-string,
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

/** The filename an export writes, and the one an import is expected to carry. */
export function levelFileName(id: string): string {
  return `${id}.json`;
}

/**
 * Which route the export actually took. Reported, never assumed.
 *
 * `download` is the one an author asked for — the file lands in the browser's
 * downloads folder, which is somewhere they can find it, send it to somebody,
 * or drop back onto an import row. The other two are what is left when a
 * browser refuses to start a download at all.
 */
export type ExportTransport = 'download' | 'clipboard' | 'storage';

/**
 * `message` is drawn verbatim on the editor's status line by the 5×7 bitmap
 * font in `engine/font.ts`, which has A-Z, 0-9 and a little punctuation and
 * nothing else. Every message here is written the way it will render —
 * uppercase, no characters outside the glyph table — rather than being cased at
 * the draw call, so what is in this file is what an author reads.
 */
export interface ExportOutcome {
  readonly ok: boolean;
  readonly transport: ExportTransport;
  readonly message: string;
}

/**
 * The narrowest slice of "hand this text to the user as a file" this module
 * uses. It reports whether the download actually started, because every step of
 * one — the Blob, the object URL, the synthetic click — can be absent or
 * refused, and an outcome claiming a file the author will never find is exactly
 * the lie this module exists to avoid.
 */
export type DownloadLike = (filename: string, text: string) => boolean;

/**
 * Every ambient the transport touches, injectable. Absent means "detect it",
 * which is what production does; a test passes all three and never reaches a
 * global.
 */
export interface LevelIoDeps {
  readonly download?: DownloadLike;
  readonly storage?: StorageLike;
  readonly clipboard?: (text: string) => Promise<void>;
}

/** Written on a bad id. Names the charset, because "bad id" alone is a riddle. */
const BAD_ID_MESSAGE = 'BAD ID: USE LOWERCASE LETTERS, DIGITS AND -, NOT STARTING WITH -.';

/**
 * How long an object URL is left alive after the click. Revoking it in the same
 * turn cancels the download in some browsers — the anchor has been clicked but
 * the fetch of the blob has not begun — and leaking one 1.3 KB blob per export
 * for ten seconds is the cheaper of the two mistakes.
 */
const OBJECT_URL_TTL_MS = 10_000;

function detectStorage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null; // Access to localStorage itself can throw (sandboxed iframes).
  }
}

/**
 * The download, as an anchor with a `download` attribute over a blob URL. Null
 * whenever any part of that is missing (node, and any environment without a
 * document), so the caller falls back rather than throwing.
 *
 * The anchor goes into the document before the click and out after it: Firefox
 * ignores a click on an element that is not in the tree, which is the kind of
 * difference that only ever shows up in the browser nobody tested in.
 */
export function detectDownload(): DownloadLike | null {
  try {
    const g = globalThis as {
      document?: Document;
      URL?: typeof URL;
      Blob?: typeof Blob;
      setTimeout?: typeof setTimeout;
    };
    const doc = g.document;
    const urls = g.URL;
    const blobs = g.Blob;
    if (!doc || typeof doc.createElement !== 'function' || !doc.body) {
      return null;
    }
    if (!urls || typeof urls.createObjectURL !== 'function' || !blobs) {
      return null;
    }
    return (filename: string, text: string): boolean => {
      try {
        const url = urls.createObjectURL(new blobs([text], { type: 'application/json' }));
        const a = doc.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        a.style.display = 'none';
        doc.body.appendChild(a);
        a.click();
        a.remove();
        g.setTimeout?.(() => {
          try {
            urls.revokeObjectURL(url);
          } catch {
            // An object URL outliving the page is harmless; throwing is not.
          }
        }, OBJECT_URL_TTL_MS);
        return true;
      } catch {
        return false;
      }
    };
  } catch {
    return null;
  }
}

/**
 * `navigator.clipboard.writeText` bound to its owner — unbound it loses `this`
 * and throws an illegal-invocation TypeError, which would be a puzzling way to
 * lose a level. Null whenever the API is missing (node, http on a LAN address,
 * a browser that gates it behind a permission that was refused).
 */
export function detectClipboard(): ((text: string) => Promise<void>) | null {
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
 * the author the clipboard copy that comes first.
 */
function writeFallbackCopy(storage: StorageLike | null, text: string): boolean {
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
export async function copyToClipboard(
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
 * The `detectDownload` implementation already catches its own throws, so this
 * guard is for the *other* one — an injected `DownloadLike`, from a test or
 * from whatever wires this up next. `exportLevel` promises never to reject, and
 * a promise that keeps that word only for the implementation it happens to
 * ship with is not keeping it at all.
 */
function tryDownload(download: DownloadLike, file: string, body: string): boolean {
  try {
    return download(file, body);
  } catch {
    return false;
  }
}

/**
 * Export a level as a file. Resolves to an outcome; never rejects, whatever the
 * ambients do — an export that throws mid-session is one that loses work, and
 * every failure here has a fallback worth reporting instead.
 *
 * Order of attempts: reject a bad id outright (the id is the filename, and
 * guessing at it would put a level somewhere nobody looks for it), then the
 * download, then the clipboard, then `bw.editor.draft` as the last thing short
 * of losing it.
 *
 * **The draft shelf is not one of the fallbacks**, and that is the shape of the
 * whole feature: the editor autosaves to the shelf on every stroke, so the
 * level is already kept and already listed under CUSTOM LEVELS. Exporting is
 * about getting a *file* out — to keep, to send to somebody, to drop back onto
 * an import row — which is why the primary route is the downloads folder and
 * not another key in storage.
 */
export async function exportLevel(p: LevelPayload, deps: LevelIoDeps = {}): Promise<ExportOutcome> {
  if (!isValidLevelId(p.id)) {
    return { ok: false, transport: 'download', message: BAD_ID_MESSAGE };
  }

  const body = buildLevelPayload(p);
  const file = levelFileName(p.id);
  const shown = file.toUpperCase();
  const download = deps.download ?? detectDownload();

  if (download !== null && tryDownload(download, file, body)) {
    return { ok: true, transport: 'download', message: `EXPORTED ${shown} TO YOUR DOWNLOADS` };
  }

  if (await copyToClipboard(deps.clipboard ?? detectClipboard(), body)) {
    return {
      ok: true,
      transport: 'clipboard',
      message: `DOWNLOAD REFUSED - JSON ON CLIPBOARD, PASTE IT INTO ${shown}`,
    };
  }
  if (writeFallbackCopy(deps.storage ?? detectStorage(), body)) {
    return {
      ok: true,
      transport: 'storage',
      message: `NO DOWNLOAD, NO CLIPBOARD - JSON IS IN ${SAVE_KEYS.editorDraft.toUpperCase()}`,
    };
  }
  // Nothing handed the file over. The draft on the shelf still holds the level,
  // so this says what failed rather than implying the work is gone.
  return {
    ok: false,
    transport: 'download',
    message: 'EXPORT FAILED: NO DOWNLOAD, NO CLIPBOARD. THE DRAFT IS STILL SAVED.',
  };
}

// --- Import: the other direction, and the reason a level file is worth having. ---

/** A file the author dropped on the window, already read as text. */
export interface DroppedFile {
  readonly name: string;
  readonly text: string;
}

/**
 * How many dropped files are held at once. A drop of forty files is a slip, and
 * queueing all of them would import forty levels before the author could look
 * at the first one.
 */
const DROP_QUEUE_MAX = 8;

/** Bigger than this is not a level: a 200×60 grid serialises to about 14 KB. */
const DROP_SIZE_MAX = 1 << 20;

/**
 * Drag-and-drop, turned into something a scene can poll.
 *
 * Scenes are node-safe (hard rule 2) and cannot listen for a `drop` event, and
 * a callback fired from a DOM handler would run scene logic outside the
 * fixed-step loop — halfway through a frame, or into a scene that has already
 * been swapped out. So `attach` is the only half that touches the DOM, it does
 * nothing but read text into a queue, and the scene drains that queue in its
 * own `update`. A test pushes onto the queue directly and needs no event.
 *
 * `hovering` is what lets a screen say DROP IT HERE while a file is over the
 * window, which is the only feedback drag-and-drop has to offer.
 */
export class FileDropbox {
  private readonly queue: DroppedFile[] = [];
  private over = false;
  private attached = false;

  /** Is a drag over the window? Cosmetic; never trusted for logic. */
  get hovering(): boolean {
    return this.over;
  }

  /** The test seam, and what `attach`'s reader calls. */
  push(file: DroppedFile): void {
    this.queue.push(file);
    while (this.queue.length > DROP_QUEUE_MAX) {
      this.queue.shift();
    }
  }

  /**
   * Every file dropped since the last call; the queue is emptied. Draining
   * rather than peeking is deliberate — two screens must never both import the
   * same drop, and a file left behind would be imported again by whatever
   * screen came next.
   */
  take(): readonly DroppedFile[] {
    if (this.queue.length === 0) {
      return [];
    }
    const out = this.queue.slice();
    this.queue.length = 0;
    return out;
  }

  /**
   * Open the operating system's file picker and queue whatever comes back, so
   * the IMPORT row is a row you can *press* rather than a label describing a
   * gesture. Returns whether a picker could be opened at all — under node, and
   * in anything without a document, it is false and the caller says so.
   *
   * Browsers gate this behind user activation, which a keypress or a click one
   * frame earlier satisfies. Drag-and-drop is the path that never needs it, so
   * both screens document the drop and offer the picker.
   */
  openPicker(): boolean {
    try {
      const doc = (globalThis as { document?: Document }).document;
      if (!doc || typeof doc.createElement !== 'function') {
        return false;
      }
      const input = doc.createElement('input');
      input.type = 'file';
      // A hint, not a guard: the picker's "all files" option is one click away,
      // and `importLevelText` is what actually decides whether this is a level.
      input.accept = '.json,application/json';
      input.multiple = true;
      input.addEventListener('change', () => {
        const files = input.files;
        if (files === null) {
          return;
        }
        for (let i = 0; i < Math.min(files.length, DROP_QUEUE_MAX); i++) {
          this.readFile(files[i]);
        }
      });
      input.click();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * One file into the queue, whatever happens. A read that fails still queues
   * an empty entry: the importer reports it as "not a level", and an author who
   * picked a file is owed an answer rather than a screen that does nothing.
   */
  private readFile(file: File): void {
    if (file.size > DROP_SIZE_MAX) {
      this.push({ name: file.name, text: '' });
      return;
    }
    void file
      .text()
      .then((text) => this.push({ name: file.name, text }))
      .catch(() => this.push({ name: file.name, text: '' }));
  }

  /**
   * Browser-only: wire the drag events on a window. One of the sanctioned
   * places that may touch a DOM API; importing this module in node stays
   * side-effect-free, and calling this twice is a no-op.
   *
   * **`dragover` must preventDefault or nothing else here runs.** Without it
   * the browser's own handler wins and dropping a JSON file on the page
   * navigates away from the game — losing the session it was about to be
   * imported into. `dragenter` and `drop` are prevented for the same reason.
   */
  attach(win: Window): void {
    if (this.attached) {
      return;
    }
    this.attached = true;
    const over = (e: DragEvent): void => {
      e.preventDefault();
      this.over = true;
    };
    win.addEventListener('dragenter', over);
    win.addEventListener('dragover', over);
    win.addEventListener('dragleave', (e: DragEvent) => {
      e.preventDefault();
      // Only the drag actually leaving the window, not every child boundary it
      // crosses on the way across: `relatedTarget` is null exactly then.
      if (e.relatedTarget === null) {
        this.over = false;
      }
    });
    win.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      this.over = false;
      const files = e.dataTransfer?.files;
      if (!files) {
        return;
      }
      for (let i = 0; i < Math.min(files.length, DROP_QUEUE_MAX); i++) {
        this.readFile(files[i]);
      }
    });
  }
}
