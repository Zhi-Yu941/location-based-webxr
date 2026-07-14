/**
 * Why these tests matter: the hero idle beat (catalog №6) fires ONCE per
 * visit after the visitor rests at the hero >60 s (scroll ≈ 0, tab
 * visible) — off under reduced motion. The timer must only accrue while
 * genuinely idle-at-hero (scrolling away resets the wait), must fire
 * exactly once, and the peek must be a self-contained animation that
 * returns the peeker fully hidden.
 */
import { describe, expect, it } from "vitest";
import { buildHeroPeeker, createHeroIdleBeat, HERO_IDLE_MS } from "./hero-idle";

describe("buildHeroPeeker", () => {
  it("builds a named peeker that starts hidden below the bush", () => {
    const { group, peeker } = buildHeroPeeker();
    expect(group.name).toBe("hero-idle");
    // Peeker parked out of sight (below ground / scaled away).
    expect(peeker.position.y).toBeLessThan(0);
  });
});

describe("createHeroIdleBeat", () => {
  it("fires the peek only after HERO_IDLE_MS of continuous idle-at-hero", () => {
    const { group, peeker } = buildHeroPeeker();
    const beat = createHeroIdleBeat(group, peeker);
    // Idle but not yet long enough: peeker stays down.
    beat.update(0, true);
    beat.update(HERO_IDLE_MS - 1000, true);
    expect(peeker.position.y).toBeLessThan(0);
    // Cross the threshold, then let the peek animate into its hold: rises.
    beat.update(HERO_IDLE_MS + 10, true);
    beat.update(HERO_IDLE_MS + 1200, true);
    expect(peeker.position.y).toBeGreaterThan(0);
  });

  it("resets the wait when the visitor scrolls away before the threshold", () => {
    const { group, peeker } = buildHeroPeeker();
    const beat = createHeroIdleBeat(group, peeker);
    beat.update(0, true);
    beat.update(HERO_IDLE_MS - 5000, true);
    // Scrolled away (not idle) → the clock restarts from here.
    beat.update(HERO_IDLE_MS, false);
    beat.update(HERO_IDLE_MS + 5000, true); // new idle begins here
    expect(peeker.position.y).toBeLessThan(0); // not fired yet
    // Full window from the restart (idle began at HERO_IDLE_MS + 5000),
    // then let the peek animate into its hold.
    const fireAt = HERO_IDLE_MS + 5000 + HERO_IDLE_MS;
    beat.update(fireAt + 10, true); // crosses the threshold
    beat.update(fireAt + 1200, true);
    expect(peeker.position.y).toBeGreaterThan(0);
  });

  it("fires exactly once per visit and ends fully hidden", () => {
    const { group, peeker } = buildHeroPeeker();
    const beat = createHeroIdleBeat(group, peeker);
    beat.update(0, true);
    // Run well past the peek so it completes.
    for (let t = HERO_IDLE_MS; t <= HERO_IDLE_MS + 6000; t += 100) {
      beat.update(t, true);
    }
    expect(peeker.position.y).toBeLessThan(0); // retracted
    expect(group.visible).toBe(false);
    // Staying idle much longer never re-fires (once per visit).
    let rose = false;
    for (let t = HERO_IDLE_MS + 6000; t <= 4 * HERO_IDLE_MS; t += 500) {
      beat.update(t, true);
      if (peeker.position.y > 0) {
        rose = true;
      }
    }
    expect(rose).toBe(false);
  });
});
