# hud-view.ts

**Purpose:** Pure formatting of the measured-size HUD readout the developer uses
to confirm a freshly printed QR against a tape measure (Note 4). No DOM.

## Public API

- `toHudView(status, size): HudView` → `{ statusLabel, sizeLabel, sampleLabel,
spreadLabel, lifecycleLabel }`.
- `DemoStatus = 'idle' | 'scanning' | 'tracking'`.

## Invariants

- Size shown in **cm** (1 dp), spread in **mm** (rounded). `measuring…` while
  measuring with no median yet; `—` when unknown. Singular `1 sample`.
- `status` is the high-level lock state; `size.status` is the lifecycle stage
  (`unknown` | `measuring` | `estimated`).

## Tests

`hud-view.test.ts` — placeholders when unknown, cm/mm formatting, singular
sample, `measuring…` path.
