import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';

import type { ColmapImage } from './model.js';
import { ColmapError } from './validate.js';

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

const sparseTextPaths = [
  'sparse/0/cameras.txt',
  'sparse/0/images.txt',
  'sparse/0/points3D.txt',
] as const satisfies readonly SparseTextPath[];

const sparseTextPathSet = new Set<string>(sparseTextPaths);
const forbiddenBinaryPaths = [
  'sparse/0/cameras.bin',
  'sparse/0/images.bin',
  'sparse/0/points3D.bin',
] as const;

export const recorderZipAdapter: RecorderZipAdapter = {
  async open(zipBytes) {
    const reader = new ZipReader(new Uint8ArrayReader(zipBytes));
    let opened: OpenedRecorderArchive | undefined;
    let failure: unknown;

    try {
      const entries: ArchiveEntry[] = [];
      const files = new Map<string, ArchiveFileEntry>();
      const pathsByAsciiFold = new Map<string, string>();

      for (const entry of await reader.getEntries()) {
        const path = entry.filename;
        const kind = entry.directory ? 'directory' : 'file';
        validateEntryPath(path, kind);

        const foldedPath = asciiFold(path);
        const previousPath = pathsByAsciiFold.get(foldedPath);
        if (previousPath !== undefined) {
          throw archiveFailure(
            `Archive entries ${previousPath} and ${path} collide`,
            path
          );
        }
        pathsByAsciiFold.set(foldedPath, path);

        if (entry.directory) {
          entries.push({ path, kind: 'directory', bytes: new Uint8Array() });
          continue;
        }

        let bytes: Uint8Array;
        try {
          bytes = await entry.getData(new Uint8ArrayWriter());
        } catch (cause) {
          throw archiveFailure(
            `Could not read archive entry ${path}`,
            path,
            cause
          );
        }

        const snapshot: ArchiveFileEntry = { path, kind: 'file', bytes };
        entries.push(snapshot);
        files.set(path, snapshot);
      }

      for (const path of forbiddenBinaryPaths) {
        if (files.has(path)) {
          throw archiveFailure('Binary COLMAP models are not supported', path);
        }
      }
      for (const path of sparseTextPaths) {
        if (!files.has(path)) {
          throw archiveFailure(`Missing required archive entry ${path}`, path);
        }
      }

      opened = {
        entries,
        colmapText: {
          'sparse/0/cameras.txt': files.get('sparse/0/cameras.txt')!.bytes,
          'sparse/0/images.txt': files.get('sparse/0/images.txt')!.bytes,
          'sparse/0/points3D.txt': files.get('sparse/0/points3D.txt')!.bytes,
        },
      };
    } catch (cause) {
      failure = asArchiveFailure(cause);
    }

    try {
      await reader.close();
    } catch (cause) {
      failure ??= asArchiveFailure(cause);
    }

    if (failure !== undefined) {
      throw failure;
    }
    return opened!;
  },

  resolveImages(archive, images) {
    const files = new Map(
      archive.entries
        .filter((entry): entry is ArchiveFileEntry => entry.kind === 'file')
        .map((entry) => [entry.path, entry])
    );

    return images.map((image) => {
      const path = `images/${image.name}`;
      const entry = files.get(path);
      if (entry === undefined) {
        throw new ColmapError(
          `Image ${image.imageId} references missing archive entry ${path}`,
          { kind: 'reference', path, field: 'name' }
        );
      }
      return entry;
    });
  },

  async copyWithReplacements(archive, replacements) {
    const writer = new ZipWriter(new Uint8ArrayWriter());
    let currentPath: string | undefined;

    try {
      for (const entry of archive.entries) {
        currentPath = entry.path;
        if (entry.kind === 'directory') {
          await writer.add(entry.path, undefined, { directory: true });
          continue;
        }

        const bytes = sparseTextPathSet.has(entry.path)
          ? replacements[entry.path as SparseTextPath]
          : entry.bytes;
        await writer.add(entry.path, new Uint8ArrayReader(bytes));
      }
      currentPath = undefined;
      return await writer.close();
    } catch (cause) {
      throw asArchiveFailure(cause, currentPath);
    }
  },
};

function validateEntryPath(path: string, kind: ArchiveEntry['kind']): void {
  const isDirectory = kind === 'directory';
  if (
    path.length === 0 ||
    (isDirectory ? !path.endsWith('/') : path.endsWith('/'))
  ) {
    throw archiveFailure('Archive entry kind does not match its path', path);
  }

  const pathWithoutDirectorySlash = isDirectory ? path.slice(0, -1) : path;
  if (
    pathWithoutDirectorySlash.length === 0 ||
    pathWithoutDirectorySlash.startsWith('/') ||
    /^[A-Za-z]:/.test(pathWithoutDirectorySlash) ||
    pathWithoutDirectorySlash.includes('\\') ||
    [...pathWithoutDirectorySlash].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    }) ||
    pathWithoutDirectorySlash
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw archiveFailure('Invalid archive entry path', path);
  }
}

function asciiFold(path: string): string {
  return path.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function archiveFailure(
  message: string,
  path?: string,
  cause?: unknown
): ColmapError {
  return new ColmapError(
    message,
    { kind: 'archive', path },
    cause === undefined ? undefined : { cause }
  );
}

function asArchiveFailure(cause: unknown, path?: string): ColmapError {
  return cause instanceof ColmapError
    ? cause
    : archiveFailure('Could not process recorder ZIP', path, cause);
}
