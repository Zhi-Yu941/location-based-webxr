# `capability-checker.ts`

## Purpose

Pure, browser-free capability gating for GPS+AR demos: decide whether the demo
can run (WebXR + geolocation both available) and build the honest "why it can't
run" message. Promoted from `AnchorStarter/src/capability.ts` (§6.4 of
`2026-06-03-0553-threejs-arbutton-minimal-ar-example-user-feedback.md`) so the minimal
AR example and AnchorStarter share the decision and message without sharing
app-specific copy.

## Public API

- `isFullySupported(support: CapabilitySupport): boolean` — `true` only when both
  `webxr` and `geolocation` are `true`.
- `capabilityMessage(support, options?): string | null` — `null` when fully
  supported; otherwise a message naming exactly which capabilities are missing.
  - `options.contextLabel?: string` — app-specific "what this demo lets you do"
    phrase, appended as `…outdoors, to try ${contextLabel}.`. Omit for a neutral
    ending at `…outdoors.`.
- `CapabilitySupport` — `{ webxr: boolean; geolocation: boolean }`.
- `CapabilityMessageOptions` — `{ contextLabel?: string }`.

## Invariants & assumptions

- Pure functions: no DOM, no async, no globals. The async probing
  (`isWebXRSupported()`, geolocation availability) stays in each app's `main.ts`.
- `capabilityMessage` returns `null` **iff** `isFullySupported` is `true`,
  regardless of `contextLabel`.
- The message always points the user at an AR-capable phone, outdoors.

## Examples

```ts
import {
  isFullySupported,
  capabilityMessage,
} from 'gps-plus-slam-app-framework/ar/capability-checker';

const support = { webxr: false, geolocation: true };
if (!isFullySupported(support)) {
  // "… does not provide. Open it on an AR-capable phone …, outdoors, to try the demo."
  showError(capabilityMessage(support, { contextLabel: 'the demo' }));
}
```

## Tests

- `capability-checker.test.ts` — decision truth table, `null` when supported
  (with and without `contextLabel`), missing-capability naming, neutral ending
  without `contextLabel`, and the appended `contextLabel` clause.
