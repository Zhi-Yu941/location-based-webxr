# capture-size-param.ts

## Purpose

Parse an optional `?capture=<px>` override from the page URL so a device tester
can run the **WS-C detection-resolution sweep** (does a larger RGB blit decode a
small/blurry QR more reliably?) without rebuilding per resolution. The value is
forwarded to `startCameraFrameCapture({ captureSize })` (the longer-edge blit
budget the `BarcodeDetector` sees).

## Public API

- `parseCaptureSizeParam(search: string): number | undefined` — returns a
  positive integer in `[128, 4096]`, or `undefined` when the param is absent,
  non-numeric, or out of range (so a bad value can never shrink the blit).

## Invariants & assumptions

- The sweep is **device-manual**: `BarcodeDetector` is not available in the
  headless test harness (the e2e fakes detection), so decode-rate-vs-resolution
  is read on-device via the diagnostics overlay (O-C1 = device-manual). This util
  only makes the lever adjustable at runtime.
- Defensive bounds: rejects ≤0, NaN, and absurd sizes; floors fractions.

## Examples

```ts
// On device: open .../qr-demo/?capture=768 to sweep the RGB blit budget.
const captureSize = parseCaptureSizeParam(window.location.search); // 768 | undefined
startCameraFrameCapture(captureSize ? { captureSize } : undefined);
```

## Tests

- `capture-size-param.test.ts` — valid override, fractional floor, absent param,
  non-numeric / out-of-range / negative → `undefined`.

## Related

- Wired in [seams.ts](seams.ts) (`startFrameSource`). Sweep method + decision in
  `2026-06-17-1204-qr-size-thin-demo-next-steps-followup.md`. The aspect-fit behaviour
  of each candidate size is locked in the framework `camera-blit-capture.test.ts`.
