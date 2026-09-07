import {
  Raycaster,
  Vector2,
  type Object3D,
  type PerspectiveCamera,
} from "three";

/**
 * Shared 3D click plumbing for the hidden easter eggs (catalog §2).
 *
 * The canvas sits BELOW the `#story` scroller, so world objects never
 * receive DOM events — instead the scroller's click glue (main.ts)
 * converts the pointer to NDC and asks this module which REGISTERED egg
 * target (if any) the ray hits. Hit-testing is deliberately limited to
 * the registered targets, never the whole scene: cheap, and a stray
 * click on ordinary scenery can never fire an egg.
 */

export interface PointerNdc {
  /** Normalized device coordinates, -1..1 (x right, y up). */
  readonly x: number;
  readonly y: number;
}

/** Pointer movement (px) up to which a press-release still counts as a
 * click; anything farther is a scroll/drag and must never fire eggs. */
const CLICK_SLOP_PX = 8;

/**
 * Pure pick decision: which registered egg target does the pointer ray
 * hit? Returns the REGISTERED root's name (hits on child meshes are
 * mapped back up), or null on a miss / bad input. The camera's world
 * matrix must be current — callers update it before picking.
 */
export function pickEggTarget(
  pointer: PointerNdc,
  camera: PerspectiveCamera,
  targets: readonly Object3D[],
): string | null {
  if (
    targets.length === 0 ||
    !Number.isFinite(pointer.x) ||
    !Number.isFinite(pointer.y)
  ) {
    return null;
  }
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(pointer.x, pointer.y), camera);
  const hit = raycaster.intersectObjects(targets as Object3D[], true)[0];
  if (!hit) {
    return null;
  }
  const registered = new Set<Object3D>(targets);
  let node: Object3D | null = hit.object;
  while (node) {
    if (registered.has(node)) {
      return node.name;
    }
    node = node.parent;
  }
  return null;
}

/** True when a pointerdown→pointerup pair reads as a genuine click (no
 * drag): the pointer moved at most CLICK_SLOP_PX. */
export function isGenuineClick(
  down: { readonly x: number; readonly y: number },
  up: { readonly x: number; readonly y: number },
): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= CLICK_SLOP_PX;
}
