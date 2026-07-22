# Task 2 Goal 1A - Shared COLMAP ZIP Reader/Writer Contract and Implementation Plan

> **Status: Proposed shared Team 6 plan.** This document merges the current Filip and Mingna proposals using the accepted decisions in `OWNER_DECISIONS.md` and the dispositions in `reviews/task2-goal1a-technical-comparison.md`. It becomes the implementation contract only after Filip and Mingna confirm the approval checklist in section 18. It does not select a pose-refinement algorithm or define 1B-1D in detail.

The labels 1A, 1B, 1C, and 1D are Team 6 planning labels, not assignment terminology.

In sections 3-18, **MUST** and **MUST NOT** define 1A acceptance behavior. **SHOULD** is the proposed default and may change only through an explicit Team 6 review. Sections 19 and 20 are informational and do not expand 1A implementation scope.

## 1. Authority and decision order

If this plan conflicts with another document, use this order:

1. `Team 6 - Reality Reconstruction via Gaussian Splats.pdf`, especially sections 2.2, 2.3 component 1, and 2.5.1;
2. decisions explicitly confirmed by Simon and recorded in `OWNER_DECISIONS.md`;
3. the remaining accepted assignment, agreed-Team, technical-Team, and deferred entries in `OWNER_DECISIONS.md`;
4. verified repository and Task 1 fixture behavior;
5. this plan after Team 6 accepts it;
6. the current independent proposals;
7. the technical comparison and other reviewer recommendations.

A proposal detail is not accepted merely because it appears in one draft. A conflict discovered during implementation must be brought back to Filip and Mingna and recorded before the contract is changed.

## 2. Goal 1 position and the purpose of 1A

Task 2 ultimately aims to prove that improving recorder camera poses produces measurably better Gaussian splats. Goal 1 builds the tools and evidence needed before Team 6 chooses a refinement method. Team 6's current working progression is:

```text
1A - trustworthy COLMAP ZIP reader/writer (current work)

later Goal 1 evidence:
  1B - reproducible LichtFeld build and ZIP-to-splat procedure
  1C - measurement harness
  -> 1D - pose research, options, and recommendation
  -> Team 6 and Simon review gate
  -> Goal 2 prototype of the selected refinement approach
```

This is a planning order, not a claim that every later activity is a strict serial dependency. OD-001 records Simon's decision that Team 6's 1A reader/writer stage is first. The assignment separately fixes that the reader/writer and measurement capability exist before refinement and that the research/options review is a gate before selecting an approach. The exact 1B/1C work split and completion gates remain later decisions.

1A is the current implementation priority. Its purpose is to prove that Team 6 can read a recorder ZIP, understand its COLMAP model without changing its meaning, and emit a compatible recorder ZIP without losing unrelated data. Later quality experiments must be able to trust this boundary.

Completing 1A does not complete Goal 1 and does not improve any pose.

## 3. Normative 1A outcome

Given a local recorder ZIP, the 1A tool MUST:

1. open the ZIP without changing or extracting the source fixture;
2. locate `sparse/0/cameras.txt`, `sparse/0/images.txt`, and `sparse/0/points3D.txt`;
3. parse those files into the typed model in section 8;
4. validate the supported recorder profile, IDs, references, numeric values, and pose conventions;
5. resolve every image referenced by `images.txt` at `images/<NAME>`;
6. print the required summary through a local CLI;
7. serialize the unchanged typed model through the real writer;
8. replace only the three COLMAP text entries in a copied archive;
9. reopen and verify the emitted ZIP before reporting success; and
10. pass one recorded external LichtFeld compatibility smoke test after the fast local checks pass.

The reusable implementation MUST run locally and offline after dependencies are installed. It MUST NOT call a server, remote API, cloud service, authentication system, or LichtFeld process.

## 4. Scope and explicit non-goals

### Included in 1A

- recorder ZIP input and recorder ZIP output;
- mandatory COLMAP `.txt` support;
- the verified recorder-specific `PINHOLE` profile;
- cameras, intrinsics, images, world-to-camera poses, points3D, IDs, references, observations, and tracks in a typed model;
- empty recorder observations and tracks;
- preservation of referenced images, unreferenced images, `actions/`, `session.json`, directory records, and unknown archive entries;
- deterministic text serialization and two separate model-comparison checks;
- a browser-compatible TypeScript core and an internal Node CLI wrapper;
- fast unit, archive, synthetic integration, and Task 1 fixture-replay checks;
- one external LichtFeld compatibility gate.

### Not included in 1A

- binary COLMAP support;
- generic COLMAP support, a camera-model registry, multiple cameras, or non-`PINHOLE` cameras;
- populated feature observations or point tracks;
- parsing or using action logs, depth, GPS, odometry, or session metadata;
- modifying camera intrinsics, points3D, image names, or image membership;
- pose refinement, loop closure, bundle adjustment, pose graphs, ICP, or trainer-side pose optimization;
- a measurement harness, held-out split, PSNR, SSIM, or reprojection-error calculation;
- building LichtFeld from source, comparing source and prebuilt releases, tuning settings, or automating repeated training;
- a page, hosted application, CSUtils button, recorder integration, or final end-user error presentation;
- a public result framework, a large error hierarchy, archive-bomb hardening for arbitrary untrusted uploads, or a generic ZIP library;
- byte-identical generated COLMAP text or byte-identical ZIP containers;
- any claim of pose or splat-quality improvement.

These exclusions keep the current implementation narrow. They do not remove later Goal 1 or Goal 2 work.

## 5. Component boundary and ownership

The accepted data flow is:

```text
local input path
  -> Node CLI reads Uint8Array
  -> round-trip orchestrator
  -> recorder ZIP adapter opens and inventories entries
  -> COLMAP text codec parses three text payloads into internal candidate records
  -> codec invokes the typed model validator and returns a validated model
  -> summary from the validated model
  -> COLMAP text codec serializes all three files
  -> recorder ZIP adapter copies all entries and replaces three texts
  -> round-trip orchestrator reopens and verifies output bytes
  -> Node CLI writes the verified ZIP to a local output path
```

Ownership MUST remain exclusive:

| Component | Owns | Must not own |
|---|---|---|
| Typed model | COLMAP data values and ordered records | ZIP entries, filesystem paths, LichtFeld, refinement |
| Model validator | Pure validation/narrowing of internal parsed candidates and public models before serialization: supported profile, IDs, references, numeric ranges, empty observation/track rules, pose validity | Text tokenization, ZIP I/O, repair or normalization |
| COLMAP text codec | Grammar for the three text files, creation of internal candidate records, invocation of validation, parse/serialize behavior, deterministic generated text | ZIP layout, image bytes, local paths, LichtFeld, refinement, measurement |
| Recorder ZIP adapter | ZIP reader/writer lifecycle, entry paths, entry inventory, image resolution, opaque copy-through, selected replacements | COLMAP syntax, pose conversion, summary calculation, LichtFeld |
| Round-trip orchestrator | Calling the adapter, codec, validator, comparisons, and summary in the required order | A second parser or ZIP implementation |
| Node CLI | Local path handling, console output, exit status, temporary output and final rename | COLMAP parsing, model serialization, archive reconstruction |
| External smoke procedure | Recorded proof that an identified LichtFeld build accepts the emitted data | Reusable reader/writer runtime behavior or quality measurement |

No second archive writer may reconstruct the ZIP from only the typed COLMAP model. That would drop opaque recorder data and violate the preservation contract.

## 6. Proposed runtime and repository placement

This section resolves exact module placement for implementation, which `OWNER_DECISIONS.md` intentionally left to Team 6. It is a new Team 6 proposal, not an assignment or Simon decision, and requires explicit approval in section 18.

The reusable core will live in a new public AppFramework subpath:

```text
GpsPlusSlamJs_AppFramework/src/colmap/
  model.ts
  validate.ts
  text-codec.ts
  model-comparison.ts
  recorder-zip-adapter.ts
  round-trip.ts
  index.ts
```

Tests will be colocated as `*.test.ts` files under the same directory. The AppFramework package configuration will add a `./colmap` export and the explicit `src/colmap/index.ts` build entry required by its current `tsdown` configuration.

The internal CLI will live at:

```text
GpsPlusSlamJs_AppFramework/scripts/colmap-round-trip.mjs
```

The CLI is not part of the published package because the AppFramework package currently publishes only `dist`. It imports the compiled `../dist/colmap/index.js` entry. The AppFramework package script will be named `colmap:roundtrip`, will build the AppFramework first, and will invoke the CLI as:

```text
pnpm --filter gps-plus-slam-app-framework run colmap:roundtrip -- <input.zip> <output.zip>
```

The CLI may use `node:fs/promises`; files under `src/colmap/` MUST NOT import `node:*`, use `Buffer`, or access filesystem/process APIs. A subprocess test at `GpsPlusSlamJs_AppFramework/scripts/colmap-round-trip.test.mjs` will exercise the built `./colmap` export and CLI boundary after the package build.

The implementation will use the existing `@zip.js/zip.js` dependency directly inside the single recorder ZIP adapter. No new production dependency is planned.

### Existing code reuse decision

- `GpsPlusSlamJs_AppFramework/src/storage/zip-reader.ts` and `zip-export.ts` are behavior references only. They do not provide arbitrary archive copy-through with selected replacement and therefore cannot own the 1A round trip.
- `GpsPlusSlamJs_AppFramework/src/test-utils/zip-round-trip-helpers.ts` may inform test style, but it does not generate the required `sparse/0/` model and is not the 1A fixture helper.
- `GpsPlusSlamJs_RecorderApp/src/colmap/colmap-serializers.ts` is generation-only and rounds/clamps some values. It MUST NOT be imported by the new codec.
- `GpsPlusSlamJs_RecorderApp/src/colmap/colmap-conversions.ts` confirms the coordinate convention but MUST NOT run in 1A because recorder ZIP values are already in COLMAP coordinates.
- `GpsPlusSlamJs_RecorderApp/src/colmap/colmap-zip-contributor.ts` writes from live recorder state and is not an input-ZIP adapter.
- Existing recorder, exporter, storage, and COLMAP files remain unchanged in 1A unless Team 6 explicitly revises this plan.

This dependency direction keeps the reusable core available to the recorder later without making the AppFramework depend on RecorderApp internals.

## 7. Recorder ZIP contract

### 7.1 Public core boundary

The browser-compatible public core accepts and returns `Uint8Array`. Local filesystem paths exist only in the Node CLI. The high-level seam preserves the source archive state alongside the editable typed model:

```ts
/** Opaque archive state. Only readRecorderZip creates values of this type. */
declare const recorderArchiveSourceBrand: unique symbol;
interface RecorderArchiveSource {
  readonly [recorderArchiveSourceBrand]: true;
}

interface RecorderDataset {
  readonly model: RecorderColmapModel;
  /** Passed unchanged to writeRecorderZip so opaque entries survive. */
  readonly sourceArchive: RecorderArchiveSource;
}

interface DatasetSummary {
  readonly imageCount: number;
  readonly point3DCount: number;
  readonly camera: PinholeCamera;
  readonly image1: ColmapImage;
  readonly referencedImageCount: number;
}

interface RoundTripVerification {
  readonly semanticModel: true;
  readonly exactNoOpModel: true;
  readonly untouchedEntries: true;
  readonly replacementPaths: readonly [
    "sparse/0/cameras.txt",
    "sparse/0/images.txt",
    "sparse/0/points3D.txt"
  ];
}

interface RecorderRoundTripResult {
  readonly dataset: RecorderDataset;
  readonly summary: DatasetSummary;
  readonly outputZipBytes: Uint8Array;
  readonly verification: RoundTripVerification;
}

function readRecorderZip(zipBytes: Uint8Array): Promise<RecorderDataset>;

function writeRecorderZip(
  source: RecorderDataset,
  model: RecorderColmapModel
): Promise<Uint8Array>;

function summarizeRecorderModel(model: RecorderColmapModel): DatasetSummary;

function roundTripRecorderZip(
  zipBytes: Uint8Array
): Promise<RecorderRoundTripResult>;
```

`readRecorderZip` parses, validates, and resolves image references. `writeRecorderZip` validates the supplied model, resolves every supplied model image against `source.sourceArchive`, serializes it, and preserves the source archive. It then reopens the result through `readRecorderZip`, which resolves the written image references again, and verifies that the written model is semantically equal to the supplied model. A model that names an asset absent from the source cannot produce output. This is the later extension path: a future refiner edits `dataset.model`, while `dataset.sourceArchive` continues to carry opaque entries.

`summarizeRecorderModel` requires the record whose image ID is exactly `1`. If it is absent, the function throws a contextual `ColmapError` with `kind: "reference"` and `field: "imageId"`; it does not fall back to another record. `roundTripRecorderZip` calls the same read, summary, and write functions with the unchanged model, then adds exact no-op verification. It is not an alternate implementation.

`src/colmap/index.ts` exports the model and summary types, `ColmapError`, the four high-level functions above, and the two pure model-comparison functions in section 10. Low-level codec, validator, and ZIP-adapter helpers remain internal modules; tests may import them by relative source path, but package consumers use `./colmap`.

### 7.2 Internal archive-adapter boundary

```ts
type SparseTextPath =
  | "sparse/0/cameras.txt"
  | "sparse/0/images.txt"
  | "sparse/0/points3D.txt";

interface ArchiveEntry {
  readonly path: string;
  readonly kind: "file" | "directory";
  readonly bytes: Uint8Array;
}

type ArchiveFileEntry = ArchiveEntry & { readonly kind: "file" };

interface OpenedRecorderArchive {
  readonly entries: readonly ArchiveEntry[];
  readonly colmapText: Readonly<Record<SparseTextPath, Uint8Array>>;
}

interface RecorderZipAdapter {
  open(zipBytes: Uint8Array): Promise<OpenedRecorderArchive>;
  resolveImages(
    archive: OpenedRecorderArchive,
    images: readonly ColmapImage[]
  ): readonly ArchiveFileEntry[];
  copyWithReplacements(
    archive: OpenedRecorderArchive,
    replacements: Readonly<Record<SparseTextPath, Uint8Array>>
  ): Promise<Uint8Array>;
}
```

These internal types fix archive ownership. No public operation may introduce a directory-based model writer or a second ZIP owner.

### 7.3 Required input profile

The adapter MUST:

- require exactly one file entry at each of the three `SparseTextPath` values;
- fail on a partial text model;
- reject `cameras.bin`, `images.bin`, or `points3D.bin` under `sparse/0/`, including text/binary coexistence, so the output cannot contain two inconsistent models;
- reject duplicate normalized archive-entry paths and ASCII-case-folded path collisions, because the compatibility workflow materializes the dataset on Windows;
- reject invalid archive-entry paths or a mismatch between an entry's `kind` and path form rather than repairing them;
- compare image names case-sensitively and resolve each at exactly `images/<NAME>`;
- reject a missing referenced image;
- keep unreferenced images and all non-COLMAP data opaque.

The core MUST process archive entries in memory and MUST NOT extract them to the working tree. Task 1 fixtures are read-only inputs.

For 1A, a normalized archive-entry path is the original ZIP filename after it passes validation; normalization does not rewrite the string. A valid file-entry path:

- is a non-empty relative POSIX path using `/` only;
- does not begin or end with `/`;
- is not drive-qualified or UNC-like;
- contains no `\`, NUL, U+0000-U+001F, or U+007F;
- contains no repeated `/`, empty segment, `.` segment, or `..` segment.

A valid directory-entry path follows the same rules for the non-empty portion before one required trailing `/`. The trailing `/` is the only permitted empty final segment, and the entry MUST have `kind: "directory"`; a file entry MUST NOT end in `/`. The adapter does not URL-decode, Unicode-normalize, case-fold, reconstruct, or omit stored paths. ASCII case-folding is used only to detect a Windows collision.

### 7.4 Output preservation

The output MUST contain the same normalized archive-entry path and entry-kind set as the input. Exactly these three file-entry payloads are replaced:

- `sparse/0/cameras.txt`;
- `sparse/0/images.txt`;
- `sparse/0/points3D.txt`.

Every other archive entry MUST retain identical decompressed bytes, including:

- every image referenced by `images.txt`;
- unreferenced images;
- all `actions/` entries;
- `session.json`;
- explicit directory records; and
- any other unknown entry.

The following are not preserved or compared:

- compressed ZIP bytes;
- ZIP entry order;
- compression method or level;
- timestamps, comments, extra fields, or other container metadata.

## 8. Supported COLMAP profile and typed model

### 8.1 Supported text records

1A supports the current recorder profile:

```text
cameras.txt:
CAMERA_ID PINHOLE WIDTH HEIGHT FX FY CX CY

images.txt, two physical lines per record:
IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME
<empty observation line>

points3D.txt:
POINT3D_ID X Y Z R G B ERROR
```

The reader decodes each file as fatal UTF-8 and rejects a BOM, NUL, invalid UTF-8, or a bare carriage return. LF and CRLF input and an optional final line ending are accepted. Before the first data record, empty lines and lines whose first non-whitespace character is `#` are ignored. Comments after data begins are outside the 1A recorder profile. The empty second line of each `images.txt` record is structural and is not skipped.

Fields use one or more ASCII spaces or tabs. Quoted fields are unsupported. Exact token grammars are:

```text
UNSIGNED_INTEGER := 0 | [1-9][0-9]*
FLOAT := -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?
```

Syntactic parsing is followed by safe-integer, finite, sign, range, and reference validation. Values such as `+1`, `.5`, `1.`, `01`, hexadecimal, `NaN`, and `Infinity` are rejected. `-0` is accepted only as a float and serializes as `0`.

The codec validates exact record arity before conversion. A non-empty image observation line or point row with track tokens is detected by the codec and rejected as `unsupported-profile`; it is not parsed into populated public collections. The validator independently protects the invariant that public models supplied to the writer also contain empty collections.

The writer produces the canonical form in section 10; it does not retain original comments, whitespace, line endings, or numeric lexemes.

### 8.2 Typed model

The shared model is based on Filip's ordered recorder-specific model and Mingna's pure model/I/O separation:

```ts
type CameraId = number;
type ImageId = number;
type Point3DId = number;
type Point2DIndex = number;

type Vector3 = readonly [number, number, number];
type QuaternionWxyz = readonly [number, number, number, number];
type Rgb8 = readonly [number, number, number];

interface PinholeIntrinsics {
  readonly fx: number;
  readonly fy: number;
  readonly cx: number;
  readonly cy: number;
}

interface PinholeCamera {
  readonly cameraId: CameraId;
  readonly model: "PINHOLE";
  readonly width: number;
  readonly height: number;
  readonly intrinsics: PinholeIntrinsics;
}

/** Add later reviewed camera variants to this discriminated union. */
type ColmapCamera = PinholeCamera;

interface WorldToCameraPose {
  readonly qvec: QuaternionWxyz;
  readonly tvec: Vector3;
}

interface ImageObservation {
  readonly x: number;
  readonly y: number;
  readonly point3DId: Point3DId | null;
}

interface ColmapImage {
  readonly imageId: ImageId;
  readonly cameraId: CameraId;
  readonly name: string;
  readonly pose: WorldToCameraPose;
  readonly observations: readonly ImageObservation[];
}

interface Point3DTrackElement {
  readonly imageId: ImageId;
  readonly point2DIndex: Point2DIndex;
}

interface ColmapPoint3D {
  readonly point3DId: Point3DId;
  readonly xyz: Vector3;
  readonly rgb: Rgb8;
  readonly error: number;
  readonly track: readonly Point3DTrackElement[];
}

interface RecorderColmapModel {
  readonly cameras: readonly ColmapCamera[];
  readonly images: readonly ColmapImage[];
  readonly points3D: readonly ColmapPoint3D[];
}
```

Observations and tracks are explicit collections so later reviewed work can extend the model without replacing the seam. The 1A validator nevertheless requires both collections to be empty.

The array container and `ColmapCamera` alias are the extension point. If later evidence requires another camera shape or multiple cameras, a reviewed contract revision adds an explicit discriminated variant and relaxes the validator; it does not replace the model with a generic `model: string` plus unchecked `params: number[]` registry.

### 8.3 Validation rules

The validator MUST reject rather than repair invalid data:

- camera, image, and point IDs are positive safe integers and unique within their namespaces;
- IDs may be sparse or non-continuous;
- record-array order is source order and is preserved;
- exactly one `PINHOLE` camera is present;
- width and height are positive safe integers;
- `fx` and `fy` are positive finite numbers; `cx` and `cy` are finite;
- at least one image exists;
- every image references the supported camera;
- image names are unique, non-empty safe bare filenames without path separators or whitespace;
- all pose, XYZ, and error values are finite;
- point error is non-negative;
- RGB components are integers in `[0, 255]`;
- observations and tracks are empty;
- zero points3D records are allowed;
- no value is rounded, clamped, normalized, recentered, or inferred.

A safe bare image filename is a single non-empty token containing no `/`, `\`, quote, ASCII whitespace, NUL, or control character, and is not `.` or `..`. It is preserved and resolved case-sensitively. A `.jpg` suffix and `frame-NNNNNN.jpg` pattern match the current fixtures but are not parser requirements.

The summary/CLI demonstration has the additional assignment acceptance rule that image ID `1` MUST exist. `summarizeRecorderModel` enforces that rule as section 7.1 defines. The codec and general `readRecorderZip` operation still preserve sparse IDs, do not invent ID `1`, and may successfully read a supported model without it.

## 9. Coordinate and pose contract

`images.txt` stores a world-to-camera transform. Quaternion storage order is `[qw, qx, qy, qz]`, followed by translation `[tx, ty, tz]`.

With column vectors:

```text
X_camera = R(qvec) X_world + tvec
```

`tvec` is not the camera position. The camera center in world coordinates is:

```text
C = -R^T t
```

The reader and writer MUST NOT:

- swap world-to-camera with camera-to-world;
- treat `tvec` as camera center;
- silently reorder WXYZ to XYZW;
- repeat the recorder's WebXR-to-COLMAP basis conversion;
- flip axes, handedness, orientation, scale, units, or origin;
- normalize an invalid quaternion.

A quaternion is accepted when every component is finite and `abs(norm(q) - 1) <= 1e-6`. `q` and `-q` are the same rotation for semantic comparison. The writer preserves the supplied representative in an unchanged round trip, except that negative zero is emitted as `0`.

Tests MUST include non-identity rotations and translations. Identity-only tests cannot detect inversion, ordering, or handedness mistakes.

## 10. Text codec and round-trip guarantees

### 10.1 Codec boundary

```ts
interface ColmapTextFiles {
  readonly cameras: Uint8Array;
  readonly images: Uint8Array;
  readonly points3D: Uint8Array;
}

interface RecorderColmapTextCodec {
  parse(files: ColmapTextFiles): RecorderColmapModel;
  serialize(model: RecorderColmapModel): ColmapTextFiles;
}

type ModelComparison =
  | { readonly equal: true }
  | {
      readonly equal: false;
      readonly path: string;
      readonly reason:
        | "record-count"
        | "record-order"
        | "identifier"
        | "string-value"
        | "integer-value"
        | "numeric-value"
        | "quaternion-orientation"
        | "quaternion-sign"
        | "reference"
        | "observation"
        | "track";
    };

function semanticallyEqual(
  left: RecorderColmapModel,
  right: RecorderColmapModel
): ModelComparison;

function exactlyPreserved(
  before: RecorderColmapModel,
  after: RecorderColmapModel
): ModelComparison;
```

`RecorderColmapTextCodec.parse` is the public codec facade. Internally it tokenizes into implementation-private candidate records, invokes `validate.ts`, and returns one complete validated `RecorderColmapModel` or throws one contextual exception. It MUST NOT return a partial or unvalidated model. `serialize` invokes the same public-model validator before writing.

The two comparison functions are pure exports from `model-comparison.ts`; they are not codec methods. A failed comparison identifies the first difference in deterministic camera/image/point, record, and field order. `path` is a stable zero-based model path such as `cameras[0].intrinsics.fx`, `images[2].pose.qvec[0]`, or `points3D[4].track`; tests may rely on this notation but not on the prose error message.

The writer validates the complete model before generating any file. It MUST:

- preserve camera, image, and point source order;
- preserve IDs, names, references, scalar values, and the quaternion representative;
- use one ASCII space between fields;
- use round-trip-safe base-10 numeric formatting equivalent to `Number.prototype.toString` after validation;
- emit negative zero as `0`;
- emit one empty observation line after every image record;
- emit no track tokens in 1A;
- emit UTF-8 without a BOM, use LF, and finish every file with LF;
- recompute informational header counts from the model;
- produce identical bytes on repeated serialization of the same valid model.

It MUST NOT round integer fields, clamp RGB, normalize quaternions, use a fixed decimal precision, or copy the original sparse text as a substitute for serialization.

### 10.2 Canonical generated text

The generated headers are exact. Placeholders in braces are replaced with canonical numeric strings; braces are not emitted.

`cameras.txt`:

```text
# Camera list with one line of data per camera:
#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]
# Number of cameras: 1
{camera-id} PINHOLE {width} {height} {fx} {fy} {cx} {cy}
```

`images.txt`:

```text
# Image list with two lines of data per image:
#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME
#   POINTS2D[] as (X, Y, POINT3D_ID)
# Number of images: {image-count}, mean observations per image: 0
{image-id} {qw} {qx} {qy} {qz} {tx} {ty} {tz} {camera-id} {name}
<empty observation line>
```

The two-line image block repeats in model order. The final image pose is also followed by its empty observation line and the file's final LF.

`points3D.txt`:

```text
# 3D point list with one line of data per point:
#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)
# Number of points: {point-count}, mean track length: 0
{point-id} {x} {y} {z} {r} {g} {b} {error}
```

The point row repeats in model order. When `point-count` is zero, the file contains only the three header lines and their final LF. No blank line is inserted between a header and the first record in any file.

### 10.3 Separate guarantees

| Guarantee | Required meaning | Explicitly not required |
|---|---|---|
| Semantic model round trip | `parse -> serialize -> parse` preserves record counts/order, IDs, names, references, intrinsics, points, and poses; quaternion orientation is sign-invariant. | Original comments, spacing, line endings, or numeric text lexemes. |
| Exact no-op model preservation | An unchanged parsed model retains all JavaScript numeric values, order, IDs, names, references, and quaternion sign after serialization/reparse, with `-0` treated as `0`. | Equality after an actual refinement. |
| Deterministic generated text | Repeated serialization of one valid model produces identical generated UTF-8 bytes. | Equality with the recorder's original text bytes. |
| Untouched archive preservation | Same archive-entry path and kind set; identical decompressed bytes for every entry except the three selected sparse texts. | Identical compressed ZIP bytes or metadata. |

Record counts and order, IDs, references, dimensions, RGB, names, camera-model tags, and empty observation/track state compare exactly. Numeric tolerance applies only to floating intrinsics, quaternion/translation components, point XYZ, and point error.

The proposed 1A semantic floating comparison is:

```text
abs(a - b) <= max(1e-12, 1e-12 * max(abs(a), abs(b)))
```

The `1e-12` absolute/relative tolerance is a new Team 6 implementation choice taken from Filip's proposal; neither `OWNER_DECISIONS.md` nor the comparison selected it over Mingna's proposed `1e-6`. Filip and Mingna MUST confirm it in section 18. Its purpose is to allow floating comparison without accepting serializer drift that the round-trip-safe writer should avoid.

Quaternion semantic comparison first chooses the sign of the right quaternion whose dot product with the left is non-negative, then applies the floating comparison. Exact no-op comparison canonicalizes `-0` to `0` and otherwise uses exact JavaScript numeric equality, including the original quaternion sign; it uses no epsilon.

The round-trip demonstration MUST force all three sparse files through the writer. A successful ZIP copy that reuses the original COLMAP text is an archive test, not reader/writer acceptance evidence.

## 11. Lean failure contract

1A uses exceptions, not a public `Result` union and not an error-class hierarchy.

One small contextual exception type is sufficient:

```ts
type ColmapFailureKind =
  | "archive"
  | "unsupported-profile"
  | "syntax"
  | "validation"
  | "reference";

interface ColmapFailureContext {
  readonly kind: ColmapFailureKind;
  readonly path?: string;
  readonly line?: number;
  readonly field?: string;
}

class ColmapError extends Error {
  readonly kind: ColmapFailureKind;
  readonly path?: string;
  readonly line?: number;
  readonly field?: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    context: ColmapFailureContext,
    options?: { readonly cause?: unknown }
  );
}
```

All expected invalid-input, unsupported-profile, reference, and ZIP-library failures crossing a public 1A function MUST use this one error type. ZIP-library failures are wrapped with `kind: "archive"` and retained as `cause`; expected context is not discarded. Unexpected programmer defects are not converted into a misleading input error. The implementation MUST NOT create separate public subclasses for every failure.

Minimum behavior:

- archive errors identify the relevant entry when known;
- codec errors identify the COLMAP file and one-based physical line, and the field when practical;
- unsupported camera/binary/track shapes say which supported-profile rule was violated;
- missing references identify the image or camera ID and expected path;
- the CLI catches the exception, prints a concise error, and exits non-zero;
- an operation that fails produces no successful model and no successful output ZIP;
- tests assert `instanceof ColmapError`, the failure kind, and relevant context fields, not the complete human message.

The CLI writes the final output path only after the generated ZIP has reopened and passed all in-memory verification. It writes through a unique temporary sibling file and renames on success so a failed write is not presented as a valid result. On failure, it attempts to remove its own temporary file and never removes or overwrites the input.

## 12. CLI and assignment demonstration

The CLI is an internal Team 6 tool. It accepts exactly one explicit input ZIP path and one explicit output ZIP path. Their resolved absolute paths MUST differ. The input must be a readable file, the output parent directory must already exist, and the initial version MUST fail rather than create missing directories or overwrite an existing output.

The CLI MUST use `roundTripRecorderZip` from the compiled `../dist/colmap/index.js` entry and MUST NOT parse COLMAP text or construct ZIP entries itself.

For a successful run it prints, at minimum:

```text
Images: <count>
Camera <camera-id>: PINHOLE <width>x<height> fx=<fx> fy=<fy> cx=<cx> cy=<cy>
Image 1 world-to-camera qvec: [qw, qx, qy, qz]
Image 1 world-to-camera tvec: [tx, ty, tz]
Output ZIP: <path>
```

If the camera ID differs, the actual supported camera ID is printed. The assignment's "pose of image 1" means the record whose image ID is exactly `1`, not the first ZIP entry, first model record, or lowest ID. Absence of image ID `1` makes the assignment demonstration fail.

Before the CLI reports success, the orchestrator MUST:

1. parse and validate the input;
2. resolve all referenced images;
3. serialize all three sparse texts;
4. emit the replacement ZIP in memory;
5. reopen and parse the emitted ZIP;
6. pass semantic equivalence;
7. pass exact no-op preservation;
8. confirm the path set and untouched decompressed bytes; and
9. confirm the replacement path set is exactly the three sparse texts and each selected output payload equals the corresponding serializer result.

The CLI does not start LichtFeld. That remains a separately recorded manual or external procedure.

## 13. Test-first acceptance suite

Every implementation slice starts with a failing test for its next behavior. Tests are split so most development never waits for LichtFeld.

### 13.1 Typed model and validator tests

- one valid `PINHOLE` camera, one or more images, and zero or more points;
- sparse and non-continuous IDs with preserved source order;
- duplicate camera, image, point, and image-name rejection;
- missing camera reference rejection;
- invalid integer, range, RGB, non-finite, and quaternion values;
- empty observations and tracks accepted;
- populated observations and tracks rejected;
- serializer input is rejected instead of rounded, clamped, or normalized.

### 13.2 Codec tests

- parse a known camera, image, and point record;
- image pose line plus mandatory empty observation line;
- empty points3D body;
- malformed arity and numeric tokens;
- source-order retention;
- deterministic serialization;
- canonical `-0` handling;
- `parse -> serialize -> parse` semantic equivalence;
- exact no-op preservation as a separate assertion;
- `q` and `-q` semantic equivalence without hiding a no-op sign change;
- generated headers, field order, empty observation lines, LF endings, and final LF.
- a valid but noncanonical input whose comments, spacing, numeric lexemes, or CRLF endings differ from canonical output, proving the writer is executed instead of returning original text bytes.

### 13.3 Pose-convention tests

- identity world-to-camera pose;
- known translation proving that `tvec` is not camera center;
- known nontrivial rotation and a hand-computed transformed point;
- a case that fails when world-to-camera is interpreted as camera-to-world;
- WXYZ file order and explicit mapping to any XYZW math-library order;
- no recentering, scaling, basis conversion, or axis flip.

### 13.4 Archive tests with synthetic in-memory ZIPs

- required three-text profile;
- partial text model and binary coexistence rejection;
- unsafe and duplicate entry-path rejection;
- exact referenced-image resolution;
- missing referenced-image rejection;
- referenced and unreferenced image preservation;
- `actions/`, `session.json`, and unknown-entry preservation;
- explicit directory-record preservation;
- same normalized archive-entry path and entry-kind set;
- identical decompressed bytes for all untouched archive entries;
- replacement of exactly the three selected sparse texts;
- failure produces no successful output.

### 13.5 Orchestrator and CLI tests

- summary values come from the typed model, not comment headers or ZIP order;
- image ID `1` is explicitly selected;
- absence of image ID `1` fails the assignment demo;
- all three serializer outputs are used;
- emitted bytes are reopened and verified before success;
- each of the three emitted sparse payloads equals the actual serializer output, including for the noncanonical input case;
- CLI path handling is the only Node-specific layer;
- the built `./colmap` package export loads successfully and no file under `src/colmap/` imports `node:*`, uses `Buffer`, or accesses filesystem/process APIs;
- errors produce a non-zero exit and no final output path;
- successful output is moved into place only after verification.

### 13.6 Real Task 1 fixture replay

The following read-only fixture facts were verified directly on 2026-07-21:

| Fixture | SHA-256 | File entries / actions | Camera row | Model images / image assets | Points | Image ID `1` / unreferenced image |
|---|---|---:|---|---:|---:|---|
| `dev/task1-fixtures/first-capture.zip` | `cba147f0fc418ccf7f5b978d661d22c88172f806b36caafb12ffd31608176e76` | 124 / 108 | `1 PINHOLE 823 1920 1254.3877251148224 1254.169921875 411.5 960` | 11 / 12 | 820 | `frame-000002.jpg` / `frame-000001.jpg` |
| `dev/task1-fixtures/second-capture.zip` | `43699ee56b34a6ff985811aa29a7e123609be6f302c2a29a526723051972d0ca` | 155 / 133 | `1 PINHOLE 823 1920 1254.3877251148224 1254.169921875 411.5 960` | 17 / 18 | 1026 | `frame-000002.jpg` / `frame-000001.jpg` |

Both archives contain all three `sparse/0/*.txt` files, no corresponding `.bin` model files, root `session.json`, `actions/`, empty image observations, and empty point tracks. Every referenced image resolves. Current image and point IDs are sequential, but synthetic tests MUST still protect sparse-ID behavior so later refinement does not accidentally rely on array position.

At implementation start, Team 6 MUST recheck the two hashes before relying on the table. A mismatch means the fixture changed and the inventory must be repeated; it does not permit silently changing expectations.

The first fixture is the mandatory replay gate. The second is additional coverage and becomes mandatory if the first exposes an assumption that needs cross-fixture confirmation. The integration run MUST use a separate temporary output and MUST NOT extract, modify, repack, commit, or overwrite either fixture.

Repository verification shows that both fixture ZIPs are currently tracked files, despite older planning text describing `dev/` as ignored. Verified repository state takes precedence: treat them as immutable test inputs. Their replay may be an explicit local integration command rather than part of the default unit suite. A skipped default test is not acceptance evidence: section 17 requires a recorded successful fixture run.

Implementation evidence will be recorded in `reviews/task2-goal1a-implementation-evidence.md`. Generated ZIPs, unpacked datasets, splats, raw logs, and screenshots MUST stay outside the repository, for example under the operating system's temporary directory in a `task2-goal1a/` subdirectory. They are not committed; the evidence file records their identities and concise results.

## 14. LichtFeld compatibility gate

LichtFeld is not a reusable-code dependency and is not run after each test. Run one compatibility smoke only after sections 13.1-13.6 pass.

The smoke MUST use the CLI-emitted ZIP whose three text files came from the new serializer. It passes when an identified LichtFeld build:

1. accepts the emitted COLMAP dataset and referenced images;
2. completes the selected training run without a COLMAP-input failure; and
3. produces a splat artifact that can be opened.

Record:

- input fixture identity and output ZIP identity;
- LichtFeld release/build;
- exact command or UI procedure and effective settings;
- operating system, GPU, driver, and CUDA environment;
- completion log, screenshot, or equivalent evidence;
- produced artifact location or identity.

This is compatibility evidence only. It does not require identical training, equal appearance, deterministic results, a source build, repeated runs, PSNR/SSIM, reprojection error, or pose improvement. Those questions move to 1B and 1C.

## 15. Implementation sequence

The order below minimizes rework and keeps every slice independently reviewable. Estimates are focused four-hour pair sessions, not calendar promises; LichtFeld training wall-clock time is excluded.

| Slice | Pair-programming work | Done when | Estimate | Suggested atomic commit boundary during implementation |
|---|---|---|---:|---|
| 0. Approve and recheck | Filip and Mingna approve this plan, recheck both fixture hashes, and record any contradiction. | Section 18 is complete and no verified fixture fact contradicts the model. | 0.5 | Accepted plan and fixture expectations only. |
| 0A. ZIP feasibility spike | In a disposable test/spike, use the installed zip.js version to open a synthetic ZIP, snapshot every file payload, replace one selected entry, write bytes, reopen, and compare. Do not promote spike code automatically. | The chosen zip.js APIs work in the AppFramework browser target and preserve decompressed bytes; otherwise revise the adapter plan before model work. Re-estimate slices 1-8 here. | 0.5 | No production commit unless rewritten test-first. |
| 1. Public surface, model, and validation | Add `model.ts`, `index.ts`, the `./colmap` package export, explicit tsdown entry, public-export/portability tests, then validator tests and implementation. | The built public subpath loads; valid and invalid synthetic models behave as section 8 requires. | 1 | Package surface + typed model + validator + tests. |
| 2. Text reader | Add known-record, malformed-record, encoding, empty-observation/track, sparse-ID, and pose tests; then implement candidate parsing and validation. | All three files parse into the validated ordered model with contextual failures. | 1-1.5 | Parser + parser/pose tests. |
| 3. Text writer and comparisons | Add exact canonical output, semantic round-trip, exact no-op, noncanonical-input, quaternion-sign, and golden-format tests; then implement serialization/comparison. | All codec guarantees in section 10 pass without fixed-decimal rounding. | 1-1.5 | Writer/comparators + tests. |
| 4. Archive adapter | Hand-build synthetic ZIP fixtures; test inventory, path rules, image resolution, copy-through, and selected replacement before implementation. | One adapter preserves all untouched entries and replaces only the three serializer outputs. | 1-1.5 | ZIP adapter + archive tests. |
| 5. Public read/write orchestration and summary | Test `readRecorderZip`, `writeRecorderZip`, `roundTripRecorderZip`, and model-derived summary; then implement `round-trip.ts`. | In-memory output reopens and passes semantic, exact-no-op, deterministic-writer, and archive-preservation checks. | 0.5-1 | Public orchestration + tests. |
| 6. Node CLI | Build first; test exact arguments, path policy, exit status, image ID `1`, temporary cleanup, delayed final rename, and output formatting; then implement the `.mjs` wrapper and `colmap:roundtrip` script. | The subprocess test uses the built public core; local CLI produces only a verified output and prints the assignment summary. | 0.5-1 | CLI + CLI tests + package script. |
| 7. Real fixture replay | Run the complete path on the first Task 1 ZIP, then the second if needed by section 13.6; fix contract violations rather than weakening assertions silently. | Required local replay passes and evidence is retained. | 0.5-1 | Fixture-driven corrections only, separate from unrelated refactors. |
| 8. External smoke | Run one final emitted ZIP through LichtFeld and record the result. | Section 14 passes. | 0.5 active work | Evidence record only. |

Initial total: approximately **seven to ten focused pair sessions**. The spike, real fixture, or smoke may justify a new estimate; optional generalization does not.

Do not combine refactoring with a behavior slice. If a slice reveals that the contract is wrong, stop that slice, revise the decision record/plan with Team 6, then resume test-first work.

## 16. Pair-programming and review plan

All production-code slices are pair-programmed in person using the assignment's driver/navigator model.

- Before each session, choose one small slice and its failing acceptance tests.
- Record the starting driver and navigator for the slice; alternate the starting driver between slices.
- The driver writes/runs the current test and implementation. The navigator checks the contract, edge cases, dependency direction, and test quality.
- Swap roles every 30-60 minutes or after a completed logical test/implementation step.
- Do not split the codec and archive adapter into competing solo implementations.
- Both Filip and Mingna review the diff and can explain every accepted behavior before the slice is considered done.
- The navigator at the end of each slice records its commands, outcome, and relevant artifact identities in `reviews/task2-goal1a-implementation-evidence.md`; both verify the entry.
- For slice 7, the driver operates the fixture replay and the navigator verifies hashes and preservation evidence. For slice 8, the driver operates LichtFeld and the navigator records settings/results; both inspect the openable artifact.
- Run the focused tests during red/green work; run the full framework gate after each completed slice.
- Use a short Team 6 review whenever an implementation discovery changes the data model, ownership, or acceptance behavior. Book a Simon call only when the issue changes product scope or a decision already attributed to Simon.

1A stops at the acceptance gate; optional cleanup, general COLMAP support, and 1B experimentation do not extend the iteration automatically.

## 17. Verification and completion evidence

During development, run the existing AppFramework checks. No new test framework is needed.

Minimum final code gates, in this order so the CLI subprocess test uses current `dist/colmap` output:

```text
pnpm --filter gps-plus-slam-app-framework run format
pnpm --filter gps-plus-slam-app-framework run lint
pnpm --filter gps-plus-slam-app-framework run typecheck
pnpm --filter gps-plus-slam-app-framework run typecheck:tests
pnpm --filter gps-plus-slam-app-framework run build
pnpm --filter gps-plus-slam-app-framework run test:unit
```

The existing `test:core` command remains the convenient combined framework gate, but it does not build first. When it is used, run `build` immediately before it so `scripts/colmap-round-trip.test.mjs` cannot exercise stale output.

Before an upstream PR is considered later, also run the repository's wider applicable test gate. That PR and any CSUtils integration are not part of 1A.

1A is complete only when retained evidence shows:

1. the focused model, codec, pose, archive, orchestrator, and CLI tests pass;
2. the AppFramework typecheck, lint, build, and unit suite pass;
3. a named Task 1 ZIP was parsed through the actual reader;
4. all referenced images resolved and all opaque entries were preserved;
5. the unchanged model passed semantic equivalence and exact no-op preservation;
6. repeated serialization was deterministic;
7. the CLI printed image count, intrinsics, and the world-to-camera pose of image ID `1`;
8. the CLI emitted a new ZIP through the actual writer and reopened it successfully;
9. the one external LichtFeld compatibility gate passed; and
10. Filip and Mingna reviewed the implementation and can explain the coordinate and preservation guarantees.

Passing 1A proves a trustworthy data boundary. It MUST NOT be reported as evidence that poses or splat quality improved.

## 18. Approval and go/no-go gate

Implementation may start when all boxes are checked by the team:

- [ ] Filip confirms that this contract represents the accepted parts of his proposal.
- [ ] Mingna confirms that this contract represents the accepted parts of his proposal and comments.
- [ ] Both confirm the ZIP/codec/validator ownership boundary.
- [ ] Both confirm the typed model and strict current recorder profile.
- [ ] Both confirm round-trip, archive-preservation, pose, failure, and CLI behavior.
- [ ] Both approve the proposed AppFramework `./colmap` placement, public API, existing zip.js dependency, and internal CLI path in sections 6-7.
- [ ] Both approve `1e-12` as the semantic floating comparison tolerance, while keeping exact equality for identifiers/integer fields and exact no-op preservation.
- [ ] Both verify the Task 1 fixture inventory and record contradictions, if any.
- [ ] Both approve the complete slice order, evidence ownership, and initial seven-to-ten-session estimate in sections 15-16.
- [ ] Both agree on the first pair-programming session, its starting driver, and the slice 0A ZIP feasibility test.

Simon does not need to choose codec internals, module names, or test structure. Ask Simon only if he corrects an owner decision or if Team 6 proposes changing the product boundary, current priority, offline requirement, or review progression.

## 19. Minimal future seams and deferred work

The assignment requires the first plan to make later component seams visible. The following TypeScript-shaped contracts are planning seams only; they are not implemented or exported in 1A:

```ts
type FutureOperation<T> = T | Promise<T>;

interface FutureRefinementSeam<Signals = unknown> {
  refine(
    model: RecorderColmapModel,
    optionalSignals?: Signals
  ): FutureOperation<RecorderColmapModel>;
}

interface FutureEvaluationSeam<ControlledRun = unknown, Report = unknown> {
  evaluate(
    baselineOrCandidate: RecorderColmapModel,
    controlledRun: ControlledRun
  ): FutureOperation<Report>;
}
```

The generics intentionally leave signals, controlled-run settings, and report shape undefined. `FutureOperation` permits either a pure synchronous implementation or an external asynchronous adapter without choosing now. The shared `RecorderColmapModel` is the input/output seam. Later work must not force the archive adapter, codec, refinement, and evaluator into one component.

This plan deliberately does not decide:

- whether either future operation is synchronous or asynchronous;
- raw-signal schemas or whether action logs, depth, GPS, or odometry are used;
- training-image IDs or held-out policy;
- LichtFeld automation, frozen settings, or repeat count;
- metric/report production types;
- pose-refinement algorithm or technical stack;
- final CSUtils integration or user experience.

Those decisions require 1B-1D evidence and the later Team 6/Simon review gate.

## 20. Merge disposition and traceability

| Proposal/comparison issue | Shared contract resolution | Authority |
|---|---|---|
| ZIP input/output versus directory APIs | Whole recorder ZIP in/out; one exclusive archive adapter; preservation is mandatory. | Assignment; OD-008; comparison merge 1. |
| Recorder subset versus generic COLMAP registry | Ordered strict `.txt`/single-`PINHOLE`/empty-feature profile with explicit typed future extension points. | Assignment; OD-009; comparison merge 2. |
| Fixed 10 decimals versus round-trip-safe output | Round-trip-safe deterministic number strings; semantic and exact no-op checks remain separate; quaternion semantic comparison is sign-invariant. The `1e-12` semantic tolerance is a separate new Team 6 proposal requiring section 18 approval. | OD-010; comparison conflict 1 and merge 3; Mingna approved the merge except that neither source selected the exact epsilon. |
| Closed typed results versus thrown errors | One lean contextual exception style; non-zero CLI; no partial successful output; no large result/error hierarchy. | OD-005, which supersedes comparison merge 4's public-result recommendation; Mingna delegated the choice. |
| "Train identically" versus compatibility | One completed-training/openable-artifact compatibility smoke; no parity or quality claim. | Assignment; OD-011; comparison conflict 3 and merge 5; Mingna approved the merge. |
| Page/web product versus local tooling | Browser-compatible core plus local Node CLI; no page, server, recorder UI, or CSUtils button in 1A. Mingna's web-tool comment remains later-product context; final UX is unresolved. | OD-002, OD-003, OD-004, OD-007 supersede that comment for 1A. |
| Detailed refinement and measurement APIs in 1A | Keep only the typed-model seam and two conceptual future operations; defer algorithms, signals, metrics, and async design. | Assignment; OD-012; comparison merge 6. |
| Opaque raw recorder data | Preserve it byte-for-byte as untouched archive entries, including directory records; do not parse it in 1A. | Assignment; OD-006; OD-008; OD-010. |
| Fixture storage status | The two Task 1 ZIPs are tracked, read-only repository files; generated outputs stay outside the repository. | Verified current Git index, which overrides older text calling `dev/` ignored. |
| Exact module/API placement | AppFramework `./colmap` public core plus an unpublished package-local Node CLI. | New Team 6 implementation proposal based on verified dependency direction; approve in section 18. |
| Pair sequence and estimate | Test-first slices 0A-8, rotating pair roles, evidence recorded by the navigator, initial seven-to-ten-session estimate. | New Team 6 implementation proposal; approve in section 18. |

Detailed source locations:

- `OWNER_DECISIONS.md` - `OD-001` through `OD-012`, especially `OD-005`, `OD-008`, `OD-009`, `OD-010`, `OD-011`, and `OD-012`;
- `reviews/task2-goal1a-technical-comparison.md` - `4. Material conflicts`, `5. Merge candidates`, and `7. Comments`;
- `Draft/filip-contract-1a.md` - `6. Iteration 1A pipeline` through `18. Iteration 1A acceptance criteria`;
- `Draft/mingna-contract.md` - `3. Data Contracts & Types (The "Seam")`, `4. Core Pipeline Interfaces`, `5. Architectural Review & Edge Cases`, and `6. Product Owner (PO) Review Questions`;
- `Team 6 - Reality Reconstruction via Gaussian Splats.pdf` - sections `2.2 The seam that makes this splittable`, `2.3 The components`, and `2.5 Recommended approaches & the hard parts`.
