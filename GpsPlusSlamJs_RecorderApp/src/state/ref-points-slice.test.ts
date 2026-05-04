/**
 * Tests for refPointsSlice — Redux state for imported reference points
 * and session usage tracking.
 *
 * Why this test matters: The refPointsSlice moves prior-ref-point data
 * from opaque closure state (ref-point-handlers.ts) into Redux, making
 * it observable by store subscribers (e.g., 2D map overlay) and testable
 * via standard store.getState() assertions. This is a prerequisite for
 * the prior-refpoints-display feature and the library extraction plan.
 */

import { describe, it, expect } from 'vitest';
import {
  refPointsReducer,
  setImportedRefPoints,
  incrementRefPointUsage,
  clearSessionRefPointUsage,
  resetRefPointsState,
  setPriorRefPointMarks,
  addCurrentRefPointMark,
  clearCurrentRefPointMarks,
  selectCachedKnownRefPoints,
  type RefPointsState,
} from './ref-points-slice';
import type { ImportedRefPoint } from '../storage/ref-point-importer';
import type { RefPointMark } from '../storage/ref-point-loader';

function makeMark(overrides: Partial<RefPointMark> = {}): RefPointMark {
  return {
    id: '8b1a6b0c2d30fff',
    odomPosition: [0, 0, 0],
    odomRotation: [0, 0, 0, 1],
    gpsPosition: { lat: 50.0, lon: 8.0, altitude: 245 },
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRefPoint(
  overrides: Partial<ImportedRefPoint> = {}
): ImportedRefPoint {
  return {
    id: 'pointA',
    name: 'Point A',
    lat: 50.0,
    lon: 8.0,
    sourceZipName: 'session1.zip',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reducer tests
// ---------------------------------------------------------------------------

describe('refPointsSlice reducer', () => {
  it('has correct initial state', () => {
    const state = refPointsReducer(undefined, { type: '@@INIT' });
    expect(state.importedRefPoints).toEqual([]);
    expect(state.sessionRefPointUsage).toEqual({});
    expect(state.priorMarks).toEqual([]);
    expect(state.currentMarks).toEqual([]);
  });

  describe('setImportedRefPoints', () => {
    /**
     * Why: The primary use case — folder-manager loads prior ref points
     * from ZIPs and dispatches them into Redux.
     */
    it('replaces the entire imported ref points array', () => {
      const refPoints = [
        makeRefPoint({ id: 'a', lat: 50.0, lon: 8.0 }),
        makeRefPoint({ id: 'b', lat: 51.0, lon: 9.0 }),
      ];
      const state = refPointsReducer(
        undefined,
        setImportedRefPoints(refPoints)
      );
      expect(state.importedRefPoints).toEqual(refPoints);
    });

    /**
     * Why: Switching scenarios should clear and replace ref points.
     */
    it('replaces existing ref points on second call', () => {
      const first = [makeRefPoint({ id: 'a' })];
      const second = [makeRefPoint({ id: 'b' }), makeRefPoint({ id: 'c' })];
      let state = refPointsReducer(undefined, setImportedRefPoints(first));
      state = refPointsReducer(state, setImportedRefPoints(second));
      expect(state.importedRefPoints).toEqual(second);
      expect(state.importedRefPoints).toHaveLength(2);
    });

    /**
     * Why: Empty array is a valid state (no prior ref points found).
     */
    it('accepts an empty array', () => {
      const state = refPointsReducer(
        { importedRefPoints: [makeRefPoint()], sessionRefPointUsage: {} },
        setImportedRefPoints([])
      );
      expect(state.importedRefPoints).toEqual([]);
    });
  });

  describe('incrementRefPointUsage', () => {
    /**
     * Why: Tracks how many times each ref point was marked in the current
     * session. Used by the ref-point picker to show usage counts.
     */
    it('initializes count to 1 for first use', () => {
      const state = refPointsReducer(
        undefined,
        incrementRefPointUsage('8b1a6b0c2d30fff')
      );
      expect(state.sessionRefPointUsage['8b1a6b0c2d30fff']).toBe(1);
    });

    it('increments existing count', () => {
      const initial: RefPointsState = {
        importedRefPoints: [],
        sessionRefPointUsage: { '8b1a6b0c2d30fff': 2 },
      };
      const state = refPointsReducer(
        initial,
        incrementRefPointUsage('8b1a6b0c2d30fff')
      );
      expect(state.sessionRefPointUsage['8b1a6b0c2d30fff']).toBe(3);
    });

    it('tracks multiple ref points independently', () => {
      let state = refPointsReducer(undefined, incrementRefPointUsage('aaa'));
      state = refPointsReducer(state, incrementRefPointUsage('bbb'));
      state = refPointsReducer(state, incrementRefPointUsage('aaa'));
      expect(state.sessionRefPointUsage).toEqual({ aaa: 2, bbb: 1 });
    });
  });

  describe('clearSessionRefPointUsage', () => {
    /**
     * Why: Usage must be cleared between recording sessions so
     * the picker shows fresh counts per session.
     */
    it('clears all usage counts', () => {
      const initial: RefPointsState = {
        importedRefPoints: [makeRefPoint()],
        sessionRefPointUsage: { a: 3, b: 1 },
      };
      const state = refPointsReducer(initial, clearSessionRefPointUsage());
      expect(state.sessionRefPointUsage).toEqual({});
      // imported ref points should NOT be cleared
      expect(state.importedRefPoints).toHaveLength(1);
    });
  });

  describe('resetRefPointsState', () => {
    /**
     * Why: Full reset when store is recreated between scenarios or on
     * app-level reset.
     */
    it('returns initial state', () => {
      const populated: RefPointsState = {
        importedRefPoints: [makeRefPoint()],
        sessionRefPointUsage: { a: 5 },
        priorMarks: [makeMark()],
        currentMarks: [makeMark({ id: 'live' })],
      };
      const state = refPointsReducer(populated, resetRefPointsState());
      expect(state.importedRefPoints).toEqual([]);
      expect(state.sessionRefPointUsage).toEqual({});
      expect(state.priorMarks).toEqual([]);
      expect(state.currentMarks).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------
  // RefPointMark[] actions — Finding 5 (refpoint marks → Redux).
  // See docs/2026-04-30-refpoint-marks-into-redux-plan.md.
  // Why these tests matter: the visualizer is being inverted from
  // imperative caller to subscription consumer; the slice is the new
  // source of truth that drives 3D rendering. Anything that can break
  // serializability of these arrays (e.g. accidentally storing live
  // Three.js objects) breaks DevTools and replay parity.
  // ---------------------------------------------------------------------

  describe('setPriorRefPointMarks', () => {
    it('replaces priorMarks wholesale', () => {
      const first = [makeMark({ id: 'a' }), makeMark({ id: 'b' })];
      const second = [makeMark({ id: 'c' })];
      let state = refPointsReducer(undefined, setPriorRefPointMarks(first));
      expect(state.priorMarks).toEqual(first);
      state = refPointsReducer(state, setPriorRefPointMarks(second));
      expect(state.priorMarks).toEqual(second);
    });

    it('does not affect currentMarks', () => {
      const initial: RefPointsState = {
        importedRefPoints: [],
        sessionRefPointUsage: {},
        priorMarks: [],
        currentMarks: [makeMark({ id: 'live' })],
      };
      const state = refPointsReducer(
        initial,
        setPriorRefPointMarks([makeMark({ id: 'prior' })])
      );
      expect(state.currentMarks).toEqual(initial.currentMarks);
    });
  });

  describe('addCurrentRefPointMark', () => {
    it('appends the mark to currentMarks', () => {
      const m1 = makeMark({ id: 'a', timestamp: 1 });
      const m2 = makeMark({ id: 'b', timestamp: 2 });
      let state = refPointsReducer(undefined, addCurrentRefPointMark(m1));
      state = refPointsReducer(state, addCurrentRefPointMark(m2));
      expect(state.currentMarks).toEqual([m1, m2]);
    });

    it('does not affect priorMarks', () => {
      const prior = [makeMark({ id: 'prior' })];
      const initial: RefPointsState = {
        importedRefPoints: [],
        sessionRefPointUsage: {},
        priorMarks: prior,
        currentMarks: [],
      };
      const state = refPointsReducer(
        initial,
        addCurrentRefPointMark(makeMark({ id: 'live' }))
      );
      expect(state.priorMarks).toBe(prior);
    });
  });

  describe('clearCurrentRefPointMarks', () => {
    it('empties currentMarks but keeps priorMarks', () => {
      const initial: RefPointsState = {
        importedRefPoints: [],
        sessionRefPointUsage: {},
        priorMarks: [makeMark({ id: 'prior' })],
        currentMarks: [makeMark({ id: 'a' }), makeMark({ id: 'b' })],
      };
      const state = refPointsReducer(initial, clearCurrentRefPointMarks());
      expect(state.currentMarks).toEqual([]);
      expect(state.priorMarks).toEqual(initial.priorMarks);
    });
  });
});

// ---------------------------------------------------------------------------
// Selector tests
// ---------------------------------------------------------------------------

describe('selectCachedKnownRefPoints', () => {
  /**
   * Why: The selector derives KnownRefPoint[] (with H3 indices) from
   * importedRefPoints. This replaces the closure-based recomputeKnownRefPoints
   * in ref-point-handlers.ts.
   */
  it('returns empty array when no imported ref points', () => {
    const state: RefPointsState = {
      importedRefPoints: [],
      sessionRefPointUsage: {},
    };
    expect(selectCachedKnownRefPoints(state)).toEqual([]);
  });

  it('computes H3 index for each imported ref point', () => {
    const state: RefPointsState = {
      importedRefPoints: [
        makeRefPoint({ id: 'pointA', name: 'Point A', lat: 50.0, lon: 8.0 }),
        makeRefPoint({ id: 'pointB', name: 'Point B', lat: 51.0, lon: 9.0 }),
      ],
      sessionRefPointUsage: {},
    };
    const result = selectCachedKnownRefPoints(state);
    expect(result).toHaveLength(2);
    // Each should have an h3Index (15-char hex) and displayName from name field
    expect(result[0].h3Index).toMatch(/^[0-9a-f]{15}$/);
    expect(result[0].displayName).toBe('Point A');
    expect(result[1].h3Index).toMatch(/^[0-9a-f]{15}$/);
    expect(result[1].displayName).toBe('Point B');
  });

  /**
   * Why: When name is empty (e.g., legacy data or user skipped naming),
   * displayName should fall back to the H3 id rather than being blank.
   */
  it('falls back to id when name is empty', () => {
    const state: RefPointsState = {
      importedRefPoints: [
        makeRefPoint({ id: '8b1fa0a3168efff', name: '', lat: 50.0, lon: 8.0 }),
      ],
      sessionRefPointUsage: {},
    };
    const result = selectCachedKnownRefPoints(state);
    expect(result[0].displayName).toBe('8b1fa0a3168efff');
  });

  /**
   * Why: The selector should be referentially stable (same input → same output)
   * to avoid unnecessary subscriber notifications.
   */
  it('returns same reference for identical input', () => {
    const state: RefPointsState = {
      importedRefPoints: [makeRefPoint({ id: 'pointA', lat: 50.0, lon: 8.0 })],
      sessionRefPointUsage: {},
    };
    const a = selectCachedKnownRefPoints(state);
    const b = selectCachedKnownRefPoints(state);
    expect(a).toBe(b); // referential equality (memoized)
  });
});
