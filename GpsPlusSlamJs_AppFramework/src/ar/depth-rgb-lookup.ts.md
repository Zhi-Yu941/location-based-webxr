# depth-rgb-lookup.ts

## Purpose

Pure mapping from a depth point's normalized view coordinates onto a camera-frame RGBA readback buffer — the color half of the RGB voxel coloring (occupancy-grid port plan Iter 8). No THREE/DOM dependency.

Plan: `GpsPlusSlamJs_Docs/docs/2026-06-11-2134-depth-occupancy-grid-port-plan.md` §4 Iter 8 / §5.

## Public API

- **`createRgbLookup(pixels, width, height): RgbLookup | null`** — builds a lookup over a `readRenderTargetPixels` buffer (RGBA, bottom-row-first). Returns `null` when dimensions are not positive integers or `pixels.length !== width × height × 4`.
- **`RgbLookup = (screenX, screenY) => RgbTuple | null`** — samples the color at normalized view coordinates (0–1, y=0 top). Returns `null` for out-of-range or non-finite coordinates; the `1.0` edge clamps into the last row/column.

## Invariants & Assumptions

1. **Y-flip lives here** — WebGL readback buffers are bottom-row-first while depth `screenY` is top-first; the lookup flips the row so callers never think about it.
2. **View↔camera-image alignment is assumed** (Iter 8 field-verification item): normalized view coords are assumed to address the camera frame directly (true on ARCore). Any on-device correction (rotation, crop rect) belongs in THIS module so the convention stays in one place — mirroring how `depth-unprojection.ts` centralizes NDC flips.
3. Defensive boundary: all bad input degrades to `null` (color-less points), never an exception into the XR frame loop.
4. The lookup typically reads the INTERNAL buffer of `CameraBlitCapture.captureToPixels()` — valid only until the next capture; consume synchronously.

## Examples

```ts
const readback = depthRgbBlit.captureToPixels(renderer, cameraTexture);
const lookup = readback
  ? createRgbLookup(readback.pixels, readback.width, readback.height)
  : null;
const rgb = lookup?.(point.screenX, point.screenY); // [r, g, b] 0–255 or null
```

## Tests

- `depth-rgb-lookup.test.ts` — quadrant-buffer mapping (pins the y-flip), edge clamping, out-of-range/non-finite coords → null, invalid buffer/dimensions → null, and a fast-check property: pixel-center lookups address exactly the uniquely-encoded pixel for arbitrary buffer sizes.
