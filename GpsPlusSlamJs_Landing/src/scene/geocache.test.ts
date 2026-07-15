/**
 * Why these tests matter: the geocache chest (catalog №1) is the first
 * hidden click egg — its open/close state machine runs on wall-clock
 * event time (NOT the scroll timeline), so nothing here may touch the
 * story's scrub guarantees. The chest must stay palm-sized and grounded
 * (nothing floats — R10-3), the signal pin must be the amber GPS color
 * family (color-coding invariant), and toggling must be repeatable and
 * interrupt-safe.
 */
import { describe, expect, it } from "vitest";
import { Box3, Vector3, type Mesh, type Object3D } from "three";
import {
  buildGeocache,
  GEOCACHE_LID_NAME,
  GEOCACHE_NAME,
  GEOCACHE_PIN_NAME,
  toggleGeocache,
  updateGeocache,
} from "./geocache";

const ANCHOR = new Vector3(10, 0, -5);

function lid(chest: Object3D): Object3D {
  const node = chest.getObjectByName(GEOCACHE_LID_NAME);
  expect(node).toBeDefined();
  return node!;
}

function pin(chest: Object3D): Object3D {
  const node = chest.getObjectByName(GEOCACHE_PIN_NAME);
  expect(node).toBeDefined();
  return node!;
}

describe("buildGeocache", () => {
  it("builds a palm-sized, grounded chest with lid and amber signal pin", () => {
    const chest = buildGeocache(ANCHOR);
    expect(chest.name).toBe(GEOCACHE_NAME);
    chest.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(chest);
    // Palm-sized: roughly half a unit, and nothing floats above ground…
    expect(box.max.y - Math.max(0, box.min.y)).toBeLessThan(1.2);
    expect(box.max.x - box.min.x).toBeLessThan(1.2);
    // …anchored where clay-world put it.
    expect(chest.position.distanceTo(ANCHOR)).toBeLessThan(0.01);
    // The signal pin wears the amber GPS role (color-coding invariant).
    let pinRole: string | undefined;
    pin(chest).traverse((obj) => {
      pinRole ??= (obj as Mesh).userData?.paletteRole as string | undefined;
    });
    expect(pinRole).toBe("markerRaw");
  });

  it("is deterministic: two builds are identical", () => {
    const a: string[] = [];
    const b: string[] = [];
    buildGeocache(ANCHOR).traverse((o) =>
      a.push(`${o.name}:${o.position.toArray().join(",")}`),
    );
    buildGeocache(ANCHOR).traverse((o) =>
      b.push(`${o.name}:${o.position.toArray().join(",")}`),
    );
    expect(a).toEqual(b);
  });
});

describe("toggle/update state machine", () => {
  it("opens on first toggle: lid swings, pin rises, animation settles", () => {
    const chest = buildGeocache(ANCHOR);
    const closedLid = lid(chest).rotation.x;
    const closedPin = pin(chest).position.y;

    const first = toggleGeocache(chest, 1000);
    expect(first.opened).toBe(true);
    // Mid-animation: moving, not yet settled.
    expect(updateGeocache(chest, 1150)).toBe(true);
    // Past the transition: settled open, update reports idle.
    updateGeocache(chest, 2000);
    expect(updateGeocache(chest, 2100)).toBe(false);
    expect(lid(chest).rotation.x).toBeLessThan(closedLid - 1);
    expect(pin(chest).position.y).toBeGreaterThan(closedPin + 0.4);
  });

  it("closes on the second toggle and is repeatable", () => {
    const chest = buildGeocache(ANCHOR);
    toggleGeocache(chest, 0);
    updateGeocache(chest, 1000);
    const second = toggleGeocache(chest, 2000);
    expect(second.opened).toBe(false);
    updateGeocache(chest, 3000);
    expect(lid(chest).rotation.x).toBeCloseTo(0, 2);
    expect(pin(chest).position.y).toBeLessThan(0);
    // Third toggle opens again.
    expect(toggleGeocache(chest, 4000).opened).toBe(true);
  });

  it("an interrupting toggle reverses smoothly from the CURRENT pose (no snap)", () => {
    const chest = buildGeocache(ANCHOR);
    toggleGeocache(chest, 0);
    updateGeocache(chest, 120); // mid-open
    const midLid = lid(chest).rotation.x;
    toggleGeocache(chest, 120); // reverse mid-flight
    updateGeocache(chest, 130);
    // Just after reversing, the lid is still near its mid pose — no cut.
    expect(Math.abs(lid(chest).rotation.x - midLid)).toBeLessThan(0.4);
    updateGeocache(chest, 1000);
    expect(lid(chest).rotation.x).toBeCloseTo(0, 2);
  });
});
