# `scene/story-timeline.ts` — the scroll-scrubbed story + load intro

## Purpose

Builds the two anime.js timelines: the master story timeline (one segment
per chapter, scrubbed by scroll — never auto-played) and the one-shot load
intro. Also composes the "stage" (prop placement + reveal-group priming)
and keeps derived state (dot-person on the path) in sync.

## Public API

- `CHAPTER_DURATION_MS` (1000) and `chapterEndTime(index)` — the timeline
  time bases; total duration = `CHAPTER_COUNT × CHAPTER_DURATION_MS`.
- `createStoryStage(parts: StageParts) → StoryStage` — positions person /
  markers, parents the phone to the camera (held "in front of the lens";
  the 1.7-unit distance is load-bearing, round-7 Y4 superseding round-5
  W4: the SCREEN must cover the full mobile-portrait viewport width and
  the frame bars the vertical remainder, so no AR content is visible
  outside the phone screen on phones — test-pinned), primes reveal
  groups (visible but scaled/lowered away), sets the hero camera
  framing. Mutates the passed objects; call once at boot.
- `buildStoryTimeline(stage, onUpdate) → Timeline` — paused timeline;
  scrub with `seek(progress × duration)`.
- `buildIntroTimeline(stage, onUpdate) → Timeline` — ~2.1 s intro that
  ends EXACTLY on the story's hero framing (seamless scroll hand-over).
- `syncStage(stage)` — re-derives person path placement from `walk.t`.
  **Must be called after every `seek`** (see invariants).
- `StoryStage`, `StageParts` types.

## Invariants & assumptions

- **Seek-driven only:** both timelines are created `autoplay: false` and
  are driven by `seek()` from the scene controller's tick loop — the anime
  engine loop is never relied upon (deterministic, node-testable).
- **`composition: 'none'` is load-bearing TWICE over:** (1) with anime's
  default `'replace'`, the intro timeline (created later, animating the
  same camera/world properties) silently CANCELS the story timeline's
  tweens; (2) `'none'` also disables from-value chaining, so every
  property touched by more than one tween MUST declare explicit
  `{from, to}` — the chapter moves are generated from an explicit framing
  CHAIN for exactly this reason (round-1 "harter Sprung" bug, pinned by
  the continuity tests).
- **anime keyframe ARRAYS are banned** in these timelines: they do not
  restore their pre-tween value when seeked back past them
  (probe-verified), breaking scrub-path independence. Wiggle/jitter beats
  go through `addValueChain` (explicit `{from, to}` per segment) instead.
- **Continuity guarantees (test-pinned):** fine-step forward AND backward
  sweeps bound the camera's per-step displacement and accel; a fast-check
  property pins that scene state at time t is independent of the scrub
  history (`story-timeline.continuity.test.ts`,
  `story-timeline.property.test.ts`).
- **`onUpdate` fires BEFORE child tween values apply** (anime behavior),
  so it is only a dirty-flag hook; derived state must be pulled via
  `syncStage` AFTER the seek returns.
- The fused marker is deliberately never animated — its stillness vs. the
  raw marker's jitter IS the product message (test-pinned).
- The camera look direction is decoupled: tweens move `stage.lookTarget`
  (a bare Vector3); the render loop calls `camera.lookAt(...)`.
- Chapter staging summary (round-2, dive re-sequenced round-4 V2): hero
  push-in (person hidden in the sky above the QR drop point) → QR:
  settle-wiggle, accuracy ring fades in LARGE and collapses onto the drop
  point, person sky-drops with a bounce (`stage.drop.y`, applied in
  `syncStage`) → fusion: static scattered rings, connector reveal, pin
  pulse → dive: camera settles at the person's LEFT shoulder (round-5
  W2; the round-2 R10 arm raise was removed in round-5 W1), the person
  hides as it closes in with the phone frame launching at the SAME
  moment (round-5 W3 — no dead gap), and the AR content fades in
  together with the phone's arrival (deliberately completing near the window END — the
  requested dramaturgy, a documented deviation from the "settled by
  mid-window" default) → pull-back + outer-terrain rise → the round-11
  use-case JOURNEY: the gallery window carries TWO 500 ms waypoints
  (city sweep over the skyline, then a campus-vignette flyover — a
  second documented deviation from "settled by mid-window": the
  traveling shot is the requested effect) and the CTA is an ARRIVAL at
  the castle vignette, which stays in the background while reading (no
  return to the start framing; test-pinned against `VIGNETTE_ANCHORS`).
- The walk starts at `DROP_PATH_T` (the QR drop point) — there is no walk
  tween in the QR chapter; the drop replaces the old slide-in.

## Examples

```ts
const stage = createStoryStage({ world, person, markers, phone, camera });
const story = buildStoryTimeline(stage, markDirty);
story.seek(progress * story.duration);
syncStage(stage);
camera.lookAt(stage.lookTarget);
```

## Tests

`story-timeline.test.ts` — duration coverage, camera movement per chapter,
raw-jitters/fused-still, path walking (via the syncStage contract), phone +
gallery reveals, the round-4 dive ordering (camera → phone → AR), dirty-
notify on scrub, scrub-back restoration, intro hand-over framing, stage
placement, and the round-11 journey (gallery end near the campus, CTA
resting at the castle, no return-to-start).
