# mesh-view-controller.ts

## Purpose

Live visibility + Cubes/Detailed toggle for the reconstructed occupancy mesh.
Built **demo-local** (2026-07-15 interview decision — promote to the framework
only after its shape is validated by this first consumer). Owns the two framework
visualizers `startReplaySession` exposes and flips them cheaply: cubes via
`OccupancyCubesVisualizer.setVisible` (O(1) instanced-mesh flip), detailed via
`OcclusionMesh.setDebugStyle` (the occluder geometry is always depth-only; the
visible skin is the debug style).

Design principle: the visible style mirrors the collider type the balls hit
(Cubes ↔ AABB-compound, Detailed ↔ trimesh) so the developer sees the surface
physics uses. This controller owns the _visible_ half; the collider half is wired
alongside it when Rapier physics lands.

## Public API

- **`createMeshViewController(targets, options?): MeshViewController`** — applies
  the initial state immediately.
  - `targets`: `{ cubes: CubeTarget | null, occlusionMesh: OcclusionTarget | null }`
    — structural (`setVisible` / `setDebugStyle`); `null` when occupancy is off.
  - `options`: `{ visible=true, style='cubes', detailedStyle='wireframe' }`.
- **`MeshViewController`** — `setVisible(bool)`, `setStyle('cubes'|'detailed')`,
  `getVisible()`, `getStyle()`.

## Invariants & assumptions

- **Exactly one representation visible at a time.** Cubes and the detailed skin
  never double up on the same surface; `setStyle` switches which is shown.
- **Hiding turns BOTH off** (cubes `setVisible(false)`, occluder `setDebugStyle('off')`)
  regardless of the selected style; re-showing restores that style.
- **Null-target safe** (occupancy disabled) — every call is a no-op, never throws.
- Pure state machine; no THREE/WebGL types leak in — fully unit-testable.

## Tests

- `mesh-view-controller.test.ts` — initial apply (cubes on / occluder off),
  switch-to-detailed (cubes off / skin on), hide turns both off, re-show restores
  the style, `visible:false` initial state, and null targets don't throw.
