# `map-data.ts`

## Purpose

Pure builder that turns store-derived trajectory slices into a single
`MapData` snapshot shared by **both** map renderers (the live/replay 3D
Leaflet overlay and the 2D session-summary map). It is the data half of the
unified-map work (decisions **D1–D4** in
[2026-05-31-unified-trajectory-map-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-user-feedback.md);
plan in
[2026-05-31-unified-trajectory-map-phase3-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-phase3-plan.md)).

## Public API

- `buildMapData(input: MapDataInput): MapData` — pure; no Leaflet/Three deps.
- `interface MapData` — `{ userPosition, rawGpsPath, fusedPath,
alignmentSnapshots, userHeadingDeg? }`.
- `interface MapDataInput` — all fields optional; array fields are read-only.
  Includes `odometryRotations` (NUE quaternions) — its LATEST entry drives
  `userHeadingDeg`.

## Scope

This model owns only the genuinely-shared SLAM/GPS trajectory layers. **Reference
points are a recorder concept and are NOT modelled here** — the recorder draws
them via its own [`ui/draw-ref-point-markers.ts`](../../../GpsPlusSlamJs_RecorderApp/src/ui/draw-ref-point-markers.ts)
helper, keeping the framework ref-point-agnostic and the dependency direction
(recorder → framework) intact. See the
[Phase 3 plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-31-unified-trajectory-map-phase3-plan.md)
§ Step 5.

## Invariants & assumptions

- **D2 (the core contract):** `fusedPath` is always `computeFusedPath` over
  ALL `odometryPositions` with the latest `alignmentMatrix` + `zeroRef`. It is
  never frozen per-event. When matrix or `zeroRef` is missing → `[]`.
- All array outputs are **defensively copied** — mutating the returned arrays
  never affects caller inputs, and vice versa.
- Outputs are never `undefined`: missing inputs become empty arrays / `null`.
- **`userPosition` default chain (2026-07-06 fused-dot fix):** explicit
  `userPosition` (incl. `null`, used by the summary map to hide the dot) wins →
  else the **last `fusedPath` point** when the fused path is non-empty (the
  blue dot sits on the tip of the cyan fused polyline — no second odometry→GPS
  conversion, so dot and line can never drift apart) → else the last
  `rawGpsPath` entry (pre-alignment fallback so the dot stays visible during
  startup) → else `null`. See
  [2026-07-06-1526-recorder-live-map-user-dot-fused-pose-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-06-1526-recorder-live-map-user-dot-fused-pose-user-feedback.md).
- **`userHeadingDeg` (Finding 2):** the absolute view-direction bearing for the
  overlay's heading line, computed by
  [`computeUserHeadingDeg`](../utils/user-heading.ts) from the LATEST
  `odometryRotations` entry + `alignmentMatrix`. `buildMapData` ALWAYS sets it
  (a bearing in `[0,360)` or `null`). The field is declared optional on `MapData`
  ONLY so pre-existing direct literals (e.g. the static summary map, out of
  scope) keep compiling; `drawMapData` treats a missing value exactly like
  `null` (no line). See
  [2026-06-28-1822-map-rings-transparency-and-view-direction-user-feedback.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-28-1822-map-rings-transparency-and-view-direction-user-feedback.md).

## Examples

```ts
const data = buildMapData({
  rawGpsPath: store.rawSamples,
  odometryPositions: gpsEvents.odometryPositions,
  alignmentMatrix: gpsEvents.alignmentMatrix,
  zeroRef: firstGps.zeroRef,
  alignmentSnapshots: snapshots,
});
// data.fusedPath reflects the CURRENT matrix — it "snaps" on every rebuild.
```

## Tests

- [map-data.test.ts](map-data.test.ts) — pass-through, defensive copy, empty
  input, D2 recompute/snap, null matrix/zeroRef, the full `userPosition`
  default chain (fused tip → raw fix → null; explicit value/null wins), and
  `userHeadingDeg` wiring (latest rotation + matrix; null cases).
- [map-data.property.test.ts](map-data.property.test.ts) — properties: for any
  rigid alignment matrix and odometry array, `fusedPath` equals
  `computeFusedPath` with one point per odometry position (guards against
  reintroducing per-event frozen fused points), and the default `userPosition`
  equals `fusedPath[last]` even when a raw fix is present (pins the
  2026-07-06 fused-dot contract).
