/**
 * Zip Coverage Embed — write a recording's H3 coverage into its `session.json`.
 *
 * The map-centric browser indexes legacy recordings (those predating the
 * `h3Cells` field) by reading their full GPS path — slow, and repeated on every
 * folder open. This primitive lets a one-time "upgrade" embed the derived
 * coverage **inside the recording's own `session.json`**, so the recording
 * indexes instantly on every future open in this app *and any other reader*
 * (the portability the user asked for; O3 — in-zip rewrite).
 *
 * It is a pure transform `(zip, cells, resolution) -> zip`: it reads every entry
 * and re-emits a new zip identical to the input except that `session.json` gains
 * `h3Cells` + `h3Resolution`. It never mutates anything in place — the caller
 * (the RecorderApp backfill) owns the safe write-then-verify-then-overwrite
 * protocol around it.
 *
 * @see ./zip-coverage-embed.ts.md
 * @see GpsPlusSlamJs_Docs/docs/2026-06-14-followup-progressive-map-browser-indexing-and-backfill.md (B3)
 */

import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
  type FileEntry,
} from '@zip.js/zip.js';
import { createLogger } from '../utils/logger';

const log = createLogger('ZipCoverageEmbed');

/**
 * Return a new zip blob identical to `zip` except its `session.json` gains
 * `h3Cells` + `h3Resolution`.
 *
 * **Skips (returns the input blob unchanged, by reference) when:**
 *   - the zip has no `session.json` (nothing to embed into);
 *   - `session.json` is present but unparseable (never write over a broken one);
 *   - `session.json` already carries `h3Cells` (idempotent — re-running the
 *     upgrade is a no-op, and new recordings are skipped).
 *
 * On any unexpected read/write failure it also returns the input untouched —
 * it never emits a partial zip. Callers can detect a skip via reference
 * equality (`result === zip`).
 *
 * Built on `@zip.js/zip.js` (the same library as the exporter) in store mode, so
 * every non-`session.json` entry is re-emitted with byte-identical uncompressed
 * content.
 */
export async function embedCoverageInSessionJson(
  zip: Blob,
  h3Cells: string[],
  h3Resolution: number
): Promise<Blob> {
  const reader = new ZipReader(new BlobReader(zip));
  try {
    const entries = await reader.getEntries();
    const sessionEntry = entries.find(
      (e): e is FileEntry => !e.directory && e.filename.endsWith('session.json')
    );
    if (!sessionEntry) {
      log.warn('No session.json found; leaving zip untouched');
      return zip;
    }

    let session: Record<string, unknown>;
    try {
      const text = await sessionEntry.getData(new TextWriter());
      session = JSON.parse(text) as Record<string, unknown>;
    } catch (err) {
      log.warn('session.json unparseable; leaving zip untouched', err);
      return zip;
    }

    // Idempotent: a zip that already carries coverage is returned unchanged.
    if (session.h3Cells !== undefined) {
      return zip;
    }

    const merged = { ...session, h3Cells, h3Resolution };
    const writer = new ZipWriter(new BlobWriter('application/zip'), {
      level: 0,
    });
    try {
      for (const entry of entries) {
        if (entry.directory || !entry.getData) {
          continue;
        }
        if (entry === sessionEntry) {
          await writer.add(
            entry.filename,
            new TextReader(JSON.stringify(merged))
          );
        } else {
          const bytes = await entry.getData(new Uint8ArrayWriter());
          await writer.add(entry.filename, new Uint8ArrayReader(bytes));
        }
      }
      return await writer.close();
    } catch (err) {
      // Never leave a partial: abandon the half-built zip, keep the original.
      log.warn('Failed to re-emit zip; leaving original untouched', err);
      return zip;
    }
  } catch (err) {
    log.warn('Failed to read zip for coverage embed; leaving untouched', err);
    return zip;
  } finally {
    await reader.close();
  }
}
