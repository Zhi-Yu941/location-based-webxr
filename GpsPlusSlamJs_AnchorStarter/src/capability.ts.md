# `capability.ts` — E1 capability gating

- **Purpose:** Pure decision + copy for the "try anywhere" fallback (decision
  D5 / E1). The async feature probing happens in `main.ts`; the *decision* and
  the user-facing message live here so they are unit-testable.
- **Public API:**
  - `CapabilitySupport { webxr, geolocation }`
  - `isFullySupported(support): boolean` — both AR and GPS available.
  - `capabilityMessage(support): string | null` — names exactly which
    capabilities are missing and points the user at an AR phone outdoors;
    `null` when fully supported.
- **Invariants & assumptions:** never throws; message lists `WebXR` and/or
  `GPS / geolocation` depending on what is missing.
- **Examples:**
  - `capabilityMessage({ webxr: false, geolocation: true })` → message naming
    WebXR only.
- **Tests:** [capability.test.ts](capability.test.ts).
- **See also:** [main.ts.md](main.ts.md) (where `checkWebXRSupport` /
  `checkGeolocationPermission` feed this).
