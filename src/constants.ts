/**
 * All global tuning constants live here, commented with units.
 * Values are the GAME-DESIGN §6 design targets; the phase that owns a block
 * appends it.
 */

/** Internal render resolution (px). The world renders at this size, then integer-scales up. */
export const VIEW_W = 960;
export const VIEW_H = 540;

/** Tile size (px). 960×540 is a 30 × 16.875 tile viewport. */
export const TILE = 32;

/** Fixed simulation timestep (seconds). */
export const STEP = 1 / 60;

// --- Player kinematics (GAME-DESIGN §6). Units: px, px/s, px/s², seconds. ---

/**
 * Player square edge (px). Its diagonal is 28.3 px in a 32 px gap — 3.7 px of
 * clearance at the worst angle. Hard ceiling is TILE/√2 = 22.6; above that,
 * one-tile gaps become angle-dependent and every level breaks.
 */
export const PLAYER_SIZE = 20;
/** Horizontal run speed (px/s) = 8 tiles/s. */
export const RUN_SPEED = 256;
/** Ground acceleration toward run speed (px/s²) — full speed in ~0.12 s. */
export const GROUND_ACCEL = 2100;
/** Air acceleration (px/s²) ≈ 62% of ground control. */
export const AIR_ACCEL = 1300;
/** Deceleration when no input is held on the ground (px/s²) — stop in ~0.07 s. */
export const GROUND_FRICTION = 3600;
/** Gravity while rising (px/s², along gravitySign). */
export const GRAVITY_RISE = 2200;
/** Gravity while falling (px/s²) — 1.6× heavier descending. */
export const GRAVITY_FALL = 3520;
/** Terminal fall speed (px/s) = 24 tiles/s. */
export const MAX_FALL_SPEED = 768;
/** Jump impulse (px/s, against gravity). Peak = v²/2g ≈ 3.48 tiles. */
export const JUMP_VELOCITY = 700;
/** Grace period after leaving a ledge during which jump still works (s). */
export const COYOTE_TIME = 0.09;
/** Early jump press is honored if landing within this window (s). */
export const JUMP_BUFFER = 0.12;
/** Releasing jump while rising multiplies vy by this, once. */
export const JUMP_CUT_FACTOR = 0.45;
/** Max movement per physics sub-step (px) — prevents tunneling. */
export const MAX_SUBSTEP = 8;

/**
 * Inset of the player's paper core from each edge (px), rotating with the body
 * (GAME-DESIGN §2). It is what keeps an ink square legible against ink geometry,
 * and the only visual tell of the body's angle.
 */
export const PLAYER_CORE_INSET = 5;

// --- Angular motion (GAME-DESIGN §6). Units: rad, rad/s, rad/s², 1/s. ---

/**
 * Moment of inertia of a square lamina of side `s` about its centre, at unit
 * mass. Exported as a function so PLAYER_INERTIA and the solver share one
 * derivation: a literal 66.7 could silently disagree with PLAYER_SIZE, and
 * every angular result in the game scales with that ratio.
 */
export function inertiaOfSquare(s: number): number {
  return (s * s) / 6;
}

/** Player moment of inertia = PLAYER_SIZE² / 6 ≈ 66.7 at unit mass. */
export const PLAYER_INERTIA = inertiaOfSquare(PLAYER_SIZE);

/**
 * A contact normal within ≈45° of "up" counts as ground. Tiles are axis-aligned
 * but the box is not: balanced on a corner, the box contacts along one of its
 * own face normals, up to 45° off vertical. Standing there is the moment the
 * game is showing off, so it counts.
 */
export const GROUND_NORMAL_DOT = 0.7;
/** Angular velocity imparted by a standing jump (rad/s). */
export const JUMP_SPIN_BASE = 2.5;
/** Extra jump spin per px/s of horizontal speed (rad/s per px/s). */
export const JUMP_SPIN_PER_SPEED = 0.014;
/** Angular velocity imparted by a flip (rad/s). Phase 5 spends it. */
export const FLIP_SPIN_KICK = 3.0;
/** Hard clamp on |angVel| (rad/s). */
export const MAX_ANG_SPEED = 14;
/** Exponential angular damping in flight (1/s) — light: a jump keeps its spin. */
export const ANG_DAMP_AIR = 0.4;
/** Exponential angular damping on a step that landed an impact (1/s). */
export const ANG_DAMP_GROUND = 8;
/** Restoring spring toward the nearest multiple of 90° (rad/s²). */
export const RIGHT_STIFFNESS = 240;
/** Spring damping (1/s) ≈ 2√RIGHT_STIFFNESS — critically damped, no overshoot. */
export const RIGHT_DAMPING = 31;
/**
 * Fraction of the physically exact collision torque actually applied. An
 * admitted cheat: exact torque whirls the square off every graze.
 */
export const SPIN_TRANSFER = 0.6;
/** No bounce. Impacts spin you; they never launch you. */
export const RESTITUTION = 0.0;

// --- Solver internals (world/physics.ts, PHASES phase 4). ---

/**
 * Residual penetration left by positional correction (px). Correcting to
 * exactly this makes rest a fixed point rather than an asymptote.
 */
export const CONTACT_SLOP = 0.01;
/**
 * Depth window (px) within which contact candidates count as tied and merge
 * into their centroid. At PLAYER_SIZE this is a tie band of
 * asin(0.25/20) = ±0.72° — below the settled angular residual, and far below
 * any tilt a player could see. It is what lets a flat square land flat: both
 * bottom corners tie, the contact point is the face centre, r × n is exactly
 * zero, and the landing produces no torque at all.
 */
export const CONTACT_TOL = 0.25;
/**
 * Tangential slack (px) on clipping contact candidates to the incident face.
 *
 * Distinct from CONTACT_TOL, and necessarily larger: that one is a depth band,
 * this one is a tangential one, and it is sized by how far a resting body sinks
 * into the floor before its contact is resolved — GRAVITY_FALL · STEP² / 2 =
 * 0.489 px, every step, forever. Deepest-first can evaluate a wall contact
 * while the box is down there, and the box's lower corner is then that far
 * below the bottom of the wall tile. Clipped strictly it is discarded, the wall
 * contact degenerates to the single upper corner, and walking into a wall
 * answers with 3.7 rad/s of spin conjured out of resting slop alone. Two steps'
 * worth, for margin; at 1 px on a 32 px tile the ledge cases are untouched.
 */
export const CLIP_TOL = GRAVITY_FALL * STEP * STEP + CONTACT_SLOP;
/**
 * Contact resolution passes per sub-step. Four is a natural cap once contacts
 * are merged into manifolds: there are only four tile-axis normals.
 */
export const MAX_CONTACT_ITERS = 4;
/**
 * Approach speed (px/s) above which a contact is a genuine impact rather than
 * resting or scraping. Twice the largest approach speed gravity alone can build
 * in one step, i.e. a 1.96 px drop. One threshold, two jobs: above it, impacts
 * own the spin and the auto-right spring is suppressed for that step; below it,
 * the contact is a linear stop only and the spring owns settling.
 *
 * A resting contact is still a contact — gravity re-penetrates a resting body
 * by 0.489 px every step — so "a contact resolved this step" is permanently
 * true on the ground and cannot be the discriminator.
 */
export const IMPACT_SPEED_MIN = 2 * GRAVITY_FALL * STEP;
/**
 * Angle error (rad) under which a grounded, near-still body snaps to its target
 * angle. At 0.002 rad a corner of the square moves 0.028 px, so the snap the
 * design otherwise forbids is a third of a pixel below visible.
 */
export const ANG_SETTLE_EPS = 0.002;
/** Angular speed (rad/s) under which that snap is allowed. */
export const ANG_SETTLE_VEL = 0.05;

// --- Camera (world/camera.ts). ---

/** Exponential follow rate (1/s): higher = tighter tracking. */
export const CAMERA_FOLLOW_RATE = 8;
/** Lookahead distance is vx × this (s) — the view leads where you're going. */
export const LOOKAHEAD_TIME = 0.35;
/** Cap on the lookahead offset (px). At RUN_SPEED the raw offset saturates. */
export const LOOKAHEAD_MAX = 96;
/**
 * Smoothing rate of the lookahead offset itself (1/s). Deliberately slower than
 * CAMERA_FOLLOW_RATE: a direction reversal is a 192 px swing in the target, and
 * lagging it is what turns a whip into a slide.
 */
export const LOOKAHEAD_RATE = 3;
/**
 * Allowed vertical overshoot past the map's top and bottom (px). Not a hard
 * clamp — gravity flips, so both edges are lethal, and the frame before an
 * out-of-bounds death has to stay legible instead of clipping off a pinned edge.
 */
export const CAMERA_VSLACK = 64;

// --- Level boundary feedback (scenes/tiledraw.ts). Units: px. ---

/** Edge of each square dot marking space outside the authored level footprint. */
export const OUT_OF_BOUNDS_DOT_SIZE = 2;
/** Centre-to-centre pitch of the boundary pattern; half a tile keeps it readable at speed. */
export const OUT_OF_BOUNDS_DOT_SPACING = TILE / 2;
/** Ink alpha of the dots, visible without competing with solid level geometry. */
export const OUT_OF_BOUNDS_DOT_ALPHA = 0.22;

// --- Feel & effects (GAME-DESIGN §6/§7). One speedNorm drives all of them. ---

/** Speed (px/s) that normalises to speedNorm 1.0 for every effect. */
export const SPEED_REF = 320;
/** Exponential lag on speedNorm (1/s) — one frame of wall contact can't strobe. */
export const SPEED_SMOOTH_RATE = 6;
/*
 * The effect WIND-UP (GAME-DESIGN §7). Speed alone no longer buys the effects:
 * the scene banks seconds spent at or above SPEED_WINDUP_MIN, and the whole
 * effect stack — vignette, tint, aberration, screen bounce, music bed — is
 * scaled by a gate that is exactly 0 until SPEED_WINDUP_DELAY of that bank and
 * only reaches 1 SPEED_WINDUP_RAMP later. A burst of speed between two ledges
 * is therefore invisible; a sustained run is what escalates.
 *
 * Filling and draining are separately shaped, because they are separate
 * questions. Filling is scaled by how far over the threshold you are
 * (SPEED_WINDUP_FILL_BIAS). Draining waits SPEED_WINDUP_DRAIN_DELAY before it
 * starts — the grace that stops a landing or a wall bump costing anything at
 * all — and then runs at SPEED_WINDUP_DRAIN_RATE. The fill ships neutral (a
 * flat bank that only asks *whether* you were fast); the drain ships with a
 * short grace and at double rate, so a stumble is forgiven and a stop is not.
 */
/** speedNorm at or above which the wind-up bank fills rather than drains. */
export const SPEED_WINDUP_MIN = 0.7;
/** Seconds banked before any speed effect is non-zero. */
export const SPEED_WINDUP_DELAY = 2.0;
/** Seconds from the gate opening to full strength — deliberately slow. */
export const SPEED_WINDUP_RAMP = 7.0;
/**
 * How fast the bank fills at FULL speed, as a multiple of real time. The rate
 * lerps from 1× at exactly `SPEED_WINDUP_MIN` to this at speedNorm 1, so above
 * 1 a flat-out run is worth more than a jog-just-over-the-line and below 1 it
 * is worth less. Exactly 1 is a flat bank that only asks *whether* you were
 * fast, which is where the wind-up started.
 */
export const SPEED_WINDUP_FILL_BIAS = 1.0;
/** Seconds below the threshold before the bank starts draining at all. */
export const SPEED_WINDUP_DRAIN_DELAY = 0.3;
/**
 * How fast the bank drains once that grace is spent, as a multiple of real
 * time. 1 is symmetric with a 1× fill; 0 banks permanently for the attempt.
 */
export const SPEED_WINDUP_DRAIN_RATE = 2.0;
/** speedNorm below which chromatic aberration is exactly zero. */
export const CA_THRESHOLD = 0.45;
/** Channel split at speedNorm 1 (px). */
export const CA_MAX_OFFSET = 3.0;
/** Vignette alpha at rest / at full speed. */
export const VIGNETTE_MIN = 0.15;
export const VIGNETTE_MAX = 0.55;
/** Fraction of the radius that stays fully clear at the gradient's centre. */
export const VIGNETTE_INNER = 0.45;
/** Peak alpha of the ink tint layered over the vignette at speedNorm 1. */
export const VIGNETTE_TINT_MAX = 0.22;
/** Screen bounce amplitude at full speed (px). */
export const BOUNCE_AMP = 2.5;
/** Screen bounce frequency at full speed (rad/s). */
export const BOUNCE_FREQ = 9.0;

// --- Jump pads, death and the goal (GAME-DESIGN §5/§6, PHASES phase 5). ---

/**
 * Jump pad launch speed (px/s). It OVERRIDES the relevant velocity component
 * rather than adding to it, so a pad's launch is the same however fast you
 * arrived. Up-pad peak = 820²/(2·GRAVITY_RISE) = 152.8 px = 4.78 tiles; airtime
 * 0.667 s, which carries 170.9 px = 5.34 tiles at RUN_SPEED — against the plain
 * jump's 4.56, so five tiles is the smallest gap that *requires* a pad.
 */
export const PAD_IMPULSE = 820;
/**
 * Angular velocity (rad/s) a pad imparts at a full-corner contact, scaled
 * linearly by the torque arm and clamped. It needs its own scale because the
 * physical impulse form saturates: SPIN_TRANSFER · PAD_IMPULSE · (r×n) /
 * PLAYER_INERTIA is 73.7 rad/s at a corner, five times MAX_ANG_SPEED, so every
 * off-centre hit more than ~2 px from centre would clamp and look identical.
 * The arm is measured from the BODY's centre, so a flat landing anywhere on a
 * pad gives exactly zero — "clip it with a corner and you leave spinning" is
 * then a real distinction rather than a constant tumble.
 */
export const PAD_SPIN_MAX = 8.0;
/**
 * How square-on a contact must be to count as hitting a pad's BACK.
 *
 * A pad launches along its facing from every face BUT that one. The back has
 * to be excluded — a body landing on the back of an up-pad was launched up
 * *through* the slab it had just landed on, which reads as the pad having no
 * collision at all — but the sides must not be, because a free-standing pad
 * that merely stops you when you walk into its edge reads as broken.
 *
 * So the test is on the back alone: a contact whose normal opposes the facing
 * by more than this is plain platform, and everything else fires. Shares
 * GROUND_NORMAL_DOT's value and its reasoning — a box balanced on one of its
 * own corners contacts up to 45° off the face normal, and that contact is
 * still on the same face.
 */
export const PAD_BACK_DOT = 0.7;
/**
 * The flip pickup: how long a collected one stays gone (s), how big it draws
 * (px), and how faint its afterimage is while it is spent.
 *
 * Three seconds is long enough that a pickup cannot be farmed on the spot —
 * standing on one and flipping every frame would make the flip's whole cost
 * disappear — and short enough that a line rehearsed after a death does not
 * wait on it. The afterimage is drawn rather than the pickup simply vanishing,
 * because a player who has just used one needs to know where it will be.
 */
export const PICKUP_RESPAWN = 3.0;
export const PICKUP_SIZE = 16;
export const PICKUP_SPENT_ALPHA = 0.25;
/**
 * The pickup's `paper` core as a fraction of its size, and the stroke of the
 * outline left where a spent one will return.
 *
 * The fraction is the player's own, derived rather than eyeballed: the body's
 * core is `PLAYER_SIZE − 2·PLAYER_CORE_INSET` = 10 on a 20 px square, so 0.5.
 * The pickup IS that readout rotated 45°, and the two have to read as the same
 * object at a glance or the visual argument for the shape falls apart.
 */
export const PICKUP_CORE_FRACTION = 0.5;
export const PICKUP_OUTLINE_WIDTH = 2;
/**
 * Collection radius (px), centre to centre. Not a box overlap: the pickup is a
 * diamond and the body is a rotating square, so a rotation-independent radius
 * is both the honest shape and the one a player can predict.
 *
 * Sized against what is DRAWN, which is the only thing a player can judge it
 * by: the diamond reaches PICKUP_SIZE·√2/2 = 11.3 px to a vertex and the body
 * half-extent is 10, so the two sprites touch at 21.3 px and overlap below it.
 * 20 fires just inside that, which is "the square is over it" — 16, the first
 * value here, left a 5 px band where the square was drawn on top of the diamond
 * and nothing happened.
 */
export const PICKUP_RADIUS = 20;

/**
 * How long one pad waits before it may fire again (s), counted per PAD rather
 * than per player.
 *
 * Now that every face but the back launches, a pad can hold a body in contact
 * with a launching face indefinitely — stand on a right-facing pad with a wall
 * one tile away and the launch drives you into the wall and straight back onto
 * the pad. Measured at 38 firings per second before this existed: a buzz, a
 * pinned body, and 38 doses of spin.
 *
 * Per pad, not per player, because a chain is several pads and a player-wide
 * cooldown would make the second pad of one deaf for a quarter of a second —
 * the feature eating the game it was added to protect. Two pads a step apart
 * both fire; the same pad twice in a step does not.
 *
 * 0.25 s is fifteen steps, which is an order of magnitude above the 0.0167 s of
 * a scrape and well under the shortest genuine return to the same pad: being
 * launched by one and falling back onto it is its own airtime, 0.667 s for an
 * up-pad at PAD_IMPULSE. So no line an author can draw is shortened by it.
 */
export const PAD_DEBOUNCE = 0.25;

/** Death fade out, then back in after the respawn (s). */
export const DEATH_FADE_OUT = 0.35;
export const DEATH_FADE_IN = 0.25;

// --- The shell (scenes/play.ts, scenes/results.ts). ---

/**
 * How long the frozen winning frame holds before the results screen (s).
 *
 * Amended in phase 7 from "how long the completion readout holds before the
 * level advances": the readout moved to `ResultsScene`, and this stayed where
 * it was rather than going with it. `ResultsScene` owns no clock — this is the
 * PUNCTUATION on the frame the player just earned, and it belongs to the scene
 * that froze it.
 */
export const GOAL_HOLD = 1.2;
/**
 * Alpha of the `ink` wash under the pause overlay. It has to beat the strongest
 * vignette the frame can already be wearing — pausing at full speed against
 * VIGNETTE_MAX would otherwise barely register — while still leaving the frozen
 * frame visible underneath, which is the point of pausing rather than cutting.
 */
export const PAUSE_DIM = 0.6;
/**
 * Stroke width of the player's paper core when the flip is SPENT (px). The core
 * is PLAYER_SIZE − 2·PLAYER_CORE_INSET = 10 px square, so a 1 px outline is too
 * thin to read at speed; this is the charge tell and there is no HUD behind it.
 */
export const CORE_OUTLINE_WIDTH = 2;
/**
 * Pad chevron arm length and bar thickness (px). Two `paper` bars per pad,
 * drawn at ±135° from its facing. The width was set against a pad flush in a
 * floor row: the arms sit at 45°, so a 3 px bar antialiases almost entirely
 * into mid-grey and the chevron reads as a smudge rather than an arrow.
 */
export const PAD_CHEVRON_LEN = 14;
export const PAD_CHEVRON_WIDTH = 5;
/** Goal outline stroke (px), and the scale pulse it breathes with. */
export const GOAL_OUTLINE_WIDTH = 2;
export const GOAL_PULSE_AMP = 0.12;
export const GOAL_PULSE_FREQ = 3.0;

// --- Music (GAME-DESIGN §7/§9, PHASES phase 6). The bed runs on the AUDIO
// clock, which is deliberately unrelated to STEP: nothing in the simulation may
// ever read it, or determinism is gone. ---

/** Tempo (beats/min). A beat is 60/128 = 0.46875 s. */
export const MUSIC_BPM = 128;
/**
 * The scheduling grid (s). Every pattern is written in sixteenths, and the
 * cursor advances an integer count of these from a fixed origin rather than
 * accumulating — so a three-minute session is still exactly on the grid.
 */
export const MUSIC_SIXTEENTH = 60 / MUSIC_BPM / 4;
/** Sixteenths per bar, and the length of the whole pattern (the lead riff is 4 bars). */
export const MUSIC_BAR_STEPS = 16;
export const MUSIC_PATTERN_STEPS = 64;
/** One bar (s) = 1.875. NOT a whole number of frames, and it must not be. */
export const MUSIC_BAR = MUSIC_SIXTEENTH * MUSIC_BAR_STEPS;
/**
 * Time constant of a layer's cross-fade (s). A gate is a TARGET GAIN, not a
 * switch: gating at scheduling time would be a hard switch by construction,
 * because a note carries the gain it was scheduled with up to MUSIC_LOOKAHEAD
 * before it sounds. One frame may therefore move a gain by at most
 * STEP / MUSIC_FADE = 0.0476.
 */
export const MUSIC_FADE = 0.35;
/**
 * How far ahead of the audio clock notes are scheduled (s) = 6 frames, so a
 * five-frame hitch is invisible. FixedStepper.maxFrame is 250 ms — 2.5× this —
 * which is the relation that FORCES the cursor's resync rather than merely
 * recommending it: a stalled `while (next < now + LOOKAHEAD)` loop dumps every
 * missed sixteenth into one instant, and a 3 s stall is 25.6 of them.
 */
export const MUSIC_LOOKAHEAD = 0.1;
/** Layer gates on speedNorm (GAME-DESIGN §7). Strictly greater-than. */
export const MUSIC_GATE_HATS = 0.25;
export const MUSIC_GATE_BASS = 0.45;
export const MUSIC_GATE_ARP = 0.7;
/**
 * Gain below which a layer is skipped at scheduling time, so a closed layer
 * allocates no nodes at all. A fading one still plays and is audibly fading;
 * the two facts stay consistent because they read the same number.
 */
export const MUSIC_GATE_EPS = 0.01;
/** Master music gain at speedNorm 0 and 1 — the bed swells between the gates too. */
export const MUSIC_GAIN_MIN = 0.1;
export const MUSIC_GAIN_MAX = 0.34;

// --- The lead synth (the 'arp' layer's voice). Authored by FEEL like the
// wind-up: every one of these is live in the dev tuner (?tune=1) through
// `engine/tuning.ts`, and these are the shipped defaults a session starts
// from and RESET restores. ---

/** Riff register, octaves from the authored A3 root (-1 = A2, 1 = A4). */
export const LEAD_OCTAVE = 0;
/** Peak envelope level of a full-velocity note, pre-saturation. */
export const LEAD_LEVEL = 0.05;
/** Multiplier on the riff's authored gate lengths (1 = as written). */
export const LEAD_GATE = 1.8;
/** Envelope (s): linear swell in, hold at level, exponential release out. */
export const LEAD_ATTACK = 0.02;
export const LEAD_RELEASE = 0.02;
/** Detune of the saw pair, ± cents — the width of the voice. */
export const LEAD_DETUNE = 0.0;
/** Vibrato rate (Hz) and depth as a fraction of the pitch. */
export const LEAD_VIB_RATE = 0.5;
export const LEAD_VIB_DEPTH = 0.001;
/** Filter: cutoff opens near bright × pitch (velocity-scaled), eases to dark ×. */
export const LEAD_BRIGHT = 8.0;
export const LEAD_DARK = 2.0;
export const LEAD_Q = 1.0;
/** tanh drive of the lead bus saturation — the glue, and some of the warmth. */
export const LEAD_SAT_DRIVE = 3.5;
/** How much of the (post-saturation) lead feeds the shared delay send. */
export const LEAD_SEND = 0.2;

// --- SFX send (GAME-DESIGN §9). One shared feedback delay is what gives every
// effect the same room, instead of nine effects each with their own. ---

/** Delay time (s), feedback at rest and at full speed, and the loop's lowpass (Hz). */
export const SFX_DELAY_TIME = 0.18;
export const SFX_DELAY_FEEDBACK = 0.35;
export const SFX_DELAY_FEEDBACK_MAX = 0.55;
export const SFX_DELAY_LOWPASS = 2000;
/**
 * Ground distance between footfalls (px). DISTANCE, not time: the cadence then
 * scales with speed for free, and a body pinned against a wall at full throttle
 * makes no sound at all. At RUN_SPEED this lands 256/24 = 10.67 Hz against a
 * 0.46875 s beat — exactly five to the beat, a quintuplet over the 4/4 grid,
 * and only at flat-out speed. The one constant in the phase with no derivation
 * behind it; it got its value by ear.
 */
export const STEP_SFX_DIST = 24;

// --- Particles (GAME-DESIGN §2). The only saturated colour in the game, so
// every emitter is rationed and none of them is decoration. ---

/** Spark edge (px). Kept integer-positioned, unlike every other world draw. */
export const PARTICLE_SIZE = 2;
/**
 * Spark fall (px/s²) and velocity damping (1/s). Gravity is SIGNED AT SPAWN by
 * the player's `gravitySign`: a flipped player kicking up dust that falls toward
 * the ceiling they are standing on is the kind of wrongness nobody can name and
 * everybody sees.
 */
export const SPARK_GRAVITY = 260;
export const SPARK_DRAG = 3;
/** Half-angle of the emission cone for dust, bursts and splashes (rad). */
export const SPARK_SPREAD = Math.PI * 0.38;
/**
 * Fractional spread on a sampled spark's lifetime: it lives for
 * `life × [1, 1 + this)`. Without it every spark of a burst dies on the SAME
 * FRAME, and twenty of them vanishing together reads as a pop rather than as a
 * splash dissipating. The flip ring is deliberately exempt — a ring is a shape
 * and has to leave as one.
 */
export const SPARK_LIFE_JITTER = 0.5;
/** Dust kicked up per footfall, and its speed range and life. */
export const DUST_COUNT = 2;
export const DUST_SPEED_MIN = 20;
export const DUST_SPEED_MAX = 70;
export const DUST_LIFE = 0.3;
/** The directional burst under a jump — and the same recipe under a pad hit. */
export const JUMP_BURST_COUNT = 8;
export const BURST_SPEED_MIN = 60;
export const BURST_SPEED_MAX = 170;
export const BURST_LIFE = 0.35;
/**
 * The landing splash, sprayed along the CONTACT NORMAL and scaled by impact
 * speed: `splashCount` ramps MIN at IMPACT_SPEED_MIN (a landing barely worth
 * the name) to MAX at MAX_FALL_SPEED (terminal, and it should read as a slam).
 */
export const SPLASH_COUNT_MIN = 2;
export const SPLASH_COUNT_MAX = 20;
export const SPLASH_SPEED_MIN = 40;
export const SPLASH_SPEED_MAX = 220;
export const SPLASH_LIFE = 0.4;
/**
 * The flip's ring. Its angles are distributed BY INDEX, never by Rng — a
 * randomly-angled ring is a puff, and the flip is the one moment in the game
 * that deserves a shape.
 */
export const FLIP_RING_COUNT = 20;
export const FLIP_RING_SPEED = 150;
export const FLIP_RING_LIFE = 0.4;
/**
 * The pads' idle stream: one spark per pad every INTERVAL, drifting SPEED px/s
 * in the pad's facing for LIFE seconds — 40.5 px = 1.27 tiles of travel, and
 * 6.4 alive per pad. It is the pad's ANIMATION, not its identity: the static
 * `paper` chevron is what identifies a pad at a glance and at rest, and sparks
 * are transient by construction (there are none at all on the frame a level
 * loads). Both, not one instead of the other.
 */
export const PAD_STREAM_INTERVAL = 0.07;
export const PAD_STREAM_SPEED = 90;
export const PAD_STREAM_LIFE = 0.45;
/** Half-angle of the stream's cone (rad) — narrow, so it reads as an arrow. */
export const PAD_STREAM_SPREAD = 0.25;
/** How far outside the view a pad still streams (px). */
export const PARTICLE_CULL_MARGIN = 64;

// --- Editor (GAME-DESIGN §10, PHASES phase 7). The grid is the level, so
// there is nothing here about metadata; every number below is about being able
// to SEE what you are building. ---

/**
 * The zoom ladder, ascending, in whole-pixel cells: 8, 16, 32, 64, 128 px.
 *
 * Every step is an integer cell on purpose — a fractional cell seams between
 * adjacent cells at every non-integer scale, which is the exact problem phase
 * 3's coordinate policy exists to avoid. `0.5` is the one that earns its place
 * twice over: 60 tiles x 32 px x 1/2 = 960 px = `VIEW_W` exactly, so half zoom
 * is precisely "one screen per sixty tiles".
 *
 * **Which of these steps an author can actually reach depends on the level**
 * (`editor/zoom.ts`): there is no point zooming out past the step that already
 * shows the whole grid, and no point zooming in past 2x on a level too big to
 * fit at 4x. The ladder is the menu; the level picks which entries are on it.
 */
export const EDITOR_ZOOM_STEPS: readonly number[] = [0.25, 0.5, 1, 2, 4];
/**
 * Keyboard pan speed (px/s) = 20 tiles/s, crossing the frame in 1.5 s.
 * Deliberately faster than RUN_SPEED — navigating a level you are building is
 * not the same act as playing it.
 */
export const EDITOR_PAN_SPEED = 640;
/** Alpha of the cell grid overlay. Visible over paper, invisible over ink. */
export const EDITOR_GRID_ALPHA = 0.15;
/**
 * Undo depth. The granularity is the STROKE, not the cell, so 64 is 64 real
 * edits rather than 64 pixels of one drag. A snapshot is one character per
 * cell: 1200 characters ≈ 2.4 KB at 60×20, so the stack tops out around 154 KB
 * there and 1.5 MB at the size cap. The ceiling is memory, but the reason for
 * having a cap at all is that an unbounded stack is a leak nobody measures.
 */
export const EDITOR_UNDO_MAX = 64;

/**
 * The rectangle and select tools' preview overlay: how strongly a pending
 * rectangle tints the cells it is about to fill, and how thick its outline is.
 *
 * The tint is what makes a rectangle drag readable over a grid that is already
 * `ink` on `paper` — an outline alone vanishes the moment the drag crosses a
 * filled region, which is most of the times an author draws one. It is drawn in
 * `ink` at this alpha over `paper` cells and reads as a wash; over `ink` cells
 * it is invisible, which is why the outline exists as well. Two cues, because
 * neither one covers both grounds.
 */
export const EDITOR_MARQUEE_ALPHA = 0.3;
export const EDITOR_MARQUEE_WIDTH = 2;

/** A blank grid: small enough to see whole at half zoom while learning the tool. */
export const EDITOR_DEFAULT_W = 40;
export const EDITOR_DEFAULT_H = 20;
/**
 * Hard size cap. NOT a memory argument: 200 tiles is 6400 px, 6.7 screens at
 * 1× and 3.3 at ½, and a level you cannot see a third of is one the tool has
 * stopped helping with.
 */
export const EDITOR_MAX_W = 200;
export const EDITOR_MAX_H = 60;

/**
 * How long a level's display name may be, in characters. The editor's name
 * field clips to it and an import clips to it, so a file from somewhere else
 * cannot put a 400-character title on a menu row.
 */
export const EDITOR_NAME_MAX = 40;

/* ------------------------------------------------------------------ signs -- */

/**
 * In-world tutorial signs (`scenes/signs.ts`): text painted into the level's
 * empty space, in `ink`, at the place the thing it teaches happens.
 *
 * Scale 2 is the HUD's size, which is the point — a sign is the game talking,
 * so it reads at the weight the level name and the timer do rather than as
 * scenery. `SIGN_LINE_H` is the 7 px glyph at that scale (14) plus 8 px of
 * leading, the smallest gap at which two stacked lines still read as two.
 */
export const SIGN_TEXT_SCALE = 2;
export const SIGN_LINE_H = 22;
/**
 * A sign's optional arrow: shaft thickness and the length of each barb, which
 * sweeps ±135° off the shaft exactly as a pad chevron's arms do. Sized against
 * the scale-2 glyph rather than against `TILE` — it is punctuation on a line of
 * text, not a tile-sized object in the level.
 */
export const SIGN_ARROW_WIDTH = 4;
export const SIGN_ARROW_BARB = 14;

/* ----------------------------------------------------------- finale goal -- */

/**
 * The last level's goal, which is not an `ink` outline but a three-tile pixel
 * spiral of slowly swirling spectrum (GAME-DESIGN §1, §11). Every number here
 * is presentation only — the goal still triggers on its one centre tile, so the
 * level plays identically to the drawing it replaces.
 *
 * Three tiles because one tile of rainbow reads as a pickup that changed
 * colour. At 96 px it is bigger than the player and bigger than any single
 * piece of geometry, which is what makes it read as an ARRIVAL rather than as
 * one more object to collect.
 */
export const FINALE_GOAL_TILES = 3;
/**
 * The spiral is drawn on its own square grid of cells, `FINALE_GOAL_CELLS`
 * across the whole three-tile span. 12 puts a cell at 8 px — a quarter tile,
 * and near enough the 5×7 font's pixel that the bloom reads as the same
 * resolution as the rest of the game rather than as a smooth import.
 */
export const FINALE_GOAL_CELLS = 12;
/**
 * How far through the spectrum one ring of the spiral travels. The arm falls
 * out of subtracting the cell's ANGLE from its ring — one full turn steps the
 * hue by this much, which is what bends the concentric bands into a spiral.
 */
export const FINALE_GOAL_HUE_PER_RING = 0.34;
/** Cycles/s the whole spiral drifts through the spectrum. Slow on purpose: the
 *  colours should crawl inward, and at a cycle a second this strobes. */
export const FINALE_GOAL_HUE_RATE = 0.09;
/** The halo behind the spiral: a soft radial fill, `FINALE_GOAL_HALO_SPREAD`×
 *  the span across, so the colour bleeds past the pixels into the level. */
export const FINALE_GOAL_HALO_ALPHA = 0.42;
export const FINALE_GOAL_HALO_SPREAD = 1.5;
/**
 * Seconds the player's centre must stay inside the spiral before the level
 * ends. The finale's goal is nine tiles rather than one, so it is reached by
 * arriving rather than by aiming — and a nine-tile trigger that fired the
 * instant a corner of it was clipped would end the game on a jump that was
 * only passing through. The hold is what makes the last thing the player does
 * a decision: stop in the colour.
 *
 * It RESETS on leaving, not pauses — see `PlayScene.stepPlay`. Every other
 * level runs this same path at 0, which fires on the entering frame exactly as
 * it always has.
 */
export const FINALE_GOAL_DWELL = 1.0;

/* -------------------------------------------------------- finale ending -- */

/**
 * What happens when the player finally stops inside the spiral: the colour
 * comes off the goal and takes the screen. It grows until the level is behind
 * it, the whole frame goes soft, and what is left is a smooth conical sweep of
 * every hue with nothing in front of it — the sheet the credits come up on.
 *
 * All of it is a fraction of ONE duration, so the sequence retimes by moving a
 * single number and the stages keep their relationship. `finaleStage` in
 * `scenes/finale.ts` turns `p = elapsed / duration` into the three values that
 * drive it, and is pure so the curve can be tested without a canvas.
 *
 * Six seconds is long for a transition and deliberately so — this is the last
 * thing the game does, and the ordinary goal's 1.2 s punctuation is the length
 * of "well done", not of an ending.
 */
export const FINALE_END_DURATION = 6.0;
/** How much bigger than its three tiles the spiral gets. 24× is 2304 px across
 *  — over the 960×540 view's diagonal, so it covers from wherever it started. */
export const FINALE_END_COVER = 24;
/** Fraction of the duration the growth takes; it is done well before the end,
 *  so the last stretch is the frame settling rather than anything moving. */
export const FINALE_END_GROW_AT = 0.55;
/** Peak screen blur in px, and the fraction of the duration it takes to reach
 *  it. Ramped on a square, so the picture stays legible while it is still worth
 *  looking at and goes soft only once it is just colour. */
export const FINALE_END_BLUR = 44;
export const FINALE_END_BLUR_AT = 0.8;
/** When the smooth conical sweep starts and finishes fading in over the blurred
 *  frame. It lands at 0.85, leaving the last 15% as a still, clean hold. */
export const FINALE_END_SETTLE_AT = 0.35;
export const FINALE_END_SETTLE_END = 0.85;
/** Hue stops around the sweep. 13 is 12 arcs of 30°, which is smooth enough
 *  that the interpolation between stops is invisible. */
export const FINALE_END_STOPS = 13;
/**
 * A last, gentler blur over the FINISHED sweep. A conical gradient converges on
 * a mathematical point, and a point is a thing to look at — the one detail on a
 * screen that is meant to have none. Softening it costs one more full-screen
 * blit, on the one screen in the game that can afford it.
 */
export const FINALE_END_SOFTEN = 26;
/** rad/s the sweep turns. Barely a degree a second: the last screen should be
 *  alive rather than animated, and the credits have to be readable over it. */
export const FINALE_END_SWEEP = 0.06;

/* --------------------------------------------------------- end credits -- */

/**
 * The credits roll, on the sheet the ending leaves behind: the same conical
 * sweep of every hue, still turning, with the words coming up over it.
 *
 * It is a SCROLL rather than a sequence of held cards because the swirl behind
 * it never cuts — the ending earned a screen with no edits on it, and a card
 * that blinked to the next card would be the first cut in six seconds.
 */

/** px/s the roll travels. A reading pace rather than a list to get through —
 *  the roll is the last thing the game says, and it says all of it. */
export const CREDITS_SCROLL = 48;
/** Gap between lines inside one stanza, and between stanzas. The stanza gap is
 *  wide enough that two stanzas are never mistaken for one block of six lines. */
export const CREDITS_LINE_GAP = 14;
export const CREDITS_STANZA_GAP = 66;
/**
 * Seconds of empty swirl after the last line has climbed off the top, before
 * the fade starts. The roll runs all the way OUT rather than parking the
 * sign-off in the middle of the frame, so what the player is left looking at is
 * the screen the ending made: nothing on it and every colour in it. This hold
 * is what gives them a moment of it back before the game closes.
 */
export const CREDITS_HOLD = 1.2;
/**
 * Seconds the whole screen takes to fade to `paper` and hand over. It fades to
 * `paper` because that is what the results screen is drawn on — the colour
 * leaves, the two-colour game comes back, and the seam between the two screens
 * lands where there is nothing on either of them to see it.
 */
export const CREDITS_FADE_OUT = 2.0;
/**
 * The band at the top and bottom of the frame over which a line fades. Without
 * it, a line of text hits the edge of the view and is cut in half mid-glyph —
 * the one hard edge on a screen that has nothing else hard on it.
 */
export const CREDITS_FADE = 110;
/**
 * A `paper` wash over the swirl, under the words. The sweep is fully saturated
 * at mid lightness, and `ink` text over it is legible on some hues and not on
 * others — the wash costs the colour nothing anyone can name and buys every hue
 * the same contrast.
 *
 * It carries that on its own, since the text has no shadow under it: at 0.45
 * the worst hue on screen (the yellow-green arc) reads at 3.5:1 against `ink`,
 * which clears the large-text threshold, and the roll is nothing but large
 * text. Lowering it puts the yellows back under.
 */
export const CREDITS_SCRIM = 0.45;
/**
 * Seconds the scrim takes to reach that. It EASES IN from nothing, because the
 * frame the credits open on has to be the frame the ending closed on — a wash
 * that was simply there on the first frame would darken the screen by a third
 * on the scene change, which is the cut the whole ending was built to avoid.
 * It is done well before the first line has climbed out of the bottom fade.
 */
export const CREDITS_SCRIM_FADE = 1.2;
