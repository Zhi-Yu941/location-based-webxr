# `scene/phone-frame.ts` — simulated AR view for the dive chapter

## Purpose

Builds the phone silhouette whose screen frames the clay world at eye
level during the signature dive moment, with stylized AR overlays (trail
arrows + a label) floating inside the screen area. Communicates "this is
what your users see" without pretending to be real footage (the plan's
explicit decision against blended real capture).

## Public API

- `buildPhoneFrame() → Group` — named `PHONE_NODE.root`
  (`"phone-frame"`), starts `visible = false`.
- `PHONE_NODE` — `root`, `screen` (`"phone-screen"`), `overlays`
  (`"phone-ar-overlays"`) — the nodes the dive timeline animates.

## Invariants & assumptions

- **Starts hidden** (test-pinned): the dive timeline raises it in front of
  the camera and hides it again when scrolling past.
- The screen plane sits just in front of the body, overlays just in front
  of the screen — z-offsets are local, so the whole group can be parented
  to the camera or posed freely.
- Roles: `phone` (body), `screen`, `arrow`/`label` (overlays) — the dark
  theme makes screen + overlays glow.

## Examples

```ts
const phone = buildPhoneFrame();
camera.add(phone);
phone.position.set(0, 0, -1.6); // held in front of the lens
phone.visible = true;
```

## Tests

`props.test.ts` — name contract, hidden-by-default, screen + overlays
present.
