# `main.ts` — landing-page bootstrap

## Purpose

The only impure entry point: gathers browser signals, decides the quality
tier, boots the theme controller and the 3D scene controller, and wires
scroll/resize/toggle events to them. Everything it composes is a tested
pure module; `main.ts` itself stays thin glue (verified manually — see
Tests).

## Public API

None (side-effect entry module loaded by `index.html`).

## Invariants & assumptions

- **Boot order:** capability tier → scene controller → theme controller.
  The theme controller is created AFTER the scene so its initial
  `applyTheme` reaches both the DOM and the 3D palette in one call.
- **Fallback behavior:** `static-dom` tier or failed renderer creation →
  `body.no-webgl` (hides the canvas layer, restores full-opacity copy
  panels); the DOM copy stands alone. Missing chapter sections are
  console-warned, never fatal.
- **Modes:** `scroll` → target-progress scrubbing + auto-intro when the
  page loads at the top (first scroll past 40px skips the intro);
  `reduced-motion` → chapter end-state seeks on chapter change only.
- Scroll listener is passive; section metrics are re-measured on resize.
- The initial theme read from `document.documentElement.dataset.theme`
  (stamped by index.html's FOUC guard) is only a pre-boot hint for the
  scene; `createThemeController` re-resolves and re-applies immediately.

## Examples

Not applicable — loaded once via `<script type="module" src="/src/main.ts">`.

## Tests

No unit tests (thin impure glue; all logic lives in the imported tested
modules). The Playwright smoke suite (`playwright-tests/scroll-story.spec.js`)
exercises this wiring end-to-end in a real browser: boot + chapter
activation without console errors, canvas-or-floor, theme persistence,
demo links, reduced motion. The remaining coverage is the manual pass per
the plan's verification section: desktop Chrome/Firefox, Android phone,
both themes, no-WebGL (WebGL disabled via browser flag).
