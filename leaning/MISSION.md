# Mission: Build the browser-compatible COLMAP boundary for Task 2

## Why
Implement and explain the early Task 2 slices: first prove an in-memory ZIP copy-through, then build a trustworthy typed COLMAP model, runtime validator, contextual error, and controlled public package surface.

## Success looks like
- Build a synthetic recorder-like archive entirely from `Uint8Array` values.
- Use zip.js to distinguish files from explicit directory records.
- Rebuild the archive from the opened inventory while replacing one selected file.
- Verify paths, entry kinds, and decompressed payload bytes after reopening.
- Explain why ZIP container bytes and metadata are not part of this preservation test.
- Separate TypeScript's compile-time model from runtime validation of untrusted values.
- Validate IDs, camera/image/point fields, references, poses, and the supported 1A profile without mutating data.
- Keep the public `./colmap` entry small, intentional, and browser-compatible.

## Constraints
- Use browser-compatible APIs: no `node:fs`, `Buffer`, or temporary extraction directory.
- Work in TypeScript with `@zip.js/zip.js` 2.8.26 and Vitest.
- Learn responsibilities as separate blocks, then connect them during pair programming.
- Use focused tests and preserve invalid input exactly; the validator must reject rather than repair.

## Out of scope
- COLMAP text parsing or serialization.
- ZIP production adapters, public round-trip functions, and image-reference resolution.
- CLI, real fixtures, LichtFeld, bundle adjustment, AppFramework, and RecorderApp integration.
