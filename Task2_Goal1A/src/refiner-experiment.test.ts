import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  handoffRun,
  prepareRun,
  safetyModels,
  safetyRun,
  scoreModels,
  scoreRun,
  validateManifest,
} from './refiner-experiment.js';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const runsRoot = resolve(packageRoot, 'experiment-runs');
const template = JSON.parse(
  await readFile(
    join(packageRoot, 'scripts/refiner-manifest.template.json'),
    'utf8'
  )
) as Record<string, unknown>;
const pixels = new Uint8Array([255, 216, 42, 255, 217]);
let scratch: string;
let runDirectory: string;
let manifest: ReturnType<typeof preparationManifest>;
let inputBytes: Uint8Array;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'refiner-slice1-'));
  inputBytes = await recorderZip();
  await writeFile(join(scratch, 'recording.zip'), inputBytes);
  await writeFile(join(scratch, 'baseline.png'), pixels);
  manifest = preparationManifest();
  runDirectory = join(runsRoot, manifest.runId);
});

afterEach(async () => {
  // Only these newly allocated test directories belong to this test.
  expect(dirname(runDirectory)).toBe(runsRoot);
  expect(dirname(scratch)).toBe(resolve(tmpdir()));
  await rm(runDirectory, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

describe('slice 1 manifest gates', () => {
  test('rejects missing fields and an unfilled preparation template', () => {
    expect(() => validateManifest(template, 'preparation')).toThrow();
    for (const field of Object.keys(manifest).filter(
      (key) => key !== '$comment'
    )) {
      const incomplete: Record<string, unknown> = { ...manifest };
      delete incomplete[field];
      expect(() => validateManifest(incomplete, 'preparation'), field).toThrow(
        field
      );
    }
    expect(() =>
      validateManifest({ ...manifest, colmap: {} }, 'preparation')
    ).toThrow('colmap.executable');
  });

  test('allows explicitly pending baseline fields at preparation, but not before BA', () => {
    expect(() => validateManifest(manifest, 'preparation')).not.toThrow();
    expect(() =>
      validateManifest(
        {
          ...manifest,
          commands: [{ executable: 'synthetic', args: [], cwd: scratch }],
        },
        'preparation'
      )
    ).not.toThrow();
    expect(() => validateManifest(manifest, 'pre-ba')).toThrow('pending');

    const completed = completedManifest();
    expect(() => validateManifest(completed, 'pre-ba')).not.toThrow();
    expect(() =>
      validateManifest(
        { ...completed, gaugeAnchors: { behavior: 'pending' } },
        'pre-ba'
      )
    ).toThrow('pending');
    expect(() =>
      validateManifest({ ...completed, minPositiveDepthRatio: 2 }, 'pre-ba')
    ).toThrow('minPositiveDepthRatio');
    expect(() =>
      validateManifest({ ...completed, quaternionTolerance: 1e-3 }, 'pre-ba')
    ).toThrow('quaternionTolerance');
  });

  test('rejects unsafe run names, incomplete chronology and invalid required pairs', () => {
    for (const runId of ['../escape', 'existing/run', 'CON', 'pending']) {
      expect(() =>
        validateManifest({ ...manifest, runId }, 'preparation')
      ).toThrow('runId');
    }
    expect(() =>
      validateManifest(
        { ...manifest, chronologicalNames: ['a.jpg', 'b.jpg'] },
        'preparation'
      )
    ).toThrow('chronologicalNames');
    expect(() =>
      validateManifest({ ...manifest, loopPairs: [] }, 'preparation')
    ).toThrow('loopPairs');
    for (const images of [
      ['a.jpg', 'missing.jpg'],
      ['a.jpg', 'a.jpg'],
    ]) {
      expect(() =>
        validateManifest(
          { ...manifest, loopPairs: [{ images, required: true }] },
          'preparation'
        )
      ).toThrow('loopPairs');
    }
    expect(() =>
      validateManifest(
        {
          ...manifest,
          loopPairs: [{ images: ['a.jpg', 'c.jpg'], required: false }],
        },
        'preparation'
      )
    ).toThrow('required');
  });

  test('requires complete, valid per-stage PINHOLE calibration before BA', () => {
    const completed = completedManifest();
    const calibration = completed.intrinsicsByStage.synthetic;
    const invalidStages: unknown[] = [
      false,
      'recorded',
      [],
      {},
      { synthetic: false },
    ];
    for (const field of Object.keys(calibration)) {
      const incomplete: Record<string, unknown> = { ...calibration };
      delete incomplete[field];
      invalidStages.push({ synthetic: incomplete });
    }
    for (const [field, values] of Object.entries({
      model: ['SIMPLE_PINHOLE', false],
      width: [0, -1, 1.5, '16'],
      height: [0, -1, 1.5, false],
      cameraId: [0, -1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1],
      fx: [0, -1, '10', Infinity],
      fy: [0, -1, false, NaN],
      cx: [false, '8', Infinity],
      cy: [false, '6', NaN],
      refineFocalLength: [true, 'false', 0],
      refinePrincipalPoint: [true, 'false', 0],
      refineExtraParams: [true, 'false', 0],
    })) {
      for (const value of values) {
        invalidStages.push({ synthetic: { ...calibration, [field]: value } });
      }
    }
    for (const intrinsicsByStage of invalidStages) {
      expect(() =>
        validateManifest({ ...completed, intrinsicsByStage }, 'pre-ba')
      ).toThrow('intrinsicsByStage');
    }
  });

  test('requires named gauge anchors and all declared frame constraints before BA', () => {
    const completed = completedManifest();
    const anchors = completed.gaugeAnchors;
    for (const gaugeAnchors of [
      false,
      'fixed',
      [],
      {},
      { images: anchors.images },
      { constrainedQuantities: anchors.constrainedQuantities },
      ...[false, [], ['a.jpg'], ['a.jpg', 'a.jpg'], ['a.jpg', 'A.jpg']].map(
        (images) => ({ ...anchors, images })
      ),
      ...[
        false,
        [],
        ['origin', 'orientation'],
        ['origin', 'orientation', 'unknown'],
        ['origin', 'orientation', 'scale', 'scale'],
      ].map((constrainedQuantities) => ({ ...anchors, constrainedQuantities })),
    ]) {
      expect(() =>
        validateManifest({ ...completed, gaugeAnchors }, 'pre-ba')
      ).toThrow('gaugeAnchors');
    }
  });

  test('requires finite, nonnegative sequential step and turn maxima before BA', () => {
    const completed = completedManifest();
    for (const field of ['sequentialStepLimits', 'sequentialTurnLimits']) {
      for (const value of [
        false,
        'bounded',
        [],
        {},
        { other: 1 },
        ...[-1, false, '1', null, NaN, Infinity].map((max) => ({ max })),
      ]) {
        expect(() =>
          validateManifest({ ...completed, [field]: value }, 'pre-ba')
        ).toThrow(field);
      }
      expect(() =>
        validateManifest({ ...completed, [field]: { max: 0 } }, 'pre-ba')
      ).not.toThrow();
    }
  });

  test('requires structured evidence and artifact paths before BA', () => {
    const completed = completedManifest();
    for (const field of ['effectiveSettingsEvidence', 'behaviorEvidence']) {
      for (const value of [
        false,
        'evidence.txt',
        [],
        [false],
        [' '],
        { path: 'evidence.txt' },
      ]) {
        expect(() =>
          validateManifest({ ...completed, [field]: value }, 'pre-ba')
        ).toThrow(field);
      }
    }
    for (const artifactPaths of [
      false,
      'models/triangulated',
      [],
      {},
      { baseline: false },
      { baseline: ['models/triangulated'] },
      { ' ': 'models/triangulated' },
    ]) {
      expect(() =>
        validateManifest({ ...completed, artifactPaths }, 'pre-ba')
      ).toThrow('artifactPaths');
    }
  });
});

describe('slice 1 preparation', () => {
  test('refuses an existing workspace without altering it', async () => {
    await mkdir(runDirectory, { recursive: true });
    await writeFile(join(runDirectory, 'keep.txt'), 'existing evidence');
    await expect(prepareRun(manifest, runsRoot)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readdir(runDirectory)).toEqual(['keep.txt']);
    expect(await readFile(join(runDirectory, 'keep.txt'), 'utf8')).toBe(
      'existing evidence'
    );
  });

  test('rejects a hash mismatch before creating a run', async () => {
    manifest.input.sha256 = '0'.repeat(64);
    await expect(prepareRun(manifest, runsRoot)).rejects.toThrow(
      'input.sha256'
    );
    await expect(readdir(runDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('rejects extra, missing, duplicate or case-changed manifest images', async () => {
    for (const imageNames of [
      ['a.jpg', 'b.jpg', 'c.jpg', 'extra.jpg'],
      ['a.jpg', 'b.jpg'],
      ['a.jpg', 'b.jpg', 'b.jpg'],
      ['A.jpg', 'b.jpg', 'c.jpg'],
    ]) {
      await expect(
        prepareRun({ ...manifest, imageNames }, runsRoot)
      ).rejects.toThrow(/imageNames|chronologicalNames/);
    }
    await expect(readdir(runDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('requires the run destination to be ignored before copying input', async () => {
    await expect(prepareRun(manifest, scratch)).rejects.toThrow(
      'git check-ignore'
    );
    await expect(readdir(join(scratch, manifest.runId))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('rejects an unexpected model image even when the manifest is internally consistent', async () => {
    const unexpectedImageZip = await recorderZip(true);
    await writeFile(manifest.input.path, unexpectedImageZip);
    manifest.input.sha256 = hash(unexpectedImageZip);
    expect(() => validateManifest(manifest, 'preparation')).not.toThrow();
    await expect(prepareRun(manifest, runsRoot)).rejects.toThrow('imageNames');
    await expect(readdir(runDirectory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('retains the original dataset and ZIP, extracts referenced bytes only, and records hashes', async () => {
    const prepared = await prepareRun(manifest, runsRoot);
    expect(prepared.runDirectory).toBe(runDirectory);
    expect(prepared.dataset.model.images.map(({ imageId }) => imageId)).toEqual(
      [9, 2, 7]
    );
    expect(prepared.dataset.model.points3D).toHaveLength(1);
    expect(
      new Uint8Array(await readFile(join(runDirectory, 'input/original.zip')))
    ).toEqual(inputBytes);
    expect(new Uint8Array(await readFile(manifest.input.path))).toEqual(
      inputBytes
    );
    expect((await readdir(join(runDirectory, 'images'))).sort()).toEqual([
      'a.jpg',
      'b.jpg',
      'c.jpg',
    ]);
    for (const name of manifest.imageNames) {
      expect(
        new Uint8Array(await readFile(join(runDirectory, 'images', name)))
      ).toEqual(pixels);
    }
    const receipt = JSON.parse(
      await readFile(join(runDirectory, 'logs/preparation.json'), 'utf8')
    );
    expect(receipt.manifest).toEqual(manifest);
    expect(receipt.input).toEqual({
      before: manifest.input.sha256,
      copy: manifest.input.sha256,
      after: manifest.input.sha256,
    });
    expect(receipt.images).toEqual(
      manifest.imageNames.map((name) => ({
        path: `images/${name}`,
        sha256: hash(pixels),
      }))
    );
    expect(receipt.suitabilityEvidence).toHaveLength(2);
    expect(
      new Uint8Array(
        await readFile(join(runDirectory, receipt.suitabilityEvidence[0].path))
      )
    ).toEqual(pixels);
    expect(
      JSON.parse(await readFile(join(runDirectory, 'manifest.json'), 'utf8'))
    ).toEqual(manifest);
    expect(
      spawnSync(
        'git',
        ['check-ignore', '-q', '--', join(runDirectory, 'input/original.zip')],
        { cwd: packageRoot }
      ).status
    ).toBe(0);
  });

  test('prepare CLI accepts a run manifest, resolves its relative paths, and never overwrites a run', async () => {
    const manifestPath = join(scratch, 'run.json');
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...manifest,
        input: { ...manifest.input, path: 'recording.zip' },
        overlapEvidence: {
          ...manifest.overlapEvidence,
          paths: ['baseline.png'],
        },
        driftEvidence: { ...manifest.driftEvidence, paths: ['baseline.png'] },
      })
    );
    const invoke = () =>
      spawnSync(
        process.execPath,
        [
          join(packageRoot, 'scripts/refiner-experiment.mjs'),
          'prepare',
          manifestPath,
        ],
        { encoding: 'utf8', cwd: scratch }
      );
    const result = invoke();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(runDirectory);
    const repeated = invoke();
    expect(repeated.status).not.toBe(0);
    expect(repeated.stderr).toContain('EEXIST');
    expect(
      new Uint8Array(await readFile(join(runDirectory, 'input/original.zip')))
    ).toEqual(inputBytes);
  });
});

describe('slice 2 exact handoff', () => {
  test('maps shuffled database IDs by filename, preserves W2C poses, and leaves working points empty', async () => {
    const { dataset } = await prepareRun(manifest, runsRoot);
    const original = structuredClone(dataset.model);
    const databasePath = await handoffDatabase();
    const databaseBefore = hash(await readFile(databasePath));
    const result = await handoffRun(runDirectory);
    expect(
      result.poses.map((row) => [
        row.originalImageId,
        row.exactFilename,
        row.databaseImageId,
        row.returnedImageId,
      ])
    ).toEqual([
      [9, 'a.jpg', 20, null],
      [2, 'b.jpg', 5, null],
      [7, 'c.jpg', 80, null],
    ]);
    expect(result.poses.map((row) => row.originalPose)).toEqual(
      original.images.map((image) => image.pose)
    );
    expect(
      result.poses.every(
        (row) => row.originalCameraId === 3 && row.databaseCameraId === 41
      )
    ).toBe(true);
    expect(
      await readFile(join(runDirectory, 'models/known/cameras.txt'), 'utf8')
    ).toBe('41 PINHOLE 16 12 10 10 8 6\n');
    expect(
      await readFile(join(runDirectory, 'models/known/images.txt'), 'utf8')
    ).toBe(
      '20 1 0 0 0 0 0 0 41 a.jpg\n\n5 1 0 0 0 1 0 0 41 b.jpg\n\n80 1 0 0 0 2 0 0 41 c.jpg\n\n'
    );
    expect(
      await readFile(join(runDirectory, 'models/known/points3D.txt'), 'utf8')
    ).toBe('');
    expect(
      JSON.parse(await readFile(join(runDirectory, 'poses.json'), 'utf8'))
    ).toEqual(result.poses);
    const receipt = JSON.parse(
      await readFile(join(runDirectory, 'logs/handoff.json'), 'utf8')
    );
    expect(receipt.database.sha256).toBe(databaseBefore);
    expect(receipt.calibration.original[0].intrinsics).toEqual(
      receipt.calibration.database[0].intrinsics
    );
    expect(receipt.returnedExport).toBeNull();
    expect(hash(await readFile(databasePath))).toBe(databaseBefore);
    expect(
      new Uint8Array(await readFile(join(runDirectory, 'input/original.zip')))
    ).toEqual(inputBytes);
    expect(dataset.model).toEqual(original);
    await expect(handoffRun(runDirectory)).rejects.toMatchObject({
      code: 'EEXIST',
    });
  });

  test('rejects missing, duplicate, unexpected and case-changed database filenames before output', async () => {
    await prepareRun(manifest, runsRoot);
    const databasePath = await handoffDatabase();
    for (const names of [
      ['a.jpg', 'b.jpg'],
      ['a.jpg', 'b.jpg', 'b.jpg'],
      ['a.jpg', 'b.jpg', 'extra.jpg'],
      ['A.jpg', 'b.jpg', 'c.jpg'],
    ]) {
      const db = new DatabaseSync(databasePath);
      try {
        db.exec('DELETE FROM images');
        names.forEach((name, i) =>
          db.prepare('INSERT INTO images VALUES (?, ?, 41)').run(i + 1, name)
        );
      } finally {
        db.close();
      }
      await expect(handoffRun(runDirectory)).rejects.toThrow(
        /database.*case-sensitive/
      );
      await expect(
        readFile(join(runDirectory, 'poses.json'))
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        readdir(join(runDirectory, 'models/known'))
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  test('rejects wrong database calibration, missing camera references and unsupported schema', async () => {
    await prepareRun(manifest, runsRoot);
    const databasePath = await handoffDatabase();
    for (const sql of [
      'UPDATE cameras SET model = 0',
      'UPDATE cameras SET width = 15',
      'UPDATE cameras SET height = 13',
      "UPDATE cameras SET params = X'0000'",
      "UPDATE images SET camera_id = 99 WHERE name = 'a.jpg'",
      "UPDATE images SET image_id = 0 WHERE name = 'a.jpg'",
      "UPDATE images SET image_id = 5 WHERE name = 'a.jpg'",
      'ALTER TABLE cameras RENAME COLUMN params TO unknown',
    ]) {
      const db = new DatabaseSync(databasePath);
      try {
        db.exec('BEGIN');
        db.exec(sql);
        db.exec('COMMIT');
      } finally {
        db.close();
      }
      await expect(handoffRun(runDirectory)).rejects.toThrow(/database|schema/);
      await expect(
        readdir(join(runDirectory, 'models/known'))
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await rm(databasePath);
      await handoffDatabase();
    }
    const db = new DatabaseSync(databasePath);
    try {
      const params = Buffer.alloc(32);
      [11, 10, 8, 6].forEach((value, i) => params.writeDoubleLE(value, i * 8));
      db.prepare('UPDATE cameras SET params = ?').run(params);
    } finally {
      db.close();
    }
    await expect(handoffRun(runDirectory)).rejects.toThrow(/calibration/);
  });

  test('does not create a missing database or accept a changed isolated input', async () => {
    await prepareRun(manifest, runsRoot);
    await expect(handoffRun(runDirectory)).rejects.toThrow();
    await expect(
      readFile(join(runDirectory, 'database/features.db'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await handoffDatabase();
    await writeFile(join(runDirectory, 'input/original.zip'), 'changed');
    await expect(handoffRun(runDirectory)).rejects.toThrow('input.sha256');
    await expect(
      readdir(join(runDirectory, 'models/known'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('maps returned IDs and retains populated working observations without importing them into the recorder', async () => {
    await prepareRun(manifest, runsRoot);
    await handoffDatabase();
    await handoffRun(runDirectory);
    const exported = await workingExport();
    const before = hash(await readFile(join(exported, 'images.txt')));
    const result = await handoffRun(runDirectory, exported);
    expect(result.poses.map((row) => row.returnedImageId)).toEqual([
      101, 303, 202,
    ]);
    expect(result.poses.map((row) => row.returnedCameraId)).toEqual([
      12, 12, 12,
    ]);
    expect(result.poses[0]!.returnedPose!.tvec).toEqual([0.25, 0, 0]);
    expect(
      result.workingImages!.map((image) => image.observations.length)
    ).toEqual([1, 2, 0]);
    expect(result.workingImages![1]!.observations).toEqual([
      [8, 6, 900],
      [9, 7, -1],
    ]);
    expect(hash(await readFile(join(exported, 'images.txt')))).toBe(before);
    expect(
      await readFile(join(runDirectory, 'models/known/points3D.txt'), 'utf8')
    ).toBe('');
  });

  test('inspects a returned export after initial handoff on the same run without replacing evidence', async () => {
    await prepareRun(manifest, runsRoot);
    await handoffDatabase();
    const initial = await handoffRun(runDirectory);
    expect(initial.poses.every((row) => row.returnedImageId === null)).toBe(
      true
    );
    const preservedPaths = [
      'models/known/cameras.txt',
      'models/known/images.txt',
      'models/known/points3D.txt',
      'poses.json',
      'logs/handoff.json',
      'input/original.zip',
      'database/features.db',
    ];
    const before = await Promise.all(
      preservedPaths.map((path) => readFile(join(runDirectory, path)))
    );
    const exported = await workingExport();
    const result = await handoffRun(runDirectory, exported);
    expect(result.poses.map((row) => row.returnedImageId)).toEqual([
      101, 303, 202,
    ]);
    expect(result.mappingPath).not.toBe(join(runDirectory, 'poses.json'));
    expect(JSON.parse(await readFile(result.mappingPath, 'utf8'))).toEqual(
      result.poses
    );
    const receiptBytes = await readFile(result.receiptPath);
    const receipt = JSON.parse(receiptBytes.toString('utf8'));
    expect(receipt.initialHandoffSha256).toBe(hash(before[4]!));
    expect(receipt.returnedExport.path).toBe(exported);
    await expect(handoffRun(runDirectory, exported)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(await readFile(result.receiptPath)).toEqual(receiptBytes);
    const exportedImages = join(exported, 'images.txt');
    await writeFile(
      exportedImages,
      (await readFile(exportedImages, 'utf8')).replace('0.25', '0.5')
    );
    const another = await handoffRun(runDirectory, exported);
    expect(another.mappingPath).not.toBe(result.mappingPath);
    expect(another.poses[0]!.returnedPose!.tvec).toEqual([0.5, 0, 0]);
    expect(JSON.parse(await readFile(result.mappingPath, 'utf8'))).toEqual(
      result.poses
    );
    expect(await readFile(result.receiptPath)).toEqual(receiptBytes);
    const after = await Promise.all(
      preservedPaths.map((path) => readFile(join(runDirectory, path)))
    );
    expect(after).toEqual(before);
  });

  test('requires an intact initial handoff before recording a returned mapping', async () => {
    await prepareRun(manifest, runsRoot);
    const databasePath = await handoffDatabase();
    const exported = await workingExport();
    await expect(handoffRun(runDirectory, exported)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      readdir(join(runDirectory, 'models/known'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await handoffRun(runDirectory);
    for (const [name, replacement] of [
      ['poses.json', '[]'],
      ['logs/handoff.json', '{}'],
      ['models/known/images.txt', 'changed'],
    ]) {
      const path = join(runDirectory, name!);
      const before = await readFile(path);
      await writeFile(path, replacement!);
      await expect(handoffRun(runDirectory, exported)).rejects.toThrow(
        /handoff|Known model/
      );
      await writeFile(path, before);
    }
    const db = new DatabaseSync(databasePath);
    try {
      db.exec('UPDATE images SET image_id = 81 WHERE image_id = 80');
    } finally {
      db.close();
    }
    await expect(handoffRun(runDirectory, exported)).rejects.toThrow(
      'database'
    );
    expect(
      (await readdir(runDirectory)).filter((name) =>
        name.startsWith('poses-returned-')
      )
    ).toEqual([]);
  });

  test('rejects invalid returned filenames, IDs, calibration and malformed observation rows', async () => {
    await prepareRun(manifest, runsRoot);
    await handoffDatabase();
    await handoffRun(runDirectory);
    const initialPoses = await readFile(join(runDirectory, 'poses.json'));
    const exported = await workingExport();
    const imagesPath = join(exported, 'images.txt');
    const valid = await readFile(imagesPath, 'utf8');
    for (const changed of [
      valid.replace('a.jpg', 'A.jpg'),
      valid.replace('a.jpg', 'b.jpg'),
      valid.replace('a.jpg', 'extra.jpg'),
      valid.replace('303 1 0 0 0 1 0 0 12 b.jpg\n\n', ''),
      valid.replace('101 1', '202 1'),
      valid.replace('12 a.jpg', '99 a.jpg'),
      valid.replace('0.25', 'NaN'),
      valid.replace('8 6 900 9 7 -1', '8 6'),
      valid.replace('8 6 900 9 7 -1', '8 6 -2'),
      valid.trimEnd(),
    ]) {
      await writeFile(imagesPath, changed);
      await expect(handoffRun(runDirectory, exported)).rejects.toThrow(
        /returned|images.txt/
      );
      expect(await readFile(join(runDirectory, 'poses.json'))).toEqual(
        initialPoses
      );
      expect(
        (await readdir(runDirectory)).filter((name) =>
          name.startsWith('poses-returned-')
        )
      ).toEqual([]);
    }
    await writeFile(imagesPath, valid);
    await writeFile(
      join(exported, 'cameras.txt'),
      '12 PINHOLE 16 12 11 10 8 6\n'
    );
    await expect(handoffRun(runDirectory, exported)).rejects.toThrow(
      /calibration/
    );
  });

  test('handoff CLI creates the synthetic database/export mapping without running COLMAP', async () => {
    await prepareRun(manifest, runsRoot);
    await handoffDatabase();
    const exported = await workingExport();
    const initial = spawnSync(
      process.execPath,
      [
        join(packageRoot, 'scripts/refiner-experiment.mjs'),
        'handoff',
        runDirectory,
      ],
      { encoding: 'utf8', cwd: scratch }
    );
    expect(initial.status, initial.stderr).toBe(0);
    const result = spawnSync(
      process.execPath,
      [
        join(packageRoot, 'scripts/refiner-experiment.mjs'),
        'handoff',
        runDirectory,
        exported,
      ],
      { encoding: 'utf8', cwd: scratch }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Handoff');
    const mappingPath = result.stdout
      .split(/\r?\n/)
      .find((line) => line.startsWith('Pose table: '))!
      .slice('Pose table: '.length);
    expect(mappingPath).not.toBe(join(runDirectory, 'poses.json'));
    expect(
      JSON.parse(await readFile(mappingPath, 'utf8'))[0].returnedImageId
    ).toBe(101);
  });
});

describe('slice 3 deterministic epipolar scorer', () => {
  test('computes known pixel residuals, even median, nearest-rank p90 and inlier-only coverage', () => {
    const model = scoringModel();
    const matches = frozenMatches([0, 1, 2, 4]);
    const before = structuredClone({ model, matches });
    const result = scoreModels(model, null, matches, scoringSettings());
    const metrics = result.before.pairs[0]!.metrics!;
    expect(metrics.errorsPx).toEqual([0, 1, 2, 4]);
    expect(metrics.medianPx).toBe(1.5);
    expect(metrics.p90Px).toBe(4);
    expect(metrics.inlierCount).toBe(3);
    expect(metrics.inlierRatio).toBe(0.75);
    expect(metrics.coverage).toEqual([0.25, 0.25]);
    expect(result.before.medianOfPairMediansPx).toBe(1.5);
    expect(result.after).toBeNull();
    expect(result.safetyEvaluated).toBe(false);
    expect({ model, matches }).toEqual(before);
  });

  test('uses W2C relative rotation and both cameras intrinsics, not a fitted matrix', () => {
    const model = scoringModel();
    model.cameras.push({
      cameraId: 8,
      model: 'PINHOLE',
      width: 100,
      height: 100,
      intrinsics: { fx: 20, fy: 20, cx: 7, cy: 9 },
    });
    model.images[1]!.cameraId = 8;
    model.images[1]!.pose = {
      qvec: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      tvec: [1, 0, 0],
    };
    const matches = frozenMatches([0]);
    // X=(1,2,10): a=(9,8), b=(5,11). Moving b.y by 2 gives
    // distance 2 in b and 1 in a, hence symmetric distance 1.5.
    matches.pairs[0]!.matches[0]!.xy = [
      [9, 8],
      [5, 13],
    ];
    // Keep this frozen keypoint's identity/coordinate consistent across pairs.
    matches.pairs[1]!.matches[0]!.xy[0] = [5, 13];
    matches.pairs[2]!.matches[0]!.xy[0] = [9, 8];
    const result = scoreModels(model, null, matches, scoringSettings());
    expect(result.before.pairs[0]!.metrics!.errorsPx[0]).toBeCloseTo(1.5, 12);
    // A common nonidentity world-to-camera transform must cancel in relative poses.
    const transformed = scoringModel();
    transformed.images.forEach((image) => {
      image.pose.qvec = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
      image.pose.tvec[1] = 3;
    });
    expect(
      scoreModels(transformed, null, frozenMatches([1]), scoringSettings())
        .before.pairs[0]!.metrics!.medianPx
    ).toBeCloseTo(1, 12);
  });

  test('does not claim to establish translation scale or sign from epipolar scores', () => {
    const original = scoringModel();
    for (const scale of [10, -1, 1e-12]) {
      const candidate = structuredClone(original);
      candidate.images.forEach((image) => {
        image.pose.tvec = image.pose.tvec.map((v) => v * scale);
      });
      const result = scoreModels(
        original,
        candidate,
        frozenMatches([1, 2]),
        scoringSettings()
      );
      expect(result.after!.medianOfPairMediansPx).toBeCloseTo(
        result.before.medianOfPairMediansPx!,
        12
      );
      expect(result.comparison!.aggregateImproved).toBe(false);
      expect(result.safetyEvaluated).toBe(false);
    }
  });

  test('keeps zero baseline, epipoles, nonfinite geometry, outside pixels and insufficient support inconclusive', () => {
    const zero = scoringModel();
    zero.images[1]!.pose.tvec = [0, 0, 0];
    const epipole = scoringModel();
    epipole.images[1]!.pose.tvec = [0, 0, 1];
    const nonfinite = scoringModel();
    nonfinite.images[1]!.pose.tvec = [Infinity, 0, 0];
    const cases = [
      { model: zero, matches: frozenMatches([0]), settings: scoringSettings() },
      {
        model: epipole,
        matches: frozenMatches([0], [8, 6]),
        settings: scoringSettings(),
      },
      {
        model: nonfinite,
        matches: frozenMatches([0]),
        settings: scoringSettings(),
      },
      {
        model: scoringModel(),
        matches: frozenMatches([0], [16, 1]),
        settings: scoringSettings(),
      },
      {
        model: scoringModel(),
        matches: frozenMatches([0], [NaN, 1]),
        settings: scoringSettings(),
      },
      {
        model: scoringModel(),
        matches: frozenMatches([]),
        settings: scoringSettings(),
      },
      {
        model: scoringModel(),
        matches: frozenMatches([0]),
        settings: { ...scoringSettings(), minVerifiedMatches: 2 },
      },
      {
        model: scoringModel(),
        matches: frozenMatches([0]),
        settings: { ...scoringSettings(), numericEpsilon: 1 },
      },
    ];
    for (const { model, matches, settings } of cases) {
      const result = scoreModels(model, null, matches, settings);
      expect(result.before.pairs[0]!.status).toBe('inconclusive');
      expect(result.before.pairs).toHaveLength(3);
      expect(result.before.medianOfPairMediansPx).toBeNull();
    }
  });

  test('keeps a required-pair regression veto when the aggregate and pooled median improve', () => {
    const before = scoringModel();
    before.images[1]!.pose.tvec = [1, 1, 0];
    before.images[2]!.pose.tvec = [2, 2, 0];
    const after = scoringModel();
    const matches = frozenMatches([0]);
    matches.pairs.forEach((pair, i) => {
      pair.matches = Array.from({ length: i === 2 ? 1 : 10 }, (_, k) => ({
        keypointIndices: [i * 20 + k, i * 20 + k],
        xy: (i === 2
          ? [
              [1, 1],
              [3, 3],
            ]
          : [
              [1, 1],
              [5, 1],
            ]) as [[number, number], [number, number]],
      }));
    });
    const result = scoreModels(before, after, matches, {
      ...scoringSettings(),
      inlierThresholdPx: 10,
    });
    expect(result.comparison!.aggregateImproved).toBe(true);
    expect(result.before.medianOfPairMediansPx).toBeCloseTo(Math.SQRT2 * 2);
    expect(result.after!.medianOfPairMediansPx).toBe(0);
    expect(result.comparison!.pairs[2]!.vetoes).toContain('median regression');
    expect(result.comparison!.pairs[2]!.vetoes).toContain('p90 regression');
  });

  test('vetoes lost inlier cells in each image independently using the full frozen population', () => {
    const before = scoringModel();
    const after = scoringModel();
    after.images[1]!.pose.tvec = [1, 1, 0];
    const matches = frozenMatches([0]);
    matches.pairs[0]!.matches = [
      {
        keypointIndices: [10, 10],
        xy: [
          [1, 1],
          [2, 2],
        ],
      },
      {
        keypointIndices: [11, 11],
        xy: [
          [9, 7],
          [13, 7],
        ],
      },
    ];
    const result = scoreModels(before, after, matches, {
      ...scoringSettings(),
      inlierThresholdPx: 1.1,
    });
    expect(result.before.pairs[0]!.metrics!.coverage).toEqual([0.5, 0.5]);
    expect(result.after!.pairs[0]!.metrics!.coverage).toEqual([0.25, 0.25]);
    expect(result.after!.pairs[0]!.count).toBe(2);
    expect(result.comparison!.pairs[0]!.vetoes).toEqual(
      expect.arrayContaining([
        'inlier ratio drop',
        'first-image coverage drop',
        'second-image coverage drop',
      ])
    );
    matches.pairs[0]!.matches = [
      {
        keypointIndices: [10, 10],
        xy: [
          [1, 1],
          [2, 1],
        ],
      },
      {
        keypointIndices: [11, 11],
        xy: [
          [9, 1],
          [3, 1],
        ],
      },
    ];
    const asymmetric = scoreModels(before, after, matches, {
      ...scoringSettings(),
      inlierThresholdPx: 1.1,
    });
    expect(asymmetric.before.pairs[0]!.metrics!.coverage).toEqual([0.5, 0.25]);
    expect(asymmetric.comparison!.pairs[0]!.vetoes).toContain(
      'first-image coverage drop'
    );
    expect(asymmetric.comparison!.pairs[0]!.vetoes).not.toContain(
      'second-image coverage drop'
    );
  });

  test('rejects changed names, missing/duplicate pairs and inconsistent frozen keypoint identities', () => {
    const model = scoringModel();
    const variants = [
      frozenMatches([0]),
      frozenMatches([0]),
      frozenMatches([0]),
      frozenMatches([0]),
    ];
    variants[0]!.pairs[0]!.images[0] = 'A.jpg';
    variants[1]!.pairs.pop();
    variants[2]!.pairs.push(structuredClone(variants[2]!.pairs[0]!));
    variants[3]!.pairs[1]!.matches[0]!.xy[0] = [2, 2];
    variants[3]!.pairs[1]!.matches[0]!.keypointIndices[0] = 0;
    for (const matches of variants)
      expect(() =>
        scoreModels(model, null, matches, scoringSettings())
      ).toThrow(/correspondences/);
    const duplicate = frozenMatches([0]);
    duplicate.pairs[0]!.matches.push(
      structuredClone(duplicate.pairs[0]!.matches[0]!)
    );
    expect(() =>
      scoreModels(model, null, duplicate, scoringSettings())
    ).toThrow(/keypoint/);
    expect(() =>
      scoreModels(model, null, frozenMatches([0]), {
        ...scoringSettings(),
        numericEpsilon: 'pending',
      })
    ).toThrow('numericEpsilon');
  });

  test('score CLI freezes baseline evidence, compares a later export, and rejects policy/hash changes and overwrite', async () => {
    await prepareRun(manifest, runsRoot);
    await handoffDatabase();
    await handoffRun(runDirectory);
    const baselineDirectory = join(runDirectory, 'exports/triangulated');
    await mkdir(baselineDirectory, { recursive: true });
    for (const name of ['cameras.txt', 'images.txt'])
      await writeFile(
        join(baselineDirectory, name),
        await readFile(join(runDirectory, 'models/known', name))
      );
    const matches = frozenMatches([0, 1, 2, 4]);
    const bytes = Buffer.from(JSON.stringify(matches));
    await mkdir(join(runDirectory, 'metrics'));
    await writeFile(join(runDirectory, 'metrics/correspondences.json'), bytes);
    const scoringManifest = {
      ...manifest,
      ...scoringSettings(),
      metricFormula: 'Plan section 8 symmetric point-to-line pixel distance',
      pixelConvention: 'Synthetic continuous original-resolution pixels',
      correspondenceFile: {
        path: 'metrics/correspondences.json',
        hash: hash(bytes),
      },
    };
    await writeFile(
      join(runDirectory, 'manifest.json'),
      JSON.stringify(scoringManifest)
    );
    const cli = spawnSync(
      process.execPath,
      [
        join(packageRoot, 'scripts/refiner-experiment.mjs'),
        'score',
        runDirectory,
      ],
      { cwd: scratch, encoding: 'utf8' }
    );
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout).toContain('Score report:');
    const baselinePath = join(runDirectory, 'metrics/scores-baseline.json');
    const baselineBytes = await readFile(baselinePath);
    const candidate = await workingExport();
    const result = await scoreRun(runDirectory, candidate);
    expect(result.report.after!.medianOfPairMediansPx).toBe(1.5);
    expect(await readFile(baselinePath)).toEqual(baselineBytes);
    await expect(scoreRun(runDirectory, candidate)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    await writeFile(
      join(runDirectory, 'manifest.json'),
      JSON.stringify({ ...scoringManifest, inlierThresholdPx: 3 })
    );
    await expect(scoreRun(runDirectory, candidate)).rejects.toThrow(
      /frozen baseline/
    );
    await writeFile(
      join(runDirectory, 'manifest.json'),
      JSON.stringify(scoringManifest)
    );
    await writeFile(join(runDirectory, 'metrics/correspondences.json'), '{}');
    await expect(scoreRun(runDirectory, candidate)).rejects.toThrow(
      'correspondenceFile.hash'
    );
    expect(await readFile(baselinePath)).toEqual(baselineBytes);
  });
});

describe('slice 4 gauge and pose safety', () => {
  test('recovers a known DLT point, W2C depths, centres and ray angle without changing inputs', () => {
    const model = safetyModel();
    const matches = safetyMatches();
    const saved = structuredClone({ model, matches });
    const result = safetyModels(model, model, null, matches, safetySettings());
    expect(result.before.passed, JSON.stringify(result.before)).toBe(true);
    const pair = result.before.pairs[0]!;
    expect(pair.count).toBe(2);
    expect(pair.positiveDepthRatio).toBe(1);
    expect(pair.samples[0]!.point![0]).toBeCloseTo(0, 10);
    expect(pair.samples[0]!.point![1]).toBeCloseTo(0, 10);
    expect(pair.samples[0]!.point![2]).toBeCloseTo(5, 10);
    expect(pair.samples[0]!.depths![0]).toBeCloseTo(5, 10);
    expect(pair.samples[0]!.depths![1]).toBeCloseTo(5, 10);
    expect(pair.samples[0]!.parallaxDegrees).toBeCloseTo(
      (Math.atan(1 / 5) * 180) / Math.PI,
      10
    );
    expect(result.before.poses[1]!.centre).toEqual([-1, 0, 0]);
    expect(result.before.support.components).toEqual([manifest.imageNames]);
    expect({ model, matches }).toEqual(saved);
  });

  test('blocks global translation, rotation, scale and translation-sign changes even with unchanged epipolar scores', () => {
    const original = safetyModel();
    for (const kind of ['translation', 'rotation', 'scale', 'sign']) {
      const candidate = structuredClone(original);
      candidate.images.forEach((image) => {
        if (kind === 'translation') image.pose.tvec[1] = 3;
        if (kind === 'rotation')
          image.pose.qvec = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
        if (kind === 'scale' || kind === 'sign')
          image.pose.tvec = image.pose.tvec.map(
            (v) => v * (kind === 'scale' ? 2 : -1)
          );
      });
      const result = safetyModels(
        original,
        original,
        candidate,
        safetyMatches(),
        safetySettings()
      );
      expect(result.after!.passed, kind).toBe(false);
      if (kind !== 'sign')
        expect(result.after!.issues.join(' '), kind).toMatch(/anchor|scale/);
      if (kind === 'sign')
        expect(result.after!.pairs[0]!.positiveDepthRatio).toBe(0);
    }
  });

  test('triangulates with rotated W2C cameras and unequal intrinsics rather than treating tvec as the centre', () => {
    const model = safetyModel();
    const matches = safetyMatches();
    model.cameras.push({
      cameraId: 8,
      model: 'PINHOLE',
      width: 30,
      height: 30,
      intrinsics: { fx: 12, fy: 15, cx: 8, cy: 6 },
    });
    const rotated = model.images[1]!;
    rotated.cameraId = 8;
    rotated.pose = {
      qvec: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      tvec: [0, 1, 0],
    };
    matches.pairs.forEach((pair) =>
      pair.matches.forEach((match, k) =>
        pair.images.forEach((name, side) => {
          if (name === 'b.jpg') {
            const xy: [number, number] = [
              8 - (12 * k * 0.5) / 5,
              6 + (15 * (1 + k * 0.5)) / 5,
            ];
            match.xy[side] = xy;
            const observation =
              rotated.observations[match.keypointIndices[side]!]!;
            observation[0] = xy[0];
            observation[1] = xy[1];
          }
        })
      )
    );
    const result = safetyModels(model, model, null, matches, {
      ...safetySettings(),
      sequentialTurnLimits: { max: 91 }, // This fixture deliberately rotates one camera by 90 degrees.
    });
    expect(result.before.passed, result.before.issues.join(' ')).toBe(true);
    expect(result.before.trajectory[0]!.rotationDegrees).toBeCloseTo(90, 10);
    result.before.pairs.forEach((pair) =>
      pair.samples.forEach((sample, k) => {
        expect(sample.point![0]).toBeCloseTo(k * 0.5, 10);
        expect(sample.point![1]).toBeCloseTo(k * 0.5, 10);
        expect(sample.point![2]).toBeCloseTo(5, 10);
        expect(sample.depths![0]).toBeCloseTo(5, 10);
        expect(sample.depths![1]).toBeCloseTo(5, 10);
      })
    );
    expect(result.before.poses[1]!.centre![0]).toBeCloseTo(-1, 12);
    expect(result.before.poses[1]!.centre![1]).toBeCloseTo(0, 12);
  });

  test('rejects invalid quaternion/tvec values without normalization, but accepts quaternion sign equivalence', () => {
    const model = safetyModel();
    for (const pose of [
      { qvec: [2, 0, 0, 0], tvec: [0, 0, 0] },
      { qvec: [1, 0, 0, 0], tvec: [NaN, 0, 0] },
      { qvec: [1, 0, 0], tvec: [0, 0, 0] },
      { qvec: [1, 0, 0, 0], tvec: [0, 0] },
      { qvec: [0, 0, 0, 1], tvec: [0, 0, 0] }, // XYZW passed as WXYZ.
    ]) {
      const candidate = structuredClone(model);
      candidate.images[0]!.pose = pose;
      expect(
        safetyModels(model, model, candidate, safetyMatches(), safetySettings())
          .after!.passed
      ).toBe(false);
      expect(candidate.images[0]!.pose).toEqual(pose);
    }
    const equivalent = structuredClone(model);
    equivalent.images.forEach((image) => {
      image.pose.qvec = [-1, 0, 0, 0];
    });
    expect(
      safetyModels(model, model, equivalent, safetyMatches(), safetySettings())
        .after!.passed
    ).toBe(true);
  });

  test('retains failed, low-parallax and negative-depth matches in the full denominator and vetoes lost support', () => {
    const model = safetyModel();
    const candidate = structuredClone(model);
    candidate.images[1]!.pose.tvec = [-1, 0, 0];
    const result = safetyModels(
      model,
      model,
      candidate,
      safetyMatches(),
      safetySettings()
    );
    expect(result.after!.pairs[0]!.count).toBe(2);
    expect(result.after!.pairs[0]!.samples).toHaveLength(2);
    expect(result.after!.pairs[0]!.positiveDepthRatio).toBe(0);
    expect(result.pairVetoes[0]!.vetoes).toContain(
      'positive-depth support loss'
    );
    for (const xy of [
      [8, 6],
      [NaN, 6],
      [16, 6],
    ] as [number, number][]) {
      const matches = safetyMatches();
      matches.pairs[0]!.matches[0]!.xy[1] = xy;
      const changed = structuredClone(model);
      changed.images[1]!.observations[0] = [...xy, 100];
      const checked = safetyModels(
        model,
        changed,
        null,
        matches,
        safetySettings()
      );
      expect(checked.before.passed).toBe(false);
      expect(checked.before.pairs[0]!.count).toBe(2);
      expect(checked.before.pairs[0]!.positiveDepthRatio).toBe(0.5);
    }
    const low = safetyModels(model, model, null, safetyMatches(), {
      ...safetySettings(),
      minParallaxDegrees: 80,
    });
    expect(low.before.pairs[0]!.parallaxRatio).toBe(0);
    expect(low.before.passed).toBe(false);
    const zero = structuredClone(model);
    zero.images[1]!.pose.tvec = [0, 0, 0];
    expect(
      safetyModels(model, zero, null, safetyMatches(), safetySettings()).before
        .passed
    ).toBe(false);
  });

  test('requires reciprocal working tracks and connected support, not just registered images or matches', () => {
    const model = safetyModel();
    const disconnected = structuredClone(model);
    disconnected.tracks = [];
    disconnected.images.forEach((image) => {
      image.observations.forEach((observation) => {
        observation[2] = -1;
      });
    });
    const checked = safetyModels(
      model,
      disconnected,
      null,
      safetyMatches(),
      safetySettings()
    );
    expect(checked.before.support.components).toHaveLength(3);
    expect(
      checked.before.support.pairs.every((pair) => pair.trackCount === 0)
    ).toBe(true);
    expect(checked.before.passed).toBe(false);
    const broken = structuredClone(model);
    broken.tracks[0]!.observations.pop();
    expect(() =>
      safetyModels(model, broken, null, safetyMatches(), safetySettings())
    ).toThrow(/reciprocal/);
    const changed = structuredClone(model);
    changed.images[0]!.observations[0]![0] += 0.1;
    expect(() =>
      safetyModels(model, changed, null, safetyMatches(), safetySettings())
    ).toThrow(/coordinate/);
    const near = structuredClone(model);
    near.images[1]!.pose.tvec = [1e-14, 0, 0];
    expect(
      safetyModels(model, near, null, safetyMatches(), safetySettings()).before
        .pairs[0]!.failures
    ).toBe(2);
  });

  test('checks all chronological poses for jumps, turns and fixed-pose triangulation drift', () => {
    const model = safetyModel();
    const jump = structuredClone(model);
    jump.images[2]!.pose.tvec = [10, 0, 0];
    const result = safetyModels(
      model,
      model,
      jump,
      safetyMatches(),
      safetySettings()
    );
    expect(result.after!.issues.join(' ')).toMatch(/centre delta/);
    expect(result.after!.issues.join(' ')).toMatch(/sequential step/);
    const turn = structuredClone(model);
    turn.images[2]!.pose.tvec = [1, 1, 0];
    expect(
      safetyModels(model, model, turn, safetyMatches(), {
        ...safetySettings(),
        maxCentreDelta: 10,
      }).after!.issues.join(' ')
    ).toMatch(/sequential turn/);
    const drift = structuredClone(model);
    drift.images[2]!.pose.tvec[0] = drift.images[2]!.pose.tvec[0]! + 0.01;
    expect(
      safetyModels(
        model,
        drift,
        null,
        safetyMatches(),
        safetySettings()
      ).before.issues.join(' ')
    ).toMatch(/fixed-pose triangulation/);
  });

  test('safety CLI closes only an evidenced pre-BA gate and preserves its frozen manifest and reports', async () => {
    const { completed, directory, baselineHashes } = await safetyFixture();
    const cli = spawnSync(
      process.execPath,
      [
        join(packageRoot, 'scripts/refiner-experiment.mjs'),
        'safety',
        runDirectory,
      ],
      { cwd: scratch, encoding: 'utf8' }
    );
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout).toContain('Pre-BA gate: pass');
    const frozenPath = join(runDirectory, 'metrics/safety-baseline.json');
    const frozen = await readFile(frozenPath);
    const report = JSON.parse(frozen.toString('utf8'));
    expect(report.preBaPassed).toBe(true);
    expect(report.manifestSha256).toBe(
      hash(await readFile(join(runDirectory, 'manifest.json')))
    );
    expect(report.baseline.hashes).toEqual(baselineHashes);
    const candidateDirectory = join(scratch, 'safe-candidate');
    await mkdir(candidateDirectory);
    for (const name of ['cameras.txt', 'images.txt', 'points3D.txt'])
      await writeFile(
        join(candidateDirectory, name),
        await readFile(join(directory, name))
      );
    await writeFile(
      join(candidateDirectory, 'gauge-evidence.json'),
      JSON.stringify(gaugeEvidence(completed, baselineHashes, 'adjusted'))
    );
    const candidate = await safetyRun(runDirectory, candidateDirectory);
    expect(candidate.report.passed).toBe(true);
    expect(await readFile(frozenPath)).toEqual(frozen);
    await expect(
      safetyRun(runDirectory, candidateDirectory)
    ).rejects.toMatchObject({ code: 'EEXIST' });
    await rm(join(candidateDirectory, 'gauge-evidence.json'));
    const missing = await safetyRun(runDirectory, candidateDirectory);
    expect(missing.report.preBaPassed).toBe(true);
    expect(missing.report.passed).toBe(false);
    expect(missing.report.evidenceIssues.join(' ')).toContain(
      'missing gauge evidence'
    );
    await writeFile(
      join(runDirectory, 'manifest.json'),
      JSON.stringify({ ...completed, maxCentreDelta: 100 })
    );
    await expect(safetyRun(runDirectory, candidateDirectory)).rejects.toThrow(
      /frozen/
    );
    expect(await readFile(frozenPath)).toEqual(frozen);
  });

  test('keeps preparation settings frozen and only completes explicitly pending fields', async () => {
    const { completed } = await safetyFixture({
      minParallaxDegrees: 1,
      gaugeAnchors: {
        images: ['a.jpg', 'b.jpg'],
        constrainedQuantities: 'pending',
      },
    });
    const receiptPath = join(runDirectory, 'logs/preparation.json');
    const receiptBytes = await readFile(receiptPath);
    const manifestPath = join(runDirectory, 'manifest.json');
    for (const [field, replacement] of Object.entries({
      exhaustiveTimeLimit: 999999,
      siftBackend: 'GPU',
      resourceLimits: { ...completed.resourceLimits, maxMemoryBytes: 999999 },
      commands: [{ ...completed.commands[0], args: ['different-command'] }],
      nonDefaultSettings: { newlyAdded: true },
      sequentialPairs: [...completed.sequentialPairs].reverse(),
      minParallaxDegrees: 2,
      gaugeAnchors: { ...completed.gaugeAnchors, images: ['b.jpg', 'a.jpg'] },
      undeclaredField: true,
    })) {
      await writeFile(
        manifestPath,
        JSON.stringify({ ...completed, [field]: replacement })
      );
      await expect(safetyRun(runDirectory), field).rejects.toThrow(
        'frozen preparation'
      );
      await expect(scoreRun(runDirectory), field).rejects.toThrow(
        'frozen preparation'
      );
      await expect(handoffRun(runDirectory), field).rejects.toThrow(
        'frozen preparation'
      );
    }
    await expect(
      readFile(join(runDirectory, 'metrics/safety-baseline.json'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(manifestPath, JSON.stringify(completed));
    const result = await safetyRun(runDirectory);
    expect(result.report.preBaPassed).toBe(true);
    expect(result.report.preparationSha256).toBe(hash(receiptBytes));
    expect(await readFile(receiptPath)).toEqual(receiptBytes);
    const snapshot = JSON.parse(receiptBytes.toString('utf8')).manifest;
    expect(snapshot.gaugeAnchors.constrainedQuantities).toBe('pending');
    expect(snapshot.minParallaxDegrees).toBe(1);
  });

  test('refuses to infer a preparation snapshot for an older or incomplete run', async () => {
    await safetyFixture();
    const receiptPath = join(runDirectory, 'logs/preparation.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    delete receipt.manifest;
    await writeFile(receiptPath, JSON.stringify(receipt));
    await expect(safetyRun(runDirectory)).rejects.toThrow(
      /preparation snapshot/
    );
    await rm(receiptPath);
    await expect(safetyRun(runDirectory)).rejects.toThrow(
      /preparation snapshot/
    );
    await expect(
      readFile(join(runDirectory, 'metrics/safety-baseline.json'))
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(receiptPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('does not close pre-BA with missing, stale or unsupported gauge evidence or an unverified evidence hash', async () => {
    const { completed, baselineHashes } = await safetyFixture();
    const gaugePath = join(runDirectory, 'metrics/gauge-baseline.json');
    const originalGauge = await readFile(gaugePath);
    for (const gauge of [
      {
        ...gaugeEvidence(completed, baselineHashes, 'triangulated'),
        verified: false,
      },
      {
        ...gaugeEvidence(completed, baselineHashes, 'triangulated'),
        exportHashes: {},
      },
      {
        ...gaugeEvidence(completed, baselineHashes, 'triangulated'),
        constraint: 'unverified-native-default',
      },
    ]) {
      const bytes = Buffer.from(JSON.stringify(gauge));
      await writeFile(gaugePath, bytes);
      await writeFile(
        join(runDirectory, 'manifest.json'),
        JSON.stringify({
          ...completed,
          baselineEvidenceHashes: {
            ...completed.baselineEvidenceHashes,
            'metrics/gauge-baseline.json': hash(bytes),
          },
        })
      );
      const result = await safetyRun(runDirectory);
      expect(result.report.preBaPassed).toBe(false);
      expect(result.report.evidenceIssues.join(' ')).toMatch(/gauge/);
      await expect(
        readFile(join(runDirectory, 'metrics/safety-baseline.json'))
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await writeFile(gaugePath, originalGauge);
    await writeFile(
      join(runDirectory, 'manifest.json'),
      JSON.stringify(completed)
    );
    await rm(gaugePath);
    const missing = await safetyRun(runDirectory);
    expect(missing.report.preBaPassed).toBe(false);
    expect(missing.report.evidenceIssues.join(' ')).toContain(
      'missing gauge evidence'
    );
    await writeFile(gaugePath, originalGauge);
    await writeFile(
      join(runDirectory, 'manifest.json'),
      JSON.stringify({
        ...completed,
        intrinsicsByStage: {
          synthetic: { ...completed.intrinsicsByStage.synthetic, fx: 11 },
        },
      })
    );
    await expect(safetyRun(runDirectory)).rejects.toThrow(/intrinsics/);
    await writeFile(
      join(runDirectory, 'manifest.json'),
      JSON.stringify(completed)
    );
    await writeFile(join(runDirectory, 'evidence/settings.txt'), 'changed');
    await expect(safetyRun(runDirectory)).rejects.toThrow(/evidence.*hash/i);
  });
});

function safetySettings() {
  return {
    ...scoringSettings(),
    minBATracks: 1,
    minBAObservations: 2,
    sequentialStepLimits: { max: 2 },
    sequentialTurnLimits: { max: 30 },
  };
}

function safetyMatches() {
  const names = ['a.jpg', 'b.jpg', 'c.jpg'];
  return {
    pairs: [...manifest.sequentialPairs, ...manifest.loopPairs].map(
      (pair, p) => ({
        ...pair,
        matches: [0, 1].map((k) => ({
          keypointIndices: [p * 2 + k, p * 2 + k],
          xy: pair.images.map((name) => [
            8 + 2 * names.indexOf(name) + k,
            6 + k,
          ]) as [[number, number], [number, number]],
        })),
      })
    ),
  };
}

function safetyModel() {
  const base = scoringModel();
  const images = base.images.map((image) => ({
    ...image,
    observations: Array.from({ length: 6 }, (): [number, number, number] => [
      0, 0, -1,
    ]),
  }));
  const tracks = safetyMatches().pairs.flatMap((pair, p) =>
    pair.matches.map((match, k) => {
      const pointId = 100 + p * 2 + k;
      const observations = pair.images.map((name, side): [number, number] => {
        const image = images.find((entry) => entry.name === name)!;
        const index = match.keypointIndices[side]!;
        image.observations[index] = [...match.xy[side]!, pointId];
        return [image.imageId, index];
      });
      return { pointId, observations };
    })
  );
  return { cameras: base.cameras, images, tracks };
}

function gaugeEvidence(
  completed: Pick<
    ReturnType<typeof safetySettings>,
    'input' | 'colmap' | 'gaugeAnchors'
  >,
  exportHashes: Record<string, string>,
  stage: string
) {
  return {
    inputSha256: completed.input.sha256,
    colmap: completed.colmap,
    anchors: completed.gaugeAnchors,
    stage,
    exportHashes,
    verified: true,
    evidencePaths: ['evidence/settings.txt'],
    // Supported gauge: first anchor pose plus distances to the other anchors.
    constraint: 'first-pose-and-anchor-distances',
  };
}

async function safetyFixture(preparation: Record<string, unknown> = {}) {
  await prepareRun({ ...manifest, ...preparation }, runsRoot);
  const directory = join(runDirectory, 'exports/triangulated');
  await mkdir(directory, { recursive: true });
  await mkdir(join(runDirectory, 'metrics'));
  const model = safetyModel();
  const contents = {
    'cameras.txt': '3 PINHOLE 16 12 10 10 8 6\n',
    'images.txt': model.images
      .map(
        (image) =>
          `${[image.imageId, ...image.pose.qvec, ...image.pose.tvec, image.cameraId, image.name].join(' ')}\n${image.observations.flat().join(' ')}\n`
      )
      .join(''),
    'points3D.txt': model.tracks
      .map(
        (track) =>
          `${track.pointId} 0 0 5 0 0 0 0 ${track.observations.flat().join(' ')}\n`
      )
      .join(''),
  };
  const baselineHashes: Record<string, string> = {};
  for (const [name, content] of Object.entries(contents)) {
    await writeFile(join(directory, name), content);
    baselineHashes[name] = hash(Buffer.from(content));
  }
  const bytes = Buffer.from(JSON.stringify(safetyMatches()));
  await writeFile(join(runDirectory, 'metrics/correspondences.json'), bytes);
  const settings = Buffer.from(
    'Synthetic gauge/settings evidence, not a real COLMAP run.'
  );
  await writeFile(join(runDirectory, 'evidence/settings.txt'), settings);
  const gauge = Buffer.from(
    JSON.stringify(
      gaugeEvidence(safetySettings(), baselineHashes, 'triangulated')
    )
  );
  await writeFile(join(runDirectory, 'metrics/gauge-baseline.json'), gauge);
  const completed = {
    ...safetySettings(),
    correspondenceFile: {
      path: 'metrics/correspondences.json',
      hash: hash(bytes),
    },
    behaviorEvidence: ['evidence/settings.txt'],
    effectiveSettingsEvidence: ['evidence/settings.txt'],
    baselineEvidenceHashes: {
      'evidence/settings.txt': hash(settings),
      'metrics/gauge-baseline.json': hash(gauge),
    },
  };
  await writeFile(
    join(runDirectory, 'manifest.json'),
    JSON.stringify(completed)
  );
  await scoreRun(runDirectory);
  return { completed, directory, baselineHashes };
}

function scoringModel() {
  return {
    cameras: [
      {
        cameraId: 3,
        model: 'PINHOLE' as const,
        width: 16,
        height: 12,
        intrinsics: { fx: 10, fy: 10, cx: 8, cy: 6 },
      },
    ],
    images: [9, 2, 7].map((imageId, i) => ({
      imageId,
      cameraId: 3,
      name: ['a.jpg', 'b.jpg', 'c.jpg'][i]!,
      pose: { qvec: [1, 0, 0, 0], tvec: [i, 0, 0] },
    })),
  };
}

function scoringSettings() {
  return {
    ...completedManifest(),
    minVerifiedMatches: 1,
    coverageGridRows: 2,
    coverageGridColumns: 2,
    minCoverageEachImage: 0.25,
  };
}

function frozenMatches(errors: number[], xy: [number, number] = [1, 1]) {
  return {
    pairs: [...manifest.sequentialPairs, ...manifest.loopPairs].map(
      (pair, p) => ({
        ...pair,
        images: [...pair.images],
        matches: errors.map((error, i) => ({
          keypointIndices: [p * 100 + i, p * 100 + i],
          xy: [[...xy], [xy[0], xy[1] + error]] as [
            [number, number],
            [number, number],
          ],
        })),
      })
    ),
  };
}

async function handoffDatabase() {
  const directory = join(runDirectory, 'database');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'features.db');
  const db = new DatabaseSync(path);
  try {
    // Required COLMAP columns; constraints omitted so corruption can be tested.
    db.exec(
      'CREATE TABLE cameras (camera_id INTEGER, model INTEGER, width INTEGER, height INTEGER, params BLOB, prior_focal_length INTEGER); CREATE TABLE images (image_id INTEGER, name TEXT, camera_id INTEGER)'
    );
    const params = Buffer.alloc(32);
    [10, 10, 8, 6].forEach((value, i) => params.writeDoubleLE(value, i * 8));
    db.prepare('INSERT INTO cameras VALUES (41, 1, 16, 12, ?, 1)').run(params);
    for (const [id, name] of [
      [5, 'b.jpg'],
      [80, 'c.jpg'],
      [20, 'a.jpg'],
    ] as const) {
      db.prepare('INSERT INTO images VALUES (?, ?, 41)').run(id, name);
    }
  } finally {
    db.close();
  }
  return path;
}

async function workingExport() {
  const directory = join(scratch, 'returned');
  await mkdir(directory);
  await writeFile(
    join(directory, 'cameras.txt'),
    '# Camera list\n12 PINHOLE 16 12 10 10 8 6\n'
  );
  await writeFile(
    join(directory, 'images.txt'),
    '# Two lines per image\n202 1 0 0 0 2 0 0 12 c.jpg\n8 6 900\n101 1 0 0 0 0.25 0 0 12 a.jpg\n8 6 900 9 7 -1\n303 1 0 0 0 1 0 0 12 b.jpg\n\n'
  );
  await writeFile(
    join(directory, 'points3D.txt'),
    '900 1 2 3 4 5 6 0.2 202 0 101 0\n'
  );
  return directory;
}

function preparationManifest() {
  const sequentialPairs = [
    { images: ['a.jpg', 'b.jpg'], required: true },
    { images: ['b.jpg', 'c.jpg'], required: true },
  ];
  const loopPairs = [{ images: ['a.jpg', 'c.jpg'], required: true }];
  return {
    ...structuredClone(template),
    runId: `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
    input: { path: join(scratch, 'recording.zip'), sha256: hash(inputBytes) },
    imageNames: ['a.jpg', 'b.jpg', 'c.jpg'],
    chronologicalNames: ['a.jpg', 'b.jpg', 'c.jpg'],
    sequentialPairs,
    loopPairs,
    overlapEvidence: {
      paths: [join(scratch, 'baseline.png')],
      rationale: 'Synthetic loop overlap for tooling tests only.',
    },
    driftEvidence: {
      paths: [join(scratch, 'baseline.png')],
      rationale: 'Synthetic drift evidence; not a real experiment.',
    },
    colmap: {
      executable: 'synthetic-colmap',
      version: 'test',
      build: 'test-only',
      hash: '1'.repeat(64),
    },
    nodeVersion: process.version,
    os: 'synthetic',
    cpu: 'synthetic',
    gpu: 'none',
    siftBackend: 'CPU',
    offlineCheck: 'Synthetic fixture; no COLMAP is executed.',
    commands: [
      { executable: 'synthetic-colmap', args: ['test-only'], cwd: scratch },
    ],
    nonDefaultSettings: {},
    matchingStrategy: 'exhaustive, with declared pair-list fallback',
    exhaustiveTimeLimit: 60,
    resourceLimits: { maxMemoryBytes: 1048576, maxRuntimeSeconds: 120 },
    fallbackPairs: [...sequentialPairs, ...loopPairs],
  };
}

function completedManifest() {
  return {
    ...manifest,
    effectiveSettingsEvidence: ['synthetic/settings.txt'],
    intrinsicsByStage: {
      synthetic: {
        model: 'PINHOLE',
        width: 16,
        height: 12,
        fx: 10,
        fy: 10,
        cx: 8,
        cy: 6,
        cameraId: 3,
        refineFocalLength: false,
        refinePrincipalPoint: false,
        refineExtraParams: false,
      },
    },
    metricFormula: 'Plan section 8 symmetric point-to-line pixel distance',
    pixelConvention: 'Synthetic continuous pixels',
    correspondenceFile: {
      path: 'metrics/correspondences.json',
      hash: '2'.repeat(64),
    },
    minVerifiedMatches: 8,
    minBATracks: 4,
    minBAObservations: 8,
    minParallaxDegrees: 1,
    minPositiveDepthRatio: 0.9,
    depthEpsilon: 1e-8,
    inlierThresholdPx: 2,
    coverageGridRows: 4,
    coverageGridColumns: 4,
    minCoverageEachImage: 0.25,
    numericEpsilon: 1e-12,
    quaternionTolerance: 1e-6,
    improvementTolerancePx: 0.1,
    pairMedianRegressionPx: 0,
    pairP90RegressionPx: 0,
    maxInlierRatioDrop: 0,
    maxCoverageDrop: 0,
    gaugeAnchors: {
      images: ['a.jpg', 'b.jpg'],
      constrainedQuantities: ['origin', 'orientation', 'scale'],
    },
    behaviorEvidence: ['synthetic/gauge.txt'],
    scaleTolerance: 1e-6,
    originTolerance: 1e-6,
    orientationTolerance: 1e-6,
    maxCentreDelta: 0.1,
    maxRotationDelta: 0.1,
    sequentialStepLimits: { max: 1 },
    sequentialTurnLimits: { max: 1 },
    artifactPaths: { baseline: 'models/triangulated' },
    baselineEvidenceHashes: { synthetic: '3'.repeat(64) },
    freezeTime: '2026-09-10T00:00:00.000Z',
    filipApproval: 'synthetic test only',
    mingnaApproval: 'synthetic test only',
  };
}

function hash(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function recorderZip(extraModelImage = false) {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  const entries: [string, string | Uint8Array][] = [
    ['sparse/0/cameras.txt', '3 PINHOLE 16 12 10 10 8 6\n'],
    [
      'sparse/0/images.txt',
      '9 1 0 0 0 0 0 0 3 a.jpg\n\n2 1 0 0 0 1 0 0 3 b.jpg\n\n7 1 0 0 0 2 0 0 3 c.jpg\n\n' +
        (extraModelImage ? '10 1 0 0 0 3 0 0 3 extra.jpg\n\n' : ''),
    ],
    ['sparse/0/points3D.txt', '5 1 2 3 4 5 6 0\n'],
    ...['a.jpg', 'b.jpg', 'c.jpg', 'extra.jpg'].map(
      (name): [string, Uint8Array] => [`images/${name}`, pixels]
    ),
    ['session.json', '{"keep":true}'],
  ];
  for (const [path, content] of entries) {
    await writer.add(
      path,
      new Uint8ArrayReader(
        typeof content === 'string'
          ? new TextEncoder().encode(content)
          : content
      )
    );
  }
  return writer.close();
}
