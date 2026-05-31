# `marker.ts` — the "your content here" extension seam

- **Purpose:** The single boundary a student edits to drop in their own use
  case (Finding 6 of the planning doc). `main.ts` anchors whatever this
  returns to the persisted GPS coordinate.
- **Public API:**
  - `createAnchorMarker(): THREE.Object3D` — returns a fresh marker each call.
    Default is a ~1 m "map pin" (post + downward cone).
- **Invariants & assumptions:** the only contract relied on by the framework
  wiring is "returns one `Object3D`". No shared mutable singleton.
- **Examples:** replace the body with your own mesh/group; keep the return
  type.
- **Tests:** [marker.test.ts](marker.test.ts) — asserts it returns an
  `Object3D` and a fresh instance per call.
- **See also:** [main.ts.md](main.ts.md).
