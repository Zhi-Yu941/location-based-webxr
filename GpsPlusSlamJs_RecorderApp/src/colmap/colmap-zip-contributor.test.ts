/**
 * Tests for the COLMAP ZIP contributor (export plan Iter 3).
 *
 * Why this test file matters:
 * This is the integration seam that turns the live recording state (poses +
 * intrinsics + occupancy grid) into a `sparse/0/` COLMAP model inside the
 * exported ZIP. The tests pin the decisions that make or break a usable export:
 *  - reads the INJECTED live state (poses/grid/matrix), never re-parses actions;
 *  - emits exactly `sparse/0/{cameras,images,points3D}.txt` on the happy path;
 *  - returns 0 files when intrinsics are unavailable (Q4: depth off / no dims),
 *    leaving the rest of the ZIP untouched;
 *  - NAME is the bare image filename (so `image_path` → the ZIP's `images/`);
 *  - points come from the occupancy grid with the SAME world frame as cameras.
 */

import { describe, it, expect } from 'vitest';
import type { ArImageCapture, Matrix4 } from 'gps-plus-slam-app-framework/core';
import { OccupancyGrid } from 'gps-plus-slam-app-framework/ar/occupancy-grid';
import { createColmapZipContributor } from './colmap-zip-contributor';
import { webxrToColmapWorldPoint } from './colmap-conversions';

// A symmetric perspective matrix (column-major): fx=0.5·W·m00, etc.
// m00=m11=1 → fx=W/2, fy=H/2; m20=m21=0 → cx=W/2, cy=H/2.
const PROJECTION: Matrix4 = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.2, 0,
];

function frame(overrides: Partial<ArImageCapture> = {}): ArImageCapture {
  return {
    imageFile: 'images/frame-000001.jpg',
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    screenRotation: 0,
    capturedAt: 1000,
    width: 1280,
    height: 960,
    ...overrides,
  };
}

/** Collect the files a contributor writes into a path→text map. */
async function runContributor(
  deps: Parameters<typeof createColmapZipContributor>[0]
): Promise<{ count: number; files: Map<string, string> }> {
  const contributor = createColmapZipContributor(deps);
  const files = new Map<string, string>();
  const count = await contributor.contribute(async (relativePath, blob) => {
    files.set(`${contributor.subdir}/${relativePath}`, await blob.text());
  });
  return { count, files };
}

describe('createColmapZipContributor', () => {
  it('owns the sparse/ subdir and emits cameras/images/points3D under 0/', async () => {
    const grid = new OccupancyGrid();
    grid.addSample({
      timestamp: 0,
      cameraPos: [0, 0, 0],
      cameraRot: [0, 0, 0, 1],
      projectionMatrix: PROJECTION,
      points: [{ screenX: 0.5, screenY: 0.5, depthM: 2, rgb: [10, 20, 30] }],
    });

    const { count, files } = await runContributor({
      getFrames: () => [frame()],
      getProjectionMatrix: () => PROJECTION,
      getOccupancyGrid: () => grid,
    });

    expect(count).toBe(3);
    expect([...files.keys()].sort()).toEqual([
      'sparse/0/cameras.txt',
      'sparse/0/images.txt',
      'sparse/0/points3D.txt',
    ]);
    // Single PINHOLE camera sized to the JPEG dims (1280×960 → cx/cy = 640/480).
    expect(files.get('sparse/0/cameras.txt')).toContain(
      '1 PINHOLE 1280 960 640 480 640 480'
    );
    // points3D has at least the one occupied cell, carrying its RGB.
    const pointLines = files
      .get('sparse/0/points3D.txt')!
      .split('\n')
      .filter((l) => l && !l.startsWith('#'));
    expect(pointLines.length).toBeGreaterThanOrEqual(1);
    expect(pointLines[0]).toMatch(/^1 \S+ \S+ \S+ 10 20 30 \S+$/);
  });

  it('emits the exact per-cell surface point, flipped into the COLMAP world frame (Items A+B)', async () => {
    const grid = new OccupancyGrid();
    // depth 2 at center screen → exact point [0,0,-2]; with 0.15 m cells the
    // lattice center is [0,0,-1.95], so exact ≠ center.
    grid.addSample({
      timestamp: 0,
      cameraPos: [0, 0, 0],
      cameraRot: [0, 0, 0, 1],
      projectionMatrix: PROJECTION,
      points: [{ screenX: 0.5, screenY: 0.5, depthM: 2 }],
    });
    const cell = grid.getOccupiedCells()[0]!;
    const exact = grid.getCellPoint(cell)!;
    expect(exact).not.toEqual(grid.getCellCenter(cell)); // sanity
    // The export applies the world basis change (Item B, upside-down fix) — the
    // SAME flip folded into the camera extrinsics — so the written point is the
    // exact surface point with Y and Z negated, keeping it registered.
    const expected = webxrToColmapWorldPoint(exact);

    const { files } = await runContributor({
      getFrames: () => [frame()],
      getProjectionMatrix: () => PROJECTION,
      getOccupancyGrid: () => grid,
    });
    const xyz = files
      .get('sparse/0/points3D.txt')!
      .split('\n')
      .find((l) => /^\d+ /.test(l))!
      .split(' ');
    // POINT3D_ID X Y Z R G B ERROR
    expect(Number(xyz[1])).toBeCloseTo(expected[0], 5);
    expect(Number(xyz[2])).toBeCloseTo(expected[1], 5);
    expect(Number(xyz[3])).toBeCloseTo(expected[2], 5);
  });

  it('uses the bare image filename as NAME (image_path → images/)', async () => {
    const { files } = await runContributor({
      getFrames: () => [
        frame({ imageFile: 'images/frame-000007.jpg' }),
        frame({ imageFile: 'frames/frame-000008.jpg' }), // legacy prefix tolerated
      ],
      getProjectionMatrix: () => PROJECTION,
      getOccupancyGrid: () => null,
    });
    const imagesTxt = files.get('sparse/0/images.txt')!;
    const poseLines = imagesTxt.split('\n').filter((l) => /^\d+ /.test(l));
    expect(poseLines[0]!.endsWith(' frame-000007.jpg')).toBe(true);
    expect(poseLines[1]!.endsWith(' frame-000008.jpg')).toBe(true);
  });

  it('returns 0 files when no projection matrix exists (Q4: depth off)', async () => {
    const { count, files } = await runContributor({
      getFrames: () => [frame()],
      getProjectionMatrix: () => undefined,
      getOccupancyGrid: () => new OccupancyGrid(),
    });
    expect(count).toBe(0);
    expect(files.size).toBe(0);
  });

  it('returns 0 files when no frame carries pixel dimensions', async () => {
    // Without W/H the normalized matrix cannot yield pixel intrinsics → skip
    // rather than emit a broken camera (generalizes Q4).
    const { count } = await runContributor({
      getFrames: () => [frame({ width: undefined, height: undefined })],
      getProjectionMatrix: () => PROJECTION,
      getOccupancyGrid: () => new OccupancyGrid(),
    });
    expect(count).toBe(0);
  });

  it('emits a valid model with an empty points3D when the grid is null/empty', async () => {
    const { count, files } = await runContributor({
      getFrames: () => [frame()],
      getProjectionMatrix: () => PROJECTION,
      getOccupancyGrid: () => null,
    });
    expect(count).toBe(3);
    const pointLines = files
      .get('sparse/0/points3D.txt')!
      .split('\n')
      .filter((l) => l && !l.startsWith('#'));
    expect(pointLines).toEqual([]);
    // images.txt still has the pose (two lines per image: pose + empty).
    expect(files.get('sparse/0/images.txt')).toMatch(/ frame-000001\.jpg/);
  });

  it('excludes a one-shot cell when getMinConfidence raises the floor above its count', async () => {
    // Behind-surface depth noise lands in a cell ONCE (count 1) and free-space
    // carving can never reach it (no ray traverses occluded space). The COLMAP
    // export must honour the same `occupancy.minConfidence` floor the voxel view
    // uses, or every single-frame phantom is baked into the reconstruction.
    const grid = new OccupancyGrid();
    grid.addSample({
      timestamp: 0,
      cameraPos: [0, 0, 0],
      cameraRot: [0, 0, 0, 1],
      projectionMatrix: PROJECTION,
      points: [{ screenX: 0.5, screenY: 0.5, depthM: 2, rgb: [10, 20, 30] }],
    });
    expect(grid.getOccupiedCells(1)).toHaveLength(1); // sanity: one-shot cell exists

    const { count, files } = await runContributor({
      getFrames: () => [frame()],
      getProjectionMatrix: () => PROJECTION,
      getOccupancyGrid: () => grid,
      getMinConfidence: () => 2, // floor above the cell's count of 1
    });

    // The model is still valid (3 files); points3D is empty — the phantom is gone.
    expect(count).toBe(3);
    const pointLines = files
      .get('sparse/0/points3D.txt')!
      .split('\n')
      .filter((l) => l && !l.startsWith('#'));
    expect(pointLines).toEqual([]);
  });

  it('keeps a well-observed cell at the same floor (real surfaces survive)', async () => {
    // The same surface point seen across 3 samples reaches count 3, so a
    // floor of 3 trusts it — the filter removes noise, not dwelt-on geometry.
    const grid = new OccupancyGrid();
    for (let i = 0; i < 3; i++) {
      grid.addSample({
        timestamp: i,
        cameraPos: [0, 0, 0],
        cameraRot: [0, 0, 0, 1],
        projectionMatrix: PROJECTION,
        points: [{ screenX: 0.5, screenY: 0.5, depthM: 2, rgb: [10, 20, 30] }],
      });
    }
    expect(grid.getOccupiedCells(3)).toHaveLength(1); // sanity: count reached 3

    const { files } = await runContributor({
      getFrames: () => [frame()],
      getProjectionMatrix: () => PROJECTION,
      getOccupancyGrid: () => grid,
      getMinConfidence: () => 3,
    });
    const pointLines = files
      .get('sparse/0/points3D.txt')!
      .split('\n')
      .filter((l) => l && !l.startsWith('#'));
    expect(pointLines.length).toBe(1);
    expect(pointLines[0]).toMatch(/ 10 20 30 /); // carries its RGB
  });

  it('defaults to floor 1 (unfiltered) when getMinConfidence is not provided', async () => {
    // Back-compat: existing call sites that omit the accessor keep today's
    // behaviour — a single-observation cell is still exported.
    const grid = new OccupancyGrid();
    grid.addSample({
      timestamp: 0,
      cameraPos: [0, 0, 0],
      cameraRot: [0, 0, 0, 1],
      projectionMatrix: PROJECTION,
      points: [{ screenX: 0.5, screenY: 0.5, depthM: 2 }],
    });
    const { files } = await runContributor({
      getFrames: () => [frame()],
      getProjectionMatrix: () => PROJECTION,
      getOccupancyGrid: () => grid,
    });
    const pointLines = files
      .get('sparse/0/points3D.txt')!
      .split('\n')
      .filter((l) => l && !l.startsWith('#'));
    expect(pointLines.length).toBe(1);
  });

  it('falls back to gray for cells that were never observed with color', async () => {
    const grid = new OccupancyGrid();
    // Sample WITHOUT rgb → cell has no color, getCellColor returns null.
    grid.addSample({
      timestamp: 0,
      cameraPos: [0, 0, 0],
      cameraRot: [0, 0, 0, 1],
      projectionMatrix: PROJECTION,
      points: [{ screenX: 0.5, screenY: 0.5, depthM: 2 }],
    });
    const { files } = await runContributor({
      getFrames: () => [frame()],
      getProjectionMatrix: () => PROJECTION,
      getOccupancyGrid: () => grid,
    });
    const pointLine = files
      .get('sparse/0/points3D.txt')!
      .split('\n')
      .find((l) => /^\d+ /.test(l))!;
    expect(pointLine).toMatch(/ 128 128 128 /); // fallback gray
  });
});
