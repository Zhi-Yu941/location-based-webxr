# `scene/clay-world.ts` — procedural low-poly landscape

## Purpose

Builds the miniature clay world the whole scroll story plays in: ground
disc, S-curve path, hills/trees/rocks, the QR sign (9×9 QR-like module
grid with the three corner finder squares, `qrModule` role — echoed by
the copy's `.hl-code` highlight), the statue, the QR "snap" ring, the
hidden outer "unmapped park" ring (anywhere chapter) and the hidden
use-case gallery props (arrows, label, treasures). Everything is
generated — no asset downloads (plan's asset budget) — and deterministic
via a seeded LCG.

## Public API

- `buildClayWorld(detail: 'high' | 'low') → Group` — the full world;
  `low` builds fewer decoration meshes and path segments.
- `WORLD_NODE` — the names of every addressable node (`root`, `ground`,
  `path`, `hills`, `trees`, `rocks`, `sign`, `statue`, `snapRing`,
  `outer`, `gallery`, `arContent`). The story timeline looks these up by
  name. `arContent` holds the dive's in-world AR overlays: path-forward
  trail arrows (each carrying `userData.pathT`, orientation test-pinned
  to the path tangent), the red `ar-poi-pin` over the statue, and the
  `ar-poi-label` hinted-text board.
- `createPathCurve() → CatmullRomCurve3` — the ground-level walk path the
  dot-person follows (same curve the path slabs are laid along).
- `WORLD_ANCHORS` — story hot-spots (`sign`, `markerPair`, `statue`)
  derived to sit on/near the path.

## Invariants & assumptions

- **Determinism:** same input → identical world (seeded LCG, no
  `Math.random`), test-pinned. Two page loads look the same and tests can
  pin structure.
- **Name contract:** every `WORLD_NODE` name resolves via
  `getObjectByName` on the built world (test-pinned) — the timeline
  animates nothing silently if a name drifts, so this is the guard.
- **Reveal groups start hidden:** `outer` and `gallery` have
  `visible === false` until their chapters (test-pinned).
- All meshes are tagged with roles that exist in `PALETTE_ROLES`
  (test-pinned) so the theme toggle recolors the entire world.
- Path is at y=0 and stays inside the world disc; scatter placement keeps
  a margin from the path and the anchors so props never block the walk.

## Examples

```ts
const world = buildClayWorld(tier.geometryDetail);
scene.add(world);
const curve = createPathCurve();
dotPerson.position.copy(curve.getPointAt(0));
```

## Tests

`clay-world.test.ts` — name contract, role validity, low-tier mesh-count
reduction, determinism, hidden reveal groups, path ground-level/in-bounds,
anchor proximity to the path.
