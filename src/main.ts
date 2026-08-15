/**
 * Browser bootstrap: canvas wiring, resize handling, fullscreen toggle, and
 * the title scene.
 */

import { Game } from './game';
import { TitleScene } from './scenes/title';

declare global {
  interface Window {
    /** Dev hook for automated driving (hidden tabs suspend RAF). */
    __bw?: { game: Game };
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
game.input.attach(window);

// Refit only on real size changes. A ResizeObserver on the root element also
// fires once immediately, which covers embedded panes that lay out after load
// (a plain 'resize' listener can miss that first sizing entirely).
let lastW = -1;
let lastH = -1;
const fit = (): void => {
  if (window.innerWidth !== lastW || window.innerHeight !== lastH) {
    lastW = window.innerWidth;
    lastH = window.innerHeight;
    game.renderer.fitToWindow(window);
  }
};
window.addEventListener('resize', fit);
new ResizeObserver(fit).observe(document.documentElement);
fit();

// Fullscreen on F (kept out of scenes: it's pure browser chrome).
window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.code !== 'KeyF' || e.repeat) {
    return;
  }
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  } else {
    void document.documentElement.requestFullscreen().catch(() => undefined);
  }
});

game.setScene(new TitleScene());
game.start();
window.__bw = { game };
