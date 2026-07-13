# `capability.ts` — capability detection → quality tier

## Purpose

Pure decision function implementing the plan's "full experience everywhere,
tiered quality" fallback ladder: which story mode runs (`scroll` /
`reduced-motion` / `static-dom`) and at what render quality (DPR cap,
shadows, geometry detail).

## Public API

- `decideQualityTier(inputs: CapabilityInputs) → QualityTier`
  - `CapabilityInputs`: `webglSupported`, `prefersReducedMotion`,
    `deviceMemoryGb` (undefined outside Chromium), `hardwareConcurrency`
    (undefined when unavailable), `devicePixelRatio`.
  - `QualityTier`: `mode`, `dprCap` (always in [1, 2]), `shadows`,
    `geometryDetail: 'high' | 'low'`, `postprocessing` (v3 F1: bloom +
    vignette, high tier only — the gate is decided HERE so it stays
    testable in one place). (The mode union `StoryMode` is
    module-private; consumers use `QualityTier['mode']`.)

## Invariants & assumptions

- **Ladder order:** no WebGL → `static-dom` (overrides everything,
  including reduced motion); else reduced motion → `reduced-motion`; else
  `scroll`. Mode and quality are orthogonal — a capable device with
  reduced motion still renders the high tier.
- **Unknown ≠ weak:** missing `deviceMemory`/`hardwareConcurrency` counts
  as capable (Firefox/Safari never expose deviceMemory; punishing unknown
  would degrade most desktops).
- **Weak hardware:** `deviceMemoryGb < 4` or `hardwareConcurrency <= 4` →
  DPR cap 1.5, shadows off, low-poly geometry, no post-processing (the
  low tier keeps exactly its pre-bloom cost profile). High tier caps DPR
  at 2 and enables post-processing.
- **Defensive:** non-finite or sub-1 `devicePixelRatio` clamps to 1 — a
  garbage DPR must never produce a zero-sized framebuffer.
- Pure function, no browser globals — callers gather the inputs (see
  `main.ts`), which keeps this testable in plain node.

## Examples

```ts
const tier = decideQualityTier({
  webglSupported: probeWebgl(),
  prefersReducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches,
  deviceMemoryGb: navigator.deviceMemory,
  hardwareConcurrency: navigator.hardwareConcurrency,
  devicePixelRatio: window.devicePixelRatio,
});
renderer.setPixelRatio(tier.dprCap);
renderer.shadowMap.enabled = tier.shadows;
```

## Tests

`capability.test.ts` — every ladder rung pinned: capable default, weak
memory/CPU downgrades, unknown-treated-as-capable, reduced-motion mode,
no-WebGL floor, and DPR clamping (device ratio, 0, NaN).
