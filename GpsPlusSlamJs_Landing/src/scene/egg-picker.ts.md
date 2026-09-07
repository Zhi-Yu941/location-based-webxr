# `scene/egg-picker.ts` — shared easter-egg click plumbing (§2)

## Purpose

Pure decision layer for the hidden click eggs: which REGISTERED egg
target does a pointer ray hit, and does a pointerdown→pointerup pair
count as a genuine click (vs. a scroll/drag)? The canvas sits below the
`#story` scroller, so world objects never receive DOM events — main.ts
forwards drag-filtered clicks here as NDC.

## Public API

- `pickEggTarget(pointer: PointerNdc, camera, targets): string | null` —
  raycasts against the registered targets ONLY (never the whole scene)
  and returns the registered root's `name` (child-mesh hits are mapped
  back up), or null on miss/bad input. The camera's world matrix must be
  current — `scene-controller.clickAt` refreshes it before picking.
- `isGenuineClick(down, up): boolean` — pointer moved ≤ 8 px.
- `PointerNdc` — `{ x, y }` in normalized device coordinates.

## Invariants & assumptions

- **Registered targets only** — a stray click on ordinary scenery can
  never fire an egg, and the raycast stays cheap.
- Non-finite pointer coords and an empty target list are misses, never
  throws (defensive boundary).
- Stateless/pure — a fresh `Raycaster` per call; clicks are rare.

## Examples

```ts
const hit = pickEggTarget({ x: 0, y: 0 }, camera, [geocache, bird]);
if (hit === GEOCACHE_NAME) toggleGeocache(geocache, now);
```

## Tests

`egg-picker.test.ts` — child-hit maps to registered root name, misses
and empty lists return null, correct target among several, NaN pointer
boundary, click-vs-drag threshold.
