import { VIEW_W, VIEW_H } from './constants';

// Temporary scaffold boot: proves the canvas + build pipeline works.
// Replaced by the real Game bootstrap in later phases.
const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.width = VIEW_W * 2;
canvas.height = VIEW_H * 2;
const ctx = canvas.getContext('2d');
if (ctx) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#0B1120';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#22D3EE';
  ctx.font = '16px monospace';
  ctx.fillText('PIXEL QUEST — scaffold OK', 24, 48);
}
