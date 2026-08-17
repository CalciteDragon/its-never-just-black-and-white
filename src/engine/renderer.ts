/**
 * Offscreen VIEW_W×VIEW_H canvas, integer-scaled to the visible canvas with
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

/** Largest integer scale of VIEW_W×VIEW_H fitting winW×winH, centered. Never 0. */
export function computeScale(winW: number, winH: number): ScaleFit {
  const scale = Math.max(1, Math.floor(Math.min(winW / VIEW_W, winH / VIEW_H)));
  return {
    scale,
    offX: Math.floor((winW - VIEW_W * scale) / 2),
    offY: Math.floor((winH - VIEW_H * scale) / 2),
  };
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
 * Fraction of the range the accent tint stays fully off for. Not a tuning knob,
 * so it isn't in constants.ts: GAME-DESIGN §7 defines the tint as arriving "over
 * the top half of the range", and the half is the spec.
 */
const TINT_START = 0.5;

/** Vignette alpha: VIGNETTE_MIN at rest, VIGNETTE_MAX at full speed. */
export function vignetteAlpha(speedNorm: number): number {
  return VIGNETTE_MIN + (VIGNETTE_MAX - VIGNETTE_MIN) * clamp01(speedNorm);
}

/**
 * Alpha of the accent tint layered over the vignette. Zero across the bottom
 * half of the range — colour is rationed, and a tint present at rest would read
 * as decoration instead of as an event.
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
   * Aberration scratch canvases, allocated on the first frame that actually
   * exceeds CA_THRESHOLD — a player who never gets fast never pays the ~4 MB.
   */
  private caBuffers: {
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
  private gradAccent: CanvasGradient | null = null;
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

  clear(color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  /** Axis-aligned fill, world space unless ui. Floats survive: this antialiases. */
  rect(x: number, y: number, w: number, h: number, color: string, ui = false): void {
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
   * Bitmap text. UI space by default; pass ui = false for world space.
   * Keeps rounding — the 5×7 font is the one deliberately low-res element
   * (GAME-DESIGN §2) and antialiasing it would throw away the signature.
   */
  text(str: string, x: number, y: number, color: string, scale = 1, ui = true): void {
    const dx = Math.round(ui ? x : x - this.camX);
    const dy = Math.round(ui ? y : y - this.camY);
    drawText(this.ctx, str, dx, dy, color, scale);
  }

  /** Bitmap text centered on cx. UI space by default. Rounds, as above. */
  textCentered(str: string, cx: number, y: number, color: string, scale = 1, ui = true): void {
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
    const { pristine, pctx, staging, sctx } = this.ensureCaBuffers();
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

  /** Radial paper darkening, plus the accent tint over the top half of the range. */
  private vignette(speedNorm: number): void {
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
      ctx.fillStyle = this.gradAccent as CanvasGradient;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    ctx.restore();
  }

  private ensureGradients(): void {
    if (this.gradPhase === palette.phase && this.gradPaper && this.gradAccent) {
      return;
    }
    const cx = VIEW_W / 2;
    const cy = VIEW_H / 2;
    const r = Math.hypot(cx, cy);
    const inner = r * VIGNETTE_INNER;
    const paper = this.ctx.createRadialGradient(cx, cy, inner, cx, cy, r);
    paper.addColorStop(0, palette.paperRgba(0));
    paper.addColorStop(1, palette.paperRgba(1));
    const accent = this.ctx.createRadialGradient(cx, cy, inner, cx, cy, r);
    accent.addColorStop(0, palette.accentRgba(0));
    accent.addColorStop(1, palette.accentRgba(1));
    this.gradPaper = paper;
    this.gradAccent = accent;
    this.gradPhase = palette.phase;
  }

  private ensureCaBuffers(): NonNullable<Renderer['caBuffers']> {
    if (this.caBuffers) {
      return this.caBuffers;
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
    this.caBuffers = { pristine, pctx, staging, sctx };
    return this.caBuffers;
  }

  /** Blit the offscreen buffer to the visible canvas at integer scale. */
  present(): void {
    const { scale, offX, offY } = computeScale(this.visible.width, this.visible.height);
    const vctx = this.visibleCtx;
    // Off, and it stays off: smoothing an integer-scaled blit would soften the
    // whole frame. The only place softness is wanted is inside the post pass.
    vctx.imageSmoothingEnabled = false;
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
