/**
 * Unit tests for the image-quality worker client (transport logic only, with a
 * FAKE worker — no real thread, no pixels).
 *
 * Why this matters: the client is the contract between the capture manager's
 * `analyzeFrame` callback and the off-thread gate. These pin the init/ready
 * handshake, id-correlated verdict resolution, the pre-ready queue (so a verdict
 * is never asked for before the gate exists), and the fail-open guarantees on
 * worker error + disposal — the properties that keep a flaky worker from ever
 * losing a recording interval.
 */

import { describe, it, expect } from 'vitest';
import {
  createImageQualityClient,
  type WorkerLike,
} from './image-quality-client';
import type { WorkerInbound, WorkerOutbound } from './image-quality-protocol';
import { DEFAULT_QUALITY_FILTER } from 'gps-plus-slam-app-framework/ar/image-quality';
import type { CapturedFrame } from 'gps-plus-slam-app-framework/ar/image-capture';

class FakeWorker implements WorkerLike {
  posted: WorkerInbound[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  postMessage(message: WorkerInbound): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Simulate a message from the worker → main thread. */
  emit(out: WorkerOutbound): void {
    this.onmessage?.({ data: out } as MessageEvent);
  }
  emitError(err: unknown): void {
    this.onerror?.(err);
  }
  analyzeMessages(): Extract<WorkerInbound, { type: 'analyze' }>[] {
    return this.posted.filter(
      (m): m is Extract<WorkerInbound, { type: 'analyze' }> =>
        m.type === 'analyze'
    );
  }
}

const config = { ...DEFAULT_QUALITY_FILTER, enabled: true };

function frame(): CapturedFrame {
  return { blob: new Blob(['jpeg']), width: 8, height: 8 };
}

describe('createImageQualityClient', () => {
  it('posts an init message with the config on creation', () => {
    const w = new FakeWorker();
    createImageQualityClient(config, w);
    expect(w.posted[0]).toEqual({ type: 'init', config });
  });

  it('queues analyze calls until ready, then flushes them in order', () => {
    const w = new FakeWorker();
    const client = createImageQualityClient(config, w);

    void client.analyze(frame());
    void client.analyze(frame());
    // Not yet ready → nothing analyzed.
    expect(w.analyzeMessages()).toHaveLength(0);

    w.emit({ type: 'ready' });
    const msgs = w.analyzeMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.id).toBe(1);
    expect(msgs[1]!.id).toBe(2);
  });

  it('resolves an analyze promise with the matching verdict', async () => {
    const w = new FakeWorker();
    const client = createImageQualityClient(config, w);
    w.emit({ type: 'ready' });

    const f = frame();
    const p = client.analyze(f);
    const msg = w.analyzeMessages()[0]!;
    expect(msg.blob).toBe(f.blob); // forwards the encoded blob, not pixels
    expect(msg.id).toBe(1);

    w.emit({ type: 'verdict', id: 1, accept: false, reason: 'blurry' });
    await expect(p).resolves.toEqual({ accept: false, reason: 'blurry' });
  });

  it('sends analyze immediately once ready (no queue)', async () => {
    const w = new FakeWorker();
    const client = createImageQualityClient(config, w);
    w.emit({ type: 'ready' });

    const p = client.analyze(frame());
    expect(w.analyzeMessages()).toHaveLength(1);
    w.emit({ type: 'verdict', id: 1, accept: true, reason: null });
    await expect(p).resolves.toEqual({ accept: true, reason: null });
  });

  it('fails open (accept) for in-flight analyses when the worker errors', async () => {
    const w = new FakeWorker();
    const client = createImageQualityClient(config, w);
    w.emit({ type: 'ready' });

    const p = client.analyze(frame());
    w.emitError(new Error('worker boom'));
    await expect(p).resolves.toEqual({ accept: true, reason: 'fail-open' });
  });

  it('fails open for analyses started AFTER a worker error (no post to the dead worker)', async () => {
    // Regression: previously `worker.onerror` failed-open the *in-flight* work
    // but left the client live (disposed=false, ready=true). A subsequent
    // analyze() then posted to the dead worker and its promise never resolved,
    // so ImageCaptureManager.awaitingVerdict stalled until its 5 s safety
    // timeout on every frame. A worker error is fatal: future analyses must
    // fail open immediately without touching the dead worker.
    const w = new FakeWorker();
    const client = createImageQualityClient(config, w);
    w.emit({ type: 'ready' });

    w.emitError(new Error('worker boom'));

    const postedBefore = w.analyzeMessages().length;
    await expect(client.analyze(frame())).resolves.toEqual({
      accept: true,
      reason: 'fail-open',
    });
    // Must not have posted another analyze to the dead worker.
    expect(w.analyzeMessages().length).toBe(postedBefore);
  });

  it('terminates the worker and fails open on dispose', async () => {
    const w = new FakeWorker();
    const client = createImageQualityClient(config, w);
    w.emit({ type: 'ready' });

    const inFlight = client.analyze(frame());
    client.dispose();
    expect(w.terminated).toBe(true);
    await expect(inFlight).resolves.toEqual({
      accept: true,
      reason: 'fail-open',
    });

    // Further calls resolve immediately accept (no worker left).
    await expect(client.analyze(frame())).resolves.toEqual({
      accept: true,
      reason: 'fail-open',
    });
  });

  it('ignores a verdict for an unknown id (e.g. a late reply after dispose)', () => {
    const w = new FakeWorker();
    const client = createImageQualityClient(config, w);
    w.emit({ type: 'ready' });
    // No pending analyses — must not throw.
    expect(() =>
      w.emit({ type: 'verdict', id: 999, accept: true, reason: null })
    ).not.toThrow();
    // Sanity: dispose still works afterwards.
    expect(() => client.dispose()).not.toThrow();
  });
});
