# `scene/world-detail.ts` — grass & contact shadows (v3 F7)

## Purpose

The world's detail layer: instanced grass tufts over the meadow and soft
fake contact shadows under the anchored props (plus a reusable disc the
dot-person attaches). The F7 curb stones were REMOVED in round-9 — they
read as distracting spikes beside the path (test-pinned removal).

## Public API

- `buildGrass(detail, curve, anchors): InstancedMesh` — ONE draw call;
  `GRASS_COUNTS = { high: 300, low: 100 }` (tier-scaled, test-pinned).
  Deterministic scatter clear of path (≥1.2) and anchors (≥2.5);
  `paletteRole: "grass"`.
- `buildContactShadows(anchors): Group` — flat gradient discs under
  statue, marker pair and QR sign. Curve/anchors are PARAMETERS
  (clay-world passes its own) to keep this module out of a clay-world
  import cycle (dpdm-enforced).
- `buildContactShadow(name, radius): Mesh` — reusable disc
  (`contact-shadow-<name>`); `dot-person.ts` parents one so it walks
  along.
- Names: `GRASS_NAME`, `CONTACT_SHADOWS_NAME`, `CONTACT_SHADOW_PREFIX`.

## Invariants & assumptions

- **Single draw call:** the grass is an `InstancedMesh` — the whole
  layer adds 1 draw call + a handful of shadow discs.
- **Cost discipline:** counts are tier-scaled; nothing casts or receives
  real shadows; contact shadows are `MeshBasicMaterial` alpha discs
  (procedural `DataTexture`, headless-test-safe), `depthWrite: false`,
  `renderOrder: 1`, rotated flat (`-π/2`) — deliberately NOT billboard
  sprites, which would stand up toward the camera.
- **Placement contracts (test-pinned):** grass keeps the walk and the
  story anchor compositions clear and is deterministic (seeded LCG).
  Unplaceable grass instances are parked at y = −50 (invisible) so the
  instance count stays exact.
- The `grass` palette role exists in all five palettes (test-pinned).
- **No curb, on purpose (round-9):** a test pins that the world carries
  zero `curb`-role objects — do not re-add them citing F7.

## Examples

```ts
world.add(buildGrass(tier.geometryDetail, curve, anchors));
world.add(buildContactShadows(WORLD_ANCHORS));
person.add(buildContactShadow("person", 0.55));
```

## Tests

`world-detail.test.ts` — palette role presence, tier-scaled counts,
path/anchor clearance, determinism, flat/no-depth-write shadow contract,
statue+marker coverage, dot-person shadow child, and the round-9
no-curb pin.
