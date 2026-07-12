# `GpsPlusSlamJs_Landing/index.html` — root landing page (3D scroll story)

## Purpose

The entry document of the landing app served at the **root** (`/`) of
`gps.csutil.com`. It carries the entire chapter copy as **real DOM text**
(SEO, accessibility, and the no-WebGL floor — the plan's "Content in DOM"
decision), the dual-theme CSS, and the mount points for the 3D scroll
story that `src/main.ts` boots behind the copy.

## Structure

- `#scene-root` — fixed full-viewport layer the WebGL canvas is appended
  into (`aria-hidden`, z-index 0; hidden entirely under `body.no-webgl`).
- `.top-bar` — brand + `#theme-toggle` button (aria-pressed reflects the
  light theme).
- `<main id="story">` — seven `<section class="chapter" id="chapter-<id>">`
  in the order defined by `src/chapters.ts` (hero, qr, fusion, dive,
  anywhere, gallery, cta). Each carries a `.copy` glass panel with the
  punchy-marketing copy (round-2 interview decision). The active section
  gets `.active` (full opacity) from `main.ts`.
- The CTA section holds the primary "Fork & start building" button, the
  demos hub (four `.demo-card`s with inline-SVG vignettes keeping the
  proven one-line descriptions), the external links, and the license
  footer.

## Invariants & assumptions

- **FOUC guard:** the inline `<script>` in `<head>` applies the persisted
  (or OS-preferred) theme to `<html data-theme>` before first paint. Its
  resolution rule MUST stay in sync with `src/theme.ts`
  (`resolveInitialTheme`) — same storage key `gps-landing-theme`, same
  valid values, same fallback.
- **Theming:** all chrome colors go through CSS custom properties defined
  per `html[data-theme='dark'|'light']`; the accent `#ef4444` matches the
  3D palette's fused-anchor color.
- **Demo links** are root-absolute with trailing slashes (`/starter/`,
  `/minimal/`, `/qr-demo/`, `/recorder/`) — deployment URLs on the shared
  origin, asserted by `scripts/build-site.mjs` after the production build.
- **Chapter sections** must exist for every id in `src/chapters.ts` (same
  order); `main.ts` warns on missing ones. Sections are min-height 130vh
  (hero 100vh) to give the scroll story room.
- `csstree/validator` disable comments on `clamp()` lines are false-
  positive suppressions (the bundled css-tree grammar rejects math
  functions), same as in the sibling apps.

## Examples

`pnpm dev` in this package serves the page on port 5182. The production
build is `vite build` at base `/` orchestrated by `scripts/build-site.mjs`.

## Tests

- `lint:css` (stylelint + csstree) covers the inline CSS.
- The chapter-id contract is covered by `src/chapters.test.ts` +
  `main.ts`'s runtime warning; the demo-link presence is asserted by the
  build-site guard after `pnpm run build:site`.
- Visual behavior (scroll story, themes, reduced motion, no-WebGL) is the
  manual pass defined in the plan's verification section.
