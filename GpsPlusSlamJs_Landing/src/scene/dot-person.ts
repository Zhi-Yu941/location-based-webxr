import { CapsuleGeometry, SphereGeometry, type Group } from "three";
import { clayMesh, namedGroup } from "./palette";
import { buildContactShadow } from "./world-detail";

/**
 * The dot-person: the user's stand-in that walks the path through the
 * story. Deliberately abstract (capsule + head dot) so it reads as "a
 * person" without any demographic detail. It once had two arms (round-2
 * R10, raised toward the phone during the dive) — removed in round-5 W1:
 * since the round-4 dive dramaturgy the phone only appears AFTER the
 * person has faded out, so the raise read as an unexplained gesture. The
 * story timeline moves the GROUP.
 */

export const DOT_PERSON_NAME = "dot-person";

export function buildDotPerson(): Group {
  const person = namedGroup(DOT_PERSON_NAME);
  const body = clayMesh(new CapsuleGeometry(0.32, 0.7, 4, 10), "person");
  body.position.y = 0.75;
  const head = clayMesh(new SphereGeometry(0.22, 10, 8), "person");
  head.position.y = 1.55;
  person.add(body, head);
  // Soft fake contact shadow (v3 F7): a child, so it walks along.
  person.add(buildContactShadow("person", 0.55));
  return person;
}
