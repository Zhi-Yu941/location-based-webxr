# webxr-nue-basis.ts

## Purpose

Single source of truth for the **WebXR → NUE** basis-change matrix
(`WEBXR_TO_NUE`). WebXR reports poses in `X=East, Y=Up, Z=South`; the framework's
GPS-world scene graph uses NUE (`X=North, Y=Up, Z=East`). This constant converts
a transform expressed in the WebXR reference space into the NUE frame.

It is intentionally a tiny module that depends only on `three`, so it can be
imported by both the AR session and the visualization layer without dragging
heavy transitive dependencies into unit-test import graphs.

## Public API

- `WEBXR_TO_NUE: THREE.Matrix4` — the constant basis change. Maps
  `(x, y, z)_WebXR → (-z, y, x)_NUE`. Pure rotation/basis (no translation).

Exported from `gps-plus-slam-app-framework/ar`.

## Invariants & assumptions

- Treated as immutable. Consumers must not mutate it; multiply into a scratch
  matrix instead (`out.multiplyMatrices(WEBXR_TO_NUE, pose)`).
- Stored column-major (three.js convention); the doc comment shows the
  equivalent row-major form.

## Consumers

- `ar/webxr-session.ts` — copies it into the static `basisChangeNode` that sits
  between `arWorldGroup` (NUE) and the WebXR camera subtree.
- `visualization/hit-test-reticle.ts` — applies it to the live WebXR hit-test
  pose so a reticle parented under `arWorldGroup` (NUE) lands at the correct
  on-screen position.

## Tests

Covered indirectly via its consumers' tests (`hit-test-reticle.test.ts` asserts
the basis change is applied to the hit pose; the scene-hierarchy tests in
`webxr-session` cover the `basisChangeNode` wiring).
