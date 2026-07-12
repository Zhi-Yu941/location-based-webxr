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
  const arContent = parts.world.getObjectByName(WORLD_NODE.arContent);
  if (arContent) {
    arContent.visible = true;
    arContent.scale.setScalar(0.001);
  }
  const snapRing = parts.world.getObjectByName(WORLD_NODE.snapRing);
  if (snapRing) {
    snapRing.visible = true;
    snapRing.scale.setScalar(0.001);
  }

  parts.camera.position.copy(HERO_CAMERA);
  // Aimed left of the world center so the marker pair and path sit in the
  // right half of the hero frame, clear of the copy panel on the left
  // (round-1 feedback: the red marker hid behind the text box).
  const lookTarget = new Vector3(-4, 2, 0);
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
/** Per-property `{from, to}` params for a Vector3-shaped target. */
function vec3Tween(from: Vector3, to: Vector3) {
  return {
    x: { from: from.x, to: to.x },
    y: { from: from.y, to: to.y },
    z: { from: from.z, to: to.z },
  };
}

interface ChainSegment {
  readonly to: number;
  readonly duration: number;
  readonly ease?: string;
}

/**
 * Add a wiggle/jitter sequence as INDIVIDUAL `{from, to}` tweens.
 *
 * Never use anime keyframe ARRAYS in these timelines: they do not restore
 * their pre-tween value when the timeline is seeked back before them
 * (probe-verified — the value sticks at an intermediate keyframe), which
 * breaks scrub-path independence. Explicit chained segments restore
 * perfectly in both directions.
 */
function addValueChain(
  timeline: Timeline,
  target: object,
  property: string,
  from: number,
  segments: readonly ChainSegment[],
  startAt: number,
): void {
  let value = from;
  let at = startAt;
  for (const segment of segments) {
    timeline.add(
      target,
      {
        [property]: { from: value, to: segment.to },
        duration: segment.duration,
        ...(segment.ease ? { ease: segment.ease } : {}),
      },
      at,
    );
    value = segment.to;
    at += segment.duration;
  }
}

/** One chapter's target composition (camera + look + walk progress). */
interface ChapterFraming {
  readonly at: number;
  readonly camera: Vector3;
  readonly look: Vector3;
  readonly walkT: number;
  readonly cameraEase?: string;
  readonly walkDuration?: number;
}

export function buildStoryTimeline(
  stage: StoryStage,
  onUpdate: () => void,
): Timeline {
  const timeline = createTimeline({
    autoplay: false,
    // composition 'none' is load-bearing TWICE over:
    // 1. With the default 'replace', the intro timeline (created later,
    //    touching the same camera properties) silently CANCELS these tweens.
    // 2. BUT 'none' also disables anime's from-value chaining: every tween
    //    captures `from` at BUILD time (the hero pose), so any property
    //    animated by more than one tween MUST declare explicit {from, to} —
    //    otherwise each chapter starts by teleporting back to the build
    //    pose (the round-1 feedback's "harter Sprung", pinned by the
    //    continuity tests). The framing chain below guarantees this.
    // Camera/reveal tweens run in the FIRST ~55% of each chapter window:
    // the scroll mapping centers a chapter's copy at ~mid-window, and the
    // composition must be settled by then (not still mid-flight). The walk
    // tweens keep full-window durations so the dot-person moves
    // continuously.
    defaults: {
      ease: "inOutSine",
      duration: CHAPTER_DURATION_MS * 0.55,
      composition: "none",
    },
    onUpdate,
  });

  const { camera, lookTarget, walk, world, markers, phone } = stage;
  const rawBase = markers.raw.position.clone();

  // ── Chapter 3 geometry (computed up front; used in the framing chain).
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

  // The camera path as an explicit framing CHAIN: each move tweens from the
  // previous framing to its own, so scrubbing is continuous by construction
  // (no dependence on anime's from-capture).
  const start: ChapterFraming = {
    at: 0,
    camera: HERO_CAMERA.clone(),
    look: new Vector3(-4, 2, 0), // must match createStoryStage's lookTarget
    walkT: 0.02,
  };
  const framings: readonly ChapterFraming[] = [
    // hero push-in
    {
      at: 0,
      camera: new Vector3(16.5, 15, 16.5),
      look: new Vector3(-3.5, 1.5, 0.5),
      walkT: 0.02,
    },
    // qr
    {
      at: 1000,
      camera: new Vector3(-3.5, 4.5, 15.5),
      look: new Vector3(WORLD_ANCHORS.sign.x, 1.6, WORLD_ANCHORS.sign.z),
      walkT: 0.14,
    },
    // fusion
    {
      at: 2000,
      camera: new Vector3(6, 5, 14),
      look: new Vector3(
        WORLD_ANCHORS.markerPair.x,
        1.2,
        WORLD_ANCHORS.markerPair.z,
      ),
      walkT: 0.45,
    },
    // dive
    {
      at: 3000,
      camera: divePos,
      look: diveLook,
      walkT: eyeT,
      cameraEase: "inOutQuad",
      walkDuration: 500,
    },
    // anywhere
    {
      at: 4000,
      camera: new Vector3(0, 44, 27),
      look: new Vector3(0, 0, 0),
      walkT: 0.6,
    },
    // gallery
    {
      at: 5000,
      camera: new Vector3(-8, 11, -12),
      look: new Vector3(4, 1, -3),
      walkT: 0.78,
    },
    // cta
    {
      at: 6000,
      camera: new Vector3(15, 17, 21),
      look: new Vector3(0, 1, 0),
      walkT: 0.92,
    },
  ];
  let previous = start;
  for (const framing of framings) {
    timeline.add(
      camera,
      {
        ...vec3Tween(previous.camera, framing.camera),
        ...(framing.cameraEase ? { ease: framing.cameraEase } : {}),
      },
      framing.at,
    );
    timeline.add(
      lookTarget,
      { ...vec3Tween(previous.look, framing.look), duration: 500 },
      framing.at,
    );
    if (framing.walkT !== previous.walkT) {
      timeline.add(
        walk,
        {
          t: { from: previous.walkT, to: framing.walkT },
          duration: framing.walkDuration ?? CHAPTER_DURATION_MS,
        },
        framing.at,
      );
    }
    previous = framing;
  }
  // ── Prop beats. All wiggle/jitter sequences go through addValueChain
  // (explicit {from, to} per segment) — see its doc comment for why anime
  // keyframe arrays are banned here.

  // QR chapter: the world "snaps into alignment" — a settling wiggle with
  // decaying amplitude, ending perfectly at rest.
  addValueChain(
    timeline,
    world,
    "x",
    0,
    [
      { to: 0.28, duration: 150 },
      { to: -0.18, duration: 150 },
      { to: 0.08, duration: 150 },
      { to: 0, duration: 150 },
    ],
    1200,
  );
  const snapRing = world.getObjectByName(WORLD_NODE.snapRing);
  if (snapRing) {
    addValueChain(
      timeline,
      snapRing,
      "scale",
      0.001,
      [
        { to: 2.2, duration: 300, ease: "outCubic" },
        { to: 0.001, duration: 100 },
      ],
      1450,
    );
  }

  // Fusion chapter: raw GPS jitter — meters of wander. The fused marker is
  // deliberately NEVER animated; its stillness is the message.
  addValueChain(
    timeline,
    markers.raw,
    "x",
    rawBase.x,
    [
      { to: rawBase.x + 0.9, duration: 180 },
      { to: rawBase.x - 0.5, duration: 180 },
      { to: rawBase.x + 0.6, duration: 180 },
      { to: rawBase.x - 0.3, duration: 180 },
      { to: rawBase.x, duration: 160 },
    ],
    2100,
  );
  addValueChain(
    timeline,
    markers.raw,
    "z",
    rawBase.z,
    [
      { to: rawBase.z - 0.6, duration: 220 },
      { to: rawBase.z + 0.5, duration: 220 },
      { to: rawBase.z - 0.4, duration: 220 },
      { to: rawBase.z, duration: 220 },
    ],
    2100,
  );

  // Dive chapter: the AR content (trail arrows, POI pin, hinted label)
  // appears in the world just before the phone window rises...
  const arContent = world.getObjectByName(WORLD_NODE.arContent);
  if (arContent) {
    timeline.add(
      arContent,
      { scale: { from: 0.001, to: 1 }, duration: 350, ease: "outBack" },
      3150,
    );
  }
  // ...then the phone rises in front of the lens...
  timeline.add(
    phone,
    { scale: { from: 0.001, to: 1 }, duration: 300, ease: "outBack" },
    3320,
  );
  // ...and drops away again on the pull-back.
  timeline.add(phone, { scale: { from: 1, to: 0.001 }, duration: 150 }, 4000);

  // Anywhere chapter: the unmapped-park ring rises into place.
  const outer = world.getObjectByName(WORLD_NODE.outer);
  if (outer) {
    timeline.add(
      outer,
      { y: { from: -6, to: 0 }, duration: 500, ease: "outCubic" },
      4100,
    );
  }

  // Gallery chapter: the use-case props pop in.
  const gallery = world.getObjectByName(WORLD_NODE.gallery);
  if (gallery) {
    timeline.add(
      gallery,
      { scale: { from: 0.001, to: 1 }, duration: 450, ease: "outBack" },
      5150,
    );
  }

  // Materialize the full duration even if a chapter ends with a short
  // tween (keeps duration === CHAPTER_COUNT * CHAPTER_DURATION_MS).
  timeline.add(
    walk,
    { t: { from: 0.92, to: 0.92 }, duration: 0 },
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
  const introFar = new Vector3(32, 30, 32);
  timeline.add(stage.camera, { x: 32, y: 30, z: 32, duration: 0 }, 0);
  timeline.add(stage.world, { y: { from: -1.2, to: 0 }, duration: 900 }, 0);
  timeline.add(
    stage.person,
    { scale: { from: 0.001, to: 1 }, duration: 700, ease: "outBack" },
    600,
  );
  // Explicit {from, to}: composition 'none' would otherwise capture the
  // build-time camera (already at HERO) as the start — turning the flight
  // into a hard snap at t=300 (the round-1 "buggy pause then nudge").
  timeline.add(
    stage.camera,
    {
      ...vec3Tween(introFar, HERO_CAMERA),
      duration: 1800,
      ease: "outCubic",
    },
    300,
  );
  return timeline;
}
