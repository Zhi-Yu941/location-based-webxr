import { describe, expect, it } from "vitest";
import { PerspectiveCamera, type Vector3 } from "three";
import { buildClayWorld } from "./clay-world";
import { buildDotPerson } from "./dot-person";
import { buildMarkerPair } from "./markers";
import { buildPhoneFrame } from "./phone-frame";
import {
  buildStoryTimeline,
  createStoryStage,
  syncStage,
  type StoryStage,
} from "./story-timeline";
import type { Timeline } from "animejs";

// Why this test matters: round-1 user feedback reported hard camera jumps
// ("harter Sprung", "komischer Cut") and explicitly demanded automated
// continuity guarantees — the camera must follow a continuous path with
// eased accel/decel, never teleporting or changing speed abruptly, in BOTH
// scroll directions. These sweeps pin that for the pure timeline; runtime
// causes (viewport remaps) are handled separately in main.ts.

const STEP_MS = 5;
// Teleport bound: the fastest intended move (dive → pull-back, ~47 units in
// 550 ms, sine-eased peak ≈ 0.68 u/step) stays well under this; a real cut
// (chapter framings are 5-40 units apart) blows past it.
const MAX_STEP_DISPLACEMENT = 1.5;
// Smoothness bound: eased tweens change per-step displacement gradually
// (measured peak ≈ 0.012 u/step²); an abrupt stop/start from a mid-flight
// value would exceed this by an order of magnitude.
const MAX_STEP_ACCEL = 0.15;

function makeStage(): StoryStage {
  return createStoryStage({
    world: buildClayWorld("low"),
    person: buildDotPerson(),
    markers: buildMarkerPair(),
    phone: buildPhoneFrame(),
    camera: new PerspectiveCamera(55, 16 / 9),
  });
}

function sweep(
  stage: StoryStage,
  timeline: Timeline,
  times: readonly number[],
): { maxStep: number; maxAccel: number } {
  let previous: Vector3 | null = null;
  let previousStep: number | null = null;
  let maxStep = 0;
  let maxAccel = 0;
  for (const t of times) {
    timeline.seek(t);
    syncStage(stage);
    const current = stage.camera.position.clone();
    if (previous) {
      const step = current.distanceTo(previous);
      maxStep = Math.max(maxStep, step);
      if (previousStep !== null) {
        maxAccel = Math.max(maxAccel, Math.abs(step - previousStep));
      }
      previousStep = step;
    }
    previous = current;
  }
  return { maxStep, maxAccel };
}

function forwardTimes(duration: number): number[] {
  const times: number[] = [];
  for (let t = 0; t <= duration; t += STEP_MS) {
    times.push(t);
  }
  return times;
}

describe("story timeline camera continuity", () => {
  it("never teleports and keeps eased accel/decel on a forward sweep", () => {
    const stage = makeStage();
    const timeline = buildStoryTimeline(stage, () => {});
    const { maxStep, maxAccel } = sweep(
      stage,
      timeline,
      forwardTimes(timeline.duration),
    );
    expect(maxStep).toBeLessThan(MAX_STEP_DISPLACEMENT);
    expect(maxAccel).toBeLessThan(MAX_STEP_ACCEL);
  });

  it("never teleports on a backward sweep (scrolling up)", () => {
    const stage = makeStage();
    const timeline = buildStoryTimeline(stage, () => {});
    // Prime forward once (real usage always scrubs forward first), then
    // sweep back to the top.
    const times = forwardTimes(timeline.duration);
    sweep(stage, timeline, times);
    const { maxStep, maxAccel } = sweep(stage, timeline, [...times].reverse());
    expect(maxStep).toBeLessThan(MAX_STEP_DISPLACEMENT);
    expect(maxAccel).toBeLessThan(MAX_STEP_ACCEL);
  });

  it("keeps the dot-person walking continuously (no position cuts)", () => {
    const stage = makeStage();
    const timeline = buildStoryTimeline(stage, () => {});
    let previous: Vector3 | null = null;
    let maxStep = 0;
    for (const t of forwardTimes(timeline.duration)) {
      timeline.seek(t);
      syncStage(stage);
      const current = stage.person.position.clone();
      if (previous) {
        maxStep = Math.max(maxStep, current.distanceTo(previous));
      }
      previous = current;
    }
    // The whole path is ~45 units walked across ~6s of timeline — any
    // per-5ms step above this is a cut, not a walk.
    expect(maxStep).toBeLessThan(0.5);
  });
});
