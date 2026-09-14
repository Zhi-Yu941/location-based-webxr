import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

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
