# main.ts

**Purpose:** Application entry point (glue — "framework wiring, don't touch").
Composes the tested seams into the demo flow: capability-gate → Start gesture →
boot store + AR session + debug view + controller → per-frame
`controller.offerFrame` + HUD render.

## Behaviour

- Capability-gates on `getSeams().checkSupport()`; a WebXR gap blocks, a depth
  gap only warns.
- `startAr()` boots the store (with `qrDetected`), `initAR`, the debug view under
  `arWorldGroup`, and the controller; wires `recordDetection`/`recordSize` to
  store dispatches, `updateScene` to the debug view (skips until a size exists),
  and `startFrameSource` to `offerFrame`. `failStart` rolls the UI back on a boot
  error.
- HUD re-renders on store change and status change.

## Verification

Not unit-tested (pure logic lives in the sibling modules). Verified via the
faked Playwright e2e (`playwright-tests/qr-demo.spec.js`) and manually on an AR
device (`pnpm dev`) — the §5 axis-overlay gate.
