import { beforeEach, describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { CHAPTER_COUNT } from "../chapters";
import { buildClayWorld, WORLD_NODE } from "./clay-world";
import { buildDotPerson } from "./dot-person";
import { buildMarkerPair } from "./markers";
import { buildPhoneFrame } from "./phone-frame";
import {
  buildIntroTimeline,
  buildStoryTimeline,
  CHAPTER_DURATION_MS,
  chapterEndTime,
  createStoryStage,
  syncStage,
  type StoryStage,
} from "./story-timeline";

// Why this test matters: the story timeline is scrubbed by scroll progress,
// so nothing ever "plays" during tests or CI — the only way to catch a
// broken chapter is to seek the timeline and assert the scene actually
// changed. These tests pin the core promises: the scrub covers all
// chapters, cameras move, the raw marker jitters while the fused one holds
// still (the product message!), and seeking back restores the start state.

function makeStage(): StoryStage {
  return createStoryStage({
    world: buildClayWorld("low"),
    person: buildDotPerson(),
    markers: buildMarkerPair(),
    phone: buildPhoneFrame(),
    camera: new PerspectiveCamera(55, 16 / 9),
  });
}

describe("buildStoryTimeline", () => {
  let stage: StoryStage;

  beforeEach(() => {
    stage = makeStage();
  });

  it("covers every chapter with the fixed per-chapter duration", () => {
    const timeline = buildStoryTimeline(stage, () => {});
    expect(timeline.duration).toBe(CHAPTER_COUNT * CHAPTER_DURATION_MS);
    expect(chapterEndTime(2)).toBe(3 * CHAPTER_DURATION_MS - 1);
  });

  it("moves the camera between chapters when scrubbed", () => {
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    const heroPos = stage.camera.position.clone();
    timeline.seek(chapterEndTime(1)); // end of QR chapter
    expect(stage.camera.position.distanceTo(heroPos)).toBeGreaterThan(1);
  });

  it("jitters the raw marker during fusion while the fused anchor holds still", () => {
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    const rawStart = stage.markers.raw.position.clone();
    const fusedStart = stage.markers.fused.position.clone();

    let rawMoved = false;
    const fusionStart = 2 * CHAPTER_DURATION_MS;
    for (let i = 1; i <= 8; i++) {
      timeline.seek(fusionStart + (i * CHAPTER_DURATION_MS) / 10);
      if (stage.markers.raw.position.distanceTo(rawStart) > 0.05) {
        rawMoved = true;
      }
      // The fused anchor must NEVER move — that stability is the message.
      expect(stage.markers.fused.position.distanceTo(fusedStart)).toBeLessThan(
        1e-6,
      );
    }
    expect(rawMoved).toBe(true);
  });

  it("walks the dot-person along the path as the story progresses", () => {
    // Contract: after every seek the render loop calls syncStage — anime
    // fires onUpdate BEFORE tween values apply, so deriving person
    // placement inside the callback would lag one seek behind.
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    syncStage(stage);
    const start = stage.person.position.clone();
    timeline.seek(chapterEndTime(2));
    syncStage(stage);
    expect(stage.person.position.distanceTo(start)).toBeGreaterThan(3);
    // Walking means staying on the ground.
    expect(stage.person.position.y).toBeCloseTo(0, 3);
  });

  it("reveals the AR content + phone during the dive and the gallery in its chapter", () => {
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    const phoneScaleBefore = stage.phone.scale.x;
    timeline.seek(chapterEndTime(3)); // end of dive
    expect(stage.phone.scale.x).toBeGreaterThan(phoneScaleBefore);
    // The AR content must be fully in place while looking through the
    // phone window (round-1 feedback: overlays live in the WORLD now).
    const arContent = stage.world.getObjectByName(WORLD_NODE.arContent);
    expect(arContent?.scale.x ?? 0).toBeGreaterThan(0.9);

    const gallery = stage.world.getObjectByName(WORLD_NODE.gallery);
    timeline.seek(chapterEndTime(5)); // end of gallery chapter
    expect(gallery?.scale.x ?? 0).toBeGreaterThan(0.9);
  });

  it("notifies the render loop on every scrub update", () => {
    let updates = 0;
    const timeline = buildStoryTimeline(stage, () => {
      updates++;
    });
    timeline.seek(1234);
    expect(updates).toBeGreaterThan(0);
  });

  it("scrubbing back to the start restores the hero framing", () => {
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    const heroPos = stage.camera.position.clone();
    timeline.seek(chapterEndTime(4));
    timeline.seek(50);
    expect(stage.camera.position.distanceTo(heroPos)).toBeLessThan(0.5);
  });
});

describe("buildIntroTimeline", () => {
  it("is a short, finite auto-intro that ends on the hero framing", () => {
    const stage = makeStage();
    const story = buildStoryTimeline(stage, () => {});
    story.seek(0);
    const heroPos = stage.camera.position.clone();

    const intro = buildIntroTimeline(stage, () => {});
    expect(intro.duration).toBeGreaterThan(500);
    expect(intro.duration).toBeLessThan(4000);
    intro.seek(intro.duration);
    // The intro must hand over seamlessly: its end state is the story's
    // hero framing (otherwise the first scroll would jump-cut).
    expect(stage.camera.position.distanceTo(heroPos)).toBeLessThan(0.5);
    expect(stage.person.scale.x).toBeCloseTo(1, 2);
  });
});

describe("createStoryStage", () => {
  it("places the markers beside the path anchor and the person at the walk start", () => {
    const stage = makeStage();
    expect(
      stage.markers.raw.position.distanceTo(stage.markers.fused.position),
    ).toBeGreaterThan(1.5);
    expect(stage.person.position.length()).toBeGreaterThan(0); // on the path, not at origin
    // Lens target starts at the world center so the hero framing looks at
    // the miniature world.
    expect(stage.lookTarget).toBeInstanceOf(Vector3);
  });
});
