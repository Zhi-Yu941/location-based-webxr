/**
 * The single "your content here" extension seam (Finding 6 of the planning
 * doc). A new developer swaps the body of `createAnchorMarker()` for their own
 * `THREE.Object3D` and the rest of the app keeps working unchanged: the
 * framework wiring in `main.ts` anchors *whatever* object this returns to
 * the persisted GPS coordinate.
 *
 * Keep this file tiny and self-contained — it is the one place meant to be
 * edited when building your own use case.
 */

import {
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  TorusGeometry,
  type Object3D,
} from "three";
import type { AnchorVisualization } from "./url-anchor-state.js";

/** Render options decoded from the `?show=` link (all optional). */
export interface MarkerOptions {
  /** Visualization style (1..4); defaults to the map pin. */
  ui?: AnchorVisualization;
  /** Uniform size multiplier; defaults to 1. */
  scale?: number;
  /** Rotation about the vertical axis vs true north, clockwise; defaults 0. */
  rotationDeg?: number;
}

/**
 * Build the marker that gets pinned to the saved GPS anchor.
 *
 * The `ui` selects one of four simple, distinct styles (D1.1 §6); `scale` and
 * `rotationDeg` are applied to the returned group. Replace the per-style
 * geometry with your own content — the only contract is "return one
 * `Object3D`".
 */
export function createAnchorMarker(options: MarkerOptions = {}): Object3D {
  const ui = options.ui ?? 1;
  const marker = buildVariant(ui);
  marker.name = "anchor-marker";
  marker.userData.ui = ui;
  marker.scale.setScalar(options.scale ?? 1);
  // Three.js y-rotation is counter-clockwise (viewed from above); negate so a
  // positive `rotationDeg` reads as clockwise-from-north, matching the schema.
  marker.rotation.y = -MathUtils.degToRad(options.rotationDeg ?? 0);
  return marker;
}

function buildVariant(ui: AnchorVisualization): Group {
  switch (ui) {
    case 2:
      return buildBillboard();
    case 3:
      return buildLightBeam();
    case 4:
      return buildRing();
    case 1:
    default:
      return buildPin();
  }
}

/** ui=1 — a ~1 m "map pin": a vertical post topped by a downward cone. */
function buildPin(): Group {
  const marker = new Group();
  const material = new MeshStandardMaterial({ color: 0xff4f6d });

  const post = new Mesh(new CylinderGeometry(0.04, 0.04, 0.8, 16), material);
  post.position.y = 0.4;
  marker.add(post);

  const head = new Mesh(new ConeGeometry(0.18, 0.36, 20), material);
  head.position.y = 0.98;
  head.rotation.x = Math.PI; // point the cone tip downward toward the spot
  marker.add(head);

  return marker;
}

/** ui=2 — a flat upright panel on a short post (a static "billboard"). */
function buildBillboard(): Group {
  const marker = new Group();
  const material = new MeshStandardMaterial({ color: 0x4f8cff });

  const post = new Mesh(new CylinderGeometry(0.03, 0.03, 0.6, 12), material);
  post.position.y = 0.3;
  marker.add(post);

  const panel = new Mesh(
    new PlaneGeometry(0.8, 0.5),
    new MeshStandardMaterial({ color: 0x4f8cff, side: DoubleSide }),
  );
  panel.position.y = 0.85;
  marker.add(panel);

  return marker;
}

/** ui=3 — a tall translucent pillar of light, visible from far away. */
function buildLightBeam(): Group {
  const marker = new Group();
  const beam = new Mesh(
    new CylinderGeometry(0.12, 0.12, 6, 16, 1, true),
    new MeshStandardMaterial({
      color: 0x66e0ff,
      emissive: 0x2299cc,
      transparent: true,
      opacity: 0.5,
      side: DoubleSide,
    }),
  );
  beam.position.y = 3; // rises from the ground to ~6 m
  marker.add(beam);
  return marker;
}

/** ui=4 — a floating horizontal ring. */
function buildRing(): Group {
  const marker = new Group();
  const ring = new Mesh(
    new TorusGeometry(0.5, 0.06, 12, 40),
    new MeshStandardMaterial({ color: 0xffd166 }),
  );
  ring.rotation.x = Math.PI / 2; // lay the ring flat (horizontal)
  ring.position.y = 1;
  marker.add(ring);
  return marker;
}
