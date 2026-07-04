/**
 * OccluderMeshDriver — coalescing + synchronous-fallback + error-recovery tests.
 *
 * The driver is the main-thread half of the Web Worker occluder offload. These
 * pin the policies that make it safe under a growing grid: at most one job in
 * flight with the NEWEST request winning (intermediates dropped), a synchronous
 * fallback when no worker is available, and — critically — **recovery from a
 * worker that never replies** (an uncaught throw in the worker, or a module that
 * fails to load). Without recovery the in-flight slot would stay set forever and
 * the occluder would silently freeze for the rest of the session (the 2026-07-01
 * "Phase 1 gap"). A fake poster stands in for a real Worker so the seam is
 * unit-tested without a worker environment.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  OccluderMeshDriver,
  type MeshWorkerPoster,
  type OccluderMeshStats,
} from './occluder-mesh-driver';
import {
  runMeshRequest,
  type MeshWorkerRequest,
} from '../ar/occlusion-mesh-worker';
import { meshOccupiedCells } from '../ar/occupancy-mesher';
import type { GridCell } from '../ar/bresenham3d';

const CELL = 0.15;

function box(n: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) cells.push([x, 0, z]);
  return cells;
}

/**
 * A fake worker: records posted requests. `respond(i)` meshes one and fires
 * `onmessage`; `error()` fires `onerror` (a worker that threw / failed to load).
 */
function makeFakePoster() {
  const posted: MeshWorkerRequest[] = [];
  const poster: MeshWorkerPoster = {
    postMessage: vi.fn((message: MeshWorkerRequest) => {
      posted.push(message);
    }),
    onmessage: null,
    onerror: null,
  };
  const respond = (i: number): void => {
    const { response } = runMeshRequest(posted[i]!);
    poster.onmessage?.({ data: response });
  };
  const error = (): void => {
    poster.onerror?.(new Error('worker boom'));
  };
  return { poster, posted, respond, error };
}

describe('OccluderMeshDriver', () => {
  it('meshes synchronously (matching a direct mesh) when constructed without a worker', () => {
    const driver = new OccluderMeshDriver(null);
    const cells = box(4);
    let positions: Float32Array | null = null;
    let indices: Uint32Array | null = null;
    driver.request(cells, CELL, 'per-face', undefined, (p, i) => {
      positions = p;
      indices = i;
    });
    const direct = meshOccupiedCells(cells, CELL);
    expect(indices).not.toBeNull();
    expect(Array.from(indices!)).toEqual(Array.from(direct.indices));
    expect(Array.from(positions!)).toEqual(Array.from(direct.positions));
  });

  it('posts to the worker and delivers the geometry on response', () => {
    const { poster, posted, respond } = makeFakePoster();
    const driver = new OccluderMeshDriver(poster);
    const cells = box(3);
    const results: number[] = [];
    driver.request(cells, CELL, 'greedy', undefined, (_p, i) => {
      results.push(i.length);
    });
    expect(posted).toHaveLength(1); // posted, not yet delivered
    expect(driver.busy).toBe(true);
    expect(results).toEqual([]);

    respond(0);
    expect(results).toHaveLength(1);
    expect(driver.busy).toBe(false);
  });

  it('coalesces to the LATEST request while a job is in flight (drops intermediates)', () => {
    const { poster, posted, respond } = makeFakePoster();
    const driver = new OccluderMeshDriver(poster);
    const done: string[] = [];
    driver.request(box(2), CELL, 'per-face', undefined, () => done.push('A'));
    driver.request(box(3), CELL, 'per-face', undefined, () => done.push('B'));
    driver.request(box(4), CELL, 'per-face', undefined, () => done.push('C'));

    // Only A is in flight; B and C coalesced (C is the survivor).
    expect(posted).toHaveLength(1);

    respond(0); // A completes → its callback fires, then C is posted
    expect(done).toEqual(['A']);
    expect(posted).toHaveLength(2);

    respond(1); // C completes; B was dropped
    expect(done).toEqual(['A', 'C']);
    expect(posted).toHaveLength(2);
  });

  it('recovers from a worker error (after a prior success): clears the wedge and re-posts the pending snapshot', () => {
    const { poster, posted, respond, error } = makeFakePoster();
    const onWorkerUnusable = vi.fn();
    const driver = new OccluderMeshDriver(poster, { onWorkerUnusable });
    const done: string[] = [];

    // Prove the worker works once, so a later error is transient (not a load failure).
    driver.request(box(2), CELL, 'per-face', undefined, () => done.push('A'));
    respond(0);
    expect(done).toEqual(['A']);

    // B goes in flight; C coalesces behind it as the pending (newest) job.
    driver.request(box(3), CELL, 'per-face', undefined, () => done.push('B'));
    driver.request(box(4), CELL, 'per-face', undefined, () => done.push('C'));
    expect(driver.busy).toBe(true);

    error(); // B's worker job fails and never replies
    // The driver must NOT wedge: it drops B, keeps the worker (already proven
    // good), and re-posts the pending C.
    expect(onWorkerUnusable).not.toHaveBeenCalled();
    expect(driver.busy).toBe(true); // C now in flight
    expect(posted).toHaveLength(3); // A, B, C  (C re-posted after the error)

    respond(2); // C completes; B was dropped (it failed)
    expect(done).toEqual(['A', 'C']);
    expect(driver.busy).toBe(false);
  });

  it('does not freeze after a worker error with nothing queued: the next request posts again', () => {
    const { poster, posted, respond, error } = makeFakePoster();
    const driver = new OccluderMeshDriver(poster);
    driver.request(box(2), CELL, 'per-face', undefined, () => {});
    respond(0); // prove the worker works → the next error is transient
    driver.request(box(3), CELL, 'per-face', undefined, () => {});
    expect(driver.busy).toBe(true);

    error(); // fails with nothing queued
    expect(driver.busy).toBe(false); // ← the bug was: `busy` stayed true forever

    // The next refresh must post again (the bug made every later request a
    // silently-dropped `pending` overwrite).
    const done: string[] = [];
    driver.request(box(2), CELL, 'per-face', undefined, () =>
      done.push('next')
    );
    expect(posted).toHaveLength(3);
    respond(2);
    expect(done).toEqual(['next']);
  });

  it('falls back to synchronous meshing when the worker errors before ever meshing (module load failure)', () => {
    const { poster, error } = makeFakePoster();
    const onWorkerUnusable = vi.fn();
    const driver = new OccluderMeshDriver(poster, { onWorkerUnusable });
    const cells = box(3);

    // The very first job is in flight when the worker's module fails to load →
    // onerror fires before any successful mesh.
    driver.request(cells, CELL, 'per-face', undefined, () => {});
    error();
    expect(onWorkerUnusable).toHaveBeenCalledTimes(1); // driver gives up on the worker

    // Subsequent requests now mesh synchronously on the main thread — the
    // occluder keeps working instead of freezing.
    let indices: Uint32Array | null = null;
    driver.request(cells, CELL, 'per-face', undefined, (_p, i) => {
      indices = i;
    });
    const direct = meshOccupiedCells(cells, CELL);
    expect(indices).not.toBeNull();
    expect(Array.from(indices!)).toEqual(Array.from(direct.indices));
    expect(driver.busy).toBe(false); // sync completes immediately
  });

  it('falls back to synchronous meshing when the worker errors BEFORE the first request (module load failure races ahead of the first post)', () => {
    const { poster, posted, error } = makeFakePoster();
    const onWorkerUnusable = vi.fn();
    const onError = vi.fn();
    const driver = new OccluderMeshDriver(poster, {
      onWorkerUnusable,
      onError,
    });
    const cells = box(3);

    // The realistic module-load-failure ordering: the worker's module fails to
    // load within a few ms of construction — BEFORE the first refresh posts any
    // job (inFlightId === null). Posting to a load-failed worker is silently
    // dropped (no second error), so if the driver ignored this error it would
    // wedge the in-flight slot forever on the first post (the residual freeze).
    error();
    expect(onWorkerUnusable).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(posted).toHaveLength(0); // never posted to the dead worker

    // The first (and every later) request now meshes synchronously.
    let indices: Uint32Array | null = null;
    driver.request(cells, CELL, 'per-face', undefined, (_p, i) => {
      indices = i;
    });
    const direct = meshOccupiedCells(cells, CELL);
    expect(indices).not.toBeNull();
    expect(Array.from(indices!)).toEqual(Array.from(direct.indices));
    expect(posted).toHaveLength(0); // still never posted to the worker
    expect(driver.busy).toBe(false);
  });

  it('ignores a stray worker error with no job in flight after a prior success (keeps the proven-good worker)', () => {
    const { poster, posted, respond, error } = makeFakePoster();
    const onWorkerUnusable = vi.fn();
    const driver = new OccluderMeshDriver(poster, { onWorkerUnusable });

    driver.request(box(2), CELL, 'per-face', undefined, () => {});
    respond(0); // worker proven good; the slot is now clear (inFlightId === null)
    expect(driver.busy).toBe(false);

    error(); // a stray / late error while nothing is in flight
    // The worker meshed once, so it must NOT be declared unusable over a stray
    // error — the fix for the pre-first-post freeze only fires when the worker
    // has never succeeded.
    expect(onWorkerUnusable).not.toHaveBeenCalled();

    // The next request still posts to the (kept) worker, not synchronously.
    driver.request(box(3), CELL, 'per-face', undefined, () => {});
    expect(posted).toHaveLength(2);
    expect(driver.busy).toBe(true);
  });

  it('does not wedge when synchronous meshing throws (bad cellSize): reports via onError and recovers', () => {
    const onError = vi.fn();
    const driver = new OccluderMeshDriver(null, { onError });
    // cellSizeM <= 0 makes meshOccupiedCells throw inside runMeshRequest.
    expect(() =>
      driver.request(box(2), 0, 'per-face', undefined, () => {})
    ).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(driver.busy).toBe(false); // slot cleared, not wedged

    // A subsequent valid request still meshes.
    let indices: Uint32Array | null = null;
    driver.request(box(2), CELL, 'per-face', undefined, (_p, i) => {
      indices = i;
    });
    expect(indices).not.toBeNull();
  });

  it('reports a sync-path consumer onMesh throw via onError instead of swallowing it', () => {
    // Why this test matters (code-health plan step 2): on the worker path a
    // throwing onMesh at least surfaces as an uncaught error from
    // Worker.onmessage; on the SYNC path the throw was caught by post()'s
    // guard, hit failInFlight's stale check (handleResponse's finally had
    // already cleared the slot) and vanished SILENTLY — a consumer bug the
    // consumer could never observe. The mesh itself succeeded, so this must
    // be reported as a consumer-callback error, not a mesh failure.
    const onError = vi.fn();
    const driver = new OccluderMeshDriver(null, { onError });
    expect(() =>
      driver.request(box(2), CELL, 'per-face', undefined, () => {
        throw new Error('consumer boom');
      })
    ).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(driver.busy).toBe(false);

    // The driver stays healthy: a later request meshes and delivers.
    let delivered = false;
    driver.request(box(2), CELL, 'per-face', undefined, () => {
      delivered = true;
    });
    expect(delivered).toBe(true);
  });

  it('does not wedge when the worker postMessage throws synchronously (e.g. DataCloneError): reports via onError and falls back to sync', () => {
    const { poster, posted } = makeFakePoster();
    const onError = vi.fn();
    const onWorkerUnusable = vi.fn();
    const driver = new OccluderMeshDriver(poster, {
      onError,
      onWorkerUnusable,
    });
    // A real `Worker.postMessage` can throw SYNCHRONOUSLY — a `DataCloneError`
    // for a non-cloneable payload, or an already-detached/invalid transferable.
    // The slot is marked in-flight *before* the post, so an unguarded throw
    // leaves `inFlightId` set forever: the driver would silently freeze (every
    // later request just overwrites `pending` and never posts). This pins the
    // worker-path symmetry with the guarded synchronous path below.
    (poster.postMessage as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => {
        throw new Error('DataCloneError');
      }
    );

    expect(() =>
      driver.request(box(2), CELL, 'per-face', undefined, () => {})
    ).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(driver.busy).toBe(false); // ← was: stayed true forever (wedged)
    expect(posted).toHaveLength(0); // the throwing post never recorded a request

    // A worker that throws on its very first post has never meshed — treated as
    // unusable (same as a module load failure): the driver switches to
    // synchronous meshing so the occluder keeps working instead of freezing.
    expect(onWorkerUnusable).toHaveBeenCalledTimes(1);
    let indices: Uint32Array | null = null;
    driver.request(box(2), CELL, 'per-face', undefined, (_p, i) => {
      indices = i;
    });
    const direct = meshOccupiedCells(box(2), CELL);
    expect(indices).not.toBeNull();
    expect(Array.from(indices!)).toEqual(Array.from(direct.indices));
    expect(posted).toHaveLength(0); // never posted to the dead worker
    expect(driver.busy).toBe(false);
  });

  it('does not wedge when getCellPoint throws during request packing: reports via onError and recovers (PR #152 review)', () => {
    // `post()` marks the slot in flight *before* `packMeshRequest` runs, and
    // packing invokes the caller's `getCellPoint` (surface modes sample every
    // cell's centroid on the main thread). An unguarded provider throw therefore
    // escaped `request()` with `inFlightId` still set — the same freeze the
    // postMessage/runMeshRequest guards above already prevent, via the one
    // remaining unguarded throw site in the post path.
    const { poster, posted, respond } = makeFakePoster();
    const onError = vi.fn();
    const onWorkerUnusable = vi.fn();
    const driver = new OccluderMeshDriver(poster, {
      onError,
      onWorkerUnusable,
    });
    const goodPoint = (c: GridCell): [number, number, number] => [
      c[0] * CELL,
      c[1] * CELL,
      c[2] * CELL,
    ];
    const done: string[] = [];

    // Prove the worker good first so the pack-time failure below cannot be
    // mistaken for a load failure.
    driver.request(box(2), CELL, 'smooth', goodPoint, () => done.push('A'));
    respond(0);
    expect(done).toEqual(['A']);

    expect(() =>
      driver.request(
        box(3),
        CELL,
        'smooth',
        () => {
          throw new Error('centroid provider boom');
        },
        () => done.push('B')
      )
    ).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(driver.busy).toBe(false); // ← was: stayed true forever (wedged)
    expect(posted).toHaveLength(1); // the failed job never reached the worker

    // The driver still works: the next refresh posts and meshes normally.
    driver.request(box(2), CELL, 'smooth', goodPoint, () => done.push('C'));
    expect(posted).toHaveLength(2);
    respond(1);
    expect(done).toEqual(['A', 'C']);
    expect(onWorkerUnusable).not.toHaveBeenCalled();
  });

  it('keeps the worker when packing throws before any success — a main-thread provider error is not the worker’s fault', () => {
    // Contrast with the postMessage-throw test above: a pack-time throw happens
    // BEFORE the worker is involved, so even with zero prior successes it must
    // not condemn the worker to the synchronous fallback for the session.
    const { poster, posted, respond } = makeFakePoster();
    const onError = vi.fn();
    const onWorkerUnusable = vi.fn();
    const driver = new OccluderMeshDriver(poster, {
      onError,
      onWorkerUnusable,
    });

    expect(() =>
      driver.request(
        box(2),
        CELL,
        'smooth',
        () => {
          throw new Error('centroid provider boom');
        },
        () => {}
      )
    ).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(driver.busy).toBe(false);
    expect(onWorkerUnusable).not.toHaveBeenCalled(); // worker NOT condemned

    // The next request still goes to the worker (not the sync fallback).
    const done: string[] = [];
    driver.request(box(3), CELL, 'per-face', undefined, () => done.push('ok'));
    expect(posted).toHaveLength(1);
    respond(0);
    expect(done).toEqual(['ok']);
  });

  it('coalesces a synchronously reentrant request() from onMesh (newest-wins) instead of double-posting', () => {
    // Why this test matters (PR #147 review, recorded 2026-07-02): handleResponse
    // used to clear the in-flight slot BEFORE invoking onMesh and draining
    // `pending` — a consumer onMesh that synchronously re-requests saw an idle
    // driver and posted immediately, then the pending drain posted AGAIN,
    // putting two jobs in the worker and dropping the reentrant one's response
    // as stale. The slot must stay reserved across the callback so a reentrant
    // request coalesces into `pending` under the documented newest-wins policy.
    const { poster, posted, respond } = makeFakePoster();
    const driver = new OccluderMeshDriver(poster);
    const done: string[] = [];
    let reentered = false;
    driver.request(box(2), CELL, 'per-face', undefined, () => {
      done.push('A');
      if (!reentered) {
        reentered = true;
        driver.request(box(4), CELL, 'per-face', undefined, () =>
          done.push('B')
        );
      }
    });
    driver.request(box(3), CELL, 'per-face', undefined, () => done.push('C'));
    expect(posted).toHaveLength(1); // A in flight; C pending

    respond(0); // A completes; its onMesh re-requests B (newer than C)
    // Exactly ONE follow-up post: B replaced C as the pending job (newest wins).
    expect(posted).toHaveLength(2);
    expect(driver.busy).toBe(true);
    respond(1);
    expect(done).toEqual(['A', 'B']); // C dropped as intermediate; B delivered
    expect(driver.busy).toBe(false);
  });

  it('does not wedge when onMesh throws: the slot clears and the pending job still posts', () => {
    // Why this test matters: keeping the slot reserved across the callback (see
    // the reentrancy test above) must not let a THROWING onMesh wedge the
    // driver — the clear + pending drain happen in a finally.
    const { poster, posted, respond } = makeFakePoster();
    const driver = new OccluderMeshDriver(poster);
    const done: string[] = [];
    driver.request(box(2), CELL, 'per-face', undefined, () => {
      throw new Error('consumer boom');
    });
    driver.request(box(3), CELL, 'per-face', undefined, () => done.push('C'));

    // The consumer's throw propagates (a real Worker.onmessage would surface it
    // as an uncaught error), but the driver must have recovered underneath.
    expect(() => respond(0)).toThrow('consumer boom');
    expect(posted).toHaveLength(2); // pending C was still drained
    expect(driver.busy).toBe(true); // …and is now in flight
    respond(1);
    expect(done).toEqual(['C']);
  });

  it('coalesces a synchronously reentrant request() from onError instead of double-posting', () => {
    // failInFlight mirrors handleResponse: onError runs with the slot still
    // reserved, so a consumer that reacts to a failure by re-requesting
    // coalesces (newest-wins) instead of racing the pending drain.
    const { poster, posted, respond, error } = makeFakePoster();
    const done: string[] = [];
    let driverRef: OccluderMeshDriver | null = null;
    const onError = vi.fn(() => {
      driverRef?.request(box(4), CELL, 'per-face', undefined, () =>
        done.push('B')
      );
    });
    const driver = new OccluderMeshDriver(poster, { onError });
    driverRef = driver;

    driver.request(box(2), CELL, 'per-face', undefined, () => done.push('A'));
    respond(0); // prove the worker good
    driver.request(box(3), CELL, 'per-face', undefined, () => done.push('D'));
    driver.request(box(5), CELL, 'per-face', undefined, () => done.push('C'));
    expect(posted).toHaveLength(2); // A, D; C pending

    error(); // D fails; onError reentrantly requests B (newer than C)
    expect(onError).toHaveBeenCalledTimes(1);
    expect(posted).toHaveLength(3); // exactly one follow-up post (B, not B+C)
    respond(2);
    expect(done).toEqual(['A', 'B']);
  });

  // Mesh-time stats — the freshness instrumentation for the Phase-2 gate
  // (2026-07-01-occluder-worker-and-chunked-remesh-plan.md §"Next step"): the
  // on-device walk reads the occluder's freshness latency off these numbers
  // instead of estimating it by feel, so each completed job must report its
  // wall-clock duration + input size. Failed jobs report nothing (they already
  // surface via onError).

  it('reports duration, cell count, mode and synchronous=false via onMeshStats when a worker job completes', () => {
    const { poster, respond } = makeFakePoster();
    const stats: OccluderMeshStats[] = [];
    let nowMs = 1000;
    const driver = new OccluderMeshDriver(poster, {
      onMeshStats: (s) => stats.push(s),
      now: () => nowMs,
    });
    const cells = box(3);
    driver.request(cells, CELL, 'greedy', undefined, () => {});
    expect(stats).toEqual([]); // nothing reported until the job completes

    nowMs = 1250; // the worker "takes" 250 ms
    respond(0);
    expect(stats).toEqual([
      { durationMs: 250, cellCount: 9, mode: 'greedy', synchronous: false },
    ]);
  });

  it('reports synchronous fallback meshes with synchronous=true', () => {
    const stats: OccluderMeshStats[] = [];
    let nowMs = 100;
    // The clock is read once at post and once at completion; advancing it per
    // read makes the inline (same-tick) duration observable.
    const driver = new OccluderMeshDriver(null, {
      onMeshStats: (s) => stats.push(s),
      now: () => (nowMs += 7),
    });
    driver.request(box(2), CELL, 'per-face', undefined, () => {});
    expect(stats).toEqual([
      { durationMs: 7, cellCount: 4, mode: 'per-face', synchronous: true },
    ]);
  });

  it('reports stats for each COMPLETED job when coalescing (dropped intermediates report nothing)', () => {
    const { poster, respond } = makeFakePoster();
    const stats: OccluderMeshStats[] = [];
    const driver = new OccluderMeshDriver(poster, {
      onMeshStats: (s) => stats.push(s),
      now: () => 0,
    });
    driver.request(box(2), CELL, 'per-face', undefined, () => {}); // A → in flight
    driver.request(box(3), CELL, 'per-face', undefined, () => {}); // B → dropped
    driver.request(box(4), CELL, 'per-face', undefined, () => {}); // C → pending
    respond(0); // A completes, C posts
    respond(1); // C completes
    expect(stats.map((s) => s.cellCount)).toEqual([4, 16]); // A and C only, never B
  });

  it('reports no stats for a failed job (the error already surfaces via onError)', () => {
    const { poster, error } = makeFakePoster();
    const stats: OccluderMeshStats[] = [];
    const onError = vi.fn();
    const driver = new OccluderMeshDriver(poster, {
      onMeshStats: (s) => stats.push(s),
      onError,
      now: () => 0,
    });
    driver.request(box(3), CELL, 'per-face', undefined, () => {});
    error(); // the job never completes
    expect(onError).toHaveBeenCalledTimes(1);
    expect(stats).toEqual([]);
  });

  it('delivers nothing after dispose()', () => {
    const { poster, respond } = makeFakePoster();
    const driver = new OccluderMeshDriver(poster);
    const onMesh = vi.fn();
    driver.request(box(3), CELL, 'per-face', undefined, onMesh);
    driver.dispose();
    respond(0);
    expect(onMesh).not.toHaveBeenCalled();
    expect(poster.onmessage).toBeNull();
  });
});
