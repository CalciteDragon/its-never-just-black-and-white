/**
 * Offscreen VIEW_W×VIEW_H canvas, integer-scaled to the visible canvas with
 * letterboxing. Constructing a Renderer requires a DOM (browser only), but
 * computeScale is pure and node-tested.
 *
 * Phase 3 owns the look: antialiased shapes, rotated rects, and the post pass.
 * For now this is a rect-and-text blitter and nothing more.
 */

import { VIEW_H, VIEW_W } from '../constants';
import { drawText, drawTextCentered } from './font';
import { palette } from './palette';

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

export class Renderer {
  /** Offscreen 2d context. Scenes draw into this. */
  readonly ctx: CanvasRenderingContext2D;

  private readonly visible: HTMLCanvasElement;
  private readonly visibleCtx: CanvasRenderingContext2D;
  private readonly offscreen: HTMLCanvasElement;
  private camX = 0;
  private camY = 0;

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
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
  }

  /** Camera position (floats fine; draws snap to integers). */
  setCamera(x: number, y: number): void {
    this.camX = x;
    this.camY = y;
  }

  clear(color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  rect(x: number, y: number, w: number, h: number, color: string, ui = false): void {
    const dx = Math.round(ui ? x : x - this.camX);
    const dy = Math.round(ui ? y : y - this.camY);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(dx, dy, Math.round(w), Math.round(h));
  }

  /** Bitmap text. UI space by default; pass ui = false for world space. */
  text(str: string, x: number, y: number, color: string, scale = 1, ui = true): void {
    const dx = Math.round(ui ? x : x - this.camX);
    const dy = Math.round(ui ? y : y - this.camY);
    drawText(this.ctx, str, dx, dy, color, scale);
  }

  /** Bitmap text centered on cx. UI space by default. */
  textCentered(str: string, cx: number, y: number, color: string, scale = 1, ui = true): void {
    const dx = Math.round(ui ? cx : cx - this.camX);
    const dy = Math.round(ui ? y : y - this.camY);
    drawTextCentered(this.ctx, str, dx, dy, color, scale);
  }

  /** Blit the offscreen buffer to the visible canvas at integer scale. */
  present(): void {
    const { scale, offX, offY } = computeScale(this.visible.width, this.visible.height);
    const vctx = this.visibleCtx;
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
