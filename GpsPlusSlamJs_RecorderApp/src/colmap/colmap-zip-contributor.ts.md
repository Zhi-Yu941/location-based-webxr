# `colmap-zip-contributor.ts`

## Purpose

Recorder-side `ZipExportContributor` that derives a COLMAP `sparse/0/` model
from the live recording state and writes it into the exported ZIP. The
integration seam tying together Iter 1 (conversions), Iter 2 (serializers) and
Iter 2.5 (grid accessor). See
[2026-06-13-colmap-export-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-colmap-export-plan.md)
Iter 3.

## Public API

- `createColmapZipContributor(deps): ZipExportContributor`
  - `deps.getFrames(): readonly ArImageCapture[]` — WebXR camera poses + JPEG
    pixel dims (wired to `selectFrameTilesInWebXR(store.getState())`).
  - `deps.getProjectionMatrix(): Matrix4 | undefined` — session-constant
    intrinsics (wired to `state.recording.latestDepthSample?.projectionMatrix`).
  - `deps.getOccupancyGrid(): OccupancyGrid | null` — the shared live grid (Iter
    2.5 provider).
  - `deps.getMinConfidence?(): number` — the recording's `occupancy.minConfidence`
    (the SAME voxel-noise floor the live cube view applies), read live so a
    changed value applies on the next sync/export. Omitted → floor **1**
    (unfiltered/legacy).
  - Returns a contributor with `subdir: 'sparse'` that writes
    `0/cameras.txt`, `0/images.txt`, `0/points3D.txt` (file count 3), or **0
    files** when intrinsics are unavailable.

## Behavior & invariants

- **Reads injected live state, never re-parses `actions/`** (Q2) — per-sync cost
  ∝ output size, not O(session²).
- **Q4 skip:** returns 0 files (no `sparse/0/`) when `getProjectionMatrix()` is
  `undefined`, when no frame carries pixel dimensions, or when the matrix is not
  a usable perspective. The rest of the ZIP is unaffected.
- **NAME = bare filename** (`images/frame-000001.jpg` → `frame-000001.jpg`); the
  user points COLMAP `image_path` at the ZIP's `images/`. Legacy `frames/`
  prefixes are stripped the same way.
- **Point source:** each `points3D` row is the **exact per-cell surface point**
  (`getCellPoint(cell) ?? getCellCenter(cell)`, follow-up Item A) — the
  running-average of the measured points in the cell, hugging the real surface
  instead of snapping to the 15 cm lattice.
- **Confidence floor:** only cells observed `≥ getMinConfidence()` times are
  exported (`getOccupiedCells(minConfidence)`). This is the same
  `occupancy.minConfidence` lever the voxel view uses, applied here so
  single-frame depth noise — in particular **behind-surface** phantoms that
  free-space carving can never clear — is kept out of the reconstruction. See
  [2026-06-22-occupancy-grid-behind-surface-noise-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-22-occupancy-grid-behind-surface-noise-plan.md).
- **World frame:** points are run through `webxrToColmapWorldPoint` (the
  `G = diag(1,−1,−1)` world basis change — negate Y,Z) before `points3D`, the
  SAME `G` folded into the camera extrinsics by `webxrToColmapPose`. This flips
  our WebXR Y-up world into the viewers' Y-down gravity world so the export loads
  **upright**, while keeping points and cameras registered (follow-up Item B).
- **Color fallback:** cells with no observed RGB (`getCellColor` → null) emit
  mid-gray `128 128 128` rather than black.
- **Empty grid:** still emits a valid model (cameras + images) with an empty
  `points3D.txt`.

## Orientation: upright by default (world flip applied)

COLMAP/3DGS viewers (Lichtfeld Studio, gsplat, Nerfstudio) treat the COLMAP
world as **+Y-down gravity**, while our raw-WebXR world is **+Y-up**. The export
therefore applies a shared world basis change `G = diag(1,−1,−1)` (a proper
180°-about-X rotation, det = +1 → no mirroring) to **both** the points
(`webxrToColmapWorldPoint`) and the camera extrinsics (`webxrToColmapPose`), so
new ZIPs load **upright** and stay internally consistent (registered, not
mirrored, correctly scaled).

This reverses the earlier document-only decision (follow-up Item B / Q-B1, which
had kept the export raw-WebXR and asked users to rotate 180° about X in the
viewer). **Old ZIPs exported before this change still load upside-down** — only
new exports are corrected; no migration is performed. The derivation is in
[colmap-conversions.ts.md](colmap-conversions.ts.md) and follow-up Item B.

## Wiring

Added to `buildZipContributors()` in `recording-session-handlers.ts`, used by
BOTH the periodic crash-safety sync (`syncToExternalZip`) and the final
`exportSessionAsZip`, so the on-disk backup is continuously COLMAP-format.

## Tests

- `colmap-zip-contributor.test.ts` — happy path (3 files, PINHOLE dims, RGB
  point), bare-filename NAME (incl. legacy `frames/`), Q4 skips (no matrix / no
  dims → 0 files), empty-grid valid model, gray fallback, and the confidence
  floor (one-shot cell excluded above its count, well-observed cell survives,
  default floor 1 when `getMinConfidence` omitted). Wiring is covered by
  the recording-session-handlers tests.
