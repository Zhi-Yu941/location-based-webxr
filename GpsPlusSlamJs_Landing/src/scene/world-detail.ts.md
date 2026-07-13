# `scene/world-detail.ts` — grass, curb & contact shadows (v3 F7)

## Purpose

The world's detail layer: instanced grass tufts over the meadow, a low
curb line along both path edges, and soft fake contact shadows under the
anchored props (plus a reusable disc the dot-person attaches).

## Public API

- `buildGrass(detail, curve, anchors): InstancedMesh` — ONE draw call;
  `GRASS_COUNTS = { high: 300, low: 100 }` (tier-scaled, test-pinned).
  Deterministic scatter clear of path (≥1.2) and anchors (≥2.5);
  `paletteRole: "grass"`.
- `buildCurb(detail, curve): InstancedMesh` — ONE draw call; 60/30
  stones per side at ±0.95 from the curve (just off the 1.6-wide slabs);
  `paletteRole: "curb"`.
- `buildContactShadows(anchors): Group` — flat gradient discs under
  statue, marker pair and QR sign. Curve/anchors are PARAMETERS
  (clay-world passes its own) to keep this module out of a clay-world
  import cycle (dpdm-enforced).
- `buildContactShadow(name, radius): Mesh` — reusable disc
  (`contact-shadow-<name>`); `dot-person.ts` parents one so it walks
  along.
- Names: `GRASS_NAME`, `CURB_NAME`, `CONTACT_SHADOWS_NAME`,
  `CONTACT_SHADOW_PREFIX`.

## Invariants & assumptions

- **Single draw call each:** grass and curb are `InstancedMesh` — the
  whole layer adds 2 draw calls + a handful of shadow discs.
- **Cost discipline:** counts are tier-scaled; nothing casts or receives
  real shadows; contact shadows are `MeshBasicMaterial` alpha discs
  (procedural `DataTexture`, headless-test-safe), `depthWrite: false`,
  `renderOrder: 1`, rotated flat (`-π/2`) — deliberately NOT billboard
  sprites, which would stand up toward the camera.
- **Placement contracts (test-pinned):** grass keeps the walk and the
  story anchor compositions clear; curb hugs the curve at ~0.95; both
  are deterministic (seeded LCG). Unplaceable grass instances are parked
  at y = −50 (invisible) so the instance count stays exact.
- The two palette roles (`grass`, `curb`) exist in all five palettes
  (test-pinned via the role-completeness suites).

## Examples

```ts
world.add(buildGrass(tier.geometryDetail), buildCurb(tier.geometryDetail));
world.add(buildContactShadows());
person.add(buildContactShadow("person", 0.55));
```

## Tests

`world-detail.test.ts` — palette role presence, tier-scaled counts,
path/anchor clearance, curb-hugs-curve, determinism, flat/no-depth-write
shadow contract, statue+marker coverage, dot-person shadow child.
