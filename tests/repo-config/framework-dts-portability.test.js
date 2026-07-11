// Repo-meta test: the AppFramework must declare `redux` as a DIRECT
// dependency (not only transitively via @reduxjs/toolkit).
//
// Why this test matters: the framework's public API types reference redux
// types (`Reducer`, `Action`, …) re-exported through @reduxjs/toolkit. When
// `redux` is not a direct dependency, tsdown's d.ts bundling cannot
// externalize those types and inlines them into a private dist chunk
// (`dist/redux-<hash>.d.ts`) that is NOT reachable through the package
// `exports` map. Consumers that compile with `composite`/`declaration`
// (e.g. GpsPlusSlamJs_QrTrackingDemo) then fail with TS2883 ("cannot be
// named without a reference to …/dist/redux-<hash>"): the inferred types of
// perfectly ordinary calls like `createSlamAppStore(...)` become unnameable.
// The core library (gps-plus-slam-js) declares `redux`/`redux-thunk`
// directly for exactly this reason — this test keeps the framework aligned
// so its d.ts always says `from "redux"` instead of bundling a copy.
//
// Found 2026-07-11 when the simplify loop's local `link:` override changed
// module dedupe enough for TS to stop finding a portable fallback name.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const frameworkDir = resolve(repoRoot, 'GpsPlusSlamJs_AppFramework');

describe('AppFramework d.ts portability', () => {
  it('declares redux as a direct dependency alongside @reduxjs/toolkit', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(frameworkDir, 'package.json'), 'utf8'),
    );
    expect(pkg.dependencies['@reduxjs/toolkit']).toBeDefined();
    expect(
      pkg.dependencies.redux,
      'redux must be a direct dependency so tsdown externalizes redux types ' +
        'in the built d.ts instead of bundling them into a private chunk',
    ).toBeDefined();
  });

  it('built dist contains no bundled redux d.ts chunk (when dist exists)', () => {
    // The dist check only runs when the framework has been built — the
    // manifest check above is the always-on guard; this one catches a
    // future tsdown behavior change that re-bundles despite the manifest.
    const distDir = resolve(frameworkDir, 'dist');
    if (!existsSync(distDir)) return;
    const bundledReduxChunks = readdirSync(distDir).filter((f) =>
      /^redux-.*\.d\.ts$/.test(f),
    );
    expect(bundledReduxChunks).toEqual([]);
  });
});
