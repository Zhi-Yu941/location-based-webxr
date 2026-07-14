/**
 * File System Utilities - Pure Functions
 *
 * These are extracted from file-system.ts so they can be tested
 * without mocking browser APIs.
 */

/**
 * Format a Date as a timestamp string for folder names
 * @example "2025-02-28_14-30-11utc"
 */
export function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}_` +
    `${pad(date.getUTCHours())}-${pad(date.getUTCMinutes())}-${pad(date.getUTCSeconds())}utc`
  );
}

/**
 * Format an action file index as a zero-padded filename
 * @example 42 -> "000042.json"
 */
export function formatActionFilename(index: number): string {
  return `${String(index).padStart(6, '0')}.json`;
}

/**
 * Format a frame index as a zero-padded filename
 * @example 42 -> "frame-000042.jpg"
 */
export function formatFrameFilename(index: number): string {
  return `frame-${String(index).padStart(6, '0')}.jpg`;
}

/**
 * Canonical session subdirectory for captured camera images, written by new
 * recordings. Renamed from {@link LEGACY_SESSION_IMAGES_DIR} so an exported ZIP
 * is a textbook COLMAP tree (`images/frame-NNNNNN.jpg` next to `sparse/0/`).
 * Both the OPFS write path and the recorder's persisted `imageFile` value must
 * use THIS constant so a recording stays self-consistent (COLMAP export plan
 * Q5, gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-13-1205-colmap-export-plan.md).
 */
export const SESSION_IMAGES_DIR = 'images';

/**
 * The pre-2026-06 session image subdirectory. Recordings made before the
 * {@link SESSION_IMAGES_DIR} rename store frames under `frames/` (in both the
 * on-disk dir and the persisted `imageFile`); readers fall back to this prefix
 * so old recordings still replay.
 */
export const LEGACY_SESSION_IMAGES_DIR = 'frames';
