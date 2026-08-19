/**
 * THE WIND-UP TUNER — a dev-only DOM panel for the GAME-DESIGN §7 numbers
 * that can only be judged by playing: what counts as fast, how long that has to
 * hold before the effects start, how slowly they arrive once they do, and what
 * being faster or slower than the threshold is worth to the bank.
 *
 * Browser-only, and deliberately outside `src/engine/`: it reaches into the
 * live scene to read the wind-up bank, and an engine module that knew about a
 * scene would invert the layering the whole project is built on. It sits beside
 * `main.ts` instead, which is the other module allowed to know a document
 * exists. Nothing imports it except `main.ts`, and `main.ts` mounts it only
 * behind `?tune=1` — so a build that is never asked for it never runs a line of
 * this file.
 *
 * It writes to `engine/tuning.ts` and nowhere else. When the feel is right,
 * COPY CONSTANTS puts the paste-ready `constants.ts` lines on the clipboard;
 * the tuner never edits the game.
 */

import { SPEED_REF } from './constants';
import { copyToClipboard, detectClipboard } from './engine/levelio';
import { palette } from './engine/palette';
import { resetWindup, setWindup, windup, windupSource } from './engine/tuning';
import type { WindupTuning } from './engine/tuning';
import type { Game, Scene } from './game';
import { windupFillRate, windupGate } from './scenes/play';

/** Toggles the panel. Not a game binding, and not one the editor reads. */
const TOGGLE_CODE = 'Backquote';

/** The part of `PlayScene.status` the readout needs. */
interface Readout {
  readonly windupSec: number;
  readonly windupIdleSec: number;
  readonly speedNorm: number;
  readonly vx: number;
  readonly vy: number;
}

/**
 * The live numbers, or null when the scene on screen isn't a level.
 *
 * Shape, not `instanceof PlayScene`, and the reason is the dev server this
 * panel only ever runs under: an HMR update re-fetches a module under a new URL
 * and the class identity moves with it, so a scene built before the reload
 * fails `instanceof` against the class imported after it and the panel goes
 * blind exactly when someone is mid-session and editing. A duck-typed read
 * cannot rot that way, and `status` is a debug surface already.
 */
function readScene(scene: Scene | null): Readout | null {
  const status = (scene as { status?: unknown } | null)?.status;
  if (typeof status !== 'object' || status === null) {
    return null;
  }
  const s = status as Partial<Readout>;
  const ok =
    typeof s.windupSec === 'number' &&
    typeof s.windupIdleSec === 'number' &&
    typeof s.speedNorm === 'number' &&
    typeof s.vx === 'number' &&
    typeof s.vy === 'number';
  return ok ? (s as Readout) : null;
}

interface Row {
  readonly key: keyof WindupTuning;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
}

const ROWS: readonly Row[] = [
  { key: 'min', label: 'MIN', min: 0, max: 1, step: 0.01, unit: `of ${SPEED_REF} px/s` },
  { key: 'delay', label: 'DELAY', min: 0, max: 8, step: 0.05, unit: 's of speed' },
  { key: 'ramp', label: 'RAMP', min: 0.05, max: 10, step: 0.05, unit: 's to full' },
  { key: 'fillBias', label: 'FILL', min: 0, max: 4, step: 0.05, unit: '× at full speed' },
  { key: 'drainDelay', label: 'GRACE', min: 0, max: 5, step: 0.05, unit: 's before drain' },
  { key: 'drainRate', label: 'DRAIN', min: 0, max: 4, step: 0.05, unit: '× once draining' },
];

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.setAttribute('style', style);
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/**
 * Mount the panel. Returns a disposer, so whatever mounts it can also take it
 * away — a listener with no way off the window is how a dev tool becomes
 * permanent by accident.
 */
export function mountDevTuner(game: Game, doc: Document, win: Window): () => void {
  const root = el(
    doc,
    'div',
    [
      'position:fixed;top:10px;left:10px;z-index:10',
      'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
      'padding:10px 12px;border-width:2px;border-style:solid',
      'min-width:290px;letter-spacing:0.04em',
    ].join(';'),
  );

  const head = el(doc, 'div', 'display:flex;justify-content:space-between;margin-bottom:8px');
  head.append(
    el(doc, 'strong', 'letter-spacing:0.12em', 'WIND-UP TUNER'),
    el(doc, 'span', 'opacity:0.6', '` hides'),
  );
  root.append(head);

  // --- The sliders. Range and box stay in sync both ways: the slider is for
  // feel, the box is for saying 2.25 exactly. ---
  const fields = new Map<keyof WindupTuning, { range: HTMLInputElement; box: HTMLInputElement }>();

  const sync = (): void => {
    for (const row of ROWS) {
      const f = fields.get(row.key);
      if (!f) {
        continue;
      }
      const v = windup[row.key];
      f.range.value = String(v);
      // Not while the box is being typed into, or a half-finished keystroke
      // ("2." on the way to "2.5") gets rewritten under the cursor.
      if (doc.activeElement !== f.box) {
        f.box.value = String(v);
      }
    }
  };

  for (const row of ROWS) {
    const line = el(doc, 'label', 'display:block;margin:6px 0');
    const top = el(doc, 'div', 'display:flex;justify-content:space-between');
    top.append(
      el(doc, 'span', 'font-weight:700', row.label),
      el(doc, 'span', 'opacity:0.6', row.unit),
    );

    const controls = el(doc, 'div', 'display:flex;gap:8px;align-items:center');
    const range = el(doc, 'input', 'flex:1;min-width:0;accent-color:currentColor');
    range.type = 'range';
    range.min = String(row.min);
    range.max = String(row.max);
    range.step = String(row.step);

    const box = el(
      doc,
      'input',
      'width:64px;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;padding:1px 4px',
    );
    box.type = 'number';
    box.min = String(row.min);
    box.max = String(row.max);
    box.step = String(row.step);

    const write = (raw: string): void => {
      setWindup({ ...windup, [row.key]: Number.parseFloat(raw) });
      sync();
    };
    range.addEventListener('input', () => write(range.value));
    box.addEventListener('change', () => write(box.value));

    controls.append(range, box);
    line.append(top, controls);
    root.append(line);
    fields.set(row.key, { range, box });
  }

  // --- The readout: what those numbers are doing to the run in progress.
  // Tuning a two-second delay blind is guesswork; watching the bank fill while
  // you hold a run is the whole reason this beats editing constants.ts. ---
  const readout = el(doc, 'div', 'margin-top:8px;white-space:pre', '');
  const track = el(doc, 'div', 'height:6px;margin:5px 0 9px;border:1px solid currentColor');
  const fill = el(doc, 'div', 'height:100%;width:0%;background:currentColor');
  track.append(fill);

  const btnStyle =
    'font:inherit;letter-spacing:inherit;color:inherit;background:transparent;border:1px solid currentColor;padding:3px 8px;cursor:pointer';
  const buttons = el(doc, 'div', 'display:flex;gap:8px');
  const copy = el(doc, 'button', btnStyle, 'COPY CONSTANTS');
  const reset = el(doc, 'button', btnStyle, 'RESET');
  buttons.append(copy, reset);

  const note = el(doc, 'div', 'margin-top:6px;min-height:1.5em;opacity:0.75', '');
  root.append(readout, track, buttons, note);

  copy.addEventListener('click', () => {
    const text = windupSource();
    void copyToClipboard(detectClipboard(), text).then((ok) => {
      // The console line is not a nicety. The clipboard is refused on a LAN
      // address and in a tab that has had no gesture, and losing a tuning
      // session to that would be absurd, so it is printed either way.
      console.info(`[wind-up tuner]\n${text}`);
      note.textContent = ok ? 'copied, and logged to the console' : 'clipboard refused — see console';
    });
  });
  reset.addEventListener('click', () => {
    resetWindup();
    sync();
    note.textContent = 'back to the shipped values';
  });

  // Keys and pointer events stop here. `Input.attach` listens on the window in
  // the bubble phase, so without this the arrow keys that nudge a slider also
  // drive the square, and a slider drag paints in the editor.
  for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointermove']) {
    root.addEventListener(type, (e: Event) => e.stopPropagation());
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === TOGGLE_CODE && !e.repeat) {
      root.style.display = root.style.display === 'none' ? 'block' : 'none';
    }
  };
  win.addEventListener('keydown', onKey);

  // --- The panel wears the palette, so it flips with the game. Two colours,
  // structurally (hard rule 6): even the dev chrome asks for tokens rather than
  // naming a colour of its own. ---
  const pct = (n: number): string => `${(n * 100).toFixed(0).padStart(3, ' ')}%`;
  let raf = 0;
  const tick = (): void => {
    raf = win.requestAnimationFrame(tick);
    if (root.style.display === 'none') {
      return;
    }
    root.style.background = palette.paper;
    root.style.color = palette.ink;
    root.style.borderColor = palette.ink;

    const st = readScene(game.activeScene);
    if (st === null) {
      readout.textContent = 'not in a level —\nthe bank only fills while playing';
      fill.style.width = '0%';
      return;
    }
    const gate = windupGate(st.windupSec);
    const raw = Math.min(1, Math.hypot(st.vx, st.vy) / SPEED_REF);
    const full = windup.delay + windup.ramp;
    // What the bank is doing RIGHT NOW and at what rate — the three states are
    // exactly the three the tuning can produce, and naming them is what makes a
    // grace period visible at all. It does nothing you can otherwise see.
    const grace = windup.drainDelay - st.windupIdleSec;
    const rate =
      raw >= windup.min
        ? `banking ${windupFillRate(raw).toFixed(2)}×`
        : grace > 0
          ? `held ${grace.toFixed(2)}s`
          : `draining ${windup.drainRate.toFixed(2)}×`;
    readout.textContent =
      `speed ${raw.toFixed(2)}  ${rate}\n` +
      `bank  ${st.windupSec.toFixed(2)}s of ${full.toFixed(2)}s\n` +
      `gate ${pct(gate)}   effects ${pct(st.speedNorm)}`;
    fill.style.width = `${(gate * 100).toFixed(1)}%`;
  };

  sync();
  note.textContent = 'RESET returns the shipped values';
  doc.body.append(root);
  raf = win.requestAnimationFrame(tick);

  return (): void => {
    win.cancelAnimationFrame(raf);
    win.removeEventListener('keydown', onKey);
    root.remove();
  };
}
