import { CapsuleGeometry, SphereGeometry, type Group } from "three";
import { clayMesh, namedGroup } from "./palette";

/**
 * The dot-person: the visitor's stand-in that walks the path through the
 * story. Deliberately abstract (capsule + head dot) so it reads as "a
 * person with a phone" without any demographic detail. The story timeline
 * moves the GROUP; the meshes stay put inside it.
 */

export const DOT_PERSON_NAME = "dot-person";

export function buildDotPerson(): Group {
  const person = namedGroup(DOT_PERSON_NAME);
  const body = clayMesh(new CapsuleGeometry(0.32, 0.7, 4, 10), "person");
  body.position.y = 0.75;
  const head = clayMesh(new SphereGeometry(0.22, 10, 8), "person");
  head.position.y = 1.55;
  person.add(body, head);
  return person;
}
