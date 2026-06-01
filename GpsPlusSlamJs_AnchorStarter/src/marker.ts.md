# `marker.ts` — the "your content here" extension seam

- **Purpose:** The single boundary a new developer edits to drop in their own use
  case (Finding 6 of the planning doc). `main.ts` anchors whatever this
  returns to the persisted GPS coordinate.
- **Public API:**
  - `createAnchorMarker(options?: MarkerOptions): THREE.Object3D` — returns a
    fresh marker each call. Default is a ~1 m "map pin" (post + downward cone).
  - `MarkerOptions` — `{ ui?, scale?, rotationDeg? }`, decoded from the
    `?show=` link. `ui` (1..4) selects one of four simple, distinct styles:
    1 = map pin, 2 = upright billboard panel, 3 = tall translucent light beam,
    4 = floating horizontal ring. `scale` is applied uniformly; `rotationDeg`
    rotates the group about the vertical axis (clockwise-from-north → negated
    onto Three.js' counter-clockwise y-rotation).
- **Invariants & assumptions:** the only contract relied on by the framework
  wiring is "returns one `Object3D`". The top-level group is always named
  `anchor-marker` and tagged with `userData.ui`. No shared mutable singleton.
  The billboard is a _static_ panel (true camera-facing is a future refinement,
  see the F1 doc); rotation/scale come from the decoded anchor spec.
- **Examples:** replace the per-style geometry with your own mesh/group; keep
  the return type.
- **Tests:** [marker.test.ts](marker.test.ts) — asserts it returns an
  `Object3D`, a fresh instance per call, a marker for every `ui`, and that
  `scale`/`rotationDeg` are applied.
- **See also:** [main.ts.md](main.ts.md).
