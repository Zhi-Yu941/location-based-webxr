import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { PerspectiveCamera } from "three";
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

// Why this test matters: anime.js captures tween start values lazily on
// first render, so a pathological seek history could in principle poison
// later from-values — which would surface exactly as the "hard jumps after
// scrolling around" the round-1 feedback reported. This property pins that
// the scene state at any time t is INDEPENDENT of the scrub path taken to
// get there: arbitrary seek histories must land on the same state as a
// fresh timeline seeked straight to t.

function makeStage(): StoryStage {
  return createStoryStage({
    world: buildClayWorld("low"),
    person: buildDotPerson(),
    markers: buildMarkerPair(),
    phone: buildPhoneFrame(),
    camera: new PerspectiveCamera(55, 16 / 9),
  });
}

describe("story timeline scrub-path independence", () => {
  it("state at t is the same regardless of the seek history", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 7000, noNaN: true }), {
          minLength: 1,
          maxLength: 12,
        }),
        fc.double({ min: 0, max: 7000, noNaN: true }),
        (history, finalT) => {
          const scrubbed = makeStage();
          const scrubbedTl = buildStoryTimeline(scrubbed, () => {});
          for (const t of history) {
            scrubbedTl.seek(t);
          }
          scrubbedTl.seek(finalT);
          syncStage(scrubbed);

          const fresh = makeStage();
          const freshTl = buildStoryTimeline(fresh, () => {});
          freshTl.seek(finalT);
          syncStage(fresh);

          expect(
            scrubbed.camera.position.distanceTo(fresh.camera.position),
            `camera diverged at t=${finalT} after history ${history.join(",")}`,
          ).toBeLessThan(1e-3);
          expect(
            scrubbed.person.position.distanceTo(fresh.person.position),
          ).toBeLessThan(1e-3);
          expect(
            scrubbed.markers.raw.position.distanceTo(
              fresh.markers.raw.position,
            ),
          ).toBeLessThan(1e-3);
          expect(scrubbed.lookTarget.distanceTo(fresh.lookTarget)).toBeLessThan(
            1e-3,
          );
        },
      ),
      { numRuns: 30 },
    );
  });
});
