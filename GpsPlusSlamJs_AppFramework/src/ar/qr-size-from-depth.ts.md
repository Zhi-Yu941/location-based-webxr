# qr-size-from-depth.ts

## Purpose

Measure a QR's **printed physical size directly from the depth map** (Note 4 of
the [follow-up plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-followup-qr-tracking-generalization-overlay-and-north.md)),
so the QR content/size are irrelevant and `qr.physicalSizeM` need not be hand-
authored. This is the **measuring stage** of the Note 3 size lifecycle.

## Public API

- `estimateQrSizeFromDepth(corners, interiorSamples, unprojector)` →
  `{ sizeM, quality } | null`. Unprojects the 4 corner `DepthPoint`s (TL,TR,BR,BL)
  via `createDepthUnprojector`, takes the **median of the 4 edge lengths** as
  `sizeM`, and scores `quality ∈ [0,1]` from edge agreement + diagonal ≈ `√2·edge`
  - planarity (c2 and the interior samples vs the plane through c0,c1,c3).
    Returns `null` when a corner can't be unprojected or the quad is degenerate.
- `createQrSizeAccumulator(options)` → `{ add(obs|null), current(), reset() }`.
  A robust running **median** over accepted observations, reporting a
  `QrSizeEstimate` with the lifecycle `status`. Options: `qualityThreshold`
  (0.8), `minSamples` (8), `maxSpreadM` (0.01 m), `maxSamples` (64, ring cap).
- **Size value types** `QrSizeStatus` / `QrSizeEstimate` are defined here and
  imported by `state/qr-detected-slice.ts` (keeps `ar` free of any `state`
  import — the reverse direction would close a dependency cycle).

## Invariants & assumptions

- **Metric, angle-robust:** size comes from depth-unprojected 3D corners, so it
  is correct at any distance/viewing angle (no `solvePnP` scale assumption) —
  verified by the property test across random size/distance/yaw.
- **Quality is scale-free:** every error term is normalized by the mean edge, so
  the threshold is size-independent. A non-planar / non-square / noisy read
  scores low and is dropped by the accumulator's `qualityThreshold`.
- **Corner depth is noisiest** (edge/background discontinuity): interior samples
  only strengthen the planarity check; a single bad interior read is skipped, not
  fatal.
- **`estimated` gate:** `sampleCount ≥ minSamples` **and** `spreadM ≤ maxSpreadM`.
  This is the gate that later promotes a measured size to drive size-dependent
  features (PnP solve, geo vote) — under the same bar as every other feature.

## Examples

```ts
const acc = createQrSizeAccumulator();
const u = createDepthUnprojector(cameraPos, cameraRot, projectionMatrix);
const est = acc.add(estimateQrSizeFromDepth(corners, interior, u!));
if (est.status === 'estimated') buildCube(est.estimateM!);
```

## Tests

- `qr-size-from-depth.test.ts` — fronto-parallel recovery + quality≈1, a depth-
  pushed corner scores < 0.8, null on an unprojectable corner; accumulator
  lifecycle, spread gate, quality/null rejection, reset.
- `qr-size-from-depth.property.test.ts` — recovers the printed size for random
  size/distance/yaw (angle-robustness); a non-planar quad scores low.

## Related

- Composes [depth-unprojection.ts.md](depth-unprojection.ts.md). Feeds the size
  lifecycle in [../state/qr-detected-slice.ts.md](../state/qr-detected-slice.ts.md)
  and the `resolveSizeM` seam of
  [qr-tracking-controller.ts.md](qr-tracking-controller.ts.md).
