import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { readRecorderZip } from './colmap/index.js';
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
  const manifest = value;
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
    `${JSON.stringify({ input: { before, copy, after }, images: imageHashes, suitabilityEvidence }, null, 2)}\n`,
    { flag: 'wx' }
  );
  return { runDirectory, dataset };
}

type RecorderModel = Awaited<ReturnType<typeof readRecorderZip>>['model'];
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
  model: RecorderModel,
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
