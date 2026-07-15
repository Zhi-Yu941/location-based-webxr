# `scene/dot-person.ts` — the visitor's stand-in figure

## Purpose

Builds the abstract "dot-person" (capsule body + head sphere) that walks
the path through the story — the visitor's stand-in. Deliberately
featureless so it reads as "a person" without demographic detail.

## Public API

- `buildDotPerson() → Group` — named `DOT_PERSON_NAME` (`"dot-person"`).
- `DOT_PERSON_NAME` — the name the story timeline uses to address it.

## Invariants & assumptions

- The story timeline moves/rotates the GROUP; meshes keep their local
  offsets (body at y≈0.75, head at y≈1.55 → total height ≈ 1.8 world
  units ≙ a person).
- Meshes are `person`-role tagged so the theme toggle recolors them; the
  role carries the "user color" (round-2 R6b): teal/petrol in every
  palette, glowing slightly in dark ones.
- **Deliberately armless** (round-5 W1, test-pinned): the round-2 R10
  arms were removed because the round-4 dive dramaturgy shows the phone
  only after the person has faded — the raise read as an unexplained
  gesture. Do not re-add them citing R10.
- Carries a `contact-shadow-person` disc child (v3 F7, from
  `world-detail.ts`) so the soft ground shadow walks along; it is NOT
  `person`-role tagged (plain black alpha disc, palette-independent).

## Examples

```ts
const person = buildDotPerson();
person.position.copy(createPathCurve().getPointAt(0));
scene.add(person);
```

## Tests

`props.test.ts` — name + role tagging + the no-arms pin (round-5 W1).
