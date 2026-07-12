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
- Meshes are `person`-role tagged so the theme toggle recolors them
  (light: dark figure on light world; dark: light glowing figure).

## Examples

```ts
const person = buildDotPerson();
person.position.copy(createPathCurve().getPointAt(0));
scene.add(person);
```

## Tests

`props.test.ts` — name + role tagging.
