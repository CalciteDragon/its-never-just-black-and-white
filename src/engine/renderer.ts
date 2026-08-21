/**
 * Offscreen VIEW_W×VIEW_H canvas, scaled to fit the visible canvas with
 * letterboxing. Constructing a Renderer requires a DOM (browser only), but
 * computeScale and the post ramps are pure and node-tested.
 *
 * The coordinate policy is the look (PHASES decision 1). `imageSmoothingEnabled`
 * is NOT what antialiases a shape — Canvas 2D antialiases paths and fillRect
 * unconditionally, and the flag only touches drawImage/pattern scaling. What
 * decides whether a square resting at 37° has a clean edge is where rounding
 * survives: the camera origin rounds, shapes don't, text does.
 */

import {
  CA_MAX_OFFSET,
  CA_THRESHOLD,
  VIEW_H,
  VIEW_W,
  VIGNETTE_INNER,
  VIGNETTE_MAX,
  VIGNETTE_MIN,
  VIGNETTE_TINT_MAX,
} from '../constants';
import { drawText, drawTextCentered } from './font';
import {
  CHANNEL_BLUE,
  CHANNEL_GREEN,
  CHANNEL_RED,
  COMPOSITE_BLACK,
  palette,
} from './palette';

export interface ScaleFit {
  scale: number;
  offX: number;
  offY: number;
}

/**
 * Smallest scale below which the frame stops shrinking (a window this small has
 * no usable game in it either way). It exists only so `screenToView` can never
 * divide by zero on a zero-sized or detached canvas.
 */
const MIN_SCALE = 0.05;

/**
 * Steps per 1× that a magnifying scale snaps down to. Quarters, and the
 * quarters are load-bearing in both directions: coarser is a cliff (halves put
 * a 1366×768 window on 1×, at 70% of the height it could have used), and
 * finer stops buying anything — the point of snapping is that a scale of n/4
 * resamples on a repeating four-pixel pattern instead of an irrational-looking
 * one, and 2.32× does not.
 */
const SCALE_STEPS = 4;

/**
 * Largest scale of VIEW_W×VIEW_H fitting winW×winH, centered. Never 0.
 *
 * **Continuous in the window, snapped in quarters.** Snapping to whole
 * multiples looks tidy and reads consistently until you notice it is a cliff: a
 * windowed browser on a 1080p display has about 940 px of viewport height, so
 * it fits 1.74× and floored to 1 — half the linear size the same window gets
 * on a 1440p display, which fits 2.41× and floored to 2. One display got a
 * 960×540 stamp in a sea of letterbox; the other got a frame filling three
 * quarters of its width.
 *
 * Filling the window exactly fixes that and overcorrects: an arbitrary scale is
 * an arbitrary resample, and the frame goes soft in proportion to how odd the
 * ratio is. Quarter steps keep the fit within about 14% of the window on every
 * common size — no cliff — while landing on a rational magnification, and on
 * an exact whole one whenever the window is close to a multiple of the view
 * (fullscreen 1080p is 2× on the nose, and `present` blits that unsmoothed).
 *
 * Below 1× the scale is left alone. Snapping is about magnifying cleanly, and
 * a window smaller than the view is already resampling everything it draws;
 * quantising there would only throw away pixels it cannot spare.
 *
 * Offsets stay integers. The letterbox edge is the one hard edge in the blit,
 * and there is no reason to land it on a half pixel. They ROUND rather than
 * floor: `VIEW_W * (winW / VIEW_W)` is not exactly `winW` in binary floating
 * point, so on the axis the fit is tight against, the remaining gap is a few
 * ulps either side of zero — and flooring turns the negative half of that into
 * an off-by-one pixel that shifts the whole frame left or up.
 */
export function computeScale(winW: number, winH: number): ScaleFit {
  const raw = Math.min(winW / VIEW_W, winH / VIEW_H);
  const fitted = raw >= 1 ? Math.floor(raw * SCALE_STEPS) / SCALE_STEPS : raw;
  const scale = fitted > MIN_SCALE ? fitted : MIN_SCALE;
  return {
    // `|| 0` only normalises -0, which those same ulps produce and which reads
    // as a different value to every deep-equality check that ever looks at it.
    offX: Math.round((winW - VIEW_W * scale) / 2) || 0,
    offY: Math.round((winH - VIEW_H * scale) / 2) || 0,
    scale,
  };
}

/** A canvas point mapped back into view space, and whether it landed in frame. */
export interface ViewPoint {
  vx: number;
  vy: number;
  inFrame: boolean;
}

/**
 * The exact inverse of `present`'s blit: canvas pixels back to the 960×540 view
 * (PHASES phase 7, decision 2). `Input.attach` runs it on every pointer event,
 * so it is the one and only place in the project where the letterbox arithmetic
 * lives — and the one place it can be wrong.
 *
 * **Dropping the offset is a fifteen-tile error, not a sub-pixel one.** At a
 * 3840×1080 window `computeScale` gives scale 2 and offX 960, so the naive
 * `clientX / scale` lands 480 view px to the right — 15 tiles across on a 32 px
 * grid. That failure reads as "the editor feels off" rather than as an
 * arithmetic bug, which is why the round-trip test picks window sizes that
 * deliberately do not fit exactly.
 *
 * It reports `inFrame` rather than clamping. A press in the letterbox is not a
 * press on the edge tile; clamping would smear a wall of tiles down the border,
 * which is the visible version of the same mistake.
 */
export function screenToView(
  canvasW: number,
  canvasH: number,
  clientX: number,
  clientY: number,
): ViewPoint {
  const { scale, offX, offY } = computeScale(canvasW, canvasH);
  const vx = (clientX - offX) / scale;
  const vy = (clientY - offY) / scale;
  return { vx, vy, inFrame: vx >= 0 && vx < VIEW_W && vy >= 0 && vy < VIEW_H };
}

// --- Post ramps (PHASES decision 7). Pure functions of speedNorm, so the
// numbers are testable and applyPost is left with nothing but drawing. ---

/**
 * speedNorm arrives smoothed from gameplay and can overshoot its range, so every
 * ramp clamps rather than extrapolating. NaN fails both comparisons and lands on
 * 0 — an invalid alpha must never reach the context, where it voids the draw.
 */
function clamp01(n: number): number {
  return n > 0 ? (n < 1 ? n : 1) : 0;
}

/**
 * Fraction of the range the ink tint stays fully off for. Not a tuning knob,
 * so it isn't in constants.ts: GAME-DESIGN §7 defines the tint as arriving "over
 * the top half of the range", and the half is the spec.
 */
const TINT_START = 0.5;

/** Vignette alpha: VIGNETTE_MIN at rest, VIGNETTE_MAX at full speed. */
export function vignetteAlpha(speedNorm: number): number {
  return VIGNETTE_MIN + (VIGNETTE_MAX - VIGNETTE_MIN) * clamp01(speedNorm);
}

/**
 * Alpha of the ink tint layered over the vignette. Zero across the bottom
 * half of the range — the darkening is rationed, and a tint present at rest
 * would read as decoration instead of as an event.
 *
 * INK, and nothing more saturated (hard rule 6 keeps colour scarce): the speed
 * vignette deepens toward the ink the geometry is already drawn in rather than
 * staining the frame.
 */
export function tintAmount(speedNorm: number): number {
  const n = clamp01(speedNorm);
  if (n <= TINT_START) {
    return 0;
  }
  return VIGNETTE_TINT_MAX * ((n - TINT_START) / (1 - TINT_START));
}

/**
 * Chromatic aberration channel split (px). Exactly 0 at and below CA_THRESHOLD
 * — the boundary is inclusive, so the effect starts from zero and grows rather
 * than popping in — reaching CA_MAX_OFFSET at speedNorm 1.
 */
export function caOffset(speedNorm: number): number {
  const n = clamp01(speedNorm);
  if (n <= CA_THRESHOLD) {
    return 0;
  }
  return CA_MAX_OFFSET * ((n - CA_THRESHOLD) / (1 - CA_THRESHOLD));
}

export class Renderer {
  /** Offscreen 2d context. Scenes draw into this. */
  readonly ctx: CanvasRenderingContext2D;

  private readonly visible: HTMLCanvasElement;
  private readonly visibleCtx: CanvasRenderingContext2D;
  private readonly offscreen: HTMLCanvasElement;
  private camX = 0;
  private camY = 0;

  /**
   * Canvas operations issued since the last `takeDrawCalls`, for the
   * performance monitor (`engine/perf.ts`). Counted UNCONDITIONALLY — an
   * increment is cheaper than the branch that would skip it, and a counter
   * that only runs under a flag is a counter that rots.
   *
   * It counts real context operations, not calls to this class: the post pass
   * is fourteen of them behind one method, and a monitor that reported it as
   * "1" would send an optimisation pass looking at the tile loop instead.
   */
  private drawCalls = 0;

  /**
   * Post-pass scratch canvases, allocated on the first frame that actually
   * needs one — a player who never gets fast and never finishes the last level
   * never pays the ~4 MB. Shared by the aberration and by `blurScreen`; they
   * never run in the same pass, and two more full-size buffers for the second
   * caller would be 4 MB to avoid a comment.
   */
  private postBuffers: {
    pristine: HTMLCanvasElement;
    pctx: CanvasRenderingContext2D;
    staging: HTMLCanvasElement;
    sctx: CanvasRenderingContext2D;
  } | null = null;

  /**
   * Two cached gradients, not one per frame (PHASES decision 4). Both the
   * vignette's alpha and its tint vary continuously with speed, so a single
   * gradient carrying either would be rebuilt every frame; split, the per-frame
   * variation is just globalAlpha, which is free. The buffer is a fixed
   * 960×540 — only the *visible* canvas resizes — so a phase change is the only
   * thing that can invalidate them, and the renderer notices that itself.
   */
  private gradPaper: CanvasGradient | null = null;
  private gradInk: CanvasGradient | null = null;
  private gradPhase = -1;

  constructor(visibleCanvas: HTMLCanvasElement) {
    this.visible = visibleCanvas;
    const vctx = visibleCanvas.getContext('2d');
    if (!vctx) {
      throw new Error('Renderer: 2d context unavailable on visible canvas');
    }
    this.visibleCtx = vctx;
    this.offscreen = document.createElement('canvas');
    this.offscreen.width = VIEW_W;
    this.offscreen.height = VIEW_H;
    const ctx = this.offscreen.getContext('2d');
    if (!ctx) {
      throw new Error('Renderer: 2d context unavailable on offscreen canvas');
    }
    // On the buffer, smoothing is wanted: the post pass blits this canvas at
    // sub-pixel offsets and needs those samples interpolated. (It does nothing
    // for the fills — those antialias either way.)
    ctx.imageSmoothingEnabled = true;
    this.ctx = ctx;
  }

  /**
   * Camera position. The origin is rounded to whole pixels so that static
   * geometry — tile coords are multiples of TILE — still lands on pixel
   * boundaries and stays crisp now that the draws themselves take floats. The
   * moving square keeps its sub-pixel position; it comes from its own coords.
   */
  setCamera(x: number, y: number): void {
    this.camX = Math.round(x);
    this.camY = Math.round(y);
  }

  /**
   * Read the draw-call count and zero it. Read-and-clear rather than a getter
   * plus a `resetDrawCalls`, because two callers reading the same running total
   * would each see the other's frame; there is exactly one consumer per frame
   * and taking the number is what ends the frame's count.
   */
  takeDrawCalls(): number {
    const n = this.drawCalls;
    this.drawCalls = 0;
    return n;
  }

  clear(color: string): void {
    this.drawCalls++;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  /** Axis-aligned fill, world space unless ui. Floats survive: this antialiases. */
  rect(x: number, y: number, w: number, h: number, color: string, ui = false): void {
    this.drawCalls++;
    const dx = ui ? x : x - this.camX;
    const dy = ui ? y : y - this.camY;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(dx, dy, w, h);
  }

  /**
   * Fill a w×h rect CENTERED on (cx, cy) and rotated by `angle` radians. The
   * player draws through this twice — an ink body and its paper core — and
   * phase 4 drives the angle from the rigid body. Float path, no rounding:
   * the clean edge on a tilted square is the entire point.
   */
  rectRotated(
    cx: number,
    cy: number,
    w: number,
    h: number,
    angle: number,
    color: string,
    ui = false,
  ): void {
    this.drawCalls++;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(ui ? cx : cx - this.camX, ui ? cy : cy - this.camY);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /**
   * Outline of the same rect. `strokeRect` centers the line on the path, so the
   * stroke straddles the edge by lineWidth / 2 — matching the filled body of the
   * same w×h rather than sitting inside or outside it.
   */
  rectRotatedOutline(
    cx: number,
    cy: number,
    w: number,
    h: number,
    angle: number,
    color: string,
    lineWidth = 1,
    ui = false,
  ): void {
    this.drawCalls++;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(ui ? cx : cx - this.camX, ui ? cy : cy - this.camY);
    ctx.rotate(angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  /**
   * A soft radial bloom: `inner` at the centre, fading to `outer` at `radius`.
   * The one soft-edged primitive in the renderer, and it exists for one caller
   * — the finale goal (`scenes/tiledraw.ts`), where the game's two-colour rule
   * is broken on purpose and a hard-edged rectangle of rainbow would read as a
   * sticker rather than as light.
   *
   * Deliberately **source-over, not `lighter`**. Additive is the obvious choice
   * for a glow and it is wrong here: it is invisible against phase B's near
   * white paper, and a bloom that only exists in one phase is a bloom that
   * disappears the moment the player flips. Alpha blending keeps it chromatic
   * over both grounds, with no branch on the phase.
   *
   * The gradient is built per call, unlike the vignette's two cached ones. It
   * varies in hue AND radius every frame, so there is nothing to cache, and it
   * is drawn a couple of dozen times on exactly one screen in the game.
   */
  glow(
    cx: number,
    cy: number,
    radius: number,
    inner: string,
    outer: string,
    ui = false,
  ): void {
    if (radius <= 0) {
      return;
    }
    this.drawCalls++;
    const ctx = this.ctx;
    const dx = ui ? cx : cx - this.camX;
    const dy = ui ? cy : cy - this.camY;
    const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, radius);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(dx, dy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Blur the ENTIRE frame in place, in screen space, after everything else has
   * been drawn. The finale's ending is the only caller: the game dissolves into
   * colour, and dissolving means the level, the player and the HUD all go soft
   * together rather than one of them fading out from under the others.
   *
   * Canvas `filter` blurs each draw operation, so blurring the composed frame
   * means blitting it through the filter — hence the scratch copy. The blit is
   * OVERDRAWN by twice the radius on every side, because a blur samples past
   * the edge of its source, finds nothing there, and rings the screen with a
   * dark border. Overdrawing feeds it real pixels instead; the ~8% zoom that
   * costs is invisible under the blur that caused it.
   */
  blurScreen(px: number): void {
    if (px <= 0) {
      return;
    }
    this.drawCalls += 2;
    const { pristine, pctx } = this.ensurePostBuffers();
    pctx.filter = 'none';
    pctx.globalCompositeOperation = 'copy';
    pctx.drawImage(this.offscreen, 0, 0);

    const grow = px * 2;
    const ctx = this.ctx;
    ctx.save();
    ctx.filter = `blur(${px}px)`;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(pristine, -grow, -grow, VIEW_W + grow * 2, VIEW_H + grow * 2);
    ctx.restore();
  }

  /**
   * A full-screen conical sweep through `stops` — hue by ANGLE around
   * (cx, cy) — at `alpha`. The finale's last frame and the only caller: it is
   * the smooth version of the pixel spiral the player just stood in, and the
   * screen the credits will come up over.
   *
   * Conic rather than radial because a radial sweep has a centre, and a centre
   * is a thing to look at. This one has no subject at all, which is the point:
   * the game is over and there is nothing left to read.
   */
  conic(cx: number, cy: number, angle: number, stops: readonly string[], alpha: number): void {
    if (alpha <= 0 || stops.length < 2) {
      return;
    }
    this.drawCalls++;
    const ctx = this.ctx;
    const g = ctx.createConicGradient(angle, cx, cy);
    for (let i = 0; i < stops.length; i++) {
      g.addColorStop(i / (stops.length - 1), stops[i]);
    }
    ctx.save();
    ctx.globalAlpha = alpha < 1 ? alpha : 1;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  /**
   * Bitmap text. UI space by default; pass ui = false for world space.
   * Keeps rounding — the 5×7 font is the one deliberately low-res element
   * (GAME-DESIGN §2) and antialiasing it would throw away the signature.
   */
  text(str: string, x: number, y: number, color: string, scale = 1, ui = true): void {
    // One per GLYPH: the 5x7 font fills a rect per lit pixel, so a line of
    // text is not one operation and must not be counted as one.
    this.drawCalls += str.length;
    const dx = Math.round(ui ? x : x - this.camX);
    const dy = Math.round(ui ? y : y - this.camY);
    drawText(this.ctx, str, dx, dy, color, scale);
  }

  /** Bitmap text centered on cx. UI space by default. Rounds, as above. */
  textCentered(str: string, cx: number, y: number, color: string, scale = 1, ui = true): void {
    this.drawCalls += str.length;
    const dx = Math.round(ui ? cx : cx - this.camX);
    const dy = Math.round(ui ? y : y - this.camY);
    drawTextCentered(this.ctx, str, dx, dy, color, scale);
  }

  /**
   * The post pass: chromatic aberration, then the vignette. Called last by the
   * scene, over everything including the UI — it is screen-space.
   *
   * Order matters both ways (PHASES decision 6). The vignette is an overlay and
   * has no business being channel-split; and each shifted channel copy would
   * otherwise disturb a strip up to CA_MAX_OFFSET px at the frame edge, which
   * the vignette is at its strongest precisely when aberration is active.
   */
  applyPost(speedNorm: number): void {
    const off = caOffset(speedNorm);
    if (off > 0) {
      this.aberrate(off);
    }
    this.vignette(speedNorm);
  }

  /**
   * Split R and B by ±off px. The naive version — draw the buffer three times
   * with `lighter` and per-channel offsets — only works against a black
   * background, and this game inverts, so half the time the background is near
   * white and additive blending saturates the frame to white (PHASES decision
   * 5). The decomposition that survives the flip: mask each copy to a single
   * channel with `multiply` (frame × (1,0,0) = (r,0,0)), then sum the three
   * with `lighter`. At zero offset they add back to the original exactly,
   * whatever the background.
   */
  private aberrate(off: number): void {
    // 1 copy + 1 fill + 4 per channel pass.
    this.drawCalls += 14;
    const { pristine, pctx, staging, sctx } = this.ensurePostBuffers();
    pctx.globalCompositeOperation = 'copy';
    pctx.drawImage(this.offscreen, 0, 0);

    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = COMPOSITE_BLACK;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalCompositeOperation = 'lighter';

    const passes: readonly (readonly [number, string])[] = [
      [-off, CHANNEL_RED],
      [0, CHANNEL_GREEN],
      [off, CHANNEL_BLUE],
    ];
    for (const [dx, mask] of passes) {
      // Base the staging canvas on the UNSHIFTED frame before drawing the
      // shifted copy over it. Otherwise the shift uncovers a strip at the frame
      // edge that composites as black, which reads as a dark band against paper
      // — one extra blit per channel buys real content in that strip instead.
      sctx.globalCompositeOperation = 'copy';
      sctx.drawImage(pristine, 0, 0);
      sctx.globalCompositeOperation = 'source-over';
      sctx.drawImage(pristine, dx, 0);
      sctx.globalCompositeOperation = 'multiply';
      sctx.fillStyle = mask;
      sctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.drawImage(staging, 0, 0);
    }
    ctx.restore();
  }

  /** Radial paper darkening, plus the ink tint over the top half of the range. */
  private vignette(speedNorm: number): void {
    this.drawCalls += tintAmount(speedNorm) > 0 ? 2 : 1;
    this.ensureGradients();
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = vignetteAlpha(speedNorm);
    ctx.fillStyle = this.gradPaper as CanvasGradient;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const tint = tintAmount(speedNorm);
    if (tint > 0) {
      ctx.globalAlpha = tint;
      ctx.fillStyle = this.gradInk as CanvasGradient;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    ctx.restore();
  }

  private ensureGradients(): void {
    if (this.gradPhase === palette.phase && this.gradPaper && this.gradInk) {
      return;
    }
    const cx = VIEW_W / 2;
    const cy = VIEW_H / 2;
    const r = Math.hypot(cx, cy);
    const inner = r * VIGNETTE_INNER;
    const paper = this.ctx.createRadialGradient(cx, cy, inner, cx, cy, r);
    paper.addColorStop(0, palette.paperRgba(0));
    paper.addColorStop(1, palette.paperRgba(1));
    const ink = this.ctx.createRadialGradient(cx, cy, inner, cx, cy, r);
    ink.addColorStop(0, palette.inkRgba(0));
    ink.addColorStop(1, palette.inkRgba(1));
    this.gradPaper = paper;
    this.gradInk = ink;
    this.gradPhase = palette.phase;
  }

  private ensurePostBuffers(): NonNullable<Renderer['postBuffers']> {
    if (this.postBuffers) {
      return this.postBuffers;
    }
    const make = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
      const c = document.createElement('canvas');
      c.width = VIEW_W;
      c.height = VIEW_H;
      const cc = c.getContext('2d');
      if (!cc) {
        throw new Error('Renderer: 2d context unavailable on post buffer');
      }
      cc.imageSmoothingEnabled = true;
      return [c, cc];
    };
    const [pristine, pctx] = make();
    const [staging, sctx] = make();
    this.postBuffers = { pristine, pctx, staging, sctx };
    return this.postBuffers;
  }

  /** Blit the offscreen buffer to the visible canvas, centered and letterboxed. */
  present(): void {
    this.drawCalls += 2;
    const { scale, offX, offY } = computeScale(this.visible.width, this.visible.height);
    const vctx = this.visibleCtx;
    // Smoothing is decided by the scale, not by preference. At a whole-number
    // scale every source pixel lands on a whole block of destination pixels and
    // smoothing could only soften a frame that is already exact; at a fractional
    // scale it is the difference between a resampled frame and a frame with
    // ragged, unevenly-doubled rows through it.
    vctx.imageSmoothingEnabled = !Number.isInteger(scale);
    // The letterbox is the background continuing past the frame, so it tracks
    // the palette rather than being a colour of its own.
    vctx.fillStyle = palette.paper;
    vctx.fillRect(0, 0, this.visible.width, this.visible.height);
    vctx.drawImage(this.offscreen, offX, offY, VIEW_W * scale, VIEW_H * scale);
  }

  /** Size the visible canvas to the window and re-present. */
  fitToWindow(win: Window): void {
    this.visible.width = win.innerWidth;
    this.visible.height = win.innerHeight;
    this.present();
  }
}
