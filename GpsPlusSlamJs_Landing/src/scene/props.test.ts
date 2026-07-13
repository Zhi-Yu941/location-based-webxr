import { describe, expect, it } from "vitest";
import type { Mesh, RingGeometry } from "three";
import { Vector3 } from "three";
import { buildDotPerson, DOT_PERSON_ARM, DOT_PERSON_NAME } from "./dot-person";
import { buildMarkerPair, MARKER_NODE, RING_OFFSETS } from "./markers";
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

  it("has two shoulder-pivoted arms the dive can raise", () => {
    // Round-2 R10: the person raises an arm holding the phone during the
    // dive — the arms are pivot GROUPS at shoulder height so a rotation
    // swings them naturally.
    const person = buildDotPerson();
    const left = person.getObjectByName(DOT_PERSON_ARM.left);
    const right = person.getObjectByName(DOT_PERSON_ARM.right);
    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(right?.position.y ?? 0).toBeGreaterThan(1); // shoulder pivot
    expect(right?.rotation.x ?? 99).toBeCloseTo(0, 5); // hanging by default
  });
});

describe("buildMarkerPair", () => {
  it("scatters the GPS sample rings so their center-of-centers is the pin", () => {
    // Round-2 R5: the rings are GPS READINGS — larger, overlapping,
    // offset around the group origin such that the AVERAGE of the ring
    // centers is exactly the origin (where the red pin stands). That
    // spatial relationship IS the averaging message.
    const pair = buildMarkerPair();
    const ringNames: string[] = [];
    pair.raw.traverse((obj) => {
      if (obj.name.startsWith("uncertainty-ring-")) {
        ringNames.push(obj.name);
      }
    });
    expect(ringNames.length).toBeGreaterThanOrEqual(3);
    const sum = RING_OFFSETS.reduce(
      (acc, [x, z]) => ({ x: acc.x + x, z: acc.z + z }),
      { x: 0, z: 0 },
    );
    expect(Math.abs(sum.x)).toBeLessThan(1e-9);
    expect(Math.abs(sum.z)).toBeLessThan(1e-9);
    // Scattered, not concentric: at least two distinct centers.
    expect(
      new Set(RING_OFFSETS.map(([x, z]) => `${x},${z}`)).size,
    ).toBeGreaterThan(1);
  });

  it("renders each GPS sample as ONE uniform thin flat ring above the path surface", () => {
    // Round-4 V1: the torus-based rings read as "a thin ring plus a thick
    // ring around it" (flat-shaded octagon tube = a bright lit band next
    // to darker bands) and arcs crossing the path VANISHED because the
    // torus bottom dipped below the path slab top (y = 0.12). Pin the fix:
    // a flat annulus (single normal = one uniform band), thin, lying flat
    // ABOVE the path surface, with shadows off so nothing re-widens or
    // darkens the band.
    const pair = buildMarkerPair();
    const rings: Mesh[] = [];
    pair.raw.traverse((obj) => {
      if (obj.name.startsWith("uncertainty-ring-")) {
        rings.push(obj as Mesh);
      }
    });
    expect(rings.length).toBeGreaterThanOrEqual(3);
    for (const ring of rings) {
      expect(ring.geometry.type).toBe("RingGeometry");
      const params = (ring.geometry as RingGeometry).parameters;
      expect(params.outerRadius - params.innerRadius).toBeLessThanOrEqual(0.1);
      expect(ring.position.y).toBeGreaterThan(0.12); // path slab top
      expect(ring.castShadow).toBe(false);
      expect(ring.receiveShadow).toBe(false);
    }
  });

  it("provides connector lines from each ring center aimed at the pin", () => {
    // Round-2 R8: the fusion chapter draws lines from the ring centers to
    // the average point — each connector's long axis must point from its
    // ring offset toward the group origin.
    const pair = buildMarkerPair();
    expect(pair.connectors.name).toBe(MARKER_NODE.connectors);
    const bars = pair.connectors.children;
    expect(bars.length).toBe(RING_OFFSETS.length);
    bars.forEach((bar, i) => {
      const offset = RING_OFFSETS[i];
      if (!offset) {
        throw new Error("offset missing");
      }
      const [dx, dz] = offset;
      const along = new Vector3(1, 0, 0).applyQuaternion(bar.quaternion);
      const toOrigin = new Vector3(-dx, 0, -dz).normalize();
      expect(Math.abs(along.dot(toOrigin))).toBeGreaterThan(0.99);
    });
  });

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
  it("starts hidden and is a pure window: frame + translucent screen, NO screen-plane overlays", () => {
    // Round-1 feedback: overlays painted on the screen plane pointed
    // nowhere and confused the message — the AR content lives in the
    // WORLD (clay-world's ar-content group) and is seen THROUGH the
    // window instead.
    const phone = buildPhoneFrame();
    expect(phone.name).toBe(PHONE_NODE.root);
    expect(phone.visible).toBe(false);
    expect(phone.getObjectByName(PHONE_NODE.screen)).toBeDefined();
    let arrowCount = 0;
    phone.traverse((obj) => {
      if (obj.userData.paletteRole === "arrow") {
        arrowCount++;
      }
    });
    expect(arrowCount).toBe(0);
  });
});
