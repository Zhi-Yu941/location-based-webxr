import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import {
  handoffRun,
  prepareRun,
  safetyRun,
  scoreRun,
  validateManifest,
} from '../dist/refiner-experiment.js';

async function main() {
  const [stage, run, ...extra] = process.argv.slice(2);
  if (stage === 'safety' && run !== undefined && extra.length <= 1) {
    const { report, reportPath } = await safetyRun(
      resolve(run),
      extra[0] === undefined ? undefined : resolve(extra[0])
    );
    console.log(`Safety report: ${reportPath}`);
    console.log(`Pre-BA gate: ${report.preBaPassed ? 'pass' : 'not passed'}`);
    console.log(
      'Safety checks only; BA participation and final acceptance are not evaluated.'
    );
    if (!report.passed) process.exitCode = 2;
    return;
  }
  if (stage === 'score' && run !== undefined && extra.length <= 1) {
    const { report, reportPath } = await scoreRun(
      resolve(run),
      extra[0] === undefined ? undefined : resolve(extra[0])
    );
    console.log(`Score report: ${reportPath}`);
    console.log(
      'Epipolar metrics only; safety and final acceptance are not evaluated.'
    );
    if (
      report.before.medianOfPairMediansPx === null ||
      (report.after !== null && report.after.medianOfPairMediansPx === null)
    )
      process.exitCode = 2;
    return;
  }
  // No export: create the initial handoff. With an export: inspect it after
  // handoff and retain a separate pose table without replacing initial evidence.
  if (stage === 'handoff' && run !== undefined && extra.length <= 1) {
    const { poses, mappingPath } = await handoffRun(
      resolve(run),
      extra[0] === undefined ? undefined : resolve(extra[0])
    );
    console.log(`Handoff: ${resolve(run)} (${poses.length} mapped images)`);
    console.log(`Pose table: ${mappingPath}`);
    return;
  }
  if (stage !== 'prepare' || run === undefined || extra.length !== 0) {
    throw new Error(
      'Usage: node scripts/refiner-experiment.mjs prepare <run-manifest.json> | handoff <run-directory> [returned-txt-directory] | score <run-directory> [candidate-txt-directory] | safety <run-directory> [candidate-txt-directory]'
    );
  }
  const manifestPath = resolve(run);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(manifest, 'preparation');
  const manifestDirectory = dirname(manifestPath);
  manifest.input.path = resolve(manifestDirectory, manifest.input.path);
  for (const kind of ['overlapEvidence', 'driftEvidence']) {
    manifest[kind].paths = manifest[kind].paths.map((path) =>
      resolve(manifestDirectory, path)
    );
  }
  const runsRoot = fileURLToPath(
    new URL('../experiment-runs/', import.meta.url)
  );
  const { runDirectory, dataset } = await prepareRun(manifest, runsRoot);
  console.log(`Prepared run: ${runDirectory}`);
  console.log(`Referenced images: ${dataset.model.images.length}`);
  console.log(`Input SHA-256: ${manifest.input.sha256}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
