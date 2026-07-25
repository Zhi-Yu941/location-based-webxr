import type { ColmapImage } from './model.js';

export type SparseTextPath =
  | 'sparse/0/cameras.txt'
  | 'sparse/0/images.txt'
  | 'sparse/0/points3D.txt';

export interface ArchiveEntry {
  readonly path: string;
  readonly kind: 'file' | 'directory';
  readonly bytes: Uint8Array;
}

export type ArchiveFileEntry = ArchiveEntry & { readonly kind: 'file' };

export interface OpenedRecorderArchive {
  readonly entries: readonly ArchiveEntry[];
  readonly colmapText: Readonly<Record<SparseTextPath, Uint8Array>>;
}

/** Internal exclusive owner of recorder ZIP reading and reconstruction. */
export interface RecorderZipAdapter {
  open(zipBytes: Uint8Array): Promise<OpenedRecorderArchive>;
  resolveImages(
    archive: OpenedRecorderArchive,
    images: readonly ColmapImage[]
  ): readonly ArchiveFileEntry[];
  copyWithReplacements(
    archive: OpenedRecorderArchive,
    replacements: Readonly<Record<SparseTextPath, Uint8Array>>
  ): Promise<Uint8Array>;
}
