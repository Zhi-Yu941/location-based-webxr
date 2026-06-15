# pose-from-corners.ts

**Purpose:** Fit a rigid 6-DoF pose to the 4 depth-unprojected QR corners — the
demo's pose source (Note 4 "cleanest — a rigid fit to the depth-unprojected 3D
corners, needs no size up front"). No `solvePnP`, no OpenCV.

## Public API

- `poseFromWorldCorners(corners): Pose | null` — corners are TL,TR,BR,BL in
  raw-WebXR/odom space; returns the QR center + orientation, or `null` for a
  degenerate (collinear / zero-area) quad.

## Invariants

- Center = mean of the 4 corners (exact). Basis: +x = mid-right − mid-left,
  +y = mid-top − mid-bottom, +z = x×y, then y re-orthogonalized via z×x so the
  basis is exactly orthonormal despite depth-noise non-squareness.
- Built on THREE (`makeBasis` + `setFromRotationMatrix`); the app already depends
  on `three`.
- Orientation is recovered up to the square's symmetry — sufficient to glue the
  axis + cube to the printed face.

## Tests

`pose-from-corners.test.ts` — center recovery, <4 / collinear → null, and a
property test recovering an arbitrary posed square (center exact, normal
parallel) across random size/position/orientation.
