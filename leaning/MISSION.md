# Mission: Build the browser-compatible COLMAP boundary for Task 2

## Why

Implement and explain the early Task 2 slices: prove in-memory ZIP copy-through, build a trustworthy typed model and validator, parse the recorder's COLMAP text profile, then serialize and compare models without hiding meaningful changes.

## Success looks like

- Build a synthetic recorder-like archive entirely from `Uint8Array` values.
- Use zip.js to distinguish files from explicit directory records.
- Rebuild the archive from the opened inventory while replacing one selected file.
- Verify paths, entry kinds, and decompressed payload bytes after reopening.
- Explain why ZIP container bytes and metadata are not part of this preservation test.
- Separate TypeScript's compile-time model from runtime validation of untrusted values.
- Validate IDs, camera/image/point fields, references, poses, and the supported 1A profile without mutating data.
- Keep the public `./colmap` entry small, intentional, and browser-compatible.
- Decode COLMAP payloads strictly from `Uint8Array` and retain useful file and line context on failure.
- Parse the three supported record grammars without accidentally accepting JavaScript's broader number syntax.
- Serialize valid models with canonical headers, spaces, newlines, numeric strings, record order, and quaternion sign.
- Prove non-identity poses survive the text boundary without conversion or inversion.
- Distinguish semantic equivalence from exact no-op preservation.
- Produce deterministic canonical text without copying source formatting or rounding values.
- Return the first model difference with a stable path and reason.

## Constraints

- Use browser-compatible APIs: no `node:fs`, `Buffer`, or temporary extraction directory.
- Work in TypeScript with `@zip.js/zip.js` 2.8.26 and Vitest.
- Learn responsibilities as separate blocks, then connect them during pair programming.
- Use focused tests and preserve invalid input exactly; the validator must reject rather than repair.
- Keep parsing, validation, and writing separate enough that each failure has one clear owner.
- Compare record structure exactly while applying tolerance only to approved floating fields.

## Out of scope

- ZIP production adapters, public round-trip functions, and image-reference resolution.
- CLI, real fixtures, LichtFeld, bundle adjustment, AppFramework, and RecorderApp integration.
- General-purpose deep equality, arbitrary comparison policies, or diff accumulation.
