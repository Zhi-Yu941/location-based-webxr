import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { link, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { roundTripRecorderZip } from '../dist/colmap/index.js';

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await run(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

async function run(args) {
  if (args.length !== 2) {
    throw new Error('Usage: colmap-round-trip <input.zip> <output.zip>');
  }

  const input = resolve(args[0]);
  const output = resolve(args[1]);
  if (input === output) {
    throw new Error('Input and output paths must differ');
  }

  await requireFile(input);
  await requireDirectory(dirname(output));
  await requireMissing(output);

  const result = await roundTripRecorderZip(await readFile(input));
  const temporary = join(
    dirname(output),
    `.${basename(output)}.${randomUUID()}.tmp`
  );

  try {
    await writeFile(temporary, result.outputZipBytes, { flag: 'wx' });
    // Node has no portable no-replace rename. The hard link intentionally
    // replaces the plan's literal rename so publication cannot overwrite.
    await link(temporary, output);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  await cleanupPublishedTemporary(temporary);

  const { camera, image1, imageCount } = result.summary;
  console.log(`Images: ${imageCount}`);
  console.log(
    `Camera ${camera.cameraId}: ${camera.model} ${camera.width}x${camera.height} ` +
      `fx=${camera.intrinsics.fx} fy=${camera.intrinsics.fy} ` +
      `cx=${camera.intrinsics.cx} cy=${camera.intrinsics.cy}`
  );
  console.log(`Image 1 world-to-camera qvec: [${image1.pose.qvec.join(', ')}]`);
  console.log(`Image 1 world-to-camera tvec: [${image1.pose.tvec.join(', ')}]`);
  console.log(`Output ZIP: ${output}`);
}

export async function cleanupPublishedTemporary(
  temporary,
  removeTemporary = unlink,
  warn = console.warn
) {
  try {
    await removeTemporary(temporary);
  } catch (error) {
    warn(
      `Warning: output was published but temporary cleanup failed: ${
        error instanceof Error ? error.message : error
      }`
    );
  }
}

async function requireFile(path) {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Input file does not exist: ${path}`, { cause: error });
    }
    throw error;
  }
  if (!details.isFile()) {
    throw new Error(`Input path is not a file: ${path}`);
  }
}

async function requireDirectory(path) {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Output parent does not exist: ${path}`, {
        cause: error,
      });
    }
    throw error;
  }
  if (!details.isDirectory()) {
    throw new Error(`Output parent is not a directory: ${path}`);
  }
}

async function requireMissing(path) {
  try {
    await stat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Output already exists: ${path}`);
}
