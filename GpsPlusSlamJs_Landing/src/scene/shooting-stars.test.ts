/**
 * Why these tests matter: shooting stars (catalog №7) are a rare ambient
 * delight gated exactly like the satellites (dark palettes only, same
 * continuous-render gate). The schedule MUST be a deterministic function
 * of the clock (no runtime Math.random — that would break scrub-path
 * independence and make the effect impossible to reason about), the
 * streak must actually cross the sky during its ~1.2 s window, and it
 * must stay hidden both between events and entirely in light palettes.
 */
import { describe, expect, it } from "vitest";
import {
  buildShootingStar,
  SHOOTING_STAR_NAME,
  STREAK_DURATION_MS,
  updateShootingStar,
} from "./shooting-stars";

function poseKey(group: ReturnType<typeof buildShootingStar>): string {
  return `${group.visible}:${group.position.toArray().join(",")}`;
}

/** Scan the schedule for the first active streak window start. */
function firstActiveTime(): number {
  const group = buildShootingStar();
  for (let t = 0; t <= 120_000; t += 200) {
    if (updateShootingStar(group, t, true)) {
      return t;
    }
  }
  throw new Error("no shooting star fired within 2 minutes");
}

describe("shooting stars", () => {
  it("builds a named, initially hidden streak", () => {
    const group = buildShootingStar();
    expect(group.name).toBe(SHOOTING_STAR_NAME);
    expect(group.visible).toBe(false);
    expect(group.children.length).toBeGreaterThanOrEqual(1);
  });

  it("stays hidden in light palettes (enabled = false), always", () => {
    const group = buildShootingStar();
    for (let t = 0; t <= 120_000; t += 250) {
      expect(updateShootingStar(group, t, false)).toBe(false);
      expect(group.visible).toBe(false);
    }
  });

  it("fires at least once within a couple of minutes and crosses the sky", () => {
    const group = buildShootingStar();
    const start = firstActiveTime();
    // Sample across the streak window: it must be visible and MOVE.
    updateShootingStar(group, start, true);
    const a = group.position.clone();
    updateShootingStar(group, start + STREAK_DURATION_MS * 0.6, true);
    const b = group.position.clone();
    expect(group.visible).toBe(true);
    expect(a.distanceTo(b)).toBeGreaterThan(2);
    // High in the sky, not down among the world.
    expect(group.position.y).toBeGreaterThan(15);
  });

  it("hides again after the streak window", () => {
    const group = buildShootingStar();
    const start = firstActiveTime();
    updateShootingStar(group, start + STREAK_DURATION_MS + 500, true);
    expect(group.visible).toBe(false);
  });

  it("is a pure function of the clock (history-independent)", () => {
    const a = buildShootingStar();
    const b = buildShootingStar();
    const t = firstActiveTime() + 300;
    updateShootingStar(a, 999, true);
    updateShootingStar(a, 50_000, true);
    updateShootingStar(a, t, true);
    updateShootingStar(b, t, true);
    expect(poseKey(a)).toEqual(poseKey(b));
  });

  it("spaces events 30–60 s apart (deterministic schedule)", () => {
    const group = buildShootingStar();
    const starts: number[] = [];
    let prevActive = false;
    for (let t = 0; t <= 300_000; t += 100) {
      const active = updateShootingStar(group, t, true);
      if (active && !prevActive) {
        starts.push(t);
      }
      prevActive = active;
    }
    expect(starts.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i]! - starts[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(30_000);
      expect(gap).toBeLessThanOrEqual(60_000 + STREAK_DURATION_MS);
    }
  });
});
