# depth-grid-lookup.ts

## Purpose

Bilinear depth lookup over the regular `DepthSampler` grid (WS-A 2a). Lets a
consumer read depth at an **arbitrary** normalized screen point by interpolating
the four surrounding grid nodes, instead of snapping to the nearest node — which
made every interior point of a sub-grid-cell QR collapse onto one borrowed depth.

## Public API

- `createDepthGridLookup(points: DepthPoint[], gridSize?): DepthGridLookup`
  - `depthAt(screenX, screenY): number | null` — bilinearly interpolated depth
    (m), or `null` when the point is outside the node grid (no extrapolation) or
    any of the four surrounding nodes has no valid depth (a hole).
  - `gridSize` defaults to `round(√points.length)` (the sampler emits a full
    `g²` grid).

## Invariants & assumptions

- Grid layout matches `DepthSampler.sampleGrid`: node `(col,row)` at screen
  `((col+1)/(g+1), (row+1)/(g+1))`, row-major index `row·g + col`.
- **Bilinear is exact for planar depth** — a tilted flat surface is reproduced
  with zero error between nodes (the property the dense QR plane fit relies on).
- **No extrapolation:** queries outside the node bounding box return `null`.
- **Holes are not bridged:** if any of the four cell corners has depth ≤ 0 or
  non-finite, the lookup returns `null` rather than interpolating across it (the
  dense fit tolerates missing lattice points).
- `g < 2` (or a short `points` array) degrades to "first valid node depth".

## Examples

```ts
const lut = createDepthGridLookup(depthSample.points); // gridSize inferred
const d = lut.depthAt(0.42, 0.55); // smooth depth, not a nearest-node snap
```

## Tests

- `depth-grid-lookup.test.ts` — exact node reproduction, exact planar-gradient
  interpolation, gridSize inference, null outside the grid, null across a hole
  (and still-valid neighbouring cell).

## Related

- Reads the grid from [depth-sampler.ts.md](depth-sampler.ts.md); the primary
  consumer is [qr-size-measurer.ts.md](qr/qr-size-measurer.ts.md) (the dense-fit
  lattice). Unprojection of the resulting points is
  [depth-unprojection.ts.md](depth-unprojection.ts.md).
