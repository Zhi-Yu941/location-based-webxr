import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { exactlyPreserved, readRecorderZip } from './colmap/index.js';
import { recorderZipAdapter } from './colmap/recorder-zip-adapter.js';

interface RequiredPair {
  images: [string, string];
  required: true;
}

interface SuitabilityEvidence {
  paths: string[];
  rationale: string;
}

/** Local experiment data only; this is not part of the ./colmap API. */
export interface ExperimentManifest extends Record<string, unknown> {
  runId: string;
  input: { path: string; sha256: string };
  imageNames: string[];
  chronologicalNames: string[];
  sequentialPairs: RequiredPair[];
  loopPairs: RequiredPair[];
  fallbackPairs: RequiredPair[];
  overlapEvidence: SuitabilityEvidence;
  driftEvidence: SuitabilityEvidence;
}

const preparationFields = [
  'runId',
  'input.path',
  'input.sha256',
  'imageNames',
  'chronologicalNames',
  'sequentialPairs',
  'loopPairs',
  'overlapEvidence.paths',
  'overlapEvidence.rationale',
  'driftEvidence.paths',
  'driftEvidence.rationale',
  'colmap.executable',
  'colmap.version',
  'colmap.build',
  'colmap.hash',
  'nodeVersion',
  'os',
  'cpu',
  'gpu',
  'siftBackend',
  'offlineCheck',
  'commands',
  'nonDefaultSettings',
  'matchingStrategy',
  'exhaustiveTimeLimit',
  'resourceLimits.maxMemoryBytes',
  'resourceLimits.maxRuntimeSeconds',
  'fallbackPairs',
];

const baselineFields = [
  'effectiveSettingsEvidence',
  'intrinsicsByStage',
  'metricFormula',
  'pixelConvention',
  'correspondenceFile.path',
  'correspondenceFile.hash',
  'minVerifiedMatches',
  'minBATracks',
  'minBAObservations',
  'minParallaxDegrees',
  'minPositiveDepthRatio',
  'depthEpsilon',
  'inlierThresholdPx',
  'coverageGridRows',
  'coverageGridColumns',
  'minCoverageEachImage',
  'numericEpsilon',
  'quaternionTolerance',
  'improvementTolerancePx',
  'pairMedianRegressionPx',
  'pairP90RegressionPx',
  'maxInlierRatioDrop',
  'maxCoverageDrop',
  'gaugeAnchors',
  'behaviorEvidence',
  'scaleTolerance',
  'originTolerance',
  'orientationTolerance',
  'maxCentreDelta',
  'maxRotationDelta',
  'sequentialStepLimits',
  'sequentialTurnLimits',
  'artifactPaths',
  'baselineEvidenceHashes',
  'freezeTime',
  'filipApproval',
  'mingnaApproval',
];

/** Completeness/shape gate only. Later slices establish the recorded evidence. */
export function validateManifest(
  value: unknown,
  phase: 'preparation' | 'pre-ba'
): asserts value is ExperimentManifest {
  if (phase !== 'preparation' && phase !== 'pre-ba') {
    throw new Error('Unknown manifest phase');
  }
  const manifest = object(value, 'manifest');
  for (const field of preparationFields) {
    filled(
      at(manifest, field),
      field,
      false,
      field === 'nonDefaultSettings' || field === 'commands'
    );
  }
  for (const field of baselineFields) {
    filled(at(manifest, field), field, phase === 'preparation');
  }
  for (const field of [
    'runId',
    'input.path',
    'colmap.executable',
    'colmap.version',
    'colmap.build',
    'nodeVersion',
    'os',
    'cpu',
    'gpu',
    'siftBackend',
    'offlineCheck',
    'matchingStrategy',
    'overlapEvidence.rationale',
    'driftEvidence.rationale',
  ]) {
    text(at(manifest, field), field);
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(
      String(manifest.runId)
    )
  ) {
    invalid(
      'runId',
      'expected a UTC timestamp (colons/dot replaced by hyphens) followed by a UUID'
    );
  }
  sha256Value(at(manifest, 'input.sha256'), 'input.sha256');
  sha256Value(at(manifest, 'colmap.hash'), 'colmap.hash');
  const names = strings(manifest.imageNames, 'imageNames');
  if (names.length < 2 || new Set(names).size !== names.length) {
    invalid('imageNames', 'expected at least two distinct exact filenames');
  }
  const chronologicalNames = strings(
    manifest.chronologicalNames,
    'chronologicalNames'
  );
  sameNames(names, chronologicalNames, 'chronologicalNames');
  for (const field of ['overlapEvidence.paths', 'driftEvidence.paths']) {
    strings(at(manifest, field), field);
  }
  const sequential = pairs(manifest.sequentialPairs, names, 'sequentialPairs');
  const expectedSequential = chronologicalNames
    .slice(1)
    .map((name, i) => pairKey([chronologicalNames[i]!, name]));
  sameNames(expectedSequential, sequential, 'sequentialPairs');
  const loops = pairs(manifest.loopPairs, names, 'loopPairs');
  const required = [...sequential, ...loops];
  if (new Set(required).size !== required.length) {
    invalid('loopPairs', 'loop and sequential pairs must be distinct');
  }
  sameNames(
    required,
    pairs(manifest.fallbackPairs, names, 'fallbackPairs'),
    'fallbackPairs'
  );
  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
    invalid('commands', 'expected expanded commands');
  }
  for (const [i, command] of manifest.commands.entries()) {
    const entry = object(command, `commands[${i}]`);
    text(entry.executable, `commands[${i}].executable`);
    text(entry.cwd, `commands[${i}].cwd`);
    if (
      !Array.isArray(entry.args) ||
      !entry.args.every((arg) => typeof arg === 'string')
    ) {
      invalid(`commands[${i}].args`, 'expected an argument array');
    }
  }
  object(manifest.nonDefaultSettings, 'nonDefaultSettings');
  for (const field of [
    'exhaustiveTimeLimit',
    'resourceLimits.maxMemoryBytes',
    'resourceLimits.maxRuntimeSeconds',
  ]) {
    number(at(manifest, field), field, 0, Infinity, true);
  }
  for (const field of [
    'minVerifiedMatches',
    'minBATracks',
    'minBAObservations',
    'coverageGridRows',
    'coverageGridColumns',
    'depthEpsilon',
    'inlierThresholdPx',
    'numericEpsilon',
    'improvementTolerancePx',
    'pairMedianRegressionPx',
    'pairP90RegressionPx',
    'scaleTolerance',
    'originTolerance',
    'orientationTolerance',
    'maxCentreDelta',
    'maxRotationDelta',
    'minParallaxDegrees',
    'minPositiveDepthRatio',
    'minCoverageEachImage',
    'maxInlierRatioDrop',
    'maxCoverageDrop',
    'quaternionTolerance',
  ]) {
    const limit = manifest[field];
    if (phase === 'preparation' && limit === 'pending') {
      continue;
    }
    const fraction = [
      'minPositiveDepthRatio',
      'minCoverageEachImage',
      'maxInlierRatioDrop',
      'maxCoverageDrop',
    ].includes(field);
    const integer = [
      'minVerifiedMatches',
      'minBATracks',
      'minBAObservations',
      'coverageGridRows',
      'coverageGridColumns',
    ].includes(field);
    const positive =
      integer ||
      [
        'minParallaxDegrees',
        'minPositiveDepthRatio',
        'minCoverageEachImage',
        'depthEpsilon',
        'inlierThresholdPx',
        'numericEpsilon',
        'quaternionTolerance',
      ].includes(field);
    const max = fraction
      ? 1
      : field === 'minParallaxDegrees'
        ? 180
        : field === 'quaternionTolerance'
          ? 1e-6
          : Infinity;
    number(limit, field, 0, max, positive);
    if (integer && !Number.isInteger(limit)) {
      invalid(field, 'expected a positive integer');
    }
  }
  if (phase === 'pre-ba') {
    for (const field of ['effectiveSettingsEvidence', 'behaviorEvidence']) {
      strings(manifest[field], field);
    }
    for (const [stage, value] of Object.entries(
      object(manifest.intrinsicsByStage, 'intrinsicsByStage')
    )) {
      text(stage, 'intrinsicsByStage');
      const field = `intrinsicsByStage.${stage}`;
      const camera = object(value, field);
      if (camera.model !== 'PINHOLE') {
        invalid(`${field}.model`, 'expected PINHOLE');
      }
      for (const key of ['width', 'height', 'cameraId']) {
        number(camera[key], `${field}.${key}`, 0, Infinity, true);
        if (!Number.isSafeInteger(camera[key])) {
          invalid(`${field}.${key}`, 'expected a positive safe integer');
        }
      }
      for (const key of ['fx', 'fy']) {
        number(camera[key], `${field}.${key}`, 0, Infinity, true);
      }
      for (const key of ['cx', 'cy']) {
        number(camera[key], `${field}.${key}`, -Infinity, Infinity, false);
      }
      for (const key of [
        'refineFocalLength',
        'refinePrincipalPoint',
        'refineExtraParams',
      ]) {
        if (camera[key] !== false) {
          invalid(`${field}.${key}`, 'refinement must be explicitly disabled');
        }
      }
    }
    const anchors = object(manifest.gaugeAnchors, 'gaugeAnchors');
    const anchorNames = strings(anchors.images, 'gaugeAnchors.images');
    if (
      anchorNames.length < 2 ||
      new Set(anchorNames).size !== anchorNames.length ||
      anchorNames.some((name) => !names.includes(name))
    ) {
      invalid(
        'gaugeAnchors.images',
        'expected distinct exact model filenames for at least two anchors'
      );
    }
    sameNames(
      ['origin', 'orientation', 'scale'],
      strings(
        anchors.constrainedQuantities,
        'gaugeAnchors.constrainedQuantities'
      ),
      'gaugeAnchors.constrainedQuantities'
    );
    for (const field of ['sequentialStepLimits', 'sequentialTurnLimits']) {
      const limits = object(manifest[field], field);
      number(limits.max, `${field}.max`, 0, Infinity, false);
    }
    for (const [name, path] of Object.entries(
      object(manifest.artifactPaths, 'artifactPaths')
    )) {
      text(name, 'artifactPaths');
      text(path, `artifactPaths.${name}`);
    }
    sha256Value(
      at(manifest, 'correspondenceFile.hash'),
      'correspondenceFile.hash'
    );
    for (const [path, hash] of Object.entries(
      object(manifest.baselineEvidenceHashes, 'baselineEvidenceHashes')
    )) {
      sha256Value(hash, `baselineEvidenceHashes.${path}`);
    }
    for (const field of [
      'metricFormula',
      'pixelConvention',
      'correspondenceFile.path',
      'freezeTime',
      'filipApproval',
      'mingnaApproval',
    ]) {
      text(at(manifest, field), field);
    }
    if (!Number.isFinite(Date.parse(String(manifest.freezeTime)))) {
      invalid('freezeTime', 'expected an ISO timestamp');
    }
  }
}

/** Creates one exclusive workspace. Failed runs are retained for diagnosis. */
export async function prepareRun(value: unknown, runsRoot: string) {
  validateManifest(value, 'preparation');
  const manifest = structuredClone(value);
  const runDirectory = resolve(runsRoot, manifest.runId);
  try {
    execFileSync(
      'git',
      ['check-ignore', '-q', '--', join(runDirectory, 'input/original.zip')],
      {
        cwd: dirname(resolve(runsRoot)),
        stdio: 'pipe',
      }
    );
  } catch {
    throw new Error(
      'git check-ignore must confirm the experiment run is ignored before copying data'
    );
  }
  const inputBytes = await readFile(manifest.input.path);
  const before = hash(inputBytes);
  if (before !== manifest.input.sha256.toLowerCase()) {
    invalid('input.sha256', 'does not match the original ZIP');
  }
  const dataset = await readRecorderZip(inputBytes);
  sameNames(
    dataset.model.images.map(({ name }) => name),
    manifest.imageNames,
    'imageNames'
  );
  const archive = await recorderZipAdapter.open(inputBytes);
  const images = recorderZipAdapter.resolveImages(
    archive,
    dataset.model.images
  );
  for (const image of images) {
    // ZIP names are already traversal-checked. Reject Windows aliases/streams too.
    if (
      image.path
        .split('/')
        .some(
          (segment) =>
            /[<>:"|?*]|[. ]$/.test(segment) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
        )
    ) {
      invalid(
        'imageNames',
        `cannot extract exact filename on disk: ${image.path}`
      );
    }
  }
  const evidence = [];
  for (const kind of ['overlapEvidence', 'driftEvidence'] as const) {
    for (const [i, sourcePath] of manifest[kind].paths.entries()) {
      evidence.push({
        sourcePath,
        path: `evidence/${kind}-${i + 1}${extname(sourcePath)}`,
        bytes: await readFile(sourcePath),
      });
    }
  }
  await mkdir(resolve(runsRoot), { recursive: true });
  await mkdir(runDirectory); // Atomic reservation: never reuse or overwrite a run.
  for (const directory of ['input', 'images', 'logs', 'evidence']) {
    await mkdir(join(runDirectory, directory));
  }
  const originalPath = join(runDirectory, 'input/original.zip');
  await writeFile(originalPath, inputBytes, { flag: 'wx' });
  const imageHashes = [];
  for (const image of images) {
    const path = join(runDirectory, image.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, image.bytes, { flag: 'wx' });
    const sha256 = hash(await readFile(path));
    if (sha256 !== hash(image.bytes)) {
      throw new Error(`Extracted image hash mismatch: ${image.path}`);
    }
    imageHashes.push({ path: image.path, sha256 });
  }
  const suitabilityEvidence = [];
  for (const entry of evidence) {
    const path = join(runDirectory, entry.path);
    await writeFile(path, entry.bytes, { flag: 'wx' });
    const sha256 = hash(await readFile(path));
    if (sha256 !== hash(entry.bytes)) {
      throw new Error(
        `Suitability evidence hash mismatch: ${entry.sourcePath}`
      );
    }
    suitabilityEvidence.push({
      sourcePath: entry.sourcePath,
      path: entry.path,
      sha256,
    });
  }
  const copy = hash(await readFile(originalPath));
  const after = hash(await readFile(manifest.input.path));
  if (copy !== before || after !== before) {
    invalid(
      'input.sha256',
      'original or isolated copy changed during preparation'
    );
  }
  await writeFile(
    join(runDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' }
  );
  await writeFile(
    join(runDirectory, 'logs/preparation.json'),
    `${JSON.stringify({ manifest, input: { before, copy, after }, images: imageHashes, suitabilityEvidence }, null, 2)}\n`,
    { flag: 'wx' }
  );
  return { runDirectory, dataset };
}

/** The write-once preparation receipt, never today's editable manifest, is the reference. */
async function checkPreparationSnapshot(
  runDirectory: string,
  manifest: ExperimentManifest
) {
  const bytes = await readFile(
    join(runDirectory, 'logs/preparation.json')
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('Missing preparation snapshot; start a new run');
  });
  const receipt = object(
    JSON.parse(bytes.toString('utf8')),
    'preparation receipt'
  );
  if (!Object.hasOwn(receipt, 'manifest'))
    throw new Error('Missing preparation snapshot; start a new run');
  validateManifest(receipt.manifest, 'preparation');
  const compare = (
    prepared: unknown,
    current: unknown,
    field: string
  ): void => {
    if (prepared === 'pending' || isDeepStrictEqual(prepared, current)) return;
    if (
      prepared !== null &&
      current !== null &&
      typeof prepared === 'object' &&
      typeof current === 'object' &&
      Array.isArray(prepared) === Array.isArray(current)
    ) {
      const oldKeys = Object.keys(prepared);
      if (isDeepStrictEqual([...oldKeys].sort(), Object.keys(current).sort())) {
        for (const key of oldKeys)
          compare(
            (prepared as Record<string, unknown>)[key],
            (current as Record<string, unknown>)[key],
            `${field}.${key}`
          );
        return;
      }
    }
    throw new Error(
      `Changed frozen preparation field ${field}; start a new run`
    );
  };
  compare(receipt.manifest, manifest, 'manifest');
  return hash(bytes);
}

type RecorderModel = Awaited<ReturnType<typeof readRecorderZip>>['model'];

/** Mutation gate only: pose/frame safety and ZIP verification remain separate. */
export function assertPoseOnlyMutation(
  original: RecorderModel,
  candidate: RecorderModel
): void {
  for (const [label, model] of [
    ['original', original],
    ['candidate', candidate],
  ] as const) {
    for (const image of model.images) {
      if (!Array.isArray(image.observations) || image.observations.length !== 0)
        throw new Error(
          `${label} image ${image.imageId} (${image.name}): observations must be an empty array`
        );
    }
    for (const point of model.points3D) {
      if (!Array.isArray(point.track) || point.track.length !== 0)
        throw new Error(
          `${label} point ${point.point3DId}: track must be an empty array`
        );
    }
  }
  const masked = {
    ...candidate,
    images: candidate.images.map((image, i) => ({
      ...image,
      pose: {
        ...image.pose,
        qvec: original.images[i]?.pose.qvec ?? image.pose.qvec,
        tvec: original.images[i]?.pose.tvec ?? image.pose.tvec,
      },
    })),
  };
  // Index masking does not remap records: the exact comparison also checks order/IDs.
  const comparison = exactlyPreserved(original, masked);
  if (!comparison.equal)
    throw new Error(`Non-pose mutation: ${JSON.stringify(comparison)}`);
}

type HandoffCamera = RecorderModel['cameras'][number];
type ImageIdentity = Pick<
  RecorderModel['images'][number],
  'imageId' | 'cameraId' | 'name'
>;
interface WorkingImage extends ImageIdentity {
  pose: { qvec: number[]; tvec: number[] };
  observations: [number, number, number][];
}

/** Create the known model once, or inspect a later TXT export into separate evidence. */
export async function handoffRun(
  runDirectory: string,
  returnedDirectory?: string
) {
  const manifest: unknown = JSON.parse(
    await readFile(join(runDirectory, 'manifest.json'), 'utf8')
  );
  validateManifest(manifest, 'preparation');
  await checkPreparationSnapshot(runDirectory, manifest);
  const originalPath = join(runDirectory, 'input/original.zip');
  const bytes = await readFile(originalPath);
  if (hash(bytes) !== manifest.input.sha256.toLowerCase()) {
    invalid('input.sha256', 'isolated original ZIP changed');
  }
  const { model } = await readRecorderZip(bytes);
  sameNames(
    model.images.map((image) => image.name),
    manifest.imageNames,
    'imageNames'
  );
  const databasePath = join(runDirectory, 'database/features.db');
  // Only a closed/checkpointed extraction snapshot has a single-file hash.
  const wal = await stat(`${databasePath}-wal`).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    }
  );
  if (wal && wal.size > 0)
    throw new Error('Close and checkpoint the database before handoff');
  const databaseHash = hash(await readFile(databasePath));
  const database = await readHandoffDatabase(databasePath);
  const databaseImages = checkIdentityAndCalibration(
    model,
    database,
    'database'
  );
  let returned:
    | { cameras: HandoffCamera[]; images: WorkingImage[] }
    | undefined;
  const exportHashes: Record<string, string> = {};
  if (returnedDirectory !== undefined) {
    const cameras = await readFile(
      join(returnedDirectory, 'cameras.txt'),
      'utf8'
    );
    const images = await readFile(
      join(returnedDirectory, 'images.txt'),
      'utf8'
    );
    exportHashes['cameras.txt'] = hash(new TextEncoder().encode(cameras));
    exportHashes['images.txt'] = hash(new TextEncoder().encode(images));
    returned = {
      cameras: readWorkingCameras(cameras),
      images: readWorkingImages(images),
    };
    checkIdentityAndCalibration(model, returned, 'returned');
  }
  const returnedImages = new Map(
    returned?.images.map((image) => [image.name, image])
  );
  const poses = model.images.map((image) => {
    const databaseImage = databaseImages.get(image.name)!;
    const returnedImage = returnedImages.get(image.name);
    return {
      originalImageId: image.imageId,
      exactFilename: image.name,
      databaseImageId: databaseImage.imageId,
      returnedImageId: returnedImage?.imageId ?? null,
      originalCameraId: image.cameraId,
      databaseCameraId: databaseImage.cameraId,
      returnedCameraId: returnedImage?.cameraId ?? null,
      originalPose: image.pose,
      returnedPose: returnedImage?.pose ?? null,
    };
  });
  const known = {
    'cameras.txt': database.cameras
      .map(
        (camera) =>
          [
            camera.cameraId,
            camera.model,
            camera.width,
            camera.height,
            camera.intrinsics.fx,
            camera.intrinsics.fy,
            camera.intrinsics.cx,
            camera.intrinsics.cy,
          ].join(' ') + '\n'
      )
      .join(''),
    'images.txt': poses
      .map(
        (row) =>
          [
            row.databaseImageId,
            ...row.originalPose.qvec,
            ...row.originalPose.tvec,
            row.databaseCameraId,
            row.exactFilename,
          ].join(' ') + '\n\n'
      )
      .join(''),
    'points3D.txt': '', // Recorder occupancy points are never triangulation input.
  };
  if (
    hash(await readFile(databasePath)) !== databaseHash ||
    hash(await readFile(originalPath)) !== hash(bytes)
  ) {
    throw new Error('Original ZIP or database changed during handoff');
  }
  const knownDirectory = join(runDirectory, 'models/known');
  const knownHashes: Record<string, string> = {};
  let initialHandoffSha256: string | undefined;
  let suffix = '';
  if (returnedDirectory === undefined) {
    await mkdir(join(runDirectory, 'models'), { recursive: true });
    await mkdir(knownDirectory); // Never replace an earlier handoff or its evidence.
  } else {
    const initialBytes = await readFile(
      join(runDirectory, 'logs/handoff.json')
    );
    const initial = object(
      JSON.parse(initialBytes.toString('utf8')),
      'initial handoff'
    );
    if (
      initial.inputSha256 !== hash(bytes) ||
      at(initial, 'database.sha256') !== databaseHash ||
      !isDeepStrictEqual(initial.colmap, manifest.colmap)
    ) {
      throw new Error(
        'Initial handoff input, database or COLMAP identity changed'
      );
    }
    const initialPoses: unknown = JSON.parse(
      await readFile(join(runDirectory, 'poses.json'), 'utf8')
    );
    if (
      !isDeepStrictEqual(
        initialPoses,
        poses.map((row) => ({
          ...row,
          returnedImageId: null,
          returnedCameraId: null,
          returnedPose: null,
        }))
      )
    ) {
      throw new Error('Initial handoff pose table changed');
    }
    for (const [name, content] of Object.entries(known)) {
      if (
        object(initial.knownModelHashes, 'initial handoff knownModelHashes')[
          name
        ] !== hash(new TextEncoder().encode(content))
      ) {
        throw new Error(`Initial handoff known model changed: ${name}`);
      }
    }
    initialHandoffSha256 = hash(initialBytes);
    // Distinct exports retain distinct immutable mappings; repeats cannot overwrite.
    suffix = `-returned-${hash(new TextEncoder().encode(JSON.stringify(exportHashes)))}`;
  }
  for (const [name, content] of Object.entries(known)) {
    const path = join(knownDirectory, name);
    if (returnedDirectory === undefined) {
      await writeFile(path, content, { flag: 'wx' });
    }
    knownHashes[name] = hash(await readFile(path));
    if (knownHashes[name] !== hash(new TextEncoder().encode(content)))
      throw new Error(`Known model mismatch: ${name}`);
  }
  const mappingPath = join(runDirectory, `poses${suffix}.json`);
  const receiptPath = join(runDirectory, `logs/handoff${suffix}.json`);
  await writeFile(mappingPath, `${JSON.stringify(poses, null, 2)}\n`, {
    flag: 'wx',
  });
  await writeFile(
    receiptPath,
    `${JSON.stringify(
      {
        inputSha256: hash(bytes),
        initialHandoffSha256,
        colmap: manifest.colmap,
        database: {
          path: databasePath,
          sha256: databaseHash,
          schema: database.schema,
        },
        calibration: {
          original: model.cameras,
          database: database.cameras,
          known: database.cameras,
          returned: returned?.cameras ?? null,
        },
        knownModelHashes: knownHashes,
        returnedExport:
          returnedDirectory === undefined
            ? null
            : { path: resolve(returnedDirectory), hashes: exportHashes },
      },
      null,
      2
    )}\n`,
    { flag: 'wx' }
  );
  return {
    poses,
    workingImages: returned?.images ?? null,
    mappingPath,
    receiptPath,
  };
}

async function readHandoffDatabase(path: string) {
  // Consumed schema pinned to COLMAP 3.11.1 scene/database.cc and sensor/models.h:
  // https://github.com/colmap/colmap/blob/3.11.1/src/colmap/scene/database.cc
  // PINHOLE = 1; params = four float64 values in fx, fy, cx, cy order.
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('BEGIN');
    const schema: Record<string, unknown> = {};
    for (const [table, fields] of Object.entries({
      cameras: {
        camera_id: 'INTEGER',
        model: 'INTEGER',
        width: 'INTEGER',
        height: 'INTEGER',
        params: 'BLOB',
      },
      images: { image_id: 'INTEGER', name: 'TEXT', camera_id: 'INTEGER' },
    })) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      schema[table] = columns;
      for (const [name, type] of Object.entries(fields)) {
        if (
          !columns.some(
            (column) => column.name === name && column.type === type
          )
        ) {
          throw new Error(
            `Unsupported database schema: ${table}.${name} must be ${type}`
          );
        }
      }
    }
    const cameras = db
      .prepare('SELECT camera_id, model, width, height, params FROM cameras')
      .all()
      .map((row) => {
        if (
          row.model !== 1 ||
          !(row.params instanceof Uint8Array) ||
          row.params.byteLength !== 32
        ) {
          throw new Error(
            `database camera ${row.camera_id}: expected PINHOLE with four float64 parameters`
          );
        }
        const view = new DataView(
          row.params.buffer,
          row.params.byteOffset,
          row.params.byteLength
        );
        return handoffCamera(
          row.camera_id,
          row.width,
          row.height,
          [0, 8, 16, 24].map((offset) => view.getFloat64(offset, true)),
          'database'
        );
      });
    const images = db
      .prepare('SELECT image_id, name, camera_id FROM images')
      .all()
      .map((row) => {
        text(row.name, 'database image name');
        return {
          imageId: handoffId(row.image_id, 'database image ID', 2147483646),
          name: row.name,
          cameraId: handoffId(row.camera_id, 'database camera ID'),
        };
      });
    return { cameras, images, schema };
  } finally {
    db.close();
  }
}

function checkIdentityAndCalibration(
  model: {
    cameras: readonly HandoffCamera[];
    images: readonly ImageIdentity[];
  },
  other: { cameras: HandoffCamera[]; images: ImageIdentity[] },
  field: string
) {
  sameNames(
    model.images.map((image) => image.name),
    other.images.map((image) => image.name),
    `${field} filenames`
  );
  for (const ids of [
    other.images.map((image) => image.imageId),
    other.cameras.map((camera) => camera.cameraId),
  ]) {
    if (new Set(ids).size !== ids.length)
      throw new Error(`${field}: duplicate IDs`);
  }
  const images = new Map(other.images.map((image) => [image.name, image]));
  const associations = new Map<number, number>();
  for (const image of model.images) {
    const mapped = images.get(image.name)!;
    const original = model.cameras.find(
      (camera) => camera.cameraId === image.cameraId
    )!;
    const camera = other.cameras.find(
      (entry) => entry.cameraId === mapped.cameraId
    );
    if (!camera)
      throw new Error(
        `${field}: image ${image.name} references missing camera ${mapped.cameraId}`
      );
    if (
      camera.model !== original.model ||
      camera.width !== original.width ||
      camera.height !== original.height ||
      (['fx', 'fy', 'cx', 'cy'] as const).some(
        (key) => camera.intrinsics[key] !== original.intrinsics[key]
      )
    ) {
      throw new Error(
        `${field}: calibration differs for image ${image.name}, camera ${camera.cameraId}`
      );
    }
    if (
      associations.has(image.cameraId) &&
      associations.get(image.cameraId) !== camera.cameraId
    ) {
      throw new Error(
        `${field}: camera association split for image ${image.name}`
      );
    }
    associations.set(image.cameraId, camera.cameraId);
  }
  if (
    associations.size !== model.cameras.length ||
    new Set(associations.values()).size !== other.cameras.length ||
    associations.size !== other.cameras.length
  ) {
    throw new Error(
      `${field}: expected a camera association bijection without extra or merged cameras`
    );
  }
  return images;
}

function handoffId(
  value: unknown,
  field: string,
  max = Number.MAX_SAFE_INTEGER
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > max
  ) {
    throw new Error(`${field}: expected a positive safe ID <= ${max}`);
  }
  return value;
}

function handoffCamera(
  cameraId: unknown,
  width: unknown,
  height: unknown,
  params: number[],
  field: string
): HandoffCamera {
  if (
    params.length !== 4 ||
    params.some((value) => !Number.isFinite(value)) ||
    params[0]! <= 0 ||
    params[1]! <= 0
  ) {
    throw new Error(`${field}: invalid PINHOLE calibration`);
  }
  return {
    cameraId: handoffId(cameraId, `${field} camera ID`),
    model: 'PINHOLE',
    width: handoffId(width, `${field} camera width`),
    height: handoffId(height, `${field} camera height`),
    intrinsics: {
      fx: params[0]!,
      fy: params[1]!,
      cx: params[2]!,
      cy: params[3]!,
    },
  };
}

function readWorkingCameras(source: string): HandoffCamera[] {
  return source.split(/\r?\n/).flatMap((line, i) => {
    if (line.trim() === '' || line.trimStart().startsWith('#')) return [];
    const tokens = line.trim().split(/\s+/);
    const field = `returned cameras.txt:${i + 1}`;
    if (tokens.length !== 8 || tokens[1] !== 'PINHOLE')
      throw new Error(`${field}: expected PINHOLE camera`);
    return [
      handoffCamera(
        Number(tokens[0]),
        Number(tokens[2]),
        Number(tokens[3]),
        tokens.slice(4).map(Number),
        field
      ),
    ];
  });
}

/** Only images.txt identity/pose/observation decoding; no recorder validation or track evaluation. */
function readWorkingImages(source: string): WorkingImage[] {
  const lines = source.split(/\r?\n/);
  if (source.endsWith('\n')) lines.pop(); // The split sentinel is not an observation row.
  const images: WorkingImage[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const field = `returned images.txt:${i + 1}`;
    const header = /^\s*((?:\S+\s+){9})(\S.*)$/.exec(line);
    if (!header)
      throw new Error(`${field}: expected image identity and W2C pose`);
    const values = header[1]!.trim().split(/\s+/).map(Number);
    if (values.some((value) => !Number.isFinite(value)))
      throw new Error(`${field}: nonfinite pose or ID`);
    const observationLine = lines[++i];
    if (observationLine === undefined)
      throw new Error(`${field}: missing observation row`);
    const values2D =
      observationLine.trim() === ''
        ? []
        : observationLine.trim().split(/\s+/).map(Number);
    if (
      values2D.length % 3 !== 0 ||
      values2D.some((value) => !Number.isFinite(value))
    )
      throw new Error(`${field}: malformed observation row`);
    const observations: WorkingImage['observations'] = [];
    for (let j = 0; j < values2D.length; j += 3) {
      const pointId = values2D[j + 2]!;
      if (!Number.isSafeInteger(pointId) || pointId < -1)
        throw new Error(`${field}: invalid observation point ID`);
      observations.push([values2D[j]!, values2D[j + 1]!, pointId]);
    }
    images.push({
      imageId: handoffId(values[0], `${field} image ID`),
      cameraId: handoffId(values[8], `${field} camera ID`),
      name: header[2]!,
      pose: { qvec: values.slice(1, 5), tvec: values.slice(5, 8) },
      observations,
    });
  }
  return images;
}

type ScoringModel = {
  cameras: HandoffCamera[];
  images: Omit<WorkingImage, 'observations'>[];
};
interface FrozenPair extends RequiredPair {
  matches: {
    keypointIndices: [number, number];
    xy: [[number, number], [number, number]];
  }[];
}
const scoreFields = [
  'numericEpsilon',
  'quaternionTolerance',
  'minVerifiedMatches',
  'inlierThresholdPx',
  'coverageGridRows',
  'coverageGridColumns',
  'minCoverageEachImage',
  'improvementTolerancePx',
  'pairMedianRegressionPx',
  'pairP90RegressionPx',
  'maxInlierRatioDrop',
  'maxCoverageDrop',
] as const;
type ScorePolicy = Record<(typeof scoreFields)[number], number>;

/** Epipolar metrics only: these cannot establish translation scale/sign or acceptance. */
export function scoreModels(
  before: ScoringModel,
  after: ScoringModel | null,
  value: unknown,
  settings: Record<string, unknown>
) {
  const policy = Object.fromEntries(
    scoreFields.map((field) => {
      const positive = [
        'numericEpsilon',
        'quaternionTolerance',
        'minVerifiedMatches',
        'inlierThresholdPx',
        'coverageGridRows',
        'coverageGridColumns',
        'minCoverageEachImage',
      ].includes(field);
      const max =
        field === 'quaternionTolerance'
          ? 1e-6
          : [
                'minCoverageEachImage',
                'maxInlierRatioDrop',
                'maxCoverageDrop',
              ].includes(field)
            ? 1
            : Infinity;
      number(settings[field], field, 0, max, positive);
      if (
        [
          'minVerifiedMatches',
          'coverageGridRows',
          'coverageGridColumns',
        ].includes(field) &&
        !Number.isSafeInteger(settings[field])
      )
        invalid(field, 'expected a safe integer');
      return [field, settings[field]];
    })
  ) as ScorePolicy;
  if (
    !Number.isSafeInteger(policy.coverageGridRows * policy.coverageGridColumns)
  )
    invalid('coverageGrid', 'cell count must be a safe integer');
  checkIdentityAndCalibration(before, before, 'baseline');
  if (after) checkIdentityAndCalibration(before, after, 'candidate');
  const names = before.images.map((image) => image.name);
  const required = [
    ...pairs(settings.sequentialPairs, names, 'sequentialPairs'),
    ...pairs(settings.loopPairs, names, 'loopPairs'),
  ];
  const frozen = readFrozenPairs(value, names, required);
  const score = (model: ScoringModel) => {
    const scores = frozen.map((pair) => ({
      images: pair.images,
      ...scorePair(model, pair, policy),
    }));
    return {
      pairs: scores,
      medianOfPairMediansPx: scores.every((pair) => pair.status === 'scored')
        ? median(scores.map((pair) => pair.metrics!.medianPx))
        : null,
    };
  };
  const baseline = score(before);
  const candidate = after ? score(after) : null;
  const comparison = candidate
    ? {
        aggregateImproved:
          baseline.medianOfPairMediansPx === null ||
          candidate.medianOfPairMediansPx === null
            ? null
            : baseline.medianOfPairMediansPx - candidate.medianOfPairMediansPx >
              policy.improvementTolerancePx,
        pairs: baseline.pairs.map((pair, i) => {
          const a = pair.metrics;
          const b = candidate.pairs[i]!.metrics;
          // A computable regression still matters if a support floor also fails.
          const vetoes =
            a && b
              ? [
                  ...(b.medianPx - a.medianPx > policy.pairMedianRegressionPx
                    ? ['median regression']
                    : []),
                  ...(b.p90Px - a.p90Px > policy.pairP90RegressionPx
                    ? ['p90 regression']
                    : []),
                  ...(a.inlierRatio - b.inlierRatio > policy.maxInlierRatioDrop
                    ? ['inlier ratio drop']
                    : []),
                  ...(a.coverage[0]! - b.coverage[0]! > policy.maxCoverageDrop
                    ? ['first-image coverage drop']
                    : []),
                  ...(a.coverage[1]! - b.coverage[1]! > policy.maxCoverageDrop
                    ? ['second-image coverage drop']
                    : []),
                ]
              : null;
          return { images: pair.images, vetoes };
        }),
      }
    : null;
  return {
    safetyEvaluated: false as const,
    policy,
    before: baseline,
    after: candidate,
    comparison,
  };
}

/** JSON: {pairs:[{images:[name,name],required:true,matches:[{keypointIndices:[i,j],xy:[[u,v],[u,v]]}]}]}. */
function readFrozenPairs(
  value: unknown,
  names: string[],
  required: string[]
): FrozenPair[] {
  const entries = object(value, 'correspondences').pairs;
  sameNames(
    required,
    pairs(entries, names, 'correspondences.pairs'),
    'correspondences.pairs'
  );
  const coordinates = new Map<string, number[]>();
  const result = (entries as Record<string, unknown>[]).map(
    (entry): FrozenPair => {
      const images = entry.images as [string, string];
      if (!Array.isArray(entry.matches))
        invalid('correspondences.matches', 'expected an array');
      const seen = [new Set<number>(), new Set<number>()];
      const matches = entry.matches.map((value) => {
        const match = object(value, 'correspondences.match');
        if (
          !Array.isArray(match.keypointIndices) ||
          match.keypointIndices.length !== 2 ||
          !Array.isArray(match.xy) ||
          match.xy.length !== 2
        )
          invalid(
            'correspondences.match',
            'expected two keypoint indices and two pixel coordinates'
          );
        for (let side = 0; side < 2; side++) {
          const index: unknown = match.keypointIndices[side];
          const xy: unknown = match.xy[side];
          if (
            typeof index !== 'number' ||
            !Number.isSafeInteger(index) ||
            index < 0 ||
            seen[side]!.has(index)
          )
            invalid(
              'correspondences.keypointIndices',
              'expected distinct nonnegative safe indices within each pair'
            );
          seen[side]!.add(index);
          if (
            !Array.isArray(xy) ||
            xy.length !== 2 ||
            !xy.every((v) => typeof v === 'number')
          )
            invalid(
              'correspondences.xy',
              'expected original-resolution numeric pixel pairs'
            );
          const key = JSON.stringify([images[side], index]);
          if (
            coordinates.has(key) &&
            !isDeepStrictEqual(coordinates.get(key), xy)
          )
            invalid(
              'correspondences.xy',
              `inconsistent coordinates for ${key}`
            );
          coordinates.set(key, xy);
        }
        return {
          keypointIndices: match.keypointIndices as [number, number],
          xy: match.xy as [[number, number], [number, number]],
        };
      });
      return { images, required: true, matches };
    }
  );
  // Preserve the declared pair order; never infer identity from numeric image IDs.
  const byPair = new Map(result.map((pair) => [pairKey(pair.images), pair]));
  return required.map((key) => byPair.get(key)!);
}

function scorePair(model: ScoringModel, pair: FrozenPair, policy: ScorePolicy) {
  const count = pair.matches.length;
  const inconclusive = (reason: string) => ({
    status: 'inconclusive' as const,
    reason,
    count,
    metrics: null,
  });
  const images = pair.images.map(
    (name) => model.images.find((image) => image.name === name)!
  );
  const cameras = images.map(
    (image) =>
      model.cameras.find((camera) => camera.cameraId === image.cameraId)!
  );
  if (count === 0) return inconclusive('No verified correspondences');
  const rotations = images.map((image) =>
    scoringRotation(image.pose, policy.quaternionTolerance)
  );
  if (!rotations[0] || !rotations[1])
    return inconclusive('Nonfinite or invalid W2C pose');
  const relativeR = multiply3(rotations[1], transpose3(rotations[0]));
  const rotatedT = multiplyVector3(relativeR, images[0]!.pose.tvec);
  const t = images[1]!.pose.tvec.map((v, i) => v - rotatedT[i]!);
  const baseline = Math.hypot(...t);
  if (!Number.isFinite(baseline) || baseline === 0)
    return inconclusive('Zero or nonfinite baseline');
  const inverseK = cameras.map(({ intrinsics: k }) => [
    1 / k.fx,
    0,
    -k.cx / k.fx,
    0,
    1 / k.fy,
    -k.cy / k.fy,
    0,
    0,
    1,
  ]);
  const skew = [0, -t[2]!, t[1]!, t[2]!, 0, -t[0]!, -t[1]!, t[0]!, 0];
  const rawF = multiply3(
    multiply3(multiply3(transpose3(inverseK[1]!), skew), relativeR),
    inverseK[0]!
  );
  const norm = Math.hypot(...rawF);
  if (!Number.isFinite(norm) || norm === 0)
    return inconclusive('Degenerate fundamental matrix');
  const f = rawF.map((v) => v / norm);
  const ft = transpose3(f);
  const errorsPx: number[] = [];
  const cells = [new Set<number>(), new Set<number>()];
  for (const match of pair.matches) {
    for (let side = 0; side < 2; side++) {
      const [u, v] = match.xy[side]!;
      const camera = cameras[side]!;
      if (
        !Number.isFinite(u) ||
        !Number.isFinite(v) ||
        u < 0 ||
        u >= camera.width ||
        v < 0 ||
        v >= camera.height
      )
        return inconclusive('Nonfinite or out-of-image correspondence');
    }
    const x = [...match.xy[0], 1];
    const y = [...match.xy[1], 1];
    const lineJ = multiplyVector3(f, x);
    const lineI = multiplyVector3(ft, y);
    const dj = Math.hypot(lineJ[0]!, lineJ[1]!);
    const di = Math.hypot(lineI[0]!, lineI[1]!);
    if (
      !Number.isFinite(dj) ||
      !Number.isFinite(di) ||
      dj <= policy.numericEpsilon ||
      di <= policy.numericEpsilon
    )
      return inconclusive('Near-zero or nonfinite epipolar denominator');
    const residual = Math.abs(dot3(y, lineJ));
    const error = (residual / dj + residual / di) / 2;
    if (!Number.isFinite(error))
      return inconclusive('Nonfinite epipolar residual');
    errorsPx.push(error);
    if (error <= policy.inlierThresholdPx) {
      for (let side = 0; side < 2; side++) {
        const [u, v] = match.xy[side]!;
        const camera = cameras[side]!;
        const column = Math.min(
          policy.coverageGridColumns - 1,
          Math.floor((u * policy.coverageGridColumns) / camera.width)
        );
        const row = Math.min(
          policy.coverageGridRows - 1,
          Math.floor((v * policy.coverageGridRows) / camera.height)
        );
        cells[side]!.add(row * policy.coverageGridColumns + column);
      }
    }
  }
  const sorted = [...errorsPx].sort((a, b) => a - b);
  const inlierCount = errorsPx.filter(
    (value) => value <= policy.inlierThresholdPx
  ).length;
  const coverage = cells.map(
    (set) => set.size / (policy.coverageGridRows * policy.coverageGridColumns)
  );
  const reason =
    count < policy.minVerifiedMatches
      ? 'Insufficient verified matches'
      : coverage.some((v) => v < policy.minCoverageEachImage)
        ? 'Insufficient inlier coverage'
        : null;
  return {
    status: reason ? ('inconclusive' as const) : ('scored' as const),
    reason,
    count,
    metrics: {
      errorsPx,
      medianPx: median(sorted),
      p90Px: sorted[Math.ceil(0.9 * count) - 1]!,
      inlierCount,
      inlierRatio: inlierCount / count,
      coverage,
    },
  };
}

function scoringRotation(
  pose: WorkingImage['pose'],
  tolerance: number
): number[] | null {
  if (
    pose.qvec.length !== 4 ||
    pose.tvec.length !== 3 ||
    [...pose.qvec, ...pose.tvec].some((v) => !Number.isFinite(v)) ||
    Math.abs(Math.hypot(...pose.qvec) - 1) > tolerance
  )
    return null;
  const [w, x, y, z] = pose.qvec as [number, number, number, number];
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y - w * z),
    2 * (x * z + w * y),
    2 * (x * y + w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z - w * x),
    2 * (x * z - w * y),
    2 * (y * z + w * x),
    1 - 2 * (x * x + y * y),
  ];
}
function transpose3(a: number[]): number[] {
  return [a[0]!, a[3]!, a[6]!, a[1]!, a[4]!, a[7]!, a[2]!, a[5]!, a[8]!];
}
function multiply3(a: number[], b: number[]): number[] {
  return a.map((_, index) =>
    [0, 1, 2].reduce(
      (sum, k) =>
        sum + a[Math.floor(index / 3) * 3 + k]! * b[k * 3 + (index % 3)]!,
      0
    )
  );
}
function multiplyVector3(a: number[], b: number[]): number[] {
  return [0, 1, 2].map(
    (row) =>
      a[row * 3]! * b[0]! + a[row * 3 + 1]! * b[1]! + a[row * 3 + 2]! * b[2]!
  );
}
function dot3(a: number[], b: number[]): number {
  return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : sorted[middle - 1]! / 2 + sorted[middle]! / 2;
}

/** Baseline TXT is exports/triangulated; an optional later TXT export never changes that baseline. */
export async function scoreRun(
  runDirectory: string,
  candidateDirectory?: string
) {
  const manifest: unknown = JSON.parse(
    await readFile(join(runDirectory, 'manifest.json'), 'utf8')
  );
  validateManifest(manifest, 'preparation');
  await checkPreparationSnapshot(runDirectory, manifest);
  text(manifest.metricFormula, 'metricFormula');
  text(manifest.pixelConvention, 'pixelConvention');
  const correspondence = object(
    manifest.correspondenceFile,
    'correspondenceFile'
  );
  text(correspondence.path, 'correspondenceFile.path');
  sha256Value(correspondence.hash, 'correspondenceFile.hash');
  const correspondencePath = resolve(runDirectory, correspondence.path);
  const matchBytes = await readFile(correspondencePath);
  if (hash(matchBytes) !== String(correspondence.hash).toLowerCase())
    invalid('correspondenceFile.hash', 'frozen correspondences changed');
  const bytes = await readFile(join(runDirectory, 'input/original.zip'));
  if (hash(bytes) !== manifest.input.sha256.toLowerCase())
    invalid('input.sha256', 'isolated original ZIP changed');
  const { model } = await readRecorderZip(bytes);
  sameNames(
    model.images.map((image) => image.name),
    manifest.imageNames,
    'imageNames'
  );
  const readExport = async (directory: string) => {
    const cameras = await readFile(join(directory, 'cameras.txt'));
    const images = await readFile(join(directory, 'images.txt'));
    const model = {
      cameras: readWorkingCameras(cameras.toString('utf8')),
      images: readWorkingImages(images.toString('utf8')),
    };
    return {
      model,
      source: {
        path: resolve(directory),
        hashes: { 'cameras.txt': hash(cameras), 'images.txt': hash(images) },
      },
    };
  };
  const baseline = await readExport(join(runDirectory, 'exports/triangulated'));
  checkIdentityAndCalibration(model, baseline.model, 'baseline');
  const candidate =
    candidateDirectory === undefined
      ? null
      : await readExport(candidateDirectory);
  const scores = scoreModels(
    baseline.model,
    candidate?.model ?? null,
    JSON.parse(matchBytes.toString('utf8')),
    manifest
  );
  const report = {
    ...scores,
    inputSha256: hash(bytes),
    colmap: manifest.colmap,
    metricFormula: manifest.metricFormula,
    pixelConvention: manifest.pixelConvention,
    implementedMetric:
      'abs(xj^T F xi) * (1 / norm((F xi).xy) + 1 / norm((F^T xj).xy)) / 2; F normalized by Frobenius norm',
    correspondences: { path: correspondencePath, sha256: hash(matchBytes) },
    baseline: baseline.source,
    candidate: candidate?.source ?? null,
  };
  const baselinePath = join(runDirectory, 'metrics/scores-baseline.json');
  if (candidate) {
    const frozen = object(
      JSON.parse(await readFile(baselinePath, 'utf8')),
      'frozen baseline'
    );
    for (const key of [
      'inputSha256',
      'colmap',
      'metricFormula',
      'pixelConvention',
      'implementedMetric',
      'correspondences',
      'baseline',
      'policy',
      'before',
    ] as const) {
      if (!isDeepStrictEqual(frozen[key], report[key]))
        throw new Error(`Scoring ${key} differs from the frozen baseline`);
    }
  }
  const reportPath = candidate
    ? join(
        runDirectory,
        `metrics/scores-${hash(new TextEncoder().encode(JSON.stringify(report)))}.json`
      )
    : baselinePath;
  await mkdir(join(runDirectory, 'metrics'), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
  });
  return { report, reportPath };
}

interface WorkingTrack {
  pointId: number;
  observations: [number, number][]; // Exact exported image ID / POINT2D_IDX.
}
type SafetyModel = Omit<ScoringModel, 'images'> & {
  images: WorkingImage[];
  tracks: WorkingTrack[];
};

/** Computational gates only. Native gauge behavior requires separately retained evidence.
 * Angles are degrees, lengths use input-export units, scale tolerance is a ratio.
 * Supported gauge: first anchor's full pose and its distances to remaining anchors.
 */
export function safetyModels(
  original: Pick<RecorderModel, 'cameras' | 'images'> | ScoringModel,
  baseline: SafetyModel,
  candidate: SafetyModel | null,
  value: unknown,
  settings: Record<string, unknown>
) {
  validateManifest(settings, 'pre-ba');
  const limit = (name: string) => settings[name] as number;
  const epsilon = limit('numericEpsilon');
  const anchors = strings(
    object(settings.gaugeAnchors, 'gaugeAnchors').images,
    'gaugeAnchors.images'
  );
  const names = original.images.map((image) => image.name);
  sameNames(names, settings.imageNames, 'imageNames');
  checkIdentityAndCalibration(original, baseline, 'baseline');
  if (candidate) checkIdentityAndCalibration(original, candidate, 'candidate');
  const epipolar = scoreModels(baseline, candidate, value, settings);
  const frozen = readFrozenPairs(
    value,
    names,
    [...settings.sequentialPairs, ...settings.loopPairs].map((pair) =>
      pairKey(pair.images)
    )
  );
  const reference = new Map(
    original.images.map((image) => [
      image.name,
      poseFrame(image.pose, limit('quaternionTolerance')),
    ])
  );
  const evaluate = (
    model: SafetyModel,
    fixed: boolean,
    scores: typeof epipolar.before
  ) => {
    const issues: string[] = [];
    const frames = new Map(
      model.images.map((image) => [
        image.name,
        poseFrame(image.pose, limit('quaternionTolerance')),
      ])
    );
    const poses = names.map((name) => {
      const a = reference.get(name);
      const b = frames.get(name);
      if (!a || !b) {
        issues.push(`${name}: invalid or nonfinite W2C pose`);
        return {
          name,
          centre: null,
          centreDelta: null,
          rotationDeltaDegrees: null,
        };
      }
      const centreDelta = distance3(a.centre, b.centre);
      const rotationDeltaDegrees = rotationDistance(a.rotation, b.rotation);
      if (centreDelta > limit('maxCentreDelta'))
        issues.push(`${name}: centre delta exceeds limit`);
      if (rotationDeltaDegrees > limit('maxRotationDelta'))
        issues.push(`${name}: rotation delta exceeds limit`);
      if (fixed && (centreDelta > epsilon || rotationDeltaDegrees > epsilon))
        issues.push(`${name}: fixed-pose triangulation changed input pose`);
      if (
        name === anchors[0] &&
        (centreDelta > limit('originTolerance') ||
          rotationDeltaDegrees > limit('orientationTolerance'))
      )
        issues.push(`${name}: gauge anchor origin/orientation changed`);
      return { name, centre: b.centre, centreDelta, rotationDeltaDegrees };
    });
    const baselines = names.flatMap((a, i) =>
      names.slice(i + 1).map((b) => {
        const originalA = reference.get(a),
          originalB = reference.get(b);
        const currentA = frames.get(a),
          currentB = frames.get(b);
        const before =
          originalA && originalB
            ? distance3(originalA.centre, originalB.centre)
            : null;
        const after =
          currentA && currentB
            ? distance3(currentA.centre, currentB.centre)
            : null;
        const ratio =
          before !== null && after !== null && before > epsilon
            ? after / before
            : null;
        const anchor =
          (a === anchors[0] && anchors.includes(b)) ||
          (b === anchors[0] && anchors.includes(a));
        if (
          anchor &&
          (ratio === null ||
            !Number.isFinite(ratio) ||
            Math.abs(ratio - 1) > limit('scaleTolerance'))
        )
          issues.push(`${a} / ${b}: degenerate or changed gauge anchor scale`);
        return { images: [a, b], before, after, ratio };
      })
    );
    const chronology = settings.chronologicalNames.map((name) =>
      frames.get(name)
    );
    const trajectory = settings.chronologicalNames.slice(1).map((name, i) => {
      const a = chronology[i],
        b = chronology[i + 1],
        c = chronology[i + 2];
      const step = a && b ? distance3(a.centre, b.centre) : null;
      const rotationDegrees =
        a && b ? rotationDistance(a.rotation, b.rotation) : null;
      const turnDegrees =
        a && b && c
          ? vectorAngle(
              subtract3(b.centre, a.centre),
              subtract3(c.centre, b.centre),
              epsilon
            )
          : null;
      if (
        step === null ||
        !Number.isFinite(step) ||
        step > Number(at(settings, 'sequentialStepLimits.max'))
      )
        issues.push(`${name}: sequential step exceeds limit or is unavailable`);
      if (
        rotationDegrees === null ||
        rotationDegrees > Number(at(settings, 'sequentialTurnLimits.max')) ||
        (i + 2 < chronology.length &&
          (turnDegrees === null ||
            turnDegrees > Number(at(settings, 'sequentialTurnLimits.max'))))
      )
        issues.push(`${name}: sequential turn exceeds limit or is unavailable`);
      return {
        images: [settings.chronologicalNames[i]!, name],
        step,
        rotationDegrees,
        turnDegrees,
      };
    });
    const geometry = frozen.map((pair, i) => {
      const images = pair.images.map(
        (name) => model.images.find((image) => image.name === name)!
      );
      const samples = pair.matches.map((match) => {
        const failed = (
          failure: string,
          parallaxDegrees: number | null = null
        ) => ({
          keypointIndices: match.keypointIndices,
          point: null,
          depths: null,
          parallaxDegrees,
          positiveDepth: false,
          sufficientParallax: false,
          failure,
        });
        const pairFrames = pair.images.map((name) => frames.get(name));
        if (!pairFrames[0] || !pairFrames[1]) return failed('Invalid W2C pose');
        const cameras = images.map(
          (image) =>
            model.cameras.find((camera) => camera.cameraId === image.cameraId)!
        );
        if (
          match.xy.some(
            ([u, v], side) =>
              !Number.isFinite(u) ||
              !Number.isFinite(v) ||
              u < 0 ||
              v < 0 ||
              u >= cameras[side]!.width ||
              v >= cameras[side]!.height
          )
        )
          return failed('Nonfinite or out-of-image coordinate');
        const rays = cameras.map(({ intrinsics: k }, side) =>
          multiplyVector3(transpose3(pairFrames[side]!.rotation), [
            (match.xy[side]![0] - k.cx) / k.fx,
            (match.xy[side]![1] - k.cy) / k.fy,
            1,
          ])
        );
        const parallaxDegrees = vectorAngle(rays[0]!, rays[1]!, epsilon);
        if (
          parallaxDegrees === null ||
          distance3(pairFrames[0].centre, pairFrames[1].centre) <= epsilon
        )
          return failed('Zero/nonfinite baseline or ray', parallaxDegrees);
        // Four homogeneous pixel projection equations from K[R|t]. One DLT only.
        const rows = images.flatMap((image, side) => {
          const { fx, fy, cx, cy } = cameras[side]!.intrinsics;
          const r = pairFrames[side]!.rotation;
          const t = image.pose.tvec;
          const p0 = [...r.slice(0, 3), t[0]!];
          const p1 = [...r.slice(3, 6), t[1]!];
          const p2 = [...r.slice(6, 9), t[2]!];
          const [u, v] = match.xy[side]!;
          return [
            p2.map((z, k) => (u - cx) * z - fx * p0[k]!),
            p2.map((z, k) => (v - cy) * z - fy * p1[k]!),
          ];
        });
        const point = triangulateDLT(rows, epsilon);
        if (!point)
          return failed(
            'Failed/nonfinite DLT point (including point at infinity)',
            parallaxDegrees
          );
        const depths = images.map(
          (image, side) =>
            dot3(pairFrames[side]!.rotation.slice(6, 9), point) +
            image.pose.tvec[2]!
        );
        if (depths.some((depth) => !Number.isFinite(depth)))
          return failed('Nonfinite depth', parallaxDegrees);
        return {
          keypointIndices: match.keypointIndices,
          point,
          depths,
          parallaxDegrees,
          positiveDepth: depths.every((depth) => depth > limit('depthEpsilon')),
          sufficientParallax: parallaxDegrees >= limit('minParallaxDegrees'),
          failure: null,
        };
      });
      const count = samples.length;
      const positiveDepthCount = samples.filter(
        (sample) => sample.positiveDepth
      ).length;
      const parallaxCount = samples.filter(
        (sample) => sample.sufficientParallax
      ).length;
      const usableCount = samples.filter(
        (sample) => sample.positiveDepth && sample.sufficientParallax
      ).length;
      const positiveDepthRatio = count ? positiveDepthCount / count : 0;
      const parallaxRatio = count ? parallaxCount / count : 0;
      const failures = samples.filter(
        (sample) => sample.failure !== null
      ).length;
      if (
        failures > 0 ||
        count < limit('minVerifiedMatches') ||
        usableCount < limit('minVerifiedMatches') ||
        positiveDepthRatio < limit('minPositiveDepthRatio') ||
        parallaxCount !== count ||
        scores.pairs[i]!.status !== 'scored'
      )
        issues.push(
          `${pair.images.join(' / ')}: insufficient fixed-population depth/parallax/epipolar support`
        );
      return {
        images: pair.images,
        count,
        samples,
        failures,
        positiveDepthCount,
        positiveDepthRatio,
        parallaxRatio,
        usableCount,
      };
    });
    const support = workingConnectivity(
      model,
      frozen,
      geometry,
      scores,
      settings
    );
    if (
      support.components.length !== 1 ||
      support.pairs.some((pair) => !pair.usable)
    )
      issues.push('Disconnected or insufficient working-track support');
    return {
      passed: issues.length === 0,
      issues,
      poses,
      baselines,
      trajectory,
      pairs: geometry,
      support,
    };
  };
  const before = evaluate(baseline, true, epipolar.before);
  const after = candidate ? evaluate(candidate, false, epipolar.after!) : null;
  const pairVetoes = after
    ? before.pairs.map((a, i) => {
        const b = after.pairs[i]!;
        const vetoes = [];
        if (a.positiveDepthRatio - b.positiveDepthRatio > epsilon)
          vetoes.push('positive-depth support loss');
        if (a.parallaxRatio - b.parallaxRatio > epsilon)
          vetoes.push('parallax support loss');
        if (a.usableCount - b.usableCount > epsilon)
          vetoes.push('usable fixed-population support loss');
        return { images: a.images, vetoes };
      })
    : [];
  return {
    before,
    after,
    pairVetoes,
    epipolar,
    passed:
      before.passed &&
      (after?.passed ?? true) &&
      pairVetoes.every((pair) => pair.vetoes.length === 0),
  };
}

function poseFrame(
  pose: WorkingImage['pose'] | RecorderModel['images'][number]['pose'],
  tolerance: number
) {
  const rotation = scoringRotation(
    { qvec: [...pose.qvec], tvec: [...pose.tvec] },
    tolerance
  );
  if (!rotation) return null;
  const centre = multiplyVector3(transpose3(rotation), [...pose.tvec]).map(
    (v) => -v || 0
  );
  return centre.every(Number.isFinite) ? { rotation, centre } : null;
}
function subtract3(a: number[], b: number[]) {
  return a.map((v, i) => v - b[i]!);
}
function distance3(a: number[], b: number[]) {
  return Math.hypot(...subtract3(a, b));
}
function vectorAngle(a: number[], b: number[], epsilon: number): number | null {
  const na = Math.hypot(...a),
    nb = Math.hypot(...b);
  if (
    !Number.isFinite(na) ||
    !Number.isFinite(nb) ||
    na <= epsilon ||
    nb <= epsilon
  )
    return null;
  return (
    (Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          dot3(
            a.map((v) => v / na),
            b.map((v) => v / nb)
          )
        )
      )
    ) *
      180) /
    Math.PI
  );
}
function rotationDistance(a: number[], b: number[]): number {
  const r = multiply3(a, transpose3(b));
  // atan2 avoids acos's loss of precision for the near-zero rotations we gate.
  return (
    (Math.atan2(
      Math.hypot(r[7]! - r[5]!, r[2]! - r[6]!, r[3]! - r[1]!) / 2,
      (r[0]! + r[4]! + r[8]! - 1) / 2
    ) *
      180) /
    Math.PI
  );
}

/** Small one-sided Jacobi SVD of the 4x4 DLT matrix; avoids squaring its condition number. */
function triangulateDLT(rows: number[][], epsilon: number): number[] | null {
  const scale = Math.max(...rows.flat().map(Math.abs));
  if (!Number.isFinite(scale) || scale === 0) return null;
  const columns = [0, 1, 2, 3].map((i) => rows.map((row) => row[i]! / scale));
  const vectors: number[][] = [0, 1, 2, 3].map((i) =>
    [0, 1, 2, 3].map((j) => Number(i === j))
  );
  const dot = (a: number[], b: number[]) =>
    a.reduce((sum, v, i) => sum + v * b[i]!, 0);
  let converged = false;
  for (let sweep = 0; sweep < 64; sweep++) {
    converged = true;
    for (let p = 0; p < 3; p++)
      for (let q = p + 1; q < 4; q++) {
        const a = columns[p]!,
          b = columns[q]!;
        const aa = dot(a, a),
          bb = dot(b, b),
          ab = dot(a, b);
        if (
          Math.sqrt(aa) <= Number.EPSILON * 8 ||
          Math.sqrt(bb) <= Number.EPSILON * 8
        )
          continue;
        if (Math.abs(ab) <= Number.EPSILON * 8 * Math.sqrt(aa * bb)) continue;
        converged = false;
        const tau = (bb - aa) / (2 * ab);
        const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.hypot(1, tau));
        const c = 1 / Math.hypot(1, t),
          s = c * t;
        for (const matrix of [columns, vectors]) {
          const x = matrix[p]!,
            y = matrix[q]!;
          matrix[p] = x.map((v, i) => c * v - s * y[i]!);
          matrix[q] = x.map((v, i) => s * v + c * y[i]!);
        }
      }
    if (converged) break;
  }
  if (!converged) return null;
  const order = columns
    .map((column, i) => ({ i, norm: Math.hypot(...column) }))
    .sort((a, b) => a.norm - b.norm);
  if (order[1]!.norm - order[0]!.norm <= epsilon * order[3]!.norm) return null; // Non-unique point.
  const homogeneous = vectors[order[0]!.i]!;
  if (Math.abs(homogeneous[3]!) <= epsilon) return null;
  const point = homogeneous.slice(0, 3).map((v) => v / homogeneous[3]!);
  return point.every(Number.isFinite) ? point : null;
}

function workingConnectivity(
  model: SafetyModel,
  frozen: FrozenPair[],
  geometry: {
    samples: { positiveDepth: boolean; sufficientParallax: boolean }[];
  }[],
  scores: ReturnType<typeof scoreModels>['before'],
  settings: Record<string, unknown>
) {
  const members = new Map<string, number>();
  const ids = new Set<number>();
  for (const track of model.tracks) {
    handoffId(track.pointId, 'working track ID');
    if (ids.has(track.pointId) || track.observations.length < 2)
      throw new Error('Duplicate or incomplete reciprocal working track');
    ids.add(track.pointId);
    const images = new Set<number>();
    for (const [id, index] of track.observations) {
      const image = model.images.find((image) => image.imageId === id);
      const key = JSON.stringify([id, index]);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        images.has(id) ||
        members.has(key) ||
        image?.observations[index]?.[2] !== track.pointId
      )
        throw new Error('Working track lacks reciprocal image observation');
      images.add(id);
      members.set(key, track.pointId);
    }
  }
  for (const image of model.images)
    image.observations.forEach((observation, index) => {
      if (
        observation[2] !== -1 &&
        members.get(JSON.stringify([image.imageId, index])) !== observation[2]
      )
        throw new Error('Image observation lacks reciprocal working track');
    });
  const edges = new Map(
    model.images.map((image) => [image.name, new Set<string>()])
  );
  const supportPairs = frozen.map((pair, i) => {
    const trackIds = new Set<number>();
    pair.matches.forEach((match, m) => {
      const observations = pair.images.map((name, side) => {
        const image = model.images.find((image) => image.name === name)!;
        const observation = image.observations[match.keypointIndices[side]!];
        if (
          observation &&
          !isDeepStrictEqual(observation.slice(0, 2), match.xy[side])
        )
          throw new Error(
            `Frozen keypoint coordinate differs in working image ${name}`
          );
        return observation;
      });
      const a = observations[0],
        b = observations[1];
      const sample = geometry[i]!.samples[m]!;
      const error = scores.pairs[i]!.metrics?.errorsPx[m];
      if (
        a &&
        b &&
        a[2] !== -1 &&
        a[2] === b[2] &&
        sample.positiveDepth &&
        sample.sufficientParallax &&
        error !== undefined &&
        error <= Number(settings.inlierThresholdPx)
      )
        trackIds.add(a[2]);
    });
    const usable =
      trackIds.size >= Number(settings.minBATracks) &&
      trackIds.size * 2 >= Number(settings.minBAObservations);
    if (usable) {
      edges.get(pair.images[0])!.add(pair.images[1]);
      edges.get(pair.images[1])!.add(pair.images[0]);
    }
    return {
      images: pair.images,
      trackIds: [...trackIds],
      trackCount: trackIds.size,
      observationCount: trackIds.size * 2,
      usable,
    };
  });
  const unseen = new Set(edges.keys());
  const components: string[][] = [];
  for (const name of edges.keys()) {
    if (!unseen.delete(name)) continue;
    const component = [name];
    for (const current of component)
      for (const neighbor of edges.get(current)!)
        if (unseen.delete(neighbor)) component.push(neighbor);
    components.push(component);
  }
  return {
    pairs: supportPairs,
    components,
    baParticipationEvaluated: false as const,
  };
}

/** Only consume exported point/track identities; no recorder point import or BA residual claim. */
function readWorkingTracks(source: string): WorkingTrack[] {
  return source.split(/\r?\n/).flatMap((line, i) => {
    if (!line.trim() || line.trimStart().startsWith('#')) return [];
    const fields = line.trim().split(/\s+/).map(Number);
    if (
      fields.length < 12 ||
      fields.length % 2 !== 0 ||
      fields.some((v) => !Number.isFinite(v))
    )
      throw new Error(`points3D.txt:${i + 1}: malformed working point/track`);
    const observations: [number, number][] = [];
    for (let k = 8; k < fields.length; k += 2)
      observations.push([
        handoffId(fields[k], 'track image ID'),
        fields[k + 1]!,
      ]);
    return [{ pointId: handoffId(fields[0], 'track point ID'), observations }];
  });
}

/** Baseline gauge receipt: metrics/gauge-baseline.json; candidate: <export>/gauge-evidence.json.
 * Receipt JSON: {inputSha256,colmap,anchors,stage,exportHashes,verified:true,
 * constraint:'first-pose-and-anchor-distances',evidencePaths:[retained log paths]}.
 * This is a human evidence attestation, not inferred native solver behavior.
 */
export async function safetyRun(
  runDirectory: string,
  candidateDirectory?: string
) {
  const manifestBytes = await readFile(join(runDirectory, 'manifest.json'));
  const manifest: unknown = JSON.parse(manifestBytes.toString('utf8'));
  validateManifest(manifest, 'pre-ba');
  const preparationSha256 = await checkPreparationSnapshot(
    runDirectory,
    manifest
  );
  const manifestSha256 = hash(manifestBytes);
  const baselinePath = join(runDirectory, 'metrics/safety-baseline.json');
  if (candidateDirectory !== undefined) {
    const frozen = object(
      JSON.parse(await readFile(baselinePath, 'utf8')),
      'frozen pre-BA gate'
    );
    if (
      frozen.manifestSha256 !== manifestSha256 ||
      frozen.preparationSha256 !== preparationSha256 ||
      frozen.preBaPassed !== true
    )
      throw new Error(
        'Completed manifest differs from the closed frozen pre-BA gate'
      );
  }
  const evidenceHashes = object(
    manifest.baselineEvidenceHashes,
    'baselineEvidenceHashes'
  );
  const evidenceIssues: string[] = [];
  for (const [path, expected] of Object.entries(evidenceHashes)) {
    const evidence = await readFile(resolve(runDirectory, path)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      }
    );
    if (evidence === null)
      evidenceIssues.push(`Missing baseline evidence: ${path}`);
    else if (hash(evidence) !== String(expected).toLowerCase())
      throw new Error(`Baseline evidence hash changed: ${path}`);
  }
  for (const path of [
    ...strings(manifest.behaviorEvidence, 'behaviorEvidence'),
    ...strings(manifest.effectiveSettingsEvidence, 'effectiveSettingsEvidence'),
    'metrics/gauge-baseline.json',
  ]) {
    if (evidenceHashes[path] === undefined)
      evidenceIssues.push(`Missing frozen evidence hash: ${path}`);
  }
  const bytes = await readFile(join(runDirectory, 'input/original.zip'));
  if (hash(bytes) !== manifest.input.sha256.toLowerCase())
    invalid('input.sha256', 'isolated original ZIP changed');
  const { model: original } = await readRecorderZip(bytes);
  const correspondence = object(
    manifest.correspondenceFile,
    'correspondenceFile'
  );
  const matchBytes = await readFile(
    resolve(runDirectory, String(correspondence.path))
  );
  if (hash(matchBytes) !== String(correspondence.hash).toLowerCase())
    invalid('correspondenceFile.hash', 'frozen correspondences changed');
  const readExport = async (directory: string) => {
    const cameras = await readFile(join(directory, 'cameras.txt'));
    const images = await readFile(join(directory, 'images.txt'));
    const points = await readFile(join(directory, 'points3D.txt'));
    return {
      model: {
        cameras: readWorkingCameras(cameras.toString('utf8')),
        images: readWorkingImages(images.toString('utf8')),
        tracks: readWorkingTracks(points.toString('utf8')),
      },
      source: {
        path: resolve(directory),
        hashes: {
          'cameras.txt': hash(cameras),
          'images.txt': hash(images),
          'points3D.txt': hash(points),
        },
      },
    };
  };
  const baseline = await readExport(join(runDirectory, 'exports/triangulated'));
  for (const [stage, value] of Object.entries(
    object(manifest.intrinsicsByStage, 'intrinsicsByStage')
  )) {
    const camera = object(value, `intrinsicsByStage.${stage}`);
    if (
      ![...original.cameras, ...baseline.model.cameras].some(
        (known) =>
          known.cameraId === camera.cameraId &&
          known.width === camera.width &&
          known.height === camera.height &&
          (['fx', 'fy', 'cx', 'cy'] as const).every(
            (key) => known.intrinsics[key] === camera[key]
          )
      )
    ) {
      throw new Error(
        `Stage ${stage}: recorded intrinsics/camera association differ from the input handoff`
      );
    }
  }
  const candidate =
    candidateDirectory === undefined
      ? null
      : await readExport(candidateDirectory);
  const checked = safetyModels(
    original,
    baseline.model,
    candidate?.model ?? null,
    JSON.parse(matchBytes.toString('utf8')),
    manifest
  );
  const scoreBytes = await readFile(
    join(runDirectory, 'metrics/scores-baseline.json')
  );
  const frozenScores = object(
    JSON.parse(scoreBytes.toString('utf8')),
    'frozen baseline scores'
  );
  for (const [key, expected] of Object.entries({
    inputSha256: hash(bytes),
    colmap: manifest.colmap,
    metricFormula: manifest.metricFormula,
    pixelConvention: manifest.pixelConvention,
    policy: checked.epipolar.policy,
    before: checked.epipolar.before,
    correspondences: {
      path: resolve(runDirectory, String(correspondence.path)),
      sha256: hash(matchBytes),
    },
    baseline: {
      path: baseline.source.path,
      hashes: {
        'cameras.txt': baseline.source.hashes['cameras.txt'],
        'images.txt': baseline.source.hashes['images.txt'],
      },
    },
  }))
    if (!isDeepStrictEqual(frozenScores[key], expected))
      throw new Error(`Safety ${key} differs from frozen baseline scores`);
  const gauges = [];
  for (const [stage, path, exported] of [
    [
      'triangulated',
      join(runDirectory, 'metrics/gauge-baseline.json'),
      baseline,
    ],
    ...(candidate
      ? [
          [
            'adjusted',
            join(candidate.source.path, 'gauge-evidence.json'),
            candidate,
          ] as const,
        ]
      : []),
  ] as const) {
    const receiptBytes = await readFile(path).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      }
    );
    if (!receiptBytes) {
      evidenceIssues.push(`${stage}: missing gauge evidence`);
      continue;
    }
    const receipt = object(
      JSON.parse(receiptBytes.toString('utf8')),
      'gauge evidence'
    );
    // ponytail: one explicit gauge; a different native gauge needs reviewed evidence and a separate checker.
    if (
      receipt.verified !== true ||
      receipt.constraint !== 'first-pose-and-anchor-distances' ||
      receipt.stage !== stage ||
      receipt.inputSha256 !== hash(bytes) ||
      !isDeepStrictEqual(receipt.colmap, manifest.colmap) ||
      !isDeepStrictEqual(receipt.anchors, manifest.gaugeAnchors) ||
      !isDeepStrictEqual(receipt.exportHashes, exported.source.hashes)
    )
      evidenceIssues.push(
        `${stage}: unverified, unsupported or stale gauge evidence`
      );
    const paths = strings(receipt.evidencePaths, 'gauge evidencePaths');
    const sources: Record<string, string> = {};
    for (const evidencePath of paths) {
      const bytes = await readFile(resolve(runDirectory, evidencePath)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        }
      );
      if (!bytes) {
        evidenceIssues.push(
          `${stage}: missing gauge evidence source ${evidencePath}`
        );
        continue;
      }
      sources[evidencePath] = hash(bytes);
      if (
        stage === 'triangulated' &&
        String(evidenceHashes[evidencePath]).toLowerCase() !==
          sources[evidencePath]
      )
        evidenceIssues.push(
          `Baseline gauge evidence is not frozen: ${evidencePath}`
        );
    }
    gauges.push({ path, sha256: hash(receiptBytes), receipt, sources });
  }
  const preBaPassed =
    candidate !== null ||
    (checked.before.passed && evidenceIssues.length === 0);
  const report = {
    ...checked,
    manifestSha256,
    preparationSha256,
    frozenManifest: manifest,
    inputSha256: hash(bytes),
    baseline: baseline.source,
    candidate: candidate?.source ?? null,
    baselineScoresSha256: hash(scoreBytes),
    gauges,
    evidenceIssues,
    preBaPassed,
    passed: preBaPassed && checked.passed && evidenceIssues.length === 0,
    finalAcceptanceEvaluated: false as const,
  };
  if (candidate) {
    const frozen = object(
      JSON.parse(await readFile(baselinePath, 'utf8')),
      'frozen pre-BA gate'
    );
    for (const key of ['baseline', 'before', 'baselineScoresSha256'] as const)
      if (!isDeepStrictEqual(frozen[key], report[key]))
        throw new Error(`Safety ${key} differs from frozen pre-BA gate`);
  }
  // Only a passing baseline reserves the closed gate; retain failed attempts separately.
  const reportPath =
    !candidate && preBaPassed
      ? baselinePath
      : join(
          runDirectory,
          `metrics/safety-${hash(new TextEncoder().encode(JSON.stringify(report)))}.json`
        );
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
  });
  return { report, reportPath };
}

function invalid(field: string, message: string): never {
  throw new Error(`Manifest ${field}: ${message}`);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(field, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function at(value: Record<string, unknown>, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split('.')) {
    current = object(current, path)[key];
  }
  return current;
}

function filled(
  value: unknown,
  field: string,
  pendingAllowed: boolean,
  emptyAllowed = false
): void {
  if (value === 'pending' && pendingAllowed) {
    return;
  }
  if (
    value === undefined ||
    value === null ||
    value === 'pending' ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    invalid(field, 'missing or pending value');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    invalid(field, 'expected a finite value');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0 && !emptyAllowed) {
      invalid(field, 'must not be empty');
    }
    for (const [key, child] of entries) {
      filled(child, `${field}.${key}`, pendingAllowed, emptyAllowed);
    }
  }
}

function text(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '' || value === 'pending') {
    invalid(field, 'expected nonempty text');
  }
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalid(field, 'expected a nonempty array');
  }
  value.forEach((item) => text(item, field));
  return value as string[];
}

function sha256Value(value: unknown, field: string): void {
  if (typeof value !== 'string' || !/^[\da-f]{64}$/i.test(value)) {
    invalid(field, 'expected a SHA-256 hex digest');
  }
}

function number(
  value: unknown,
  field: string,
  min: number,
  max: number,
  exclusiveMin: boolean
): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (exclusiveMin ? value <= min : value < min) ||
    value > max
  ) {
    invalid(
      field,
      `expected a finite number ${exclusiveMin ? '>' : '>='} ${min} and <= ${max}`
    );
  }
}

function sameNames(expected: string[], actual: string[], field: string): void {
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== actual.length ||
    actual.some((name) => !expected.includes(name))
  ) {
    invalid(
      field,
      'expected the complete case-sensitive set, without missing, duplicate or unexpected names/pairs'
    );
  }
}

function pairKey(names: string[]): string {
  const [a, b] = names as [string, string];
  return JSON.stringify(a < b ? [a, b] : [b, a]);
}

function pairs(value: unknown, names: string[], field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalid(field, 'expected nonempty required pairs');
  }
  return value.map((pair, i) => {
    const entry = object(pair, `${field}[${i}]`);
    const images = strings(entry.images, `${field}[${i}].images`);
    if (
      images.length !== 2 ||
      images[0] === images[1] ||
      images.some((name) => !names.includes(name))
    ) {
      invalid(field, 'pair must name two distinct model images exactly');
    }
    if (entry.required !== true) {
      invalid(`${field}[${i}].required`, 'must be true');
    }
    return pairKey(images);
  });
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
