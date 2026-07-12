# `scene/phone-frame.ts` — the phone window for the dive chapter

## Purpose

Builds the phone frame whose glass-translucent screen is a pure WINDOW
into the clay world at eye level during the signature dive moment. The AR
content itself (trail arrows, POI pin, hinted label) lives in the world
(`clay-world`'s `ar-content` group) and is seen through the window —
round-1 feedback removed the earlier screen-plane overlays, which pointed
nowhere and confused the message.

## Public API

- `buildPhoneFrame() → Group` — named `PHONE_NODE.root`
  (`"phone-frame"`), starts `visible = false`.
- `PHONE_NODE` — `root`, `screen` (`"phone-screen"`).

## Invariants & assumptions

- **Starts hidden** (test-pinned): the dive timeline raises it in front of
  the camera and hides it again when scrolling past.
- The body is a FRAME of four edge bars (never a solid slab — that would
  block the window) and the screen material is transparent (opacity
  ≈ 0.16) so the world shows through. **No overlay meshes on the screen
  plane** (test-pinned: zero `arrow`-role meshes in the subtree).
- Roles: `phone` (frame bars), `screen` — the dark theme makes the screen
  glow slightly.

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
