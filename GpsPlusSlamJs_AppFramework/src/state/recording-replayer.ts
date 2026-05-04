/**
 * Recording Replayer
 *
 * Replays a recorded session from a zip file into a fresh store,
 * producing the fully-computed CombinedRootState without any persistence
 * side effects.
 *
 * This is the primary entry point for loading recordings for
 * visualization, comparison, validation, or offline analysis.
 *
 * Uses NullStorageBackend to ensure no OPFS writes occur during replay.
 *
 * See also: Finding F5 in docs/2026-02-15-replay-integration-test-review.md
 */

import { loadActionsFromZip, type RecordedAction } from '../storage/zip-reader';
import { NullStorageBackend } from '../storage/null-storage-backend';
import { createSlamAppStore } from './create-slam-app-store';
import type { CombinedRootState } from './combined-root-state';

export type { CombinedRootState };

/**
 * Options for replaying a recording.
 */
export interface ReplayRecordingOptions {
  /**
   * Optional migration function to transform raw actions from the ZIP before
   * dispatching. Use this to handle older recording formats (e.g., era 1–3
   * recordings that use `gpsPoint` instead of `rawGpsPoint`).
   *
   * When not provided, actions are dispatched as-is from the ZIP.
   */
  readonly migrateActions?: (actions: RecordedAction[]) => RecordedAction[];
}

/**
 * Replay a recording session from zip data, returning the final state.
 *
 * Loads all actions from the zip, creates a store with no persistence,
 * optionally migrates old-format actions, dispatches in order, and returns
 * the resulting state.
 *
 * @param zipData - The zip file content as a Uint8Array
 * @param options - Optional replay configuration (e.g., action migration)
 * @returns The fully-replayed combined state (library + recorder)
 * @throws If the zip cannot be parsed or contains invalid data
 */
export async function replayRecording(
  zipData: Uint8Array,
  options?: ReplayRecordingOptions
): Promise<CombinedRootState> {
  const store = createSlamAppStore({
    storageBackend: new NullStorageBackend(),
  });

  const actionEntries = await loadActionsFromZip(zipData);
  let actions = actionEntries.map((e) => e.action);

  if (options?.migrateActions) {
    actions = options.migrateActions(actions);
  }

  for (const action of actions) {
    store.dispatch(action);
  }

  return store.getState();
}
