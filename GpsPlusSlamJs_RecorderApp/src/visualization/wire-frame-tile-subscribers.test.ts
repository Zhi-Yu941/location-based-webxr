/**
 * @vitest-environment jsdom
 *
 * Tests for `wireFrameTileSubscribers` — F3.4.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { add2dImage, setZeroPos } from 'gps-plus-slam-app-framework/state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage/null-storage-backend';
import { createRecorderStore } from '../state/recorder-store';
import { createStoreRef } from '../state/store-ref';
import {
  wireFrameTileSubscribers,
  type FrameTile,
} from './wire-frame-tile-subscribers';

/**
 * Build an `add2dImage` payload (WebXR coords). Round-tripping through
 * the library's NUE conversion + the selector's NUE→WebXR conversion
 * yields the same WebXR coords (modulo floating-point), so tests can
 * inspect `frame.position`/`frame.rotation` with `toBeCloseTo` if
 * exact equality is needed.
 */
function makeFrame(overrides: Partial<FrameTile> = {}): FrameTile {
  return {
    imageFile: 'img/0001.jpg',
    position: [1, 2, 3],
    rotation: [0, 0, 0, 1],
    screenRotation: 0,
    capturedAt: 1700000000000,
    ...overrides,
  };
}

function makeBlobOfSize(size: number): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
}

function makeVisualizerSpy() {
  return {
    addTile: vi.fn<(frame: FrameTile, texture: THREE.Texture) => void>(),
    clear: vi.fn<() => void>(),
  };
}

async function flushMicrotasks(): Promise<void> {
  // Two passes: one for blobSource resolution, one for decodeTexture.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('wireFrameTileSubscribers', () => {
  let storeRef: ReturnType<
    typeof createStoreRef<ReturnType<typeof createRecorderStore>>
  >;

  beforeEach(() => {
    const store = createRecorderStore({
      storageBackend: new NullStorageBackend(),
    });
    // gpsData starts as null; setZeroPos initialises the model so
    // subsequent add2dImage dispatches actually populate the
    // odometryPath.points list (selectFrameTilesInWebXR reads from there).
    store.dispatch(setZeroPos({ lat: 50, lon: 8 }));
    storeRef = createStoreRef(store);
  });

  it('fetches blob, decodes texture, and calls addTile when a frame is added', async () => {
    const visualizer = makeVisualizerSpy();
    const texture = new THREE.Texture();
    const blob = makeBlobOfSize(5000);
    const blobSource = vi.fn().mockResolvedValue(blob);
    const decodeTexture = vi.fn().mockResolvedValue(texture);

    const dispose = wireFrameTileSubscribers({
      storeRef,
      visualizer,
      blobSource,
      decodeTexture,
    });

    const frame = makeFrame();
    storeRef.get().dispatch(add2dImage(frame));
    await flushMicrotasks();

    expect(blobSource).toHaveBeenCalledWith('img/0001.jpg');
    expect(decodeTexture).toHaveBeenCalledWith(blob);
    expect(visualizer.addTile).toHaveBeenCalledTimes(1);
    expect(visualizer.addTile).toHaveBeenCalledWith(frame, texture);

    dispose();
  });

  it('skips frames whose blob is below minFrameBytes (broken frame)', async () => {
    const visualizer = makeVisualizerSpy();
    const decodeTexture = vi.fn();
    const blobSource = vi.fn().mockResolvedValue(makeBlobOfSize(500));

    const dispose = wireFrameTileSubscribers({
      storeRef,
      visualizer,
      blobSource,
      decodeTexture,
      minFrameBytes: 2000,
    });

    storeRef.get().dispatch(add2dImage(makeFrame()));
    await flushMicrotasks();

    expect(decodeTexture).not.toHaveBeenCalled();
    expect(visualizer.addTile).not.toHaveBeenCalled();

    dispose();
  });

  it('skips when blobSource returns null', async () => {
    const visualizer = makeVisualizerSpy();
    const decodeTexture = vi.fn();
    const blobSource = vi.fn().mockResolvedValue(null);

    const dispose = wireFrameTileSubscribers({
      storeRef,
      visualizer,
      blobSource,
      decodeTexture,
    });

    storeRef.get().dispatch(add2dImage(makeFrame()));
    await flushMicrotasks();

    expect(decodeTexture).not.toHaveBeenCalled();
    expect(visualizer.addTile).not.toHaveBeenCalled();

    dispose();
  });

  it('skips when decodeTexture returns null', async () => {
    const visualizer = makeVisualizerSpy();
    const blobSource = vi.fn().mockResolvedValue(makeBlobOfSize(5000));
    const decodeTexture = vi.fn().mockResolvedValue(null);

    const dispose = wireFrameTileSubscribers({
      storeRef,
      visualizer,
      blobSource,
      decodeTexture,
    });

    storeRef.get().dispatch(add2dImage(makeFrame()));
    await flushMicrotasks();

    expect(visualizer.addTile).not.toHaveBeenCalled();

    dispose();
  });

  it('processes each imageFile only once even if dispatched twice', async () => {
    const visualizer = makeVisualizerSpy();
    const blobSource = vi.fn().mockResolvedValue(makeBlobOfSize(5000));
    const decodeTexture = vi.fn().mockResolvedValue(new THREE.Texture());

    const dispose = wireFrameTileSubscribers({
      storeRef,
      visualizer,
      blobSource,
      decodeTexture,
    });

    const frame = makeFrame();
    storeRef.get().dispatch(add2dImage(frame));
    await flushMicrotasks();
    storeRef.get().dispatch(add2dImage(frame));
    await flushMicrotasks();

    expect(blobSource).toHaveBeenCalledTimes(1);
    expect(visualizer.addTile).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('clears the visualizer and re-attaches on store swap', async () => {
    const visualizer = makeVisualizerSpy();
    const blobSource = vi.fn().mockResolvedValue(makeBlobOfSize(5000));
    const decodeTexture = vi.fn().mockResolvedValue(new THREE.Texture());

    const dispose = wireFrameTileSubscribers({
      storeRef,
      visualizer,
      blobSource,
      decodeTexture,
    });

    storeRef.get().dispatch(add2dImage(makeFrame({ imageFile: 'a.jpg' })));
    await flushMicrotasks();
    expect(visualizer.addTile).toHaveBeenCalledTimes(1);

    const nextStore = createRecorderStore({
      storageBackend: new NullStorageBackend(),
    });
    nextStore.dispatch(setZeroPos({ lat: 50, lon: 8 }));
    storeRef.set(nextStore);
    // 2 = the harmless no-op clear on the initial attachment (followStore
    // attach-start contract, quality-review G-11) + the real swap clear.
    expect(visualizer.clear).toHaveBeenCalledTimes(2);

    // The new store's processed-set is reset, so the same imageFile is
    // accepted again on the new store.
    nextStore.dispatch(add2dImage(makeFrame({ imageFile: 'a.jpg' })));
    await flushMicrotasks();
    expect(visualizer.addTile).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('dispose() stops further processing', async () => {
    const visualizer = makeVisualizerSpy();
    const blobSource = vi.fn().mockResolvedValue(makeBlobOfSize(5000));
    const decodeTexture = vi.fn().mockResolvedValue(new THREE.Texture());

    const dispose = wireFrameTileSubscribers({
      storeRef,
      visualizer,
      blobSource,
      decodeTexture,
    });

    dispose();

    storeRef.get().dispatch(add2dImage(makeFrame()));
    await flushMicrotasks();

    expect(blobSource).not.toHaveBeenCalled();
    expect(visualizer.addTile).not.toHaveBeenCalled();
  });

  it('disposes a decoded texture when disposed flips true mid-decode', async () => {
    // Why this test matters: decodeTexture is async. If dispose() runs
    // after the texture is decoded but before addTile() is called, the
    // texture never reaches the visualizer (which is what disposes the
    // textures it owns), so the wirer must dispose it itself to avoid a
    // GPU memory leak.
    const visualizer = makeVisualizerSpy();
    const texture = new THREE.Texture();
    const disposeSpy = vi.spyOn(texture, 'dispose');
    const blobSource = vi.fn().mockResolvedValue(makeBlobOfSize(5000));

    let resolveDecode: ((t: THREE.Texture) => void) | undefined;
    const decodeTexture = vi.fn(
      () =>
        new Promise<THREE.Texture>((resolve) => {
          resolveDecode = resolve;
        })
    );

    const dispose = wireFrameTileSubscribers({
      storeRef,
      visualizer,
      blobSource,
      decodeTexture,
    });

    storeRef.get().dispatch(add2dImage(makeFrame()));
    await flushMicrotasks();
    expect(decodeTexture).toHaveBeenCalledTimes(1);

    // Dispose the subscriber while decodeTexture is still pending, then
    // resolve the decode.
    dispose();
    resolveDecode?.(texture);
    await flushMicrotasks();

    expect(visualizer.addTile).not.toHaveBeenCalled();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('disposes a decoded texture when the store is swapped mid-decode', async () => {
    // Why this test matters: a store swap (Start Recording / Replay)
    // does NOT flip the subscriber-wide `disposed` flag. Without a
    // per-store staleness check, an in-flight decode from the OLD store
    // resolves after `visualizer.clear()` and calls `addTile` with a
    // stale frame — leaking the texture (the visualizer never tracks /
    // disposes it once a fresh attach owns the scene) and corrupting the
    // new store's visualization. The wirer must drop+dispose the stale
    // texture instead.
    const visualizer = makeVisualizerSpy();
    const texture = new THREE.Texture();
    const disposeSpy = vi.spyOn(texture, 'dispose');
    const blobSource = vi.fn().mockResolvedValue(makeBlobOfSize(5000));

    let resolveDecode: ((t: THREE.Texture) => void) | undefined;
    const decodeTexture = vi.fn(
      () =>
        new Promise<THREE.Texture>((resolve) => {
          resolveDecode = resolve;
        })
    );

    const dispose = wireFrameTileSubscribers({
      storeRef,
      visualizer,
      blobSource,
      decodeTexture,
    });

    storeRef.get().dispatch(add2dImage(makeFrame()));
    await flushMicrotasks();
    expect(decodeTexture).toHaveBeenCalledTimes(1);

    // Swap stores while the decode is still pending, then resolve it.
    const nextStore = createRecorderStore({
      storageBackend: new NullStorageBackend(),
    });
    nextStore.dispatch(setZeroPos({ lat: 50, lon: 8 }));
    storeRef.set(nextStore);
    // 2 = the harmless no-op clear on the initial attachment (followStore
    // attach-start contract, quality-review G-11) + the real swap clear.
    expect(visualizer.clear).toHaveBeenCalledTimes(2);

    resolveDecode?.(texture);
    await flushMicrotasks();

    expect(visualizer.addTile).not.toHaveBeenCalled();
    expect(disposeSpy).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('reports errors via onError and does not crash', async () => {
    const visualizer = makeVisualizerSpy();
    const onError = vi.fn();
    const blobSource = vi.fn().mockRejectedValue(new Error('boom'));
    const decodeTexture = vi.fn();

    const dispose = wireFrameTileSubscribers({
      storeRef,
      visualizer,
      blobSource,
      decodeTexture,
      onError,
    });

    storeRef.get().dispatch(add2dImage(makeFrame()));
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(visualizer.addTile).not.toHaveBeenCalled();

    dispose();
  });
});
