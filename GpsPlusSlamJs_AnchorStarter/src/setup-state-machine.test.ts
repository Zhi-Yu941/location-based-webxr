/**
 * Unit tests for the setup state machine (setup-state-machine.ts).
 *
 * Why this test matters: this FSM is the *pedagogical core* of the starter
 * example.
 * It makes the "is there a cached anchor? no → place mode; yes → load and
 * show" branch explicit and self-explaining instead of inline `if`/flag
 * spaghetti. These tests pin both branches, the soft-gate placement rule
 * (D2), and the async in-progress → final/revert transitions the repo's
 * async-UX rule requires.
 */

import { describe, it, expect } from "vitest";
import {
  initialSetupState,
  setupReducer,
  canPlaceAnchor,
  type SetupState,
} from "./setup-state-machine.js";

function boot(hasCachedAnchor: boolean): SetupState {
  return setupReducer(initialSetupState, { type: "BOOTED", hasCachedAnchor });
}

describe("setupReducer — boot branch selection", () => {
  it("starts in the booting phase", () => {
    expect(initialSetupState.phase).toBe("booting");
    expect(canPlaceAnchor(initialSetupState)).toBe(false);
  });

  it("cache-miss boot enters the placement (awaiting-tracking) branch", () => {
    expect(boot(false).phase).toBe("awaiting-tracking");
  });

  it("cache-hit boot enters the relocalising branch", () => {
    expect(boot(true).phase).toBe("relocalising");
  });

  // Regression: the store subscription is live before BOOTED is dispatched, so
  // TRACKING_READY_CHANGED(true) can arrive while still `booting`. BOOTED must
  // honour that pre-boot readiness instead of routing into a stale waiting
  // phase that no further (unchanged) readiness event would ever advance.
  it("cache-hit boot with pre-boot trackingReady goes straight to anchor-shown", () => {
    const ready = setupReducer(initialSetupState, {
      type: "TRACKING_READY_CHANGED",
      ready: true,
    });
    expect(ready.phase).toBe("booting");
    expect(ready.trackingReady).toBe(true);
    const booted = setupReducer(ready, {
      type: "BOOTED",
      hasCachedAnchor: true,
    });
    expect(booted.phase).toBe("anchor-shown");
  });

  it("cache-miss boot with pre-boot trackingReady goes straight to ready-to-place", () => {
    const ready = setupReducer(initialSetupState, {
      type: "TRACKING_READY_CHANGED",
      ready: true,
    });
    const booted = setupReducer(ready, {
      type: "BOOTED",
      hasCachedAnchor: false,
    });
    expect(booted.phase).toBe("ready-to-place");
  });
});

describe("setupReducer — cache-miss placement branch", () => {
  it("advances awaiting-tracking → ready-to-place when tracking becomes ready", () => {
    const s = setupReducer(boot(false), {
      type: "TRACKING_READY_CHANGED",
      ready: true,
    });
    expect(s.phase).toBe("ready-to-place");
    expect(s.trackingReady).toBe(true);
  });

  it("regresses ready-to-place → awaiting-tracking when tracking degrades", () => {
    let s = setupReducer(boot(false), {
      type: "TRACKING_READY_CHANGED",
      ready: true,
    });
    s = setupReducer(s, { type: "TRACKING_READY_CHANGED", ready: false });
    expect(s.phase).toBe("awaiting-tracking");
    expect(s.trackingReady).toBe(false);
  });

  it("SOFT GATE (D2): placement is allowed even before tracking is ready", () => {
    const awaiting = boot(false);
    expect(awaiting.phase).toBe("awaiting-tracking");
    expect(canPlaceAnchor(awaiting)).toBe(true);

    const ready = setupReducer(awaiting, {
      type: "TRACKING_READY_CHANGED",
      ready: true,
    });
    expect(canPlaceAnchor(ready)).toBe(true);
  });

  it("PLACE_REQUESTED moves into the saving in-progress phase", () => {
    const s = setupReducer(boot(false), { type: "PLACE_REQUESTED" });
    expect(s.phase).toBe("saving");
    // While saving, no second placement may be dispatched.
    expect(canPlaceAnchor(s)).toBe(false);
  });

  it("PLACE_SUCCEEDED moves saving → saved (final state, prompts reload)", () => {
    let s = setupReducer(boot(false), { type: "PLACE_REQUESTED" });
    s = setupReducer(s, { type: "PLACE_SUCCEEDED" });
    expect(s.phase).toBe("saved");
  });

  it("PLACE_FAILED reverts saving → placeable phase and surfaces the error", () => {
    // tracking was ready before placing → revert to ready-to-place.
    let s = setupReducer(boot(false), {
      type: "TRACKING_READY_CHANGED",
      ready: true,
    });
    s = setupReducer(s, { type: "PLACE_REQUESTED" });
    expect(s.phase).toBe("saving");
    s = setupReducer(s, { type: "PLACE_FAILED", message: "disk full" });
    expect(s.phase).toBe("ready-to-place");
    expect(s.errorMessage).toBe("disk full");
  });

  it("PLACE_FAILED reverts to awaiting-tracking when tracking was not ready", () => {
    let s = setupReducer(boot(false), { type: "PLACE_REQUESTED" });
    s = setupReducer(s, { type: "PLACE_FAILED", message: "nope" });
    expect(s.phase).toBe("awaiting-tracking");
    expect(s.errorMessage).toBe("nope");
  });

  it("a fresh PLACE_REQUESTED clears a previous error message", () => {
    let s = setupReducer(boot(false), { type: "PLACE_REQUESTED" });
    s = setupReducer(s, { type: "PLACE_FAILED", message: "boom" });
    expect(s.errorMessage).toBe("boom");
    s = setupReducer(s, { type: "PLACE_REQUESTED" });
    expect(s.errorMessage).toBeNull();
  });

  it("PLACE_BLOCKED surfaces a hint without leaving the placeable phase", () => {
    // A press that cannot place yet (no surface / no alignment) must show the
    // hint but never enter `saving` — the phase stays placeable and the button
    // stays enabled so the user can retry after pointing at the ground.
    const s = setupReducer(boot(false), {
      type: "PLACE_BLOCKED",
      message: "point at the ground",
    });
    expect(s.phase).toBe("awaiting-tracking");
    expect(s.errorMessage).toBe("point at the ground");
  });

  it("PLACE_BLOCKED is a no-op once a save is in flight (cannot clobber saving)", () => {
    const s = setupReducer(boot(false), { type: "PLACE_REQUESTED" });
    expect(s.phase).toBe("saving");
    const same = setupReducer(s, {
      type: "PLACE_BLOCKED",
      message: "ignored",
    });
    expect(same).toBe(s);
  });

  it("a subsequent PLACE_REQUESTED clears a PLACE_BLOCKED hint", () => {
    let s = setupReducer(boot(false), {
      type: "PLACE_BLOCKED",
      message: "point at the ground",
    });
    s = setupReducer(s, { type: "PLACE_REQUESTED" });
    expect(s.phase).toBe("saving");
    expect(s.errorMessage).toBeNull();
  });
});

describe("setupReducer — cache-hit relocalise branch", () => {
  it("advances relocalising → anchor-shown when tracking becomes ready", () => {
    const s = setupReducer(boot(true), {
      type: "TRACKING_READY_CHANGED",
      ready: true,
    });
    expect(s.phase).toBe("anchor-shown");
    expect(s.trackingReady).toBe(true);
  });

  it("does not offer placement in the relocalise branch (soft gate is placement-only)", () => {
    expect(canPlaceAnchor(boot(true))).toBe(false);
    const shown = setupReducer(boot(true), {
      type: "TRACKING_READY_CHANGED",
      ready: true,
    });
    expect(canPlaceAnchor(shown)).toBe(false);
  });

  // Why this matters: the cache-hit branch must be symmetric on tracking loss,
  // mirroring the cache-miss `ready-to-place ⇄ awaiting-tracking` revert. If
  // `anchor-shown` stayed put when tracking is lost, the placement banner would
  // keep claiming "Your saved anchor is shown at its real-world spot." while the
  // guidance meter (driven by the live tracking report) shows the loss — a
  // contradictory UI, and an internally inconsistent {anchor-shown,
  // trackingReady:false} state. (PR #53, gemini comment on setup-state-machine.)
  it("reverts anchor-shown → relocalising when tracking is lost, then re-advances", () => {
    const shown = setupReducer(boot(true), {
      type: "TRACKING_READY_CHANGED",
      ready: true,
    });
    expect(shown.phase).toBe("anchor-shown");

    const lost = setupReducer(shown, {
      type: "TRACKING_READY_CHANGED",
      ready: false,
    });
    expect(lost.phase).toBe("relocalising");
    expect(lost.trackingReady).toBe(false);

    // Round-trip: regaining tracking shows the anchor again.
    const reshown = setupReducer(lost, {
      type: "TRACKING_READY_CHANGED",
      ready: true,
    });
    expect(reshown.phase).toBe("anchor-shown");
    expect(reshown.trackingReady).toBe(true);
  });
});

describe("setupReducer — robustness", () => {
  it("ignores out-of-branch events instead of throwing", () => {
    // PLACE_REQUESTED while still booting is a no-op.
    const s = setupReducer(initialSetupState, { type: "PLACE_REQUESTED" });
    expect(s).toBe(initialSetupState);
  });

  it("ignores BOOTED after boot (idempotent guard)", () => {
    const placed = boot(false);
    const again = setupReducer(placed, {
      type: "BOOTED",
      hasCachedAnchor: true,
    });
    expect(again.phase).toBe("awaiting-tracking");
  });
});
