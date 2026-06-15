# debug-log.ts

**Purpose:** A bounded line buffer + formatters for the demo's on-screen debug
log (Note 2.6 of the on-device follow-up). Surfaces _when_ detections lock and
the **Δt between them**, so the detection cadence is visible on a real device
and the throttle + accumulator thresholds can be tuned against actual hardware.

## Public API

- `createDebugLog(maxLines = 40): DebugLog` — `{ append(line), lines }`, a ring
  buffer (oldest dropped past the cap; can't leak).
- `formatDetectionLine({ clockMs, deltaMs, text, sizeStatus, estimateM, sampleCount })`
  → `"[12.34s Δ132ms] \"…\" estimated 20.1cm (9)"`. `deltaMs: null` → `Δ—`
  (first lock); `estimateM: null` → `?`; long payloads truncated.
- `formatStatusLine(clockMs, status)` → `"[5.00s] → tracking"`.

## Invariants

- Pure + bounded + DOM-free → unit-testable; `main.ts` renders `lines` into a
  `<pre>` and computes `deltaMs` from the previous lock's clock.

## Tests

`debug-log.test.ts` — ring-buffer bound/order; detection-line formatting
(clock/Δt/median/count, first-lock `—`, unknown `?`, truncation); status line.
