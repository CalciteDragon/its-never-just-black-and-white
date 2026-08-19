/**
 * Which rungs of `EDITOR_ZOOM_STEPS` a given grid may use, and where it opens.
 *
 * Pure, node-safe and separate from the scene for the usual reason: it is
 * arithmetic about a grid and a frame, it has interesting edges at both ends of
 * the size range, and a test should be able to ask "what can a 200x60 do?"
 * without a canvas.
 *
 * The rule is stated in terms of **the fit step** — the largest zoom at which
 * the whole grid still sits inside the frame, or the smallest rung when nothing
 * fits (a 200-wide level is 1600 px even at a quarter):
 *
 * - **Out** stops at the fit step. Below it the level is a speck on a field of
 *   nothing, and the one job zooming out has — see all of it — is already done.
 *   Never above 1x, though, or a tiny level would open with no way to see the
 *   cells it is made of.
 * - **In** stops at 2x, or at the fit step when that is higher: a level small
 *   enough to sit whole at 4x can be worked on at 4x, and one that is not gains
 *   nothing from a cell the size of a fist.
 *
 * Both ends therefore move with the level's size, which is the point: the
 * editor never offers a zoom that shows nothing useful.
 */

import { EDITOR_ZOOM_STEPS, TILE, VIEW_H, VIEW_W } from '../constants';

/** The rung showing a whole `w x h` grid at the largest zoom, or 0 if none does. */
export function fitZoomIndex(w: number, h: number): number {
  for (let i = EDITOR_ZOOM_STEPS.length - 1; i >= 0; i--) {
    const cell = TILE * EDITOR_ZOOM_STEPS[i];
    if (w * cell <= VIEW_W && h * cell <= VIEW_H) {
      return i;
    }
  }
  return 0;
}

/** The rung for a zoom factor, e.g. `1` → the index of 1x. */
function indexOf(factor: number): number {
  const i = EDITOR_ZOOM_STEPS.indexOf(factor);
  // The ladder is a constant in this repo, so a miss is a typo in that
  // constant rather than a runtime condition — but falling back to a legal
  // index beats indexing an array at -1 in a scene that draws every frame.
  return i === -1 ? 0 : i;
}

/** The inclusive rung range a `w x h` grid may zoom within, and where it opens. */
export interface ZoomRange {
  readonly min: number;
  readonly max: number;
  /** Where a freshly opened grid sits: the fit step, clamped into range. */
  readonly initial: number;
}

export function zoomRange(w: number, h: number): ZoomRange {
  const fit = fitZoomIndex(w, h);
  const min = Math.min(fit, indexOf(1));
  const max = Math.max(fit, indexOf(2));
  return { min, max, initial: Math.min(Math.max(fit, min), max) };
}

/** `EDITOR_ZOOM_STEPS[i]` as the 5x7 font draws it: `50%`, `100%`, `400%`. */
export function zoomLabel(index: number): string {
  return `${Math.round(EDITOR_ZOOM_STEPS[index] * 100)}%`;
}
