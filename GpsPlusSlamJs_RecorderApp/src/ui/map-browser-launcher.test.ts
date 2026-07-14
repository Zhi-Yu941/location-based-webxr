/**
 * Map-browser launcher — lifecycle unit tests.
 *
 * Why this test matters: the launcher owns the module-level browser/abort
 * state that was previously embedded in `main.ts` (Step 4C) and was covered
 * only by the Playwright map-browser spec. These tests pin the extraction's
 * contract at unit level: the root container is mounted/reused, the coverage
 * stream feeds the browser, teardown aborts the in-flight stream and drops the
 * container, an empty folder never shows an empty map, a picked tour hands off
 * to the injected `startReplayForEntry` (the launcher's single main.ts dep),
 * and only non-abort stream failures surface via `showError`.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./map-browser', () => ({ createMapBrowser: vi.fn() }));
vi.mock('./recording-index', () => ({ streamRecordingIndex: vi.fn() }));
vi.mock('../storage/coverage-backfill', () => ({
  backfillCoverageIntoZips: vi.fn(),
}));
vi.mock('./hud', () => ({ showError: vi.fn() }));
vi.mock('./toast', () => ({ showToast: vi.fn() }));

import { createMapBrowser, type MapBrowserInstance } from './map-browser';
import {
  streamRecordingIndex,
  type RecordingCoverage,
} from './recording-index';
import {
  backfillCoverageIntoZips,
  type BackfillResult,
} from '../storage/coverage-backfill';
import { showError } from './hud';
import { showToast } from './toast';
import {
  launchMapBrowser,
  teardownMapBrowser,
  ensureMapBrowserRoot,
} from './map-browser-launcher';

type StreamHandlers = Parameters<typeof streamRecordingIndex>[1];

const folderHandle = {} as FileSystemDirectoryHandle;

/** Partial MapBrowserInstance with just the members the launcher touches. */
function makeBrowser() {
  return {
    addRecording: vi.fn(),
    setIndexingProgress: vi.fn(),
    destroy: vi.fn(),
  };
}

/** The launcher only calls the three mocked members, so the cast is safe. */
function asInstance(browser: ReturnType<typeof makeBrowser>) {
  return browser as unknown as MapBrowserInstance;
}

/** Minimal RecordingCoverage stream emission (fileHandle is never read). */
function makeRecording(overrides: {
  filename?: string;
  cells?: string[];
  backfilled?: boolean;
}): RecordingCoverage {
  const filename = overrides.filename ?? 'rec-1.zip';
  return {
    entry: {
      filename,
      fileHandle: { name: filename } as unknown as FileSystemFileHandle,
      date: null,
    },
    scenario: 'test',
    cells: overrides.cells ?? [],
    backfilled: overrides.backfilled ?? false,
  };
}

describe('map-browser-launcher', () => {
  const deps = { startReplayForEntry: vi.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    vi.clearAllMocks();
    teardownMapBrowser(); // reset module-level state between tests
    document.body.innerHTML = '';
    vi.mocked(streamRecordingIndex).mockResolvedValue(undefined);
  });

  describe('ensureMapBrowserRoot', () => {
    it('creates the full-bleed root container once and reuses it', () => {
      const first = ensureMapBrowserRoot();
      expect(first.id).toBe('map-browser-root');
      expect(first.className).toBe('fixed inset-0 z-[80]');
      expect(document.body.contains(first)).toBe(true);
      // Second call must return the SAME element (the e2e hooks and the real
      // replay path share one container).
      expect(ensureMapBrowserRoot()).toBe(first);
      expect(document.querySelectorAll('#map-browser-root')).toHaveLength(1);
    });
  });

  describe('launchMapBrowser', () => {
    it('mounts the browser in the root and streams recordings onto it', async () => {
      const browser = makeBrowser();
      vi.mocked(createMapBrowser).mockReturnValue(asInstance(browser));
      vi.mocked(streamRecordingIndex).mockImplementation(
        (_handle, handlers: StreamHandlers) => {
          handlers.onTotal?.(2);
          handlers.onRecording(makeRecording({ filename: 'a.zip' }));
          handlers.onProgress?.({ done: 1, total: 2 });
          return Promise.resolve();
        }
      );

      await launchMapBrowser(folderHandle, deps);

      const container = document.getElementById('map-browser-root');
      expect(container).not.toBeNull();
      expect(vi.mocked(createMapBrowser).mock.calls[0]?.[0]).toBe(container);
      expect(browser.setIndexingProgress).toHaveBeenCalledWith(0, 2);
      expect(browser.addRecording).toHaveBeenCalledTimes(1);
      expect(browser.setIndexingProgress).toHaveBeenLastCalledWith(1, 2);
      expect(showError).not.toHaveBeenCalled();
    });

    it('tears down (no empty map) when the folder has zero recordings', async () => {
      const browser = makeBrowser();
      vi.mocked(createMapBrowser).mockReturnValue(asInstance(browser));
      vi.mocked(streamRecordingIndex).mockImplementation(
        (_handle, handlers: StreamHandlers) => {
          handlers.onTotal?.(0);
          return Promise.resolve();
        }
      );

      await launchMapBrowser(folderHandle, deps);

      expect(browser.destroy).toHaveBeenCalled();
      expect(document.getElementById('map-browser-root')).toBeNull();
    });

    it('tears down the browser and starts single-tour replay on onPlayTour', async () => {
      const browser = makeBrowser();
      vi.mocked(createMapBrowser).mockReturnValue(asInstance(browser));

      await launchMapBrowser(folderHandle, deps);

      const options = vi.mocked(createMapBrowser).mock.calls[0]?.[1];
      const rec = makeRecording({ filename: 'picked.zip' });
      options?.onPlayTour(rec);

      expect(browser.destroy).toHaveBeenCalled();
      expect(document.getElementById('map-browser-root')).toBeNull();
      expect(deps.startReplayForEntry).toHaveBeenCalledWith(rec.entry);
    });

    it('relaunching tears down the previous browser and aborts its stream', async () => {
      const first = makeBrowser();
      const second = makeBrowser();
      vi.mocked(createMapBrowser)
        .mockReturnValueOnce(asInstance(first))
        .mockReturnValueOnce(asInstance(second));
      const signals: AbortSignal[] = [];
      vi.mocked(streamRecordingIndex).mockImplementation(
        (_handle, handlers: StreamHandlers) => {
          if (handlers.signal) signals.push(handlers.signal);
          return Promise.resolve();
        }
      );

      await launchMapBrowser(folderHandle, deps);
      await launchMapBrowser(folderHandle, deps);

      expect(first.destroy).toHaveBeenCalled();
      expect(second.destroy).not.toHaveBeenCalled();
      expect(signals[0]?.aborted).toBe(true);
      expect(signals[1]?.aborted).toBe(false);
    });

    it('surfaces a genuine stream failure via showError but stays quiet on abort', async () => {
      vi.mocked(createMapBrowser).mockReturnValue(asInstance(makeBrowser()));
      vi.mocked(streamRecordingIndex).mockRejectedValue(new Error('boom'));

      await launchMapBrowser(folderHandle, deps);
      expect(showError).toHaveBeenCalledWith(
        'Failed to index recordings for the map — see logs.'
      );

      // Abort path: the stream rejects only after teardown flipped the signal.
      vi.mocked(showError).mockClear();
      vi.mocked(createMapBrowser).mockReturnValue(asInstance(makeBrowser()));
      vi.mocked(streamRecordingIndex).mockImplementation(() => {
        teardownMapBrowser();
        return Promise.reject(new Error('aborted mid-flight'));
      });
      await launchMapBrowser(folderHandle, deps);
      expect(showError).not.toHaveBeenCalled();
    });

    it('tears down when createMapBrowser cannot mount (returns null)', async () => {
      vi.mocked(createMapBrowser).mockReturnValue(null);

      await launchMapBrowser(folderHandle, deps);

      expect(document.getElementById('map-browser-root')).toBeNull();
      expect(streamRecordingIndex).not.toHaveBeenCalled();
    });

    it('accumulates legacy backfill candidates and reports the backfill outcome', async () => {
      vi.mocked(createMapBrowser).mockReturnValue(asInstance(makeBrowser()));
      const legacy = makeRecording({
        filename: 'legacy.zip',
        cells: ['8b1f'],
        backfilled: true,
      });
      const modern = makeRecording({ filename: 'modern.zip', cells: ['8b2f'] });
      vi.mocked(streamRecordingIndex).mockImplementation(
        (_handle, handlers: StreamHandlers) => {
          handlers.onRecording(legacy);
          handlers.onRecording(modern);
          return Promise.resolve();
        }
      );
      const result: BackfillResult = {
        embedded: 1,
        skipped: 0,
        failed: 0,
        permissionDenied: false,
      };
      vi.mocked(backfillCoverageIntoZips).mockResolvedValue(result);

      await launchMapBrowser(folderHandle, deps);
      const options = vi.mocked(createMapBrowser).mock.calls[0]?.[1];
      await options?.onBackfill?.();

      // Only the backfilled legacy recording becomes a candidate.
      expect(vi.mocked(backfillCoverageIntoZips).mock.calls[0]?.[1]).toEqual([
        {
          fileHandle: legacy.entry.fileHandle,
          filename: 'legacy.zip',
          cells: ['8b1f'],
        },
      ]);
      expect(showToast).toHaveBeenCalledWith(
        'Embedded coverage into 1 recordings — future loads will be instant'
      );
    });
  });

  describe('teardownMapBrowser', () => {
    it('is idempotent and removes the root container', async () => {
      const browser = makeBrowser();
      vi.mocked(createMapBrowser).mockReturnValue(asInstance(browser));
      await launchMapBrowser(folderHandle, deps);

      teardownMapBrowser();
      teardownMapBrowser(); // second call must not throw

      expect(browser.destroy).toHaveBeenCalledTimes(1);
      expect(document.getElementById('map-browser-root')).toBeNull();
    });
  });
});
