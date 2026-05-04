/**
 * Tests for `createSlamAppStore` â€” the framework's composable Redux store
 * factory introduced in Iter 1 of the AppFramework/RecorderApp boundary
 * migration ([plan](../../../../GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md)).
 *
 * The factory replaces `createRecorderStore` for non-recorder consumers.
 * It wires:
 * - The three library reducers (`gpsData`, `gpsElements`, `arElements`).
 * - The framework-owned recording lifecycle slice (`recorder`).
 * - The persistence middleware bridging Redux â†’ `StorageBackend`.
 *
 * Recorder-only state (routing, ref-points, scenario name) is supplied
 * by the consumer via `extraReducers` / `extraMiddleware`. The factory
 * itself never references those concepts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSlice } from '@reduxjs/toolkit';
import { createSlamAppStore } from './create-slam-app-store';
import { startSession, endSession } from './recording-slice';
import type { StorageBackend } from '../storage/storage-backend';
import { NullStorageBackend } from '../storage/null-storage-backend';

function makeBackend(): StorageBackend {
  return new NullStorageBackend();
}

describe('createSlamAppStore', () => {
  let backend: StorageBackend;

  beforeEach(() => {
    backend = makeBackend();
  });

  describe('default state shape', () => {
    it('exposes the three library reducers', () => {
      // Why: any AR+GPS app needs the library's gpsData/gpsElements/arElements
      // state. The factory must wire them unconditionally.
      const store = createSlamAppStore({ storageBackend: backend });
      const state = store.getState();
      expect(state.gpsData).toBeDefined();
      expect(state.gpsElements).toBeDefined();
      expect(state.arElements).toBeDefined();
    });

    it('exposes the framework recording slice', () => {
      // Why: recording lifecycle (isRecording, counters, sessionMetadata) is
      // a framework-owned concern; every app built on it gets it for free.
      const store = createSlamAppStore({ storageBackend: backend });
      const state = store.getState();
      expect(state.recording).toBeDefined();
      expect(state.recording.isRecording).toBe(false);
      expect(state.recording.actionCount).toBe(0);
    });

    it('does NOT include routing, refPoints, or scenario reducers by default', () => {
      // Why: those are recorder-only concerns. A generic app composing the
      // factory must not pay for them. They land via `extraReducers` only.
      const store = createSlamAppStore({ storageBackend: backend });
      const state = store.getState() as Record<string, unknown>;
      expect(state.routing).toBeUndefined();
      expect(state.refPoints).toBeUndefined();
      expect(state.scenario).toBeUndefined();
    });
  });

  describe('lifecycle dispatch', () => {
    it('handles startSession / endSession through the recording slice', () => {
      const store = createSlamAppStore({ storageBackend: backend });
      store.dispatch(
        startSession({
          scenarioName: 'Generic',
          sessionName: 's1',
          startTime: 1,
        })
      );
      expect(store.getState().recording.isRecording).toBe(true);
      store.dispatch(endSession());
      expect(store.getState().recording.isRecording).toBe(false);
    });
  });

  describe('extraReducers', () => {
    it('mounts caller-supplied reducers under their slice keys', () => {
      // Why: composable factory contract â€” recorder will plug routing /
      // refPoints / scenario through this seam without the framework knowing.
      const counter = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          inc(state) {
            state.value += 1;
          },
        },
      });
      const store = createSlamAppStore({
        storageBackend: backend,
        extraReducers: { counter: counter.reducer },
      });
      expect(
        (store.getState() as { counter: { value: number } }).counter.value
      ).toBe(0);
      store.dispatch(counter.actions.inc());
      expect(
        (store.getState() as { counter: { value: number } }).counter.value
      ).toBe(1);
    });
  });

  describe('extraMiddleware', () => {
    it('runs caller-supplied middleware in order with the persistence middleware', () => {
      // Why: lets consumers add app-specific middleware (logging, analytics,
      // recorder-specific side effects) without forking the factory.
      const seen: string[] = [];
      const trackingMiddleware =
        () => (next: (a: unknown) => unknown) => (action: unknown) => {
          if (
            typeof action === 'object' &&
            action !== null &&
            typeof (action as { type?: unknown }).type === 'string'
          ) {
            seen.push((action as { type: string }).type);
          }
          return next(action);
        };
      const store = createSlamAppStore({
        storageBackend: backend,
        extraMiddleware: [trackingMiddleware],
      });
      store.dispatch(endSession());
      expect(seen).toContain('recording/endSession');
    });
  });

  describe('storage backend wiring', () => {
    it('routes writeFrame / writeSessionMetadata through the supplied backend', async () => {
      // Why: A1 fix â€” abstraction boundary; tests must be able to substitute
      // a NullStorageBackend / spy backend in place of OPFS.
      const writeFrame = vi.fn().mockResolvedValue(undefined);
      const writeSessionMetadata = vi.fn().mockResolvedValue(undefined);
      const spy: StorageBackend = {
        createSession: vi.fn().mockResolvedValue({ sessionName: 's' }),
        listSessions: vi.fn().mockResolvedValue([]),
        writeAction: vi.fn().mockResolvedValue(undefined),
        writeFrame,
        writeSessionMetadata,
      };
      const store = createSlamAppStore({ storageBackend: spy });
      const blob = new Blob(['x']);
      await store.writeFrame(blob, 1);
      expect(writeFrame).toHaveBeenCalledWith(blob, 1);
      await store.writeSessionMetadata({
        version: 1,
        startedAt: '',
        endedAt: '',
        actionCount: 0,
        frameCount: 0,
        userAgent: '',
      });
      expect(writeSessionMetadata).toHaveBeenCalled();
    });
  });

  describe('license validation', () => {
    it('throws when an invalid license key is supplied', () => {
      // Why: the framework must never run without a valid license â€” including
      // the bundled community key path. Empty / bad keys are a hard fail.
      expect(() =>
        createSlamAppStore({ storageBackend: backend, licenseKey: '' })
      ).toThrow();
    });
  });
});
