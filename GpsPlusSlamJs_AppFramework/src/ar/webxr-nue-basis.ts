/**
 * `webxr-nue-basis` — the single source of truth for the WebXR↔NUE basis
 * change.
 *
 * The framework's scene graph keeps GPS-world content in the **NUE**
 * convention (X=North, Y=Up, Z=East) while WebXR reports poses in its own
 * convention (X=East, Y=Up, Z=South). `WEBXR_TO_NUE` converts a transform
 * expressed in the WebXR reference space into the NUE frame.
 *
 * It lives in its own tiny module (depending only on three) so it can be shared
 * by both `webxr-session.ts` (which parents it permanently as the static
 * `basisChangeNode`) and `visualization/hit-test-reticle.ts` (which applies it
 * to the live hit-test pose) without either pulling the other's heavy
 * transitive dependencies into a unit-test import graph.
 */
import { Matrix4 } from 'three';

/**
 * Constant matrix converting WebXR local-floor coordinates to the internal
 * NUE (North-Up-East) convention.
 *
 * WebXR: X=East, Y=Up, Z=South (right-handed, toward viewer)
 * NUE:   X=North, Y=Up, Z=East (right-handed)
 *
 * Mapping:  NUE_X = -WebXR_Z,  NUE_Y = WebXR_Y,  NUE_Z = WebXR_X
 *
 * Row-major:
 *   [ 0  0 -1  0 ]
 *   [ 0  1  0  0 ]
 *   [ 1  0  0  0 ]
 *   [ 0  0  0  1 ]
 *
 * Stored column-major (Three.js / gl-matrix convention).
 */
export const WEBXR_TO_NUE = /* @__PURE__ */ new Matrix4().fromArray([
  // col0    col1     col2     col3
  0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1,
]);
