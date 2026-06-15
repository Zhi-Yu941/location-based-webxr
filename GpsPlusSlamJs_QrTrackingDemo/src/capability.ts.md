# capability.ts

**Purpose:** Capability gate for the QR-tracking demo — WebXR is required;
depth-sensing is optional (auto-size needs it, else a manual-size fallback);
GPS is not needed (geo-less demo).

## Public API

- `isDemoSupported(support): boolean` — true when WebXR is present.
- `capabilityMessage(support): string | null` — blocking message when WebXR is
  missing, a non-blocking note when only depth is missing, else `null`.
- `DemoCapabilitySupport = { webxr, depthSensing }`.

## Invariants

- Pure over a plain support object (no `navigator.xr` touch) → unit-testable.
- Depth-less + WebXR-capable still runs (message is informational, not a gate).

## Tests

`capability.test.ts` — supported matrix, WebXR-missing block, depth-missing
warning, all-present → null.
