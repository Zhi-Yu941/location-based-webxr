/**
 * The single "your content here" extension seam (Finding 6 of the planning
 * doc). A student swaps the body of `createAnchorMarker()` for their own
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
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';

/**
 * Build the marker that gets pinned to the saved GPS anchor.
 *
 * Default: a simple "map pin" (a vertical post topped by a downward cone)
 * about 1 m tall so it is visible at human scale outdoors. Replace the body
 * with your own content — the only contract is "return one `Object3D`".
 */
export function createAnchorMarker(): Object3D {
  const marker = new Group();
  marker.name = 'anchor-marker';

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
