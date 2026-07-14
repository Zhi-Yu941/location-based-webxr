/**
 * Why these tests matter: the hidden bird (catalog №10) is a click egg
 * that opens the cs-util X profile. It must be registered/clickable, and
 * it must be NON-blue on purpose — blue is reserved for AR/tech content
 * per the color-coding invariant (no blue-bird pun).
 */
import { describe, expect, it } from "vitest";
import { Vector3, type Mesh } from "three";
import { BIRD_LINK, BIRD_NAME, buildBird } from "./bird";

// The AR/tech blue family — reserved for AR overlay content by the
// color-coding invariant. The bird must use NONE of these (no blue-bird
// pun); it wears a neutral scenery role instead, which in the neon
// palette is itself blue-tinted like all scenery — that's the palette
// aesthetic, not a coding violation, so we check the ROLE, not raw hue.
const AR_BLUE_ROLES = new Set([
  "arrow",
  "label",
  "ghost",
  "satellite",
  "screen",
  "phone",
]);

const ANCHOR = new Vector3(2, 1, 3);

describe("buildBird", () => {
  it("builds a named group with a body and a beak", () => {
    const bird = buildBird(ANCHOR);
    expect(bird.name).toBe(BIRD_NAME);
    let meshes = 0;
    bird.traverse((o) => {
      if ((o as Mesh).isMesh) {
        meshes += 1;
      }
    });
    expect(meshes).toBeGreaterThanOrEqual(2); // body + beak at least
  });

  it("links to the cs-util X profile", () => {
    expect(BIRD_LINK).toBe("https://x.com/csutil_com");
  });

  it("uses no AR-blue role (color-coding invariant: blue = AR only)", () => {
    const bird = buildBird(ANCHOR);
    const roles = new Set<string>();
    bird.traverse((o) => {
      const role = (o as Mesh).userData?.paletteRole as string | undefined;
      if (role) {
        roles.add(role);
      }
    });
    expect(roles.size).toBeGreaterThan(0);
    for (const role of roles) {
      expect(AR_BLUE_ROLES.has(role), `bird uses AR-blue role ${role}`).toBe(
        false,
      );
    }
  });

  it("is deterministic and sits at its anchor", () => {
    const a = buildBird(ANCHOR);
    const b = buildBird(ANCHOR);
    expect(a.position.distanceTo(ANCHOR)).toBeLessThan(0.01);
    const dump = (g: typeof a) => {
      const out: string[] = [];
      g.traverse((o) =>
        out.push(`${o.name}:${o.position.toArray().join(",")}`),
      );
      return out;
    };
    expect(dump(a)).toEqual(dump(b));
  });
});
