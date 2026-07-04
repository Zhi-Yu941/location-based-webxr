/**
 * cell-key — the ONE packed-cell-key implementation (2026-07-04 consolidation).
 *
 * Why this test matters: three modules (grid, mesher, worker) used to hand-roll
 * this algebra with two different envelopes, and the review-log's aliasing /
 * envelope-mismatch findings lived in the gaps between the copies. These tests
 * pin the shared packer's contract so the consolidation stays sound: exact
 * pack↔unpack inverse over the full envelope, the documented alias behaviour
 * just outside it, and the tier relationship that makes the mesher's derived
 * half-lattice keys safe.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  CELL_KEY_LIMIT,
  HALF_LATTICE_CELL_KEY_LIMIT,
  cellCoordsInKeyRange,
  cellKey,
  packCellKey,
  unpackCellKey,
} from './cell-key';

describe('cell-key', () => {
  it('unpackCellKey is the exact inverse of packCellKey over the full ±65 535 envelope', () => {
    const coord = fc.integer({ min: -CELL_KEY_LIMIT, max: CELL_KEY_LIMIT });
    fc.assert(
      fc.property(coord, coord, coord, (x, y, z) => {
        expect(unpackCellKey(packCellKey(x, y, z))).toEqual([x, y, z]);
      })
    );
  });

  it('packs into safe integers over the full envelope (no float precision loss)', () => {
    const corner = packCellKey(CELL_KEY_LIMIT, CELL_KEY_LIMIT, CELL_KEY_LIMIT);
    expect(Number.isSafeInteger(corner)).toBe(true);
    expect(
      Number.isSafeInteger(
        packCellKey(-CELL_KEY_LIMIT, -CELL_KEY_LIMIT, -CELL_KEY_LIMIT)
      )
    ).toBe(true);
  });

  it('documents the aliasing just outside the envelope (why callers must range-check)', () => {
    // The base-2^17 encoding wraps a field overflow into the next field:
    expect(packCellKey(0, CELL_KEY_LIMIT + 2, 0)).toBe(
      packCellKey(1, -CELL_KEY_LIMIT, 0)
    );
  });

  it('the half-lattice tier leaves headroom for the meshers’ derived keys', () => {
    // corner-fit keys are 2·coord ± 1; the extreme derived coordinate must
    // still be inside the full-field envelope.
    expect(2 * HALF_LATTICE_CELL_KEY_LIMIT + 1).toBeLessThanOrEqual(
      CELL_KEY_LIMIT
    );
  });

  it('cellCoordsInKeyRange defaults to the full envelope and accepts a tier override', () => {
    expect(cellCoordsInKeyRange([CELL_KEY_LIMIT, 0, 0])).toBe(true);
    expect(cellCoordsInKeyRange([CELL_KEY_LIMIT + 1, 0, 0])).toBe(false);
    expect(
      cellCoordsInKeyRange(
        [HALF_LATTICE_CELL_KEY_LIMIT + 1, 0, 0],
        HALF_LATTICE_CELL_KEY_LIMIT
      )
    ).toBe(false);
  });

  it('the tuple form equals the scalar form', () => {
    expect(cellKey([3, -4, 5])).toBe(packCellKey(3, -4, 5));
  });
});
