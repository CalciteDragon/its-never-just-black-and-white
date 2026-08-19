/**
 * The end credits: what the game says after the colour has taken the screen.
 *
 * It comes up on the SAME swirl the ending settled on — `drawFinaleSweep`, at
 * full alpha, on the clock `PlayScene` hands over — so the scene change lands
 * on a frame where nothing moves. The last six seconds of the finale were one
 * unbroken transition, and a credits screen that started its own sweep from
 * zero would put a cut at the end of it.
 *
 * The words SCROLL rather than cutting from card to card, for the same reason:
 * there has not been an edit since the goal, and there should not be one here.
 * They scroll all the way OUT, too — every line arrives and leaves the same way,
 * which is what makes it a roll rather than a slideshow with a last slide. What
 * the sign-off leaves behind is the screen the ending made, with nothing on it
 * again, and after a moment of that the whole thing fades to `paper` and the
 * results screen is already there underneath.
 *
 * There is no drop shadow under the text; the scrim is what buys it contrast.
 *
 * The layout is pure and separate from the scene (`creditsLayout`,
 * `creditsRoll`, `creditsFadeOut`, `creditLineAlpha`) — the shape of a roll is
 * exactly the sort of thing that drifts when a line is added, and asserting it
 * should not need a canvas. Node-safe throughout; only `render` touches the
 * renderer it is given.
 */

import {
  CREDITS_FADE,
  CREDITS_FADE_OUT,
  CREDITS_HOLD,
  CREDITS_LINE_GAP,
  CREDITS_SCRIM,
  CREDITS_SCRIM_FADE,
  CREDITS_SCROLL,
  CREDITS_STANZA_GAP,
  VIEW_H,
  VIEW_W,
} from "../constants";
import { GLYPH_HEIGHT } from "../engine/font";
import { palette } from "../engine/palette";
import type { Renderer } from "../engine/renderer";
import type { Game, Scene } from "../game";
import { drawFinaleSweep } from "./finale";
import { ResultsScene } from "./results";
import type { ResultsStats } from "./results";

/**
 * The script, in stanzas. A stanza is the unit that holds together on screen,
 * and its `scale` is how loudly it is said: the title at 5, because it is the
 * title and the player has just finished proving it; the line that answers it
 * and the names at 3; the tools at 2, which is a footnote and should read as
 * one; the sign-off at 4.
 *
 * The 5×7 font has no lowercase — `glyphFor` folds it — so the text is stored
 * as it renders rather than as it was typed. A string carrying case the font
 * cannot show is a string that lies to whoever edits it next.
 */
export interface CreditStanza {
  readonly scale: number;
  readonly lines: readonly string[];
}

export const CREDITS_SCRIPT: readonly CreditStanza[] = [
  { scale: 5, lines: ["IT'S NEVER JUST", "BLACK AND WHITE"] },
  { scale: 3, lines: ["NOTHING EVER HAS", "JUST TWO SIDES"] },
  { scale: 3, lines: ["MADE BY TYLER HAWTHORN", "AKA CALCITE"] },
  { scale: 2, lines: ["MADE WITH VITE + NODE"] },
  { scale: 4, lines: ["THANKS FOR PLAYING"] },
];

/** One line of the roll, with its `y` measured from the top of the whole roll. */
export interface CreditLine {
  readonly text: string;
  readonly scale: number;
  /** Top of the glyph line, in px from the top of the roll. */
  readonly y: number;
  /** `GLYPH_HEIGHT * scale`, kept so callers never re-derive it. */
  readonly height: number;
}

/**
 * The script laid out as a single column of lines. Pure, and computed once at
 * module load: the roll has no state, only an offset into this.
 */
export function creditsLayout(
  script: readonly CreditStanza[] = CREDITS_SCRIPT,
): CreditLine[] {
  const out: CreditLine[] = [];
  let y = 0;
  for (let s = 0; s < script.length; s++) {
    const { scale, lines } = script[s];
    const height = GLYPH_HEIGHT * scale;
    for (let i = 0; i < lines.length; i++) {
      out.push({ text: lines[i], scale, y, height });
      y += height + (i < lines.length - 1 ? CREDITS_LINE_GAP : 0);
    }
    if (s < script.length - 1) {
      y += CREDITS_STANZA_GAP;
    }
  }
  return out;
}

export const CREDITS_LINES: readonly CreditLine[] = creditsLayout();

/**
 * How far the roll has to travel to be OVER: the offset at which the bottom of
 * the last line clears the top of the view. A line's screen position is
 * `VIEW_H + line.y - roll`, so the roll starts with everything one full frame
 * below the bottom edge and ends with everything one line above the top of it.
 *
 * The roll runs all the way out rather than parking the sign-off in the middle
 * of the frame. Every line arrives and leaves the same way, which is what makes
 * it a roll and not a slideshow with a last slide — and what it leaves behind
 * is the screen the ending made, with nothing on it again.
 */
export const CREDITS_ROLL_END = ((): number => {
  const last = CREDITS_LINES[CREDITS_LINES.length - 1];
  return VIEW_H + last.y + last.height;
})();

/** Scrolling, then the empty hold, then the fade — as absolute times from 0. */
export const CREDITS_SCROLL_TIME = CREDITS_ROLL_END / CREDITS_SCROLL;
export const CREDITS_FADE_AT = CREDITS_SCROLL_TIME + CREDITS_HOLD;
export const CREDITS_DURATION = CREDITS_FADE_AT + CREDITS_FADE_OUT;

/** How far the roll has travelled at `t` seconds, clamped once it is over. */
export function creditsRoll(t: number): number {
  const d = t * CREDITS_SCROLL;
  return d > 0 ? (d < CREDITS_ROLL_END ? d : CREDITS_ROLL_END) : 0;
}

/**
 * The `paper` wash that closes the screen, 0 until `CREDITS_FADE_AT` and 1 at
 * the end. Linear, not smoothed: this one is a curtain rather than a
 * transition, and an eased curtain hangs at both ends where it should be gone.
 */
export function creditsFadeOut(t: number): number {
  const p = (t - CREDITS_FADE_AT) / CREDITS_FADE_OUT;
  return p > 0 ? (p < 1 ? p : 1) : 0;
}

/** 0 below `a`, 1 above `b`, smooth in between. */
function smoothstep(a: number, b: number, x: number): number {
  const t = b > a ? (x - a) / (b - a) : x >= b ? 1 : 0;
  const c = t > 0 ? (t < 1 ? t : 1) : 0;
  return c * c * (3 - 2 * c);
}

/**
 * The `paper` wash under the words, easing in from nothing over the first
 * `CREDITS_SCRIM_FADE` seconds — so the credits open on exactly the frame the
 * ending closed on, and the one thing this screen adds to it arrives too slowly
 * to be an edit.
 */
export function creditsScrim(t: number): number {
  return CREDITS_SCRIM * smoothstep(0, CREDITS_SCRIM_FADE, t);
}

/**
 * A line's alpha, from the centre of its glyph row — so it fades in over the
 * bottom edge and out over the top instead of being cut in half mid-glyph. The
 * resting position is the middle of the frame, where this is 1 by construction
 * as long as the fade band is under half the view.
 */
export function creditLineAlpha(centerY: number): number {
  return Math.min(
    smoothstep(0, CREDITS_FADE, centerY),
    smoothstep(0, CREDITS_FADE, VIEW_H - centerY),
  );
}

export class CreditsScene implements Scene {
  private readonly stats: ResultsStats;
  /**
   * The swirl's clock, CONTINUED from the play scene rather than started here.
   * It is presentation only — the same raw accumulator `PlayScene` fed the
   * ending, and nothing on this screen feeds a simulation.
   */
  private clock: number;
  private t = 0;

  constructor(stats: ResultsStats, clock = 0) {
    this.stats = stats;
    this.clock = clock;
  }

  /**
   * Back to phase A, like every other screen off the run: the palette is the
   * only readout of GRAVITY there is (GAME-DESIGN §2), and there is none here.
   * The scrim, the words and the vignette all read from it — the swirl does
   * not, which is the whole point of `spectrum`.
   */
  enter(): void {
    palette.reset();
  }

  update(dt: number, game: Game): void {
    this.clock += dt;
    this.t += dt;
    const input = game.input;
    if (input.pressed("mute")) {
      game.toggleMute();
    }
    // One press starts the fade, the next ends the screen. So a skip still
    // LEAVES rather than cutting — the player who wants out gets out, and the
    // game's last frame is the same fade either way.
    if (input.pressed("confirm") || input.pressed("back")) {
      if (this.t < CREDITS_FADE_AT) {
        this.t = CREDITS_FADE_AT;
      } else {
        this.finish(game);
        return;
      }
    }
    if (this.t >= CREDITS_DURATION) {
      this.finish(game);
    }
  }

  /**
   * The results screen the finale's `finish` would have gone to, with the run
   * it measured intact. The credits are inserted BEFORE it, not instead of it:
   * a time is still a time, and the last level's is the one worth keeping.
   */
  private finish(game: Game): void {
    game.setScene(new ResultsScene(this.stats));
  }

  render(r: Renderer, game: Game): void {
    r.setCamera(0, 0);
    r.clear(palette.paper);
    drawFinaleSweep(r, this.clock, 1);
    // Under the words, over the swirl. `ui` is true: this screen has no camera.
    r.rect(0, 0, VIEW_W, VIEW_H, palette.paperRgba(creditsScrim(this.t)), true);

    const roll = creditsRoll(this.t);
    for (const line of CREDITS_LINES) {
      const y = VIEW_H + line.y - roll;
      if (y + line.height < 0 || y > VIEW_H) {
        continue;
      }
      const a = creditLineAlpha(y + line.height / 2);
      if (a <= 0) {
        continue;
      }
      r.textCentered(line.text, VIEW_W / 2, y, palette.inkRgba(a), line.scale);
    }

    if (game.audio.muted) {
      r.text("MUTED", 16, 16, palette.ink);
    }
    // The curtain, over everything including the indicator: the whole screen
    // leaves, not the swirl with a readout still floating on top of it.
    const out = creditsFadeOut(this.t);
    if (out > 0) {
      r.rect(0, 0, VIEW_W, VIEW_H, palette.paperRgba(out), true);
    }
    // And NO post pass, which is the one place this screen breaks with every
    // other shell screen. `applyPost(0)` is still a `VIGNETTE_MIN` darkening at
    // the corners, and there is no way to ask for less of it — so a credits
    // screen that wore the standard frame would drop a vignette onto the frame
    // the ending had just finished clearing, on the very frame it took over.
    // The first frame of the credits is the last frame of the ending, exactly,
    // and staying that way is worth more here than matching the menus.
  }
}
