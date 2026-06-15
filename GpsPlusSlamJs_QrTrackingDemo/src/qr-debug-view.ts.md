# qr-debug-view.ts

**Purpose:** The two §5 verification objects (Note 4): a `THREE.AxesHelper` at
the solved QR pose and a semi-transparent cube sized to the QR so its front face
lands on the printed corners. Both parented under `arWorldGroup` so they ride the
alignment / transform chain like real content.

## Public API

- `createQrDebugView(parent): QrDebugView` — `{ update(pose, sizeM), clear(), dispose() }`.
  - `update` reveals + glues both objects to the pose; the cube spans `sizeM`
    in-plane and a thin slab in depth (front face on the code).
  - `clear` hides without detaching; `dispose` detaches + frees GPU resources.

## Invariants

- Objects start hidden; first `update` reveals them.
- **Persistence (Note 3):** `clear` is NOT called on detection misses — the
  objects keep their last pose so they don't flicker between throttled detections.
- Pure THREE object math; works against a bare `Object3D` parent (no WebGL).

## Tests

`qr-debug-view.test.ts` — two hidden children added, reveal + glue + size on
update, `clear` hides-but-keeps, `dispose` detaches.
