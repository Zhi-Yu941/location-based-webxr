/**
 * Tests for wireRefPointSubscribers.
 *
 * These mirror the previously-framework-owned `refPointVisualizer
 * subscription` invariants, recreated recorder-side after the Iter 3
 * boundary migration.
 */

import { describe, it, expect, vi } from 'vitest';
import { wireRefPointSubscribers } from './ref-point-subscribers';
import type { RecorderStore } from './recorder-store';
import type { RefPointMark } from '../storage/ref-point-loader';

interface MockState {
  refPoints: {
    priorMarks: RefPointMark[];
    currentMarks: RefPointMark[];
  };
}

function makeMark(id: string, timestamp = 0): RefPointMark {
  return {
    id,
    odomPosition: [0, 0, 0],
    odomRotation: [0, 0, 0, 1],
    gpsPosition: { lat: 50, lon: 8, altitude: 245 },
    timestamp,
  } as RefPointMark;
}

function makeMockStore(initial: MockState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const store = {
    getState: () => state as unknown as ReturnType<RecorderStore['getState']>,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const setState = (next: MockState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  return { store: store as unknown as RecorderStore, setState };
}

function makeVisualizer() {
  return {
    displayPriorRefPoints: vi.fn(),
    addCurrentRefPoint: vi.fn(),
  };
}

describe('wireRefPointSubscribers', () => {
  it('renders prior marks once per priorMarks change', () => {
    const v = makeVisualizer();
    const { store, setState } = makeMockStore({
      refPoints: { priorMarks: [], currentMarks: [] },
    });
    wireRefPointSubscribers(store, v);

    const marks = [makeMark('a', 1), makeMark('b', 2)];
    setState({ refPoints: { priorMarks: marks, currentMarks: [] } });

    expect(v.displayPriorRefPoints).toHaveBeenCalledTimes(1);
    expect(v.displayPriorRefPoints).toHaveBeenCalledWith(marks);
    expect(v.addCurrentRefPoint).not.toHaveBeenCalled();
  });

  it('appends one currentMark per dispatch', () => {
    const v = makeVisualizer();
    const { store, setState } = makeMockStore({
      refPoints: { priorMarks: [], currentMarks: [] },
    });
    wireRefPointSubscribers(store, v);

    const m1 = makeMark('live-1', 1);
    const m2 = makeMark('live-2', 2);

    setState({ refPoints: { priorMarks: [], currentMarks: [m1] } });
    expect(v.addCurrentRefPoint).toHaveBeenCalledTimes(1);
    expect(v.addCurrentRefPoint).toHaveBeenLastCalledWith(m1);

    setState({ refPoints: { priorMarks: [], currentMarks: [m1, m2] } });
    expect(v.addCurrentRefPoint).toHaveBeenCalledTimes(2);
    expect(v.addCurrentRefPoint).toHaveBeenLastCalledWith(m2);
  });

  it('resets the high-water mark when currentMarks is cleared', () => {
    const v = makeVisualizer();
    const { store, setState } = makeMockStore({
      refPoints: { priorMarks: [], currentMarks: [] },
    });
    wireRefPointSubscribers(store, v);

    const m1 = makeMark('live-1', 1);
    const m2 = makeMark('live-2', 2);

    setState({ refPoints: { priorMarks: [], currentMarks: [m1, m2] } });
    expect(v.addCurrentRefPoint).toHaveBeenCalledTimes(2);

    setState({ refPoints: { priorMarks: [], currentMarks: [] } });
    setState({ refPoints: { priorMarks: [], currentMarks: [m1] } });
    expect(v.addCurrentRefPoint).toHaveBeenCalledTimes(3);
    expect(v.addCurrentRefPoint).toHaveBeenLastCalledWith(m1);
  });

  it('is a no-op when visualizer is null', () => {
    const { store, setState } = makeMockStore({
      refPoints: { priorMarks: [], currentMarks: [] },
    });
    const unsubscribe = wireRefPointSubscribers(store, null);
    expect(typeof unsubscribe).toBe('function');
    expect(() => {
      setState({
        refPoints: { priorMarks: [makeMark('x', 1)], currentMarks: [] },
      });
    }).not.toThrow();
    unsubscribe();
  });

  it('returned unsubscribe detaches the store listener', () => {
    const v = makeVisualizer();
    const { store, setState } = makeMockStore({
      refPoints: { priorMarks: [], currentMarks: [] },
    });
    const unsubscribe = wireRefPointSubscribers(store, v);
    unsubscribe();

    setState({
      refPoints: { priorMarks: [makeMark('p', 1)], currentMarks: [] },
    });
    expect(v.displayPriorRefPoints).not.toHaveBeenCalled();
  });
});
