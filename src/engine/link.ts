/**
 * Opening an external link, guarded.
 *
 * One function, one job, and the same shape as the rest of `engine`'s browser
 * IO (`levelio`): nothing is touched at import time, `globalThis` is read
 * behind a typed cast, and a missing `window.open` is a `false` rather than a
 * throw — so this imports and runs in node like every other logic module, and
 * a scene can call it without knowing whether it is in a browser.
 *
 * `noopener,noreferrer` is not decoration. Without `noopener` the page that
 * opens gets a live `window.opener` handle back into the game and can navigate
 * it wherever it likes; the game is a canvas with no other origin in it, and
 * there is no reason to hand a tab that reach.
 */

/** Returns whether the open was ATTEMPTED — a popup blocker is silent. */
export function openExternal(url: string): boolean {
  try {
    const open = (globalThis as { open?: (u: string, t: string, f: string) => unknown }).open;
    if (typeof open !== 'function') {
      return false;
    }
    open(url, '_blank', 'noopener,noreferrer');
    return true;
  } catch {
    return false;
  }
}
