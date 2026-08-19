/**
 * The end credits. Two halves, tested the way the scene is written: the roll is
 * a pure layout plus a pure offset, and the scene is `updateMenu`-free input
 * and one handover — so all of it runs headlessly through `tests/harness.ts`
 * with no canvas anywhere.
 *
 * The invariants worth holding are the ones that break silently when a line is
 * added or a constant is retuned: every line fits the view, the roll ends with
 * the sign-off at the middle of the frame rather than off the top of it, and
 * the screen the player is left on hands the run's time along instead of
 * eating it.
 */

import { describe, expect, it } from "vitest";
import {
  CREDITS_FADE,
  CREDITS_FADE_OUT,
  CREDITS_HOLD,
  CREDITS_SCRIM,
  CREDITS_SCRIM_FADE,
  CREDITS_SCROLL,
  CREDITS_STANZA_GAP,
  STEP,
  VIEW_H,
  VIEW_W,
} from "../src/constants";
import { measureText } from "../src/engine/font";
import {
  CREDITS_DURATION,
  CREDITS_FADE_AT,
  CREDITS_LINES,
  CREDITS_ROLL_END,
  CREDITS_SCRIPT,
  CREDITS_SCROLL_TIME,
  CreditsScene,
  creditLineAlpha,
  creditsFadeOut,
  creditsLayout,
  creditsRoll,
  creditsScrim,
} from "../src/scenes/credits";
import { ResultsScene } from "../src/scenes/results";
import type { ResultsStats } from "../src/scenes/results";
import { LEVELS } from "../src/levels/index";
import { fakeGame, step, tap } from "./harness";
import type { Harness } from "./harness";

function stats(): ResultsStats {
  return {
    level: LEVELS[LEVELS.length - 1],
    index: LEVELS.length - 1,
    back: null,
    timeMs: 12345,
    previousBestMs: 20000,
    isNewBest: true,
  };
}

function credits(): { h: Harness; scene: CreditsScene } {
  const h = fakeGame();
  const scene = new CreditsScene(stats(), 3.5);
  scene.enter();
  return { h, scene };
}

describe("the credits roll", () => {
  it("says what the game is called, who made it, and thanks the player", () => {
    const text = CREDITS_SCRIPT.flatMap((s) => s.lines);
    expect(text).toContain("IT'S NEVER JUST");
    expect(text).toContain("BLACK AND WHITE");
    expect(text).toContain("MADE BY TYLER HAWTHORN");
    expect(text[text.length - 1]).toBe("THANKS FOR PLAYING");
  });

  it("stores the text as it renders: the 5x7 font has no lowercase", () => {
    for (const line of CREDITS_SCRIPT.flatMap((s) => s.lines)) {
      expect(line).toBe(line.toUpperCase());
    }
  });

  it("fits every line inside the view at its own scale", () => {
    for (const line of CREDITS_LINES) {
      expect(measureText(line.text, line.scale)).toBeLessThan(VIEW_W);
    }
  });

  it("lays the stanzas out in order, with a stanza gap wider than a line gap", () => {
    const lines = creditsLayout();
    expect(lines).toHaveLength(
      CREDITS_SCRIPT.reduce((n, s) => n + s.lines.length, 0),
    );
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].y).toBeGreaterThan(lines[i - 1].y);
    }
    // The two lines of the first stanza are closer together than the first
    // stanza is to the second — otherwise it is one block of text, not stanzas.
    const within = lines[1].y - (lines[0].y + lines[0].height);
    const between = lines[2].y - (lines[1].y + lines[1].height);
    expect(between).toBe(CREDITS_STANZA_GAP);
    expect(within).toBeLessThan(between);
  });

  it("starts below the frame and runs every line off the top of it", () => {
    // At t = 0 nothing has scrolled, so the first line is at the bottom edge.
    expect(creditsRoll(0)).toBe(0);
    expect(VIEW_H + CREDITS_LINES[0].y - creditsRoll(0)).toBe(VIEW_H);
    // And when the roll is over, EVERY line is clear of the top — including
    // the sign-off, which no longer parks in the middle of the frame.
    const end = creditsRoll(CREDITS_SCROLL_TIME);
    for (const line of CREDITS_LINES) {
      expect(VIEW_H + line.y + line.height - end).toBeLessThanOrEqual(0);
    }
    expect(end).toBe(CREDITS_ROLL_END);
    expect(creditsRoll(CREDITS_SCROLL_TIME * 10)).toBe(CREDITS_ROLL_END);
  });

  it("scrolls at the stated rate, then holds empty, then fades", () => {
    expect(creditsRoll(1)).toBeCloseTo(CREDITS_SCROLL, 6);
    expect(CREDITS_FADE_AT).toBeCloseTo(CREDITS_SCROLL_TIME + CREDITS_HOLD, 6);
    expect(CREDITS_DURATION).toBeCloseTo(CREDITS_FADE_AT + CREDITS_FADE_OUT, 6);
  });

  it("fades to paper over the last stretch, and only then", () => {
    expect(creditsFadeOut(0)).toBe(0);
    // The hold is empty swirl, not a fade already under way.
    expect(creditsFadeOut(CREDITS_SCROLL_TIME + CREDITS_HOLD / 2)).toBe(0);
    expect(creditsFadeOut(CREDITS_FADE_AT)).toBe(0);
    expect(creditsFadeOut(CREDITS_FADE_AT + CREDITS_FADE_OUT / 2)).toBeCloseTo(
      0.5,
      6,
    );
    // Fully covered by the time the scene hands over, or the results screen
    // would appear through a gap in the curtain.
    expect(creditsFadeOut(CREDITS_DURATION)).toBe(1);
  });

  it("opens on the frame the ending closed on: the scrim eases in from nothing", () => {
    expect(creditsScrim(0)).toBe(0);
    expect(creditsScrim(CREDITS_SCRIM_FADE)).toBeCloseTo(CREDITS_SCRIM, 6);
    expect(creditsScrim(CREDITS_SCRIM_FADE * 5)).toBeCloseTo(CREDITS_SCRIM, 6);
    // Done before the first line has climbed out of the bottom fade, so it is
    // never the thing a reader watches arrive.
    expect(CREDITS_SCRIM_FADE).toBeLessThan(CREDITS_FADE / CREDITS_SCROLL);
  });

  it("fades at both edges and is fully opaque at the resting position", () => {
    expect(creditLineAlpha(0)).toBe(0);
    expect(creditLineAlpha(VIEW_H)).toBe(0);
    expect(creditLineAlpha(VIEW_H / 2)).toBe(1);
    expect(creditLineAlpha(CREDITS_FADE / 2)).toBeGreaterThan(0);
    expect(creditLineAlpha(CREDITS_FADE / 2)).toBeLessThan(1);
    // Half the view, or the line that stops in the middle would stop faded.
    expect(CREDITS_FADE).toBeLessThan(VIEW_H / 2);
  });
});

describe("CreditsScene", () => {
  it("rolls, holds, fades, and then hands the run to the results screen", () => {
    const { h, scene } = credits();
    step(h, scene, Math.ceil(CREDITS_FADE_AT / STEP));
    expect(h.scenes).toHaveLength(0);
    // One frame at a time over the handover: this harness does not swap the
    // scene out, so a bulk step past it would push a results screen per frame.
    step(h, scene, Math.ceil(CREDITS_FADE_OUT / STEP) - 4);
    expect(h.scenes).toHaveLength(0);
    for (let i = 0; i < 8 && h.scenes.length === 0; i++) {
      step(h, scene);
    }
    expect(h.scenes).toHaveLength(1);
    expect(h.scenes[0]).toBeInstanceOf(ResultsScene);
  });

  it("skips to the fade on the first press and out on the second", () => {
    const { h, scene } = credits();
    step(h, scene, 30);
    tap(h, scene, "Enter");
    // The screen is leaving, not gone: a skip still fades rather than cutting.
    expect(h.scenes).toHaveLength(0);
    tap(h, scene, "Enter");
    expect(h.scenes).toHaveLength(1);
    expect(h.scenes[0]).toBeInstanceOf(ResultsScene);
  });

  it("takes ESC the same way, so one key cannot cut where the other fades", () => {
    const { h, scene } = credits();
    tap(h, scene, "Escape");
    expect(h.scenes).toHaveLength(0);
    tap(h, scene, "Escape");
    expect(h.scenes[0]).toBeInstanceOf(ResultsScene);
  });

  it("carries the run through: the time is not lost to the credits", () => {
    const { h, scene } = credits();
    tap(h, scene, "Enter");
    tap(h, scene, "Enter");
    // Through the private field the results screen keeps, which is what it
    // draws — the scene has no getter, and inventing one for a test would be a
    // wider API than the handover needs.
    const results = h.scenes[0] as unknown as { stats: ResultsStats };
    expect(results.stats.timeMs).toBe(12345);
    expect(results.stats.isNewBest).toBe(true);
  });

  it("still toggles mute, like every other screen", () => {
    const { h, scene } = credits();
    expect(h.audio.muted).toBe(false);
    tap(h, scene, "KeyM");
    expect(h.audio.muted).toBe(true);
    expect(h.scenes).toHaveLength(0);
  });
});
