import { describe, expect, it } from "vitest";
import type { Mesh } from "three";
import { buildDotPerson, DOT_PERSON_NAME } from "./dot-person";
import { buildMarkerPair, MARKER_NODE } from "./markers";
import { buildPhoneFrame, PHONE_NODE } from "./phone-frame";

// Why this test matters: the props are addressed by name from the story
// timeline (walk the dot-person, jitter the raw marker, raise the phone).
// These tests pin the names, the palette-role tagging (theme toggle must
// recolor props too), and the visibility defaults each chapter relies on.

describe("buildDotPerson", () => {
  it("is a named group with role-tagged meshes", () => {
    const person = buildDotPerson();
    expect(person.name).toBe(DOT_PERSON_NAME);
    let tagged = 0;
    person.traverse((obj) => {
      if ((obj as Mesh).isMesh && obj.userData.paletteRole !== undefined) {
        tagged++;
      }
    });
    expect(tagged).toBeGreaterThan(0);
  });
});

describe("buildMarkerPair", () => {
  it("returns a raw (wobbly) and a fused (stable) marker with distinct roles", () => {
    const pair = buildMarkerPair();
    expect(pair.raw.name).toBe(MARKER_NODE.raw);
    expect(pair.fused.name).toBe(MARKER_NODE.fused);

    const rolesIn = (group: typeof pair.raw) => {
      const roles = new Set<string>();
      group.traverse((obj) => {
        const role = obj.userData.paletteRole as string | undefined;
        if (role) {
          roles.add(role);
        }
      });
      return roles;
    };
    expect(rolesIn(pair.raw)).toContain("markerRaw");
    expect(rolesIn(pair.fused)).toContain("markerFused");
    // The two must never share a role — the visual contrast IS the message.
    for (const role of rolesIn(pair.raw)) {
      expect(rolesIn(pair.fused)).not.toContain(role);
    }
  });
});

describe("buildPhoneFrame", () => {
  it("starts hidden and contains the screen + AR overlay nodes the dive animates", () => {
    const phone = buildPhoneFrame();
    expect(phone.name).toBe(PHONE_NODE.root);
    expect(phone.visible).toBe(false);
    expect(phone.getObjectByName(PHONE_NODE.screen)).toBeDefined();
    expect(phone.getObjectByName(PHONE_NODE.overlays)).toBeDefined();
  });
});
