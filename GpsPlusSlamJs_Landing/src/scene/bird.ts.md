# `scene/bird.ts` — hidden bird egg (№10)

## Purpose

A small low-poly songbird perched atop the QR sign (catalog №10);
clicking it (via the §2 plumbing) opens the cs-util X profile in a new
tab.

## Public API

- `buildBird(anchor: Vector3): Group` — the `hidden-bird` group (body +
  head + beak + tail) at `anchor`. Placed by clay-world on the QR sign.
- `BIRD_NAME`, `BIRD_LINK` (`https://x.com/csutil_com`).

## Invariants & assumptions

- **Uses no AR-blue role (test-pinned):** blue is reserved for AR/tech
  content per the color-coding invariant (no blue-bird pun). The bird
  uses the neutral `trunk` (brown) scenery role throughout — never an
  AR-coded role (`arrow`/`label`/`ghost`/`satellite`/`screen`/`phone`).
  (Raw hue can't be the check: the neon palette blue-tints ALL scenery
  by design, so the test guards the ROLE, not the channel values.)
- Deterministic; no RNG. Sits at its anchor (test-pinned).
- The click opens the profile in `main.ts` (`window.open(BIRD_LINK,
'_blank', 'noopener')`) — `scene-controller.clickAt` returns
  `{ egg: 'bird' }` and changes no scene state.
- Fully hidden, no tracking (E3/E4).

## Tests

`bird.test.ts` — named group + body/beak, link target, no AR-blue role,
determinism + anchor placement. `scene-controller.test.ts` pins the
click→`{egg:'bird'}` routing.
