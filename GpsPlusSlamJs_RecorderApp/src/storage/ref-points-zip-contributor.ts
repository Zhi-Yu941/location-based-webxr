/**
 * Reference Point ZIP Export Contributor
 *
 * Recorder-side {@link ZipExportContributor} that filters per-session
 * ref-point observations out of the scenario-level `refPoints/` directory
 * and appends them under the ZIP's `refPoints/` subdir.
 *
 * Migrated from the framework's hard-coded `streamSessionRefPointsToZip`
 * branch in Iter 3 of the AppFramework / RecorderApp boundary cleanup.
 * See gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md
 */

import { createLogger } from 'gps-plus-slam-app-framework/utils/logger';
import type {
  ZipExportContributor,
  ZipContributorAddFile,
} from 'gps-plus-slam-app-framework/storage/zip-export';

const log = createLogger('RefPointsZipContributor');

/**
 * Build a {@link ZipExportContributor} that emits per-session ref-point
 * observations into the `refPoints/` subdir of an exported ZIP.
 *
 * @param scenarioHandle - Scenario directory in OPFS that owns `refPoints/`.
 *   May be `null` for flat-layout sessions; the contributor then emits 0.
 * @param sessionName - Session whose observations should be retained.
 */
export function createRefPointsZipContributor(
  scenarioHandle: FileSystemDirectoryHandle | null,
  sessionName: string
): ZipExportContributor {
  return {
    subdir: 'refPoints',
    async contribute(addFile: ZipContributorAddFile): Promise<number> {
      if (!scenarioHandle) return 0;

      let refPointsHandle: FileSystemDirectoryHandle;
      try {
        refPointsHandle = await scenarioHandle.getDirectoryHandle('refPoints');
      } catch {
        // No refPoints directory yet — nothing to include
        return 0;
      }

      let count = 0;
      for await (const [name, handle] of refPointsHandle.entries()) {
        if (handle.kind !== 'file' || !name.endsWith('.json')) continue;

        try {
          const file = await (handle as FileSystemFileHandle).getFile();
          const text = await file.text();
          const def = JSON.parse(text) as {
            observations?: Array<{ sessionId?: string }>;
          };

          if (!Array.isArray(def.observations)) continue;

          const sessionObs = def.observations.filter(
            (o) => o.sessionId === sessionName
          );
          if (sessionObs.length === 0) continue;

          const filtered = { ...def, observations: sessionObs };
          const blob = new Blob([JSON.stringify(filtered, null, 2)], {
            type: 'application/json',
          });
          await addFile(name, blob);
          count++;
        } catch (err) {
          log.warn(`Failed to process ref point "${name}":`, err);
        }
      }

      return count;
    },
  };
}
