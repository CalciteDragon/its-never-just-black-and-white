/**
 * Browser bootstrap: canvas wiring, resize handling, fullscreen toggle, and
 * the title scene.
 */

import { Game } from './game';
import { EditorScene, draftFromSave } from './scenes/editor';
import { TitleScene } from './scenes/title';

declare global {
  interface Window {
    /** Dev hook for automated driving (hidden tabs suspend RAF). */
    __bw?: { game: Game };
  }
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
game.input.attach(window, canvas);

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

// `?editor=1` boots straight into the editor (GAME-DESIGN §10), onto the
// autosaved draft if there is one. It is also phase 6's flagged autoplay trap:
// the AudioContext is suspended until a gesture, and the editor is silent
// anyway, so the first playtest is what has to resync onto the grid.
const params = new URLSearchParams(window.location.search);
const wantsEditor = params.get('editor') === '1';

// `?tune=1` mounts the wind-up tuner (src/devtuner.ts) over the canvas. Behind
// a flag and dynamically imported, so the panel's DOM and its palette polling
// are not in the bundle a player downloads.
if (params.get('tune') === '1') {
  void import('./devtuner').then(({ mountDevTuner: mount }) => mount(game, document, window));
}
game.setScene(
  wantsEditor ? new EditorScene(draftFromSave(game.save) ?? undefined) : new TitleScene(),
);
game.start();
window.__bw = { game };
