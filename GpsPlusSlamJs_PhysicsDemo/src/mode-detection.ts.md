# mode-detection.ts

## Purpose

Decide whether the demo runs the live AR path or the desktop-replay path, from a
single signal: whether the browser supports an `immersive-ar` WebXR session.

## Public API

- **`detectArSupport(xr?): Promise<boolean>`** — `true` iff `xr.isSessionSupported('immersive-ar')`
  resolves truthy. `xr` defaults to `navigator.xr`; injectable for tests.
- **`XrLike`** — the structural subset of `XRSystem` probed (`isSessionSupported?`).

## Invariants & assumptions

- **Defensive:** a missing `navigator.xr`, a missing `isSessionSupported`, or a
  throwing/rejecting probe all resolve to `false` (offer replay, never crash on
  startup). Every non-`true` branch is test-pinned.
- Pure/async; no DOM, no side effects.

## Tests

- `mode-detection.test.ts` — absent xr, missing method, supported→true (with the
  `'immersive-ar'` argument asserted), unsupported→false, rejecting probe→false.
