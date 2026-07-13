import { CapsuleGeometry, SphereGeometry, type Group } from "three";
import { clayMesh, namedGroup } from "./palette";

/**
 * The dot-person: the user's stand-in that walks the path through the
 * story. Deliberately abstract (capsule + head dot) so it reads as "a
 * person with a phone" without any demographic detail — but WITH two
 * simple arms (round-2 R10): the dive raises the right one to hold the
 * phone, which is what makes the phone frame read as a phone and not a
 * picture frame. The story timeline moves the GROUP; the arm pivots are
 * rotated at the shoulders.
 */

export const DOT_PERSON_NAME = "dot-person";

export const DOT_PERSON_ARM = {
  left: "dot-person-arm-left",
  right: "dot-person-arm-right",
} as const;

function buildArm(name: string, side: -1 | 1): Group {
  // Pivot group at the shoulder: rotating the GROUP swings the whole arm
  // naturally (the capsule hangs below the pivot).
  const pivot = namedGroup(name);
  pivot.position.set(side * 0.36, 1.28, 0);
  const arm = clayMesh(new CapsuleGeometry(0.09, 0.42, 4, 8), "person");
  arm.position.y = -0.3;
  pivot.add(arm);
  return pivot;
}

export function buildDotPerson(): Group {
  const person = namedGroup(DOT_PERSON_NAME);
  const body = clayMesh(new CapsuleGeometry(0.32, 0.7, 4, 10), "person");
  body.position.y = 0.75;
  const head = clayMesh(new SphereGeometry(0.22, 10, 8), "person");
  head.position.y = 1.55;
  person.add(
    body,
    head,
    buildArm(DOT_PERSON_ARM.left, -1),
    buildArm(DOT_PERSON_ARM.right, 1),
  );
  return person;
}
