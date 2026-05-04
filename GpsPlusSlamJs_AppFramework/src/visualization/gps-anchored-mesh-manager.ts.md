# `gps-anchored-mesh-manager.ts`

## Purpose

Generic mechanism for placing Three.js meshes at GPS coordinates relative to a configured GPS zero reference. Recorder-agnostic core extracted from the historical `RefPointVisualizer` in Iter 4 of the AppFramework / RecorderApp boundary cleanup.

## Public API

- `GpsAnchoredItem` — `{ id, lat, lon, altitude? }`. Domain types project onto this shape.
- `GpsAnchoredMeshManagerOptions` — `{ color, radius?, namePrefix, loggerLabel? }`.
- `class GpsAnchoredMeshManager`
  - `setZeroRef(zero: LatLong): void` / `getZeroRef(): LatLong | null`
  - `setItems(items)` — replace entire mesh group
  - `addItem(item)` — append one mesh
  - `clear()` — remove all meshes and dispose the shared geometry/material
  - `getCount(): number`
  - `dispose()` — `clear()` + drop zero reference

## Invariants & assumptions

- One instance == one color group with shared `THREE.SphereGeometry` + `THREE.MeshBasicMaterial`.
- Without a zero reference or an active scene (`getScene()`), `setItems` / `addItem` log a warning and become no-ops; the caller is responsible for ordering.
- `clear()` releases the shared geometry/material and re-creates them on the next `setItems`/`addItem`. This matches the historical disposal pattern in `RefPointVisualizer`.

## Examples

```ts
import { GpsAnchoredMeshManager } from 'gps-plus-slam-app-framework/visualization/gps-anchored-mesh-manager';

const prior = new GpsAnchoredMeshManager({
  color: 0x00ff00,
  namePrefix: 'prior-ref',
});
prior.setZeroRef({ lat: 50.7495, lon: 6.4793 });
prior.setItems([{ id: 'rp1', lat: 50.7496, lon: 6.4794, altitude: 0 }]);
```

## Tests

- See [gps-anchored-mesh-manager.test.ts](gps-anchored-mesh-manager.test.ts). Covers zero-ref gating, GPS→meters projection, add/clear semantics, and shared-geometry reuse.

## Related docs

- [reference-points removal](../../../../GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md) — Iter 4 plan.
