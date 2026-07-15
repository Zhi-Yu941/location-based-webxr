# `qr-handoff.ts` — desktop→phone QR handoff (v2 B2)

## Purpose

Shows a client-generated QR code of the **live URL** in the CTA block when
the visitor is on a desktop-class device that cannot run `immersive-ar` —
the established WebAR pattern for bridging desktop visitors to their
phone. Extends the round-8 Z6 `ar-support.ts` architecture; no server.

## Public API

- `shouldShowQrHandoff(env: QrHandoffEnvironment): boolean` — pure
  decision. True iff `!arSupported && hasFinePointer && viewportWidth >=
QR_HANDOFF_MIN_VIEWPORT_WIDTH` (768).
- `applyQrHandoff(doc, show, url): void` — injects the QR SVG (via the
  tiny `uqr` encoder, ecc M) plus the `QR_HANDOFF_CAPTION` paragraph into
  `#qr-handoff` and unhides it. No-ops on `show === false`, missing
  container, empty URL, or encoder failure.
- Constants: `QR_HANDOFF_CONTAINER_ID` (`"qr-handoff"`),
  `QR_HANDOFF_MIN_VIEWPORT_WIDTH` (768), `QR_HANDOFF_CAPTION`.

## Invariants & assumptions

- **Runtime generation is deliberate** (v2 doc §3.3 decision): the QR
  encodes `location.href`, so preview/staging origins produce correct
  codes without a rebuild. Do not "simplify" to a build-time static SVG.
- **Device-class heuristic:** fine pointer AND ≥768 px. A wide landscape
  phone (coarse pointer) and a narrow desktop window both stay QR-free;
  AR-capable devices always stay QR-free (they get the upgraded CTA
  claim from `ar-support.ts` instead).
- The static HTML ships `#qr-handoff` with the `hidden` attribute — with
  JS disabled or on any non-qualifying device nothing ever appears
  (progressive enhancement, mirror of the Z6 claim pattern).
- `innerHTML` injection is safe: `uqr`'s `renderSVG` emits only module
  geometry; the URL is never embedded as markup.
- Failure of the optional enhancement must never break boot: every bad
  input path returns silently.

## Examples

```ts
applyQrHandoff(
  document,
  shouldShowQrHandoff({
    arSupported: false,
    viewportWidth: window.innerWidth,
    hasFinePointer: matchMedia("(hover: hover) and (pointer: fine)").matches,
  }),
  window.location.href,
);
```

## Tests

- `src/qr-handoff.test.ts` — decision matrix (desktop/AR/phone/landscape),
  property-based decision equivalence, DOM injection + caption, degrade
  paths (missing container, empty URL), property-based injection for
  arbitrary URLs.
- `playwright-tests/scroll-story.spec.js` — structural presence on
  desktop (headless chromium has no `navigator.xr`) and absence in the
  mobile-emulation runs.
- Manual: `pnpm run shoot -- cta` (QR visible) vs
  `pnpm run shoot -- --mobile cta` (no QR).
