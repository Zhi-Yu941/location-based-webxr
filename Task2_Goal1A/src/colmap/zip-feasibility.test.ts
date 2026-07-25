import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';
import { expect, test, describe } from 'vitest';

type Snapshot = {
  path: string;
  kind: 'file' | 'directory';
  bytes: Uint8Array;
};

const encoder = new TextEncoder();
const expectedSnapshots: Snapshot[] = [
  // Explicit directories
  {
    path: 'sparse/',
    kind: 'directory',
    bytes: new Uint8Array(),
  },
  {
    path: 'sparse/0/',
    kind: 'directory',
    bytes: new Uint8Array(),
  },
  {
    path: 'images/',
    kind: 'directory',
    bytes: new Uint8Array(),
  },
  {
    path: 'actions/',
    kind: 'directory',
    bytes: new Uint8Array(),
  },
  {
    path: 'unknown/',
    kind: 'directory',
    bytes: new Uint8Array(),
  },

  // COLMAP-like files
  {
    path: 'sparse/0/cameras.txt',
    kind: 'file',
    bytes: encoder.encode('original camera data'),
  },
  {
    path: 'sparse/0/images.txt',
    kind: 'file',
    bytes: encoder.encode('original image data'),
  },
  {
    path: 'sparse/0/points3D.txt',
    kind: 'file',

    // Intentionally empty file
    bytes: new Uint8Array(),
  },

  // Image-like files
  {
    path: 'images/frame-000001.jpg',
    kind: 'file',
    bytes: new Uint8Array([255, 216, 1, 2, 255, 217]),
  },
  {
    path: 'images/unreferenced.jpg',
    kind: 'file',
    bytes: new Uint8Array([255, 216, 3, 4, 255, 217]),
  },

  // Other known recorder files
  {
    path: 'actions/example.json',
    kind: 'file',
    bytes: encoder.encode('{"action":"example"}'),
  },
  {
    path: 'session.json',
    kind: 'file',
    bytes: encoder.encode('{"session":"synthetic"}'),
  },

  // Unknown arbitrary binary file
  {
    path: 'unknown/data.bin',
    kind: 'file',
    bytes: new Uint8Array([0, 255, 1, 128]),
  },
];
let replacementPath: string = '';
let replacementBytes: Uint8Array;

async function init(): Promise<Snapshot[]> {
  const input = new Uint8ArrayWriter();
  const zipWriter = new ZipWriter(input);

  for (const entry of expectedSnapshots) {
    if (entry.kind === 'directory') {
      await zipWriter.add(entry.path, undefined, { directory: true });
    } else {
      await zipWriter.add(entry.path, new Uint8ArrayReader(entry.bytes));
    }
  }

  const zipBytes = await zipWriter.close();

  const zipReader = new ZipReader(new Uint8ArrayReader(zipBytes));
  const snapshots: Snapshot[] = [];
  try {
    const entries = await zipReader.getEntries();

    for (const entry of entries) {
      if (entry.directory) {
        snapshots.push({
          path: entry.filename,
          kind: 'directory',
          bytes: new Uint8Array(),
        });
      } else {
        snapshots.push({
          path: entry.filename,
          kind: 'file',
          bytes: await entry.getData(new Uint8ArrayWriter()),
        });
      }
    }
  } finally {
    await zipReader.close();
  }
  return snapshots;
}
async function changeSnapshot(inputSnapshots: Snapshot[]): Promise<Snapshot[]> {
  replacementPath = 'sparse/0/cameras.txt';
  replacementBytes = encoder.encode('replacement camera data');
  const outputWriter = new ZipWriter(new Uint8ArrayWriter());

  for (const item of inputSnapshots) {
    if (item.kind === 'directory') {
      await outputWriter.add(item.path, undefined, { directory: true });
      continue;
    }
    const bytes = item.path === replacementPath ? replacementBytes : item.bytes;
    await outputWriter.add(item.path, new Uint8ArrayReader(bytes));
  }
  const outputZipBytes = await outputWriter.close();

  const zipReader = new ZipReader(new Uint8ArrayReader(outputZipBytes));
  const outputSnapshots: Snapshot[] = [];
  try {
    const entries = await zipReader.getEntries();
    for (const entry of entries) {
      if (entry.directory) {
        outputSnapshots.push({
          path: entry.filename,
          kind: 'directory',
          bytes: new Uint8Array(),
        });
      } else {
        outputSnapshots.push({
          path: entry.filename,
          kind: 'file',
          bytes: await entry.getData(new Uint8ArrayWriter()),
        });
      }
    }
  } finally {
    await zipReader.close();
  }
  return outputSnapshots;
}

function sortSnapshots(snapshots: Snapshot[]): Snapshot[] {
  return [...snapshots].sort((a, b) => a.path.localeCompare(b.path));
}

describe('zip feasibility', () => {
  test('should create a zip file with the expected structure and contents', async () => {
    const inputSnapshots = await init();
    const outputSnapshots = await changeSnapshot(inputSnapshots);

    const beforeByPath = new Map(
      inputSnapshots.map((item) => [item.path, item])
    );
    const afterByPath = new Map(
      outputSnapshots.map((item) => [item.path, item])
    );

    expect(sortSnapshots(inputSnapshots)).toEqual(
      sortSnapshots(expectedSnapshots)
    );
    expect(new Set(afterByPath.keys())).toEqual(new Set(beforeByPath.keys()));

    for (const [path, before] of beforeByPath) {
      const after = afterByPath.get(path);
      expect(after?.kind).toBe(before.kind);
      expect(after?.bytes).toEqual(
        path === replacementPath ? replacementBytes : before.bytes
      );
    }
  });
});
