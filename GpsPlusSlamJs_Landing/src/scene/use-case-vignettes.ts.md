# `scene/use-case-vignettes.ts` — gallery journey destinations (round-11)

## Purpose

Two little use-case stages beyond the walkable world, flown past/at by
the gallery chapter's camera journey: the CAMPUS (trade-fair/venue —
tents + the blue AR arrows placed statically) and the CASTLE
(historic buildings — a low-poly ruin overlaid with a translucent
AR-blue ghost of the broken tower standing again). The journey ends at
the castle, which stays in the CTA chapter's background.

## Public API

- `buildUseCaseVignettes(anchors: VignetteAnchors): Group` — the
  `use-case-vignettes` group with `vignette-campus` (whose trail arrows
  live in the named `campus-arrows` child group), `vignette-castle`
  and the castle's `castle-ghost` child.
- `VIGNETTE_NODE` / `VIGNETTES_NAME` — node-name contract.
- `VignetteAnchors` — `{ campus, castle }` world positions; clay-world
  computes them next to its skyline math and exports them as
  `VIGNETTE_ANCHORS` (the story timeline aims the journey at the same
  constants).

## Invariants & assumptions

- **Anchors are parameters** (world-detail pattern) — importing
  clay-world from here would be an import cycle (dpdm-enforced).
- **Ghost contract (test-pinned):** every ghost mesh is `transparent`
  (opacity ~0.32, within 0.1–0.6), `depthWrite: false` — the "how it
  was" overlay must never occlude the ruin it explains. Role `ghost` is
  AR-blue in every palette (color-coding invariant: blue = AR content).
- **Nothing floats (test-pinned, the R10-3 lesson):** each vignette
  stands on its own sunken ground disc (top y=0, skirt to −10).
- **Plain meshes, journey-revealed (round-13 R13-4):** the arrows echo
  the dive trail as plain meshes with no animation of their own — but
  the STORY TIMELINE pops the `campus-arrows` children and the
  `castle-ghost` parts in during the journey flyover (it primes their
  per-part scale to ~0 at stage creation). The BUILT group ships them
  at full scale; anything else here stays static ("nicht zu viel
  3D-Heckmeck").
- **Clearances (test-pinned, round-13 R13-3):** every trail arrow keeps
  horizontal distance > roof-hull radius + 0.3 from every tent center,
  and pairwise tent hull gaps stay > 1.2 — the trail must run BETWEEN
  the tents, never through canvas.
- Deterministic (no RNG at all); roles `tent`/`ruin`/`ghost` exist in
  all five palettes (test-pinned).

## Examples

```ts
world.add(buildUseCaseVignettes(VIGNETTE_ANCHORS));
camera.lookAt(VIGNETTE_ANCHORS.castle.clone().setY(3));
```

## Tests

`use-case-vignettes.test.ts` — palette role completeness, anchors
outside the world disc + apart from each other, node contract, content
counts (tents/arrows/ruin/ghost), arrow↔tent + tent↔tent clearances
(round-13), ghost transparency/depth contract, sunken discs,
determinism. The pop-in behavior is pinned in `story-timeline.test.ts`.
Visual truth: `pnpm run shoot -- gallery cta`.
