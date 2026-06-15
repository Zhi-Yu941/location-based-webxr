/**
 * Rigid pose from depth corners — unit + property tests.
 *
 * Why this matters: the demo's axis + cube are placed from this fit, so it must
 * recover a known pose from a known square (any size/position/orientation) and
 * reject degenerate (collinear) corners.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { Vector3 as TVec3, Quaternion as TQuat, Euler } from "three";
import type { Vector3 } from "gps-plus-slam-app-framework/core";
import { poseFromWorldCorners } from "./pose-from-corners";

/** Build TL,TR,BR,BL of a square of side `s`, posed by (center, quaternion). */
function squareCorners(
  s: number,
  center: TVec3,
  q: TQuat,
): [Vector3, Vector3, Vector3, Vector3] {
  const h = s / 2;
  const local = [
    new TVec3(-h, h, 0),
    new TVec3(h, h, 0),
    new TVec3(h, -h, 0),
    new TVec3(-h, -h, 0),
  ];
  return local.map((p) => {
    const w = p.clone().applyQuaternion(q).add(center);
    return [w.x, w.y, w.z] as Vector3;
  }) as [Vector3, Vector3, Vector3, Vector3];
}

describe("poseFromWorldCorners", () => {
  it("recovers the center of a fronto-parallel square", () => {
    const center = new TVec3(1, 2, -3);
    const corners = squareCorners(0.2, center, new TQuat());
    const pose = poseFromWorldCorners(corners);
    expect(pose).not.toBeNull();
    expect(pose!.position[0]).toBeCloseTo(1, 6);
    expect(pose!.position[1]).toBeCloseTo(2, 6);
    expect(pose!.position[2]).toBeCloseTo(-3, 6);
  });

  it("returns null for fewer than 4 corners", () => {
    expect(poseFromWorldCorners([[0, 0, 0]])).toBeNull();
  });

  it("returns null for collinear (degenerate) corners", () => {
    expect(
      poseFromWorldCorners([
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ]),
    ).toBeNull();
  });

  it("recovers an arbitrary pose (center + orientation) for any square", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 2, noNaN: true }),
        fc.tuple(
          fc.double({ min: -5, max: 5, noNaN: true }),
          fc.double({ min: -5, max: 5, noNaN: true }),
          fc.double({ min: -5, max: 5, noNaN: true }),
        ),
        fc.double({ min: -Math.PI / 2.2, max: Math.PI / 2.2, noNaN: true }),
        fc.double({ min: -Math.PI / 2.2, max: Math.PI / 2.2, noNaN: true }),
        (s, c, yaw, pitch) => {
          const center = new TVec3(c[0], c[1], c[2]);
          const q = new TQuat().setFromEuler(new Euler(pitch, yaw, 0, "YXZ"));
          const corners = squareCorners(s, center, q);
          const pose = poseFromWorldCorners(corners);
          expect(pose).not.toBeNull();

          // Center recovered exactly (mean of the 4 corners).
          for (let k = 0; k < 3; k++) {
            expect(pose!.position[k]).toBeCloseTo(center.getComponent(k), 6);
          }

          // The recovered rotation maps the local +z normal to the same world
          // normal as the source pose (orientation recovered up to the square's
          // symmetry, which is all the axis/cube need).
          const recovered = new TQuat(
            pose!.rotation[0],
            pose!.rotation[1],
            pose!.rotation[2],
            pose!.rotation[3],
          );
          const nWorld = new TVec3(0, 0, 1).applyQuaternion(q);
          const nRecovered = new TVec3(0, 0, 1).applyQuaternion(recovered);
          expect(Math.abs(nWorld.dot(nRecovered))).toBeCloseTo(1, 4);
        },
      ),
    );
  });
});
