# Mission: Build and demonstrate the COLMAP boundary for Task 2

## Why

Implement and explain the early Task 2 slices: prove in-memory ZIP copy-through, build a trustworthy typed model and validator, parse and serialize the recorder's COLMAP text profile, compare models without hiding meaningful changes, turn the ZIP experiment into one safe archive adapter, connect those owners through the public read/write round trip, and expose that verified core through one safe local Node command.

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
- Inventory an untrusted ZIP without rewriting its stored entry paths.
- Reject unsafe paths, kind/path mismatches, duplicate paths, Windows case collisions, partial text models, and text/binary coexistence.
- Resolve every model-referenced image by its exact case-sensitive archive path.
- Copy every archive entry while replacing exactly the three generated sparse text payloads.
- Preserve opaque archive state beside the editable typed model without exposing ZIP internals publicly.
- Compose public read, write, summary, and unchanged round-trip operations from the existing validator, codec, adapter, and comparisons.
- Reopen emitted bytes and prove semantic equality, exact no-op preservation, serializer replacements, and untouched archive preservation before success.
- Derive the assignment summary from the typed model and select image ID `1` explicitly.
- Import the compiled public core from a thin Node ESM CLI instead of bypassing the package boundary.
- Reject invalid input/output path states without modifying the input, creating directories, or overwriting output.
- Publish verified ZIP bytes through a unique temporary sibling and final rename, with cleanup on failure.
- Prove exit status, summary output, delayed publication, and cleanup through a real subprocess test.

## Constraints

- Use browser-compatible APIs: no `node:fs`, `Buffer`, or temporary extraction directory.
- Work in TypeScript with `@zip.js/zip.js` 2.8.26 and Vitest.
- Learn responsibilities as separate blocks, then connect them during pair programming.
- Use focused tests and preserve invalid input exactly; the validator must reject rather than repair.
- Keep parsing, validation, and writing separate enough that each failure has one clear owner.
- Compare record structure exactly while applying tolerance only to approved floating fields.
- Keep archive entries in memory and preserve unknown files and explicit directory records.
- Keep ZIP ownership in one adapter instead of adding a second archive reconstruction path.
- Keep public orchestration thin: connect existing owners instead of reimplementing their rules.
- Confine filesystem and process APIs to `scripts/`; keep `src/colmap/` browser-compatible.

## Out of scope

- Real fixtures, LichtFeld, bundle adjustment, AppFramework, and RecorderApp integration.
- General-purpose deep equality, arbitrary comparison policies, or diff accumulation.
- Path repair, extraction, URL decoding, Unicode normalization, and ZIP metadata preservation.
