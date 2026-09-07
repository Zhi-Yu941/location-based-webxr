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
  block the window) and the screen material is transparent (opacity 0.22
  — the round-7 Y4 "light glass" tint, test-pinned 0.2–0.35: once the
  frame fills the viewport the tint is what still reads as "looking
  through a phone") so the world shows through. **No overlay meshes on
  the screen plane** (test-pinned: zero `arrow`-role meshes in the
  subtree).
- **Glass cue = the shiny pane alone (round-8 Z2, narrowed in round-9,
  test-pinned):** roughness 0.15 lets the directional light put a real
  specular sheen on the pane. The round-8 diagonal glare strips were
  REMOVED in round-9 ("riesig groß und überlappen") — a test pins zero
  `glare`-role objects; do not re-add them citing Z2.
- Roles: `phone` (frame bars — blue family in dark palettes since
  round-5 W4), `screen` (glows slightly in dark).

## Examples

```ts
const phone = buildPhoneFrame();
camera.add(phone);
// 1.7 = the round-7 Y4 fill distance (see story-timeline.ts createStoryStage)
phone.position.set(0, 0, -1.7);
phone.visible = true;
```

## Tests

`props.test.ts` — name contract, hidden-by-default, screen + overlays
present.
