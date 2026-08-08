import { spawn, spawnSync } from 'node:child_process';
import { randomFillSync } from 'node:crypto';
import { watch, writeFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { TextEncoder } from 'node:util';

import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { readRecorderZip } from '../dist/colmap/index.js';
import { cleanupPublishedTemporary } from './colmap-round-trip.mjs';

const cliPath = fileURLToPath(
  new URL('./colmap-round-trip.mjs', import.meta.url)
);
const encoder = new TextEncoder();
let testDirectory;

beforeEach(async () => {
  testDirectory = await mkdtemp(join(tmpdir(), 'task2-goal1a-cli-'));
});

afterEach(async () => {
  await rm(testDirectory, { recursive: true, force: true });
});

describe('colmap-round-trip CLI', () => {
  test('keeps a published output successful when temporary cleanup fails', async () => {
    const warnings = [];

    await expect(
      cleanupPublishedTemporary(
        'temporary.zip',
        async () => {
          throw new Error('temporary is locked');
        },
        (warning) => warnings.push(warning)
      )
    ).resolves.toBeUndefined();
    expect(warnings).toEqual([
      expect.stringContaining('temporary cleanup failed: temporary is locked'),
    ]);
  });

  test('requires exactly two user arguments', () => {
    const input = join(testDirectory, 'input.zip');
    const output = join(testDirectory, 'output.zip');

    for (const args of [[], [input], [input, output, 'extra']]) {
      const result = runCli(...args);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Usage:');
    }
  });

  test('rejects input and output paths that resolve identically', async () => {
    const input = join(testDirectory, 'input.zip');
    await writeFile(input, new Uint8Array([1, 2, 3]));

    const result = runCli(
      input,
      join(testDirectory, 'unused', '..', 'input.zip')
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must differ');
    expect(new Uint8Array(await readFile(input))).toEqual(
      new Uint8Array([1, 2, 3])
    );
  });

  test('rejects missing and non-file inputs', async () => {
    const directoryInput = join(testDirectory, 'input-directory');
    await mkdir(directoryInput);

    for (const input of [join(testDirectory, 'missing.zip'), directoryInput]) {
      const output = join(testDirectory, `${basename(input)}.output.zip`);
      const result = runCli(input, output);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Input');
      await expectPathMissing(output);
    }
  });

  test('rejects a missing or non-directory output parent', async () => {
    const input = join(testDirectory, 'input.zip');
    const parentFile = join(testDirectory, 'parent-file');
    await writeFile(input, new Uint8Array([1, 2, 3]));
    await writeFile(parentFile, 'keep');

    const outputs = [
      join(testDirectory, 'missing-parent', 'output.zip'),
      join(parentFile, 'output.zip'),
    ];
    for (const output of outputs) {
      const result = runCli(input, output);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Output parent');
      await expectPathMissing(output);
    }
    await expectPathMissing(dirname(outputs[0]));
  });

  test('does not overwrite an existing output', async () => {
    const input = join(testDirectory, 'input.zip');
    const output = join(testDirectory, 'output.zip');
    const existingBytes = new Uint8Array([9, 8, 7]);
    await writeFile(input, new Uint8Array([1, 2, 3]));
    await writeFile(output, existingBytes);

    const result = runCli(input, output);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('already exists');
    expect(new Uint8Array(await readFile(output))).toEqual(existingBytes);
    await expectNoTemporarySibling(output);
  });

  test('does not overwrite a file created after the initial check and removes its temporary sibling', async () => {
    const input = join(testDirectory, 'race-input.zip');
    const output = join(testDirectory, 'race-output.zip');
    const competingBytes = new Uint8Array([4, 5, 6]);
    const opaqueBytes = new Uint8Array(16 * 1024 * 1024);
    randomFillSync(opaqueBytes);
    await writeFile(input, await buildRecorderZip(true, opaqueBytes));

    const prefix = `.${basename(output)}.`;
    let collisionCreated = false;
    let collisionError;
    const watcher = watch(testDirectory, (_event, filename) => {
      if (
        collisionCreated ||
        collisionError !== undefined ||
        filename === null ||
        !filename.startsWith(prefix) ||
        !filename.endsWith('.tmp')
      ) {
        return;
      }

      try {
        writeFileSync(output, competingBytes, { flag: 'wx' });
        collisionCreated = true;
      } catch (error) {
        collisionError = error;
      }
    });

    let result;
    try {
      result = await runCliAsync(input, output);
    } finally {
      watcher.close();
    }

    expect(collisionError).toBeUndefined();
    expect(collisionCreated).toBe(true);
    expect(result.status).not.toBe(0);
    expect(new Uint8Array(await readFile(output))).toEqual(competingBytes);
    await expectNoTemporarySibling(output);
  });

  test('publishes no output for an invalid recorder archive', async () => {
    const input = join(testDirectory, 'invalid.zip');
    const output = join(testDirectory, 'output.zip');
    await writeFile(input, new Uint8Array([1, 2, 3]));

    const result = runCli(input, output);

    expect(result.status).not.toBe(0);
    await expectPathMissing(output);
    await expectNoTemporarySibling(output);
  });

  test('publishes no output when image ID 1 is absent', async () => {
    const input = join(testDirectory, 'missing-image-1.zip');
    const output = join(testDirectory, 'output.zip');
    await writeFile(input, await buildRecorderZip(false));

    const result = runCli(input, output);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('image ID 1');
    await expectPathMissing(output);
    await expectNoTemporarySibling(output);
  });

  test('writes a verified ZIP and prints the required image ID 1 summary', async () => {
    const input = join(testDirectory, 'input with spaces.zip');
    const output = join(testDirectory, 'result with spaces.zip');
    const inputBytes = await buildRecorderZip(true);
    await writeFile(input, inputBytes);

    const result = runCli(input, output);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Images: 2');
    expect(result.stdout).toContain(
      'Camera 3: PINHOLE 1920x1080 fx=1000 fy=1001 cx=960 cy=540'
    );
    expect(result.stdout).toContain(
      'Image 1 world-to-camera qvec: [0.5, 0.5, 0.5, 0.5]'
    );
    expect(result.stdout).toContain('Image 1 world-to-camera tvec: [1, 2, 3]');
    expect(result.stdout).toContain(`Output ZIP: ${output}`);

    expect(new Uint8Array(await readFile(input))).toEqual(inputBytes);
    const reopened = await readRecorderZip(await readFile(output));
    expect(reopened.model.images.map(({ imageId }) => imageId)).toEqual([8, 1]);
    await expectNoTemporarySibling(output);
  });
});

function runCli(...args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    shell: false,
  });
}

function runCliAsync(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { shell: false });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function buildRecorderZip(includeImage1, opaqueBytes) {
  const images = [
    '8 1 0 0 0 8 0 0 3 frame-8.jpg',
    '',
    ...(includeImage1 ? ['1 0.5 0.5 0.5 0.5 1 2 3 3 frame-1.jpg', ''] : []),
  ];
  const entries = [
    ['sparse/', undefined],
    ['sparse/0/', undefined],
    ['images/', undefined],
    ['sparse/0/cameras.txt', '3 PINHOLE 1920 1080 1000 1001 960 540\n'],
    ['sparse/0/images.txt', `${images.join('\n')}\n`],
    ['sparse/0/points3D.txt', '# no points\n'],
    ['images/frame-8.jpg', new Uint8Array([255, 216, 8, 255, 217])],
    ...(includeImage1
      ? [['images/frame-1.jpg', new Uint8Array([255, 216, 1, 255, 217])]]
      : []),
    ['images/unreferenced.jpg', new Uint8Array([255, 216, 3, 255, 217])],
    ['session.json', '{"session":"synthetic"}'],
    ...(opaqueBytes === undefined ? [] : [['unknown.bin', opaqueBytes]]),
  ];
  const writer = new ZipWriter(new Uint8ArrayWriter());

  for (const [path, contents] of entries) {
    if (contents === undefined) {
      await writer.add(path, undefined, { directory: true });
    } else {
      const bytes =
        typeof contents === 'string' ? encoder.encode(contents) : contents;
      await writer.add(path, new Uint8ArrayReader(bytes));
    }
  }
  return writer.close();
}

async function expectPathMissing(path) {
  await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

async function expectNoTemporarySibling(output) {
  const prefix = `.${basename(output)}.`;
  const names = await readdir(dirname(output));
  expect(names.filter((name) => name.startsWith(prefix))).toEqual([]);
}
