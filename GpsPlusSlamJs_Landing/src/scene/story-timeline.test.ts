import { beforeEach, describe, expect, it } from "vitest";
import {
  PerspectiveCamera,
  Vector3,
  type Mesh,
  type MeshStandardMaterial,
} from "three";
import { CHAPTER_COUNT } from "../chapters";
import { buildClayWorld, VIGNETTE_ANCHORS, WORLD_NODE } from "./clay-world";
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

  it("opens far out and keeps flying through the whole hero window (round-12 R12-1)", () => {
    // The story must start with a sense of the WHOLE world and the
    // camera must never stand still — it immediately approaches the QR.
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(1);
    expect(stage.camera.position.length()).toBeGreaterThan(45);
    timeline.seek(600);
    const midWindow = stage.camera.position.clone();
    timeline.seek(950);
    // Still moving LATE in the hero window (no settled dead zone).
    expect(stage.camera.position.distanceTo(midWindow)).toBeGreaterThan(0.5);
  });

  it("flies the gallery journey past the campus and arrives at the castle for the CTA (round-11)", () => {
    // The maintainer's brainstorm: the gallery chapter is a use-case
    // JOURNEY (city sweep → campus flyover → castle), and the CTA is an
    // ARRIVAL — the camera rests at the castle instead of returning to
    // the start framing.
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    const heroPos = stage.camera.position.clone();

    timeline.seek(chapterEndTime(5)); // gallery end: campus flyover
    syncStage(stage);
    expect(
      stage.camera.position.distanceTo(VIGNETTE_ANCHORS.campus),
    ).toBeLessThan(22);

    timeline.seek(chapterEndTime(6)); // CTA: resting at the castle
    syncStage(stage);
    expect(
      stage.camera.position.distanceTo(VIGNETTE_ANCHORS.castle),
    ).toBeLessThan(30);
    // No return-to-start: the arrival is the point.
    expect(stage.camera.position.distanceTo(heroPos)).toBeGreaterThan(30);
    // And the camera actually LOOKS at the castle.
    expect(
      stage.lookTarget.distanceTo(
        VIGNETTE_ANCHORS.castle.clone().add(new Vector3(0, 2.5, 0)),
      ),
    ).toBeLessThan(8);
  });

  it("moves the camera between chapters when scrubbed", () => {
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    const heroPos = stage.camera.position.clone();
    timeline.seek(chapterEndTime(1)); // end of QR chapter
    expect(stage.camera.position.distanceTo(heroPos)).toBeGreaterThan(1);
  });

  it("keeps the GPS rings still and reveals the averaging connectors during fusion", () => {
    // Round-2 R8: instead of wandering rings, the fusion chapter shows
    // STATIC scattered readings and draws connector lines whose meeting
    // point is the red pin — "average the scatter" as a picture. Neither
    // the rings nor the pin may move.
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    const rawStart = stage.markers.raw.position.clone();
    const fusedStart = stage.markers.fused.position.clone();
    expect(stage.markers.connectors.scale.x).toBeLessThan(0.01);

    const fusionStart = 2 * CHAPTER_DURATION_MS;
    for (let i = 1; i <= 8; i++) {
      timeline.seek(fusionStart + (i * CHAPTER_DURATION_MS) / 10);
      expect(stage.markers.raw.position.distanceTo(rawStart)).toBeLessThan(
        1e-6,
      );
      expect(stage.markers.fused.position.distanceTo(fusedStart)).toBeLessThan(
        1e-6,
      );
    }
    timeline.seek(chapterEndTime(2));
    expect(stage.markers.connectors.scale.x).toBeGreaterThan(0.9);
  });

  it("shrinks the accuracy ring UNDER the bouncing person and fades it out with the landing", () => {
    // Round-2 R6 set the collapse; round-8 Z1 re-timed it: the ring used
    // to be gone BEFORE the person arrived (dead stretch while
    // scrolling). Now it fades in late, shrinks WHILE the person bounces
    // on it, and disappears as the bouncing settles. All seek-driven;
    // scrubbing back restores the pre-drop sky position (covered by the
    // scrub-path-independence property).
    const timeline = buildStoryTimeline(stage, () => {});
    const ring = stage.world.getObjectByName(WORLD_NODE.snapRing);
    expect(ring).toBeDefined();
    const ringMaterial = (ring?.children[0] as Mesh | undefined)
      ?.material as MeshStandardMaterial;
    expect(ringMaterial).toBeDefined();

    timeline.seek(50);
    syncStage(stage);
    expect(stage.person.position.y).toBeGreaterThan(5); // still in the sky
    expect(stage.person.scale.x).toBeLessThan(0.01);

    timeline.seek(1250); // early in the chapter: ring NOT visible yet (Z1)
    expect(ringMaterial.opacity).toBeLessThan(0.1);

    timeline.seek(1450); // faded in, still LARGE (pre-drop)
    expect(ringMaterial.opacity).toBeGreaterThan(0.5);
    expect(ring?.scale.x ?? 0).toBeGreaterThan(2);

    timeline.seek(1700); // mid-bounce: visible AND mid-shrink (Z1 overlap)
    syncStage(stage);
    expect(ringMaterial.opacity).toBeGreaterThan(0.5);
    expect(ring?.scale.x ?? 0).toBeGreaterThan(0.2);
    expect(ring?.scale.x ?? 99).toBeLessThan(2.5);
    expect(stage.person.scale.x).toBeCloseTo(1, 2); // person already down here

    timeline.seek(chapterEndTime(1)); // QR chapter done: bounce settled…
    syncStage(stage);
    expect(ring?.scale.x ?? 99).toBeLessThan(0.2); // collapsed = precise fix
    expect(ringMaterial.opacity).toBeLessThan(0.1); // …and the ring is gone
    expect(stage.person.position.y).toBeCloseTo(0, 2); // landed
    expect(stage.person.scale.x).toBeCloseTo(1, 2);
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

  it("reveals the AR content + phone during the dive", () => {
    const timeline = buildStoryTimeline(stage, () => {});
    timeline.seek(50);
    const phoneScaleBefore = stage.phone.scale.x;
    timeline.seek(chapterEndTime(3)); // end of dive
    expect(stage.phone.scale.x).toBeGreaterThan(phoneScaleBefore);
    // The AR content must be fully in place while looking through the
    // phone window (round-1 feedback: overlays live in the WORLD now).
    const arContent = stage.world.getObjectByName(WORLD_NODE.arContent);
    expect(arContent?.scale.x ?? 0).toBeGreaterThan(0.9);
  });

  it("sequences the dive (round-4 V2 + round-5 W2/W3): camera settles at the LEFT shoulder, phone launches WITH the person fade, AR appears with the phone's arrival", () => {
    // Round-4 set the dramaturgy (camera in close → phone → AR); round-5
    // refined it: the camera stops beside the LEFT shoulder instead of
    // above the head, and the phone must launch the MOMENT the person
    // starts fading (the round-4 gap — person long gone, empty frame,
    // phone arrives late — was explicitly flagged). AR still waits for
    // the phone's arrival.
    const timeline = buildStoryTimeline(stage, () => {});
    const arContent = stage.world.getObjectByName(WORLD_NODE.arContent);

    timeline.seek(3510); // just after the person fade begins (3480)
    syncStage(stage);
    expect(stage.person.scale.x).toBeLessThan(1); // fading out...
    expect(stage.phone.scale.x).toBeGreaterThan(0.05); // ...phone launching

    timeline.seek(3550); // camera-settle time (framing tweens = 55% window)
    syncStage(stage);
    const offsetX = stage.camera.position.x - stage.person.position.x;
    const offsetZ = stage.camera.position.z - stage.person.position.z;
    expect(Math.hypot(offsetX, offsetZ)).toBeLessThan(1.0); // in close
    expect(stage.camera.position.y).toBeLessThan(1.7); // shoulder, not overhead
    // On the person's LEFT: left = up × walking direction = (tz, 0, -tx).
    const tangent = stage.curve.getTangentAt(0.5);
    expect(offsetX * tangent.z + offsetZ * -tangent.x).toBeGreaterThan(0.25);

    timeline.seek(3700); // phone mid-flight
    expect(stage.person.scale.x).toBeLessThan(0.01); // person gone
    expect(stage.phone.scale.x).toBeGreaterThan(0.1);
    expect(arContent?.scale.x ?? 99).toBeLessThan(0.05); // AR still waiting

    timeline.seek(chapterEndTime(3)); // phone at target
    expect(stage.phone.scale.x).toBeGreaterThan(0.9);
    expect(arContent?.scale.x ?? 0).toBeGreaterThan(0.9); // faded in with it
  });

  it("grows the phone monotonically — no overshoot-and-shrink (round-7 Y4)", () => {
    // Round-7 feedback: the frame briefly filled the screen, then visibly
    // SHRANK again — the outBack scale-in overshoots ~10 % past the final
    // size and settles back. The scale must never decrease while the
    // phone is on its way in.
    const timeline = buildStoryTimeline(stage, () => {});
    let previous = 0;
    for (let t = 3480; t <= chapterEndTime(3); t += 5) {
      timeline.seek(t);
      expect(stage.phone.scale.x).toBeGreaterThanOrEqual(previous - 1e-6);
      previous = stage.phone.scale.x;
    }
  });

  it("hides the person inside the phone view and restores them on the pull-back", () => {
    // Once the camera is "inside" the phone view the person disappears
    // (you cannot see yourself through your own phone) and returns on the
    // pull-back. (The round-2 R10 arm raise was removed in round-5 W1.)
    const timeline = buildStoryTimeline(stage, () => {});

    timeline.seek(2999); // just before the dive: walking, fully visible
    expect(stage.person.scale.x).toBeCloseTo(1, 2);

    timeline.seek(chapterEndTime(3)); // inside the phone view
    expect(stage.person.scale.x).toBeLessThan(0.01);

    timeline.seek(chapterEndTime(4)); // pulled back out
    expect(stage.person.scale.x).toBeCloseTo(1, 2);
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
    // The person stays hidden through the intro — they enter the story by
    // sky-dropping at the QR chapter (round-2 R6).
    expect(stage.person.scale.x).toBeLessThan(0.01);
  });
});

describe("createStoryStage", () => {
  it("stacks rings, connectors and pin on ONE anchor and places the person at the walk start", () => {
    const stage = makeStage();
    // Round-2 R5: pin and ring group share the anchor — the rings scatter
    // via their internal offsets, whose average is the pin.
    expect(
      stage.markers.raw.position.distanceTo(stage.markers.fused.position),
    ).toBeLessThan(0.01);
    expect(
      stage.markers.connectors.position.distanceTo(
        stage.markers.fused.position,
      ),
    ).toBeLessThan(0.01);
    expect(stage.person.position.length()).toBeGreaterThan(0); // on the path, not at origin
    // Lens target starts at the world center so the hero framing looks at
    // the miniature world.
    expect(stage.lookTarget).toBeInstanceOf(Vector3);
  });

  it("anchors the phone so its SCREEN fills the mobile viewport at final size (round-7 Y4, supersedes round-5 W4)", () => {
    // Round-7 feedback: AR objects (markers, label, arrows) must never be
    // visible OUTSIDE the phone screen on phones — impossible in reality.
    // So at the anchor distance the 0.82×1.72 screen plane must cover the
    // FULL mobile-portrait width, and the frame's outer edge (bars up to
    // ±0.95) must reach past the frustum's top/bottom so the remainder is
    // frame, not world. (Round-5 W4's "frame fits entirely with margin"
    // pin is deliberately gone — visible edge bars + the glass screen now
    // carry the "this is a phone" message instead.)
    const stage = makeStage();
    const distance = Math.abs(stage.phone.position.z);
    const halfHeight =
      Math.tan(((stage.camera.fov / 2) * Math.PI) / 180) * distance;
    const halfWidthPortrait = halfHeight * (412 / 915);
    // Screen half-width 0.41 covers the portrait frustum width…
    expect(0.41 - Math.abs(stage.phone.position.x)).toBeGreaterThanOrEqual(
      halfWidthPortrait,
    );
    // …and the frame reaches past the viewport's top/bottom edge.
    expect(0.95 - Math.abs(stage.phone.position.y)).toBeGreaterThanOrEqual(
      halfHeight,
    );
  });
});
