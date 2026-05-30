# gps-event-markers.ts

## Purpose

Visualizes GPS events as 3D markers during recording and replay. Shows three types of markers:

- **Raw GPS markers (yellow)**: Added to scene root at GPS world-space coordinates; fixed forever.
- **Fused markers (cyan)**: Added to `arWorldGroup` at raw odometry coordinates. Scene-graph propagation (`arWorldGroup.matrix × odomPos`) automatically produces the correct world-space fused position when the alignment matrix changes.
- **Alignment snapshot markers (red)**: Added to scene root at $A_k \cdot p_k$ (alignment × odom at update $k$). Frozen historical beliefs — never moved retroactively.

## Public API

### Types

- `GpsEventVisualizer` — class that manages GPS event marker visualization.
- `GpsEventAccuracy` — optional `{ horizontal?: number; vertical?: number }` hint used by `addGpsEvent` to render the raw-GPS marker as a non-uniform-scaled ellipsoid (replay mode).

### GpsEventVisualizer Class

- `setZeroRef(zero: LatLong): void` — set GPS origin for coordinate conversion.
- `getZeroRef(): LatLong | null` — get current GPS origin.
- `addGpsEvent(gpsCoords: [x,y,z], odomPos: [x,y,z], accuracy?: GpsEventAccuracy): void` — add markers for a GPS event.
  - When `accuracy` is omitted (recording mode), the yellow raw-GPS marker is a fixed 8 cm sphere at opacity 0.3 (legacy behaviour, all existing call sites unchanged).
  - When **both** `accuracy.horizontal` and `accuracy.vertical` are positive numbers, the yellow marker becomes a unit-sphere scaled to `(h, v, h)` metres at opacity 0.13 with `renderOrder = -1` so cyan/red markers stay visible inside it.
  - Half-populated, non-positive, non-finite (`NaN`/`Infinity`), or explicit `null` accuracy falls back to the legacy fixed sphere (defensive — same policy as `preview-map.ts`). `Infinity` is rejected explicitly because scaling a mesh by `Infinity` corrupts its world matrix and can crash rendering. `null` is rejected via a `== null` guard because — although the parameter type forbids it — a non-TS caller (or a nullable API response) could pass it, and destructuring `null` would throw a `TypeError`.
  - Cyan fused and red snapshot markers are NEVER affected by the `accuracy` argument.
- `addAlignmentSnapshot(nuePosition: readonly number[]): void` — add a red snapshot sphere at scene root.
- `getAlignmentSnapshotPositions(): number[][]` — return positions of all snapshot markers as arrays.
- `clearAll(): void` — remove all markers (including snapshots) and reset.
- `getCounts(): { raw, fused, snapshots }` — get marker counts including alignment snapshots.
- `getRawMarkerWorldSizes(): Array<{ x, y, z }>` — diagnostic accessor returning the world-space bounding-box size (`THREE.Box3.setFromObject`) of each raw-GPS marker in insertion order. Used by the §3c Playwright spec to verify accuracy-ellipsoid scaling.

### Exported Singleton

```typescript
export const gpsEventVisualizer: GpsEventVisualizer;
```

## Invariants & Assumptions

1. **Zero reference must be set** before adding GPS events
2. **Scene must be available** (from `getScene()`) for raw GPS markers to be created
3. **arWorldGroup must be available** (from `getArWorldGroup()`) for fused markers; if unavailable, only raw GPS marker is created
4. **Raw GPS markers are immutable** — they never move after creation (scene root)
5. **Fused markers move automatically** when `applyAlignmentMatrix()` updates `arWorldGroup.matrix` — no manual repositioning needed
6. **No gl-matrix dependency** — alignment is handled entirely by Three.js scene-graph propagation

## Color Coding

| Marker Type        | Color  | Hex        | Parent         | Description                                                        |
| ------------------ | ------ | ---------- | -------------- | ------------------------------------------------------------------ |
| Raw GPS            | Yellow | `0xffff00` | scene root     | Where GPS readings were received (noisy)                           |
| Fused              | Cyan   | `0x00ffff` | `arWorldGroup` | AR odometry; alignment applied via scene-graph                     |
| Alignment Snapshot | Red    | `0xff0000` | scene root     | Frozen historical belief at alignment update $k$ ($A_k \cdot p_k$) |

## Marker Sizing

- **Cyan fused** and **red snapshot** spheres: fixed radius (8 cm / 10 cm), identity scale, opacity 0.3 / 0.5. Geometry is `SphereGeometry` with 12 segments; `MeshBasicMaterial` is transparent with `depthWrite: false` to prevent z-fighting.
- **Yellow raw-GPS** sphere has two rendering modes:
  - **Legacy fixed mode** (no `accuracy` arg): radius 8 cm, identity scale, opacity 0.3. Used by recording mode and any caller that does not opt in.
  - **Accuracy-aware ellipsoid mode** (`accuracy = { horizontal, vertical }` both > 0): unit-radius sphere (radius 1 m) scaled non-uniformly to `(horizontal, vertical, horizontal)` metres, opacity 0.13, `renderOrder = -1`. The lower opacity and earlier render order keep the smaller cyan / red markers visible inside large ellipsoids (e.g. 20 m altitude jumps with growing GPS accuracy in rec31). Falls back to the legacy fixed mode when the argument is `null`, or either field is missing, non-positive, or non-finite (`NaN`/`Infinity`) — the boundary check lives in `resolveEllipsoidScale()`, which uses a `== null` guard then `Number.isFinite` before the `> 0` test.

## Examples

### Basic Usage

```typescript
import { gpsEventVisualizer } from './visualization/gps-event-markers';

// 1. Set zero reference when first GPS arrives
gpsEventVisualizer.setZeroRef({ lat: 48.8566, lon: 2.3522 });

// 2. Add GPS event (coordinates in meters from zero)
gpsEventVisualizer.addGpsEvent([10.5, 2.3, 15.2], [1.0, 0.5, 2.0]);

// 2b. (Replay mode) opt in to the accuracy-aware ellipsoid:
gpsEventVisualizer.addGpsEvent([10.5, 2.3, 15.2], [1.0, 0.5, 2.0], {
  horizontal: 4.5, // 1σ horizontal accuracy in metres
  vertical: 12.0, // 1σ vertical accuracy in metres
});

// 3. No updateAlignment needed — applyAlignmentMatrix() in webxr-session.ts
//    updates arWorldGroup.matrix, and all fused markers move automatically.

// 4. Cleanup when recording stops
gpsEventVisualizer.clearAll();
```

### Integration with Store

```typescript
// Via wireStoreSubscribers() from src/state/store-subscribers.ts
unsubscribeStore = wireStoreSubscribers(store, {
  applyAlignmentMatrix,
  gpsEventVisualizer,
  mapOverlay,
});
```

## Tests

Unit tests in `gps-event-markers.test.ts`:

- `setZeroRef / getZeroRef` — verify zero reference storage.
- `addGpsEvent` — marker creation, colors, placement, guard checks.
- `addGpsEvent accuracy-aware ellipsoid (§3)` — non-uniform scale on the raw marker, defensive fallback on missing/non-positive accuracy, lowered opacity, `renderOrder = -1`, cyan/red unaffected. See [`2026-05-19-investigate-rec31-altitude-drop.md`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-19-investigate-rec31-altitude-drop.md) §3 for the motivation.
- `scene-graph propagation` — world position via `arWorldGroup.matrix`.
- `clearAll` — cleanup and disposal.
- `getCounts` — counter functionality.
- `marker sizing` — verify legacy 8 cm radius on default code path.
- `marker transparency` — opacity and depthWrite settings.

## Architecture

```
Scene (GPS World Space)
├── ar-world (arWorldGroup — receives alignment matrix)
│   ├── fused-0 (cyan sphere at raw odom [1, 0.5, 2])
│   ├── fused-1 (cyan sphere at raw odom [2, 0.8, 4])
│   └── ...
├── raw-gps-0 (yellow sphere at GPS world coords)
├── raw-gps-1 (yellow sphere)
└── ...
```

Raw GPS markers show scatter/noise from GPS readings.
Fused markers show the stable AR-tracked path after alignment.
The visual difference between them demonstrates alignment quality.
