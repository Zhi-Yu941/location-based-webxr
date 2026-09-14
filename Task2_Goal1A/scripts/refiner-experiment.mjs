import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { prepareRun, validateManifest } from '../dist/refiner-experiment.js';

async function main() {
  const [stage, run, ...extra] = process.argv.slice(2);
  if (stage !== 'prepare' || run === undefined || extra.length !== 0) {
    throw new Error(
      'Usage: node scripts/refiner-experiment.mjs prepare <run-manifest.json>'
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
