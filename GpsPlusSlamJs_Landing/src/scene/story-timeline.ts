import "animejs/adapters/three";
import { createTimeline, type Timeline } from "animejs";
import { Vector3, type Group, type PerspectiveCamera } from "three";
import { CHAPTER_COUNT } from "../chapters";
import { createPathCurve, WORLD_ANCHORS, WORLD_NODE } from "./clay-world";
import type { MarkerPair } from "./markers";

/**
 * The scroll-scrubbed story timeline: one anime.js timeline covering all
 * chapters (CHAPTER_DURATION_MS each), NEVER auto-played — the render loop
 * seeks it from scroll progress (or to a chapter end state under reduced
 * motion). The anime.js three.js adapter (side-effect import above) lets
 * tweens target cameras, groups and vectors directly.
 *
 * Camera orientation is decoupled from position: tweens move the camera
 * and a bare `lookTarget` Vector3; the render loop calls
 * `camera.lookAt(stage.lookTarget)` before every render.
 *
 * The separate intro timeline plays ONCE on load (motion permitting) and
 * ends exactly on the story's hero framing so the first scroll never
 * jump-cuts.
 */

export const CHAPTER_DURATION_MS = 1000;

/** Last timeline ms that still belongs to chapter `index`. */
export function chapterEndTime(index: number): number {
  return (index + 1) * CHAPTER_DURATION_MS - 1;
}

/** Everything the timelines animate, plus the walk-path state. */
export interface StoryStage {
  readonly world: Group;
  readonly person: Group;
  readonly markers: MarkerPair;
  readonly phone: Group;
  readonly camera: PerspectiveCamera;
  /** The point the camera looks at; animated as a bare Vector3. */
  readonly lookTarget: Vector3;
  /** Path parameter of the dot-person, animated 0..1. */
  readonly walk: { t: number };
  readonly curve: ReturnType<typeof createPathCurve>;
}

const HERO_CAMERA = new Vector3(20, 19, 20);
const MARKER_GAP = 1.2;

export interface StageParts {
  readonly world: Group;
  readonly person: Group;
  readonly markers: MarkerPair;
  readonly phone: Group;
  readonly camera: PerspectiveCamera;
}

/**
 * Compose the stage: positions every prop for the story start and prepares
 * the reveal groups (visible but scaled/lowered away) so the scrubbed
 * timeline can reveal them with tweenable properties. Mutates the passed
 * objects — call once at boot.
 */
export function createStoryStage(parts: StageParts): StoryStage {
  const curve = createPathCurve();
  const walk = { t: 0.02 };

  parts.person.position.copy(curve.getPointAt(walk.t));

  parts.markers.raw.position
    .copy(WORLD_ANCHORS.markerPair)
    .add(new Vector3(-MARKER_GAP, 0, 0));
  parts.markers.fused.position
    .copy(WORLD_ANCHORS.markerPair)
    .add(new Vector3(MARKER_GAP, 0, 0));

  // The phone is held "in front of the lens": parent it to the camera so
  // the dive works regardless of where the camera flies.
  parts.camera.add(parts.phone);
  parts.phone.position.set(0, -0.12, -1.6);
  parts.phone.visible = true;
  parts.phone.scale.setScalar(0.001);

  // Reveal groups become visible-but-hidden via tweenable properties.
  const outer = parts.world.getObjectByName(WORLD_NODE.outer);
  if (outer) {
    outer.visible = true;
    outer.position.y = -6;
  }
  const gallery = parts.world.getObjectByName(WORLD_NODE.gallery);
  if (gallery) {
    gallery.visible = true;
    gallery.scale.setScalar(0.001);
  }
  const snapRing = parts.world.getObjectByName(WORLD_NODE.snapRing);
  if (snapRing) {
    snapRing.visible = true;
    snapRing.scale.setScalar(0.001);
  }

  parts.camera.position.copy(HERO_CAMERA);
  const lookTarget = new Vector3(0, 2, 0);
  parts.camera.lookAt(lookTarget);

  return { ...parts, lookTarget, walk, curve };
}

/**
 * Re-derive state that follows animated values: glue the dot-person to the
 * path position/heading for the current `walk.t`.
 *
 * MUST be called after every `timeline.seek(...)` (the render loop does
 * this): anime.js fires `onUpdate` BEFORE child tween values are applied,
 * so deriving inside the callback would lag one seek behind.
 */
export function syncStage(stage: StoryStage): void {
  const t = Math.min(1, Math.max(0, stage.walk.t));
  const point = stage.curve.getPointAt(t);
  stage.person.position.set(point.x, 0, point.z);
  const tangent = stage.curve.getTangentAt(t);
  stage.person.rotation.y = Math.atan2(tangent.x, tangent.z);
}

/**
 * Build the master story timeline (paused; scrub via `seek`, then call
 * `syncStage`). `onUpdate` fires on every applied scrub — the render loop
 * uses it as its dirty flag.
 */
export function buildStoryTimeline(
  stage: StoryStage,
  onUpdate: () => void,
): Timeline {
  const timeline = createTimeline({
    autoplay: false,
    // composition 'none' is load-bearing: with the default 'replace', the
    // intro timeline (created later, touching the same camera properties)
    // silently CANCELS these tweens. Both timelines are seek-driven, so
    // last-seeked-wins is exactly the semantics we want.
    defaults: {
      ease: "inOutSine",
      duration: CHAPTER_DURATION_MS,
      composition: "none",
    },
    onUpdate,
  });

  const { camera, lookTarget, walk, world, markers, phone } = stage;
  const rawBase = markers.raw.position.clone();

  // ── Chapter 0: hero — slow push-in on the miniature world.
  timeline.add(camera, { x: 16.5, y: 15, z: 16.5 }, 0);
  timeline.add(lookTarget, { y: 1.5 }, 0);

  // ── Chapter 1: QR = door + instant anchor.
  timeline.add(camera, { x: -3.5, y: 4.5, z: 15.5 }, 1000);
  timeline.add(
    lookTarget,
    { x: WORLD_ANCHORS.sign.x, y: 1.6, z: WORLD_ANCHORS.sign.z, duration: 800 },
    1000,
  );
  timeline.add(walk, { t: 0.14 }, 1000);
  // The world "snaps into alignment": a settling wiggle with decaying
  // amplitude, ending perfectly at rest.
  timeline.add(
    world,
    {
      x: [
        { to: 0.28, duration: 150 },
        { to: -0.18, duration: 150 },
        { to: 0.08, duration: 150 },
        { to: 0, duration: 150 },
      ],
    },
    1200,
  );
  const snapRing = world.getObjectByName(WORLD_NODE.snapRing);
  if (snapRing) {
    timeline.add(
      snapRing,
      {
        scale: [
          { to: 2.2, duration: 300, ease: "outCubic" },
          { to: 0.001, duration: 100 },
        ],
      },
      1600,
    );
  }

  // ── Chapter 2: wobbly GPS vs. fused anchor.
  timeline.add(camera, { x: 6, y: 5, z: 14 }, 2000);
  timeline.add(
    lookTarget,
    {
      x: WORLD_ANCHORS.markerPair.x,
      y: 1.2,
      z: WORLD_ANCHORS.markerPair.z,
      duration: 800,
    },
    2000,
  );
  timeline.add(walk, { t: 0.45 }, 2000);
  // Raw GPS jitter: meters of wander. The fused marker is deliberately
  // NEVER animated — its stillness is the message.
  timeline.add(
    markers.raw,
    {
      x: [
        { to: rawBase.x + 0.9, duration: 180 },
        { to: rawBase.x - 0.5, duration: 180 },
        { to: rawBase.x + 0.6, duration: 180 },
        { to: rawBase.x - 0.3, duration: 180 },
        { to: rawBase.x, duration: 160 },
      ],
      z: [
        { to: rawBase.z - 0.6, duration: 220 },
        { to: rawBase.z + 0.5, duration: 220 },
        { to: rawBase.z - 0.4, duration: 220 },
        { to: rawBase.z, duration: 220 },
      ],
    },
    2100,
  );

  // ── Chapter 3: the dive — into the dot-person's held phone.
  const eyeT = 0.5;
  const eyePoint = stage.curve.getPointAt(eyeT);
  const eyeTangent = stage.curve.getTangentAt(eyeT);
  const divePos = eyePoint
    .clone()
    .sub(eyeTangent.clone().multiplyScalar(1.4))
    .add(new Vector3(0, 1.9, 0));
  const diveLook = stage.curve
    .getPointAt(Math.min(1, eyeT + 0.12))
    .add(new Vector3(0, 1.3, 0));
  timeline.add(
    camera,
    { x: divePos.x, y: divePos.y, z: divePos.z, ease: "inOutQuad" },
    3000,
  );
  timeline.add(
    lookTarget,
    { x: diveLook.x, y: diveLook.y, z: diveLook.z, duration: 900 },
    3000,
  );
  timeline.add(walk, { t: eyeT, duration: 600 }, 3000);
  timeline.add(phone, { scale: 1, duration: 350, ease: "outBack" }, 3620);

  // ── Chapter 4: works anywhere — pull back, reveal the unmapped park.
  timeline.add(phone, { scale: 0.001, duration: 200 }, 4000);
  timeline.add(camera, { x: 0, y: 44, z: 27 }, 4000);
  timeline.add(lookTarget, { x: 0, y: 0, z: 0, duration: 800 }, 4000);
  timeline.add(walk, { t: 0.6 }, 4000);
  const outer = world.getObjectByName(WORLD_NODE.outer);
  if (outer) {
    timeline.add(outer, { y: 0, duration: 700, ease: "outCubic" }, 4200);
  }

  // ── Chapter 5: use-case gallery pops in.
  timeline.add(camera, { x: -8, y: 11, z: -12 }, 5000);
  timeline.add(lookTarget, { x: 4, y: 1, z: -3, duration: 800 }, 5000);
  timeline.add(walk, { t: 0.78 }, 5000);
  const gallery = world.getObjectByName(WORLD_NODE.gallery);
  if (gallery) {
    timeline.add(gallery, { scale: 1, duration: 600, ease: "outBack" }, 5200);
  }

  // ── Chapter 6: CTA — settle into a calm wide framing.
  timeline.add(camera, { x: 15, y: 17, z: 21 }, 6000);
  timeline.add(lookTarget, { x: 0, y: 1, z: 0, duration: 900 }, 6000);
  timeline.add(walk, { t: 0.92 }, 6000);

  // Materialize the full duration even if a chapter ends with a short
  // tween (keeps duration === CHAPTER_COUNT * CHAPTER_DURATION_MS).
  timeline.add(
    walk,
    { t: 0.92, duration: 0 },
    CHAPTER_COUNT * CHAPTER_DURATION_MS,
  );

  return timeline;
}

/**
 * One-shot load intro (~2.1s): the world rises, the dot-person pops in,
 * the camera settles from afar onto the hero framing. Ends EXACTLY on the
 * story's start state so scroll can take over seamlessly. Skipped entirely
 * under reduced motion.
 */
export function buildIntroTimeline(
  stage: StoryStage,
  onUpdate: () => void,
): Timeline {
  const timeline = createTimeline({
    autoplay: false,
    // See buildStoryTimeline: 'none' keeps this timeline from cancelling
    // the story timeline's tweens on the shared camera/world targets.
    defaults: { ease: "outCubic", composition: "none" },
    onUpdate,
  });
  timeline.add(stage.camera, { x: 32, y: 30, z: 32, duration: 0 }, 0);
  timeline.add(stage.world, { y: [{ from: -1.2, to: 0 }], duration: 900 }, 0);
  timeline.add(
    stage.person,
    { scale: [{ from: 0.001, to: 1 }], duration: 700, ease: "outBack" },
    600,
  );
  timeline.add(
    stage.camera,
    {
      x: HERO_CAMERA.x,
      y: HERO_CAMERA.y,
      z: HERO_CAMERA.z,
      duration: 1800,
      ease: "outCubic",
    },
    300,
  );
  return timeline;
}
