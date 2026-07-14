/**
 * Why these tests matter: the ghost-restore egg (catalog №3) is the core
 * "make the invisible visible" message as a toy — clicking the castle
 * briefly SOLIDIFIES the translucent ghost while dimming the ruin, then
 * melts back. It is a RUNTIME-only material ramp: the BUILT ghost opacity
 * (pinned 0.1–0.6 in use-case-vignettes.test.ts) and the `depthWrite:
 * false` contract must be exactly restored when the effect ends, or the
 * ghost would start occluding the ruin it explains.
 */
import { describe, expect, it } from "vitest";
import type { Mesh, MeshStandardMaterial } from "three";
import { buildUseCaseVignettes, VIGNETTE_NODE } from "./use-case-vignettes";
import { VIGNETTE_ANCHORS } from "./clay-world";
import {
  initGhostRestore,
  triggerGhostRestore,
  updateGhostRestore,
} from "./ghost-restore";

function makeCastle() {
  const vignettes = buildUseCaseVignettes(VIGNETTE_ANCHORS);
  const castle = vignettes.getObjectByName(VIGNETTE_NODE.castle)!;
  initGhostRestore(castle);
  return castle;
}

function ghostMaterials(castle: {
  getObjectByName(
    n: string,
  ): { traverse(cb: (o: unknown) => void): void } | undefined;
}): MeshStandardMaterial[] {
  const out: MeshStandardMaterial[] = [];
  castle.getObjectByName(VIGNETTE_NODE.ghost)?.traverse((obj) => {
    const mat = (obj as Mesh).material as MeshStandardMaterial | undefined;
    if (mat && (obj as Mesh).isMesh) {
      out.push(mat);
    }
  });
  return out;
}

describe("ghost restore egg", () => {
  it("ramps ghost opacity up, dims the ruin, then restores the exact built state", () => {
    const castle = makeCastle();
    const ghosts = ghostMaterials(castle);
    expect(ghosts.length).toBeGreaterThanOrEqual(2);
    const builtOpacity = ghosts.map((m) => m.opacity);
    // All built ghost opacities are within the pinned 0.1–0.6 band.
    for (const o of builtOpacity) {
      expect(o).toBeGreaterThan(0.1);
      expect(o).toBeLessThan(0.6);
    }

    triggerGhostRestore(castle, 0);

    // Mid ramp-up / hold: solidified well above the built value.
    updateGhostRestore(castle, 400);
    for (const m of ghosts) {
      expect(m.opacity).toBeGreaterThan(0.7);
      // The contract that keeps it from occluding the ruin never changes.
      expect(m.depthWrite).toBe(false);
    }

    // After the whole up→hold→down cycle: back to the EXACT built state.
    updateGhostRestore(castle, 10_000);
    ghosts.forEach((m, i) => {
      expect(m.opacity).toBeCloseTo(builtOpacity[i]!, 5);
      expect(m.transparent).toBe(true);
      expect(m.depthWrite).toBe(false);
    });
    // And the effect reports idle now.
    expect(updateGhostRestore(castle, 10_100)).toBe(false);
  });

  it("dims the ruin during the hold and restores it opaque afterward", () => {
    const castle = makeCastle();
    const ruin = castle.children.find(
      (c) => (c as Mesh).userData?.paletteRole === "ruin",
    ) as Mesh;
    const ruinMat = ruin.material as MeshStandardMaterial;
    expect(ruinMat.opacity).toBe(1);

    triggerGhostRestore(castle, 0);
    updateGhostRestore(castle, 500); // hold phase
    expect(ruinMat.opacity).toBeLessThan(1);

    updateGhostRestore(castle, 10_000);
    expect(ruinMat.opacity).toBe(1);
    // Restored opaque (no lingering transparency that would reorder it).
    expect(ruinMat.transparent).toBe(false);
  });

  it("is a pure function of the clock while animating and ignores re-trigger mid-effect", () => {
    const a = makeCastle();
    const b = makeCastle();
    triggerGhostRestore(a, 1000);
    triggerGhostRestore(b, 1000);
    updateGhostRestore(a, 1200);
    updateGhostRestore(a, 1100); // out-of-order calls
    updateGhostRestore(a, 1200);
    updateGhostRestore(b, 1200);
    const ga = ghostMaterials(a).map((m) => m.opacity);
    const gb = ghostMaterials(b).map((m) => m.opacity);
    expect(ga).toEqual(gb);

    // A re-trigger during the effect must not restart/jump it.
    const before = ghostMaterials(a).map((m) => m.opacity);
    triggerGhostRestore(a, 1200);
    updateGhostRestore(a, 1200);
    expect(ghostMaterials(a).map((m) => m.opacity)).toEqual(before);
  });
});
