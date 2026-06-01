/**
 * Tests for the anchor marker extension seam.
 *
 * Why this matters: `createAnchorMarker` is the single "your content here"
 * boundary a new developer edits. The framework wiring relies on it returning
 * one Three.js `Object3D`; this test pins that contract so a refactor that
 * accidentally returns undefined/null is caught.
 *
 * Under F1 the marker also consumes the decoded `ui` / `scale` / `rotationDeg`
 * from the `?show=` link so a shared anchor renders in the requested style.
 * These tests pin that each visualization id produces a marker and that scale
 * + rotation are applied.
 */

import { describe, it, expect } from "vitest";
import { MathUtils, Object3D } from "three";
import { createAnchorMarker } from "./marker.js";
import { ANCHOR_VISUALIZATIONS } from "./url-anchor-state.js";

describe("createAnchorMarker", () => {
  it("returns a single Three.js Object3D", () => {
    const marker = createAnchorMarker();
    expect(marker).toBeInstanceOf(Object3D);
  });

  it("returns a fresh instance each call (no shared mutable singleton)", () => {
    expect(createAnchorMarker()).not.toBe(createAnchorMarker());
  });

  it("defaults to the map-pin visualization (ui=1) with neutral transform", () => {
    const marker = createAnchorMarker();
    expect(marker.name).toBe("anchor-marker");
    expect(marker.userData.ui).toBe(1);
    expect(marker.scale.x).toBe(1);
    expect(marker.rotation.y).toBeCloseTo(0, 6);
  });

  it.each([...ANCHOR_VISUALIZATIONS])(
    "builds a marker for visualization id %i and tags userData.ui",
    (ui) => {
      const marker = createAnchorMarker({ ui });
      expect(marker).toBeInstanceOf(Object3D);
      expect(marker.name).toBe("anchor-marker");
      expect(marker.userData.ui).toBe(ui);
      // Every variant must contain at least one renderable child.
      expect(marker.children.length).toBeGreaterThan(0);
    },
  );

  it("applies the scale multiplier uniformly", () => {
    const marker = createAnchorMarker({ scale: 2.5 });
    expect(marker.scale.x).toBe(2.5);
    expect(marker.scale.y).toBe(2.5);
    expect(marker.scale.z).toBe(2.5);
  });

  it("applies rotation about the vertical (y) axis", () => {
    const marker = createAnchorMarker({ rotationDeg: 90 });
    expect(marker.rotation.y).toBeCloseTo(-MathUtils.degToRad(90), 6);
  });
});
