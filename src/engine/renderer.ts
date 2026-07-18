/**
 * Offscreen 480×270 pixel canvas, integer-scaled to the visible canvas with
 * letterboxing. Constructing a Renderer requires a DOM (browser only), but
 * computeScale is pure and node-tested. All draws snap to integer pixels.
 */

import { VIEW_H, VIEW_W } from '../constants';
import { drawText, drawTextCentered } from './font';
import { buildSpriteCache } from './sprites';
import type { SpriteName } from './sprites';

/** Letterbox bar color (background void, GAME-DESIGN §2). */
export const LETTERBOX_COLOR = '#0B1120';

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

export interface SpriteDrawOpts {
  flipX?: boolean;
  ui?: boolean;
  alpha?: number;
}

export class Renderer {
  /** Offscreen 2d context (480×270, smoothing off). Scenes draw into this. */
  readonly ctx: CanvasRenderingContext2D;

  private readonly visible: HTMLCanvasElement;
  private readonly visibleCtx: CanvasRenderingContext2D;
  private readonly offscreen: HTMLCanvasElement;
  private sprites: Map<SpriteName, HTMLCanvasElement> | null = null;
  private mirrored: Map<SpriteName, HTMLCanvasElement> | null = null;
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

  sprite(name: SpriteName, x: number, y: number, opts?: SpriteDrawOpts): void {
    const flip = opts?.flipX === true;
    const cache = flip ? this.mirroredCache() : this.spriteCache();
    const img = cache.get(name);
    if (!img) {
      return;
    }
    const dx = Math.round(opts?.ui ? x : x - this.camX);
    const dy = Math.round(opts?.ui ? y : y - this.camY);
    const alpha = opts?.alpha;
    if (alpha !== undefined && alpha < 1) {
      this.ctx.globalAlpha = Math.max(0, alpha);
      this.ctx.drawImage(img, dx, dy);
      this.ctx.globalAlpha = 1;
    } else {
      this.ctx.drawImage(img, dx, dy);
    }
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
    vctx.fillStyle = LETTERBOX_COLOR;
    vctx.fillRect(0, 0, this.visible.width, this.visible.height);
    vctx.drawImage(this.offscreen, offX, offY, VIEW_W * scale, VIEW_H * scale);
  }

  /** Size the visible canvas to the window and re-present. */
  fitToWindow(win: Window): void {
    this.visible.width = win.innerWidth;
    this.visible.height = win.innerHeight;
    this.present();
  }

  private spriteCache(): Map<SpriteName, HTMLCanvasElement> {
    if (!this.sprites) {
      this.sprites = buildSpriteCache();
    }
    return this.sprites;
  }

  private mirroredCache(): Map<SpriteName, HTMLCanvasElement> {
    if (!this.mirrored) {
      const out = new Map<SpriteName, HTMLCanvasElement>();
      for (const [name, img] of this.spriteCache()) {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Renderer: 2d context unavailable for mirrored sprite');
        }
        ctx.imageSmoothingEnabled = false;
        ctx.translate(img.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0);
        out.set(name, canvas);
      }
      this.mirrored = out;
    }
    return this.mirrored;
  }
}
