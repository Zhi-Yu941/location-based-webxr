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
import { fileURLToPath } from 'node:url';
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { prepareRun, validateManifest } from './refiner-experiment.js';

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
