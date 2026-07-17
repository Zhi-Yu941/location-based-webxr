# Filip's Task 2 Iteration 1A contract

> **Status: Current proposal.** Independent Filip candidate for Task 2 Iteration 1A. It is not merged with Mingna's proposal, is not an official plan, and records no Product Owner decision.

## 1. Status and purpose

Status: independent, assignment-aligned candidate contract for Iteration 1A.

This document defines only the first Task 2 Goal 1 component: a recorder-ZIP reader/writer for the verified recorder-specific COLMAP text model, a small summary demonstration, and evidence that a codec-re-emitted ZIP is still usable by LichtFeld. It is not an official or merged plan, production code, a task breakdown, a pose-refinement design, or a Product Owner decision.

The labels 1A, 1B, 1C, and 1D are Team 6 organizational labels. They are not terminology from the assignment.

Normative language is used as follows:

- **MUST** and **MUST NOT** are Iteration 1A conformance requirements.
- **SHOULD** is a recommended choice that may be changed by a reviewed contract revision.
- **MAY** identifies permitted behavior.
- Sections 19 and 20 are explicitly non-normative and do not expand Iteration 1A acceptance.

Source precedence for this extraction is:

1. the Team 6 SoftwareLab assignment;
2. decisions explicitly confirmed by Simon;
3. verified repository and fixture behavior;
4. accepted human dispositions;
5. completed Task 1 evidence;
6. `archive/task2/filip-broad-contract-v2.md`;
7. verified findings from the v2 review;
8. other AI-generated recommendations.

No decision is attributed to Simon in this document. Review findings are design input, not authority over the assignment or verified code.

The lower part of this task-specific order differs from `AGENTS.md`: that file includes a reviewed and accepted Team 6 plan, while the direct request forbids reading any official or merged plan and explicitly orders the disposition, Task 1 evidence, v2, and the v2 review. This document uses the direct task-specific order above and reports the difference. No normative 1A rule relies on a disposition or AI review when assignment or verified repository behavior contradicts it.

`AGENTS.md` still names the output of the earlier independent-draft activity as `archive/task2/filip-contract-audit.md`. The direct request for this bounded revision instead names `Draft/filip-contract-1a.md` and protects both earlier drafts. This is an output-isolation conflict, not an architectural requirement; this document follows the newer, task-specific instruction without changing the earlier artifacts.

## 2. Assignment requirements covered

Iteration 1A extracts Task 2 Goal 1 component 1 from assignment sections 2.2, 2.3, and 2.5.1.

| Assignment obligation | Iteration 1A treatment | Completion evidence |
|---|---|---|
| Treat the recorder ZIP as the first-iteration external contract and do not modify recorder/exporter code. | One self-contained ZIP-in/ZIP-out boundary; recorder and exporter are outside the component. | Existing Task 1 ZIP is processed without recorder/exporter changes. |
| Open a recorder COLMAP ZIP and parse `sparse/0/` into typed structures. | Sections 8-11 define the archive adapter, supported text subset, typed model, and codec. | All three supported text files parse into validated typed records. |
| Resolve image references. | `images.txt` names resolve case-sensitively to `images/<NAME>`. | Every referenced fixture image resolves; missing assets fail with a typed error. |
| Write the model back as a ZIP LichtFeld can train on. | The demonstration serializes the parsed model through the actual writer and replaces the three sparse text files in a copied archive. | The codec-re-emitted ZIP completes the compatibility smoke test in section 17. |
| Support COLMAP text; binary is nice-to-have. | `.txt` is normative. `.bin` is deferred and is not an alternative 1A acceptance path. | Text fixture replay passes. |
| Make an unchanged load/save structurally faithful. | Exact model preservation, semantic equivalence, intact image references, and archive copy-through are separate assertions. | Section 13 checks each property independently. |
| Protect quaternion/translation conventions with known-input tests. | Section 12 fixes the pose convention; section 16 requires synthetic tests. | Identity, translation, rotation, order, direction, and sign tests pass. |
| Provide a plain CLI or page that prints a summary and re-emits a ZIP. | Section 15 defines one presentation-neutral demonstration contract. | Counts, intrinsics, one selected pose, resolution status, and the emitted ZIP are shown. |
| Replay real Task 1 data. | Section 17 defines fixture provenance and the integration path. | At least the required canonical fixture is replayed without extraction into tracked directories. |

The assignment also asks for a LichtFeld source build, measurement harness, and pose investigation before refinement. Those are mandatory Goal 1 obligations, but they are not Iteration 1A requirements. They remain visible in sections 3 and 20.

The assignment's phrase "byte-faithful enough" is qualified by its concrete acceptance language: same cameras, poses within formatting tolerance, same points, intact images, and continued LichtFeld usability. It does not require byte-identical text or byte-identical ZIP containers.

## 3. Iteration model

The internal decomposition is:

| Stage | Purpose | Status in this document |
|---|---|---|
| 1A | COLMAP ZIP reader/writer and faithful round trip | Normatively defined here. |
| 1B | Reproducible LichtFeld source build and ZIP-to-splat recipe | Informational only; mandatory later Goal 1 work. |
| 1C | Measurement harness | Informational only; mandatory later Goal 1 work. |
| 1D | Pose research, options, and review decision | Informational only; mandatory later Goal 1 gate. |
| Post-gate | Prototype of the human-selected refinement approach | Outside Goal 1 and outside this contract. |

The sequencing constraint is:

```text
1A reader/writer ----+
                      +--> 1D evidence and review gate --> selected prototype
1B LichtFeld recipe --+
                      |
1C measurement -------+
```

This decomposition does not make 1A alone equivalent to Task 2 Goal 1 completion.

## 4. Scope

Iteration 1A includes:

- one recorder ZIP adapter that opens, validates, reads, resolves, preserves, and re-emits archive entries;
- the three recorder-specific COLMAP text files under `sparse/0/`;
- referenced JPEG assets under `images/`;
- opaque copy-through of unreferenced images, `actions/`, `session.json`, and unknown file entries;
- a typed, ordered, recorder-specific COLMAP model;
- a fail-closed text reader and deterministic text writer;
- semantic round-trip and exact no-op model-preservation checks;
- a presentation-neutral summary CLI/page boundary;
- synthetic, archive, codec, and Task 1 integration evidence;
- an external LichtFeld compatibility smoke test of the codec-re-emitted ZIP.

The reusable reader/writer ends at a recorder-compatible output ZIP. It neither imports nor invokes LichtFeld. LichtFeld appears only in external acceptance evidence.

## 5. Explicit non-goals

Iteration 1A does not define or implement:

- a real pose-refinement step, pose delta, refiner result, gauge-alignment record, or solver;
- selection of a pose-refinement algorithm;
- action-log, GPS, depth, odometry, or alignment-matrix parsing;
- feature extraction, feature matching, populated observations, populated tracks, bundle adjustment, pose graphs, loop closure, ICP, or joint trainer pose optimization;
- a measurement harness, train/evaluation split, held-out policy, PSNR, SSIM, reprojection-error calculation, or quality conclusion;
- a LichtFeld source build, automated orchestration, exact-view renderer, or reproducible training recipe;
- binary COLMAP, multiple cameras, non-`PINHOLE` cameras, or general COLMAP compatibility;
- intrinsic or `points3D` modification;
- recorder/exporter modification;
- a generic plugin, provider, optimizer, archive, trainer, or evidence framework;
- an implementation library, application framework, or CLI-versus-page technology choice;
- byte-identical COLMAP text or byte-identical ZIP-container output;
- any claim that the emitted ZIP improves poses or splat quality.

The Task 1 fixture point `ERROR = 1` and the recorded LichtFeld final-error values are not reprojection or validated visual-quality metrics.

## 6. Iteration 1A pipeline

The demonstrated path is:

```text
recorder ZIP
  -> recorder ZIP adapter opens and validates archive paths
  -> adapter reads sparse/0/{cameras,images,points3D}.txt
  -> COLMAP text reader parses and validates the typed model
  -> adapter resolves every model-referenced images/<NAME> asset
  -> summary surface reports the validated dataset
  -> COLMAP text writer serializes the unchanged typed model
  -> adapter copies the original archive with the three generated texts as explicit replacements
  -> emitted ZIP is opened and parsed again
  -> model preservation and archive preservation are verified
  -> emitted ZIP is trained in an external LichtFeld compatibility smoke test
```

The summary demonstration MUST pass all three sparse files through the writer. Copying the original sparse text bytes does not satisfy the demonstration, even though a copy-only adapter test is permitted separately.

The main 1A pipeline contains no refinement transform. Its model before and after serialization is unchanged under section 13's exact model-preservation predicate.

## 7. Terminology and component ownership

- **Recorder ZIP**: the entire recorder archive, including `sparse/0/`, `images/`, `actions/`, `session.json`, and unknown file entries.
- **File entry**: a non-directory ZIP entry with a validated relative path and decompressed payload.
- **Normalized entry path**: the forward-slash path obtained by joining the already validated path segments. Because empty, dot, dot-dot, repeated-separator, absolute, and backslash forms are rejected rather than repaired, the normalized path has the same text as the accepted input name.
- **Untouched entry**: a file entry whose normalized path is absent from the explicit replacement set.
- **Supported sparse text**: exactly `cameras.txt`, `images.txt`, and `points3D.txt` below `sparse/0/`.
- **Typed model**: the validated, ordered values in section 10. It contains no ZIP handle or archive metadata.
- **Referenced image**: the file entry at the exact path `images/<NAME>` for an `images.txt` record.
- **Unreferenced image**: an `images/` file entry not named by the typed model. It remains recorder data and is copied through.
- **Canonical generated text**: deterministic writer output for one valid typed model and codec version.
- **Compatibility smoke test**: the external, non-quantitative check that LichtFeld can train the codec-re-emitted ZIP.

Shared value contracts are:

```ts
type Sha256Hex = string;
type ArchiveEntryPath = string;

interface BinaryPayload {
  readonly byteLength: number;
  copy(): Uint8Array;
}

interface ArtifactIdentity {
  readonly algorithm: "sha256";
  readonly digestHex: Sha256Hex;
  readonly byteLength: number;
}
```

`digestHex` MUST contain 64 lower-case hexadecimal characters. `byteLength` MUST be a non-negative safe integer. `BinaryPayload.copy()` MUST return a fresh copy; changing a returned array MUST NOT change the source or another copy.

Ownership is exclusive:

| Component | Owns | Must not own |
|---|---|---|
| Recorder ZIP adapter | ZIP decoding/encoding, entry-path validation, sparse-text access, image resolution, opaque preservation, explicit replacement | COLMAP syntax, pose interpretation, summary calculation, LichtFeld |
| COLMAP text reader/writer | Text grammar, typed model validation, ordering, deterministic serialization, model comparisons | ZIP entries, asset bytes, archive preservation, LichtFeld |
| Summary CLI/page | Orchestration of the adapter and codec and presentation of validated summary values | Alternate parsing, direct sparse-byte copy, refinement, training |
| External smoke procedure | Demonstrating that the emitted dataset trains in an identified LichtFeld build | Reusable reader/writer runtime behavior, quality measurement |

No second archive owner or corrected-archive writer exists.

## 8. Input and output ZIP contract

### Public boundary

```ts
type SparseTextPath =
  | "sparse/0/cameras.txt"
  | "sparse/0/images.txt"
  | "sparse/0/points3D.txt";

interface RecorderZipInput {
  readonly bytes: BinaryPayload;
  readonly label?: string;
  readonly resourcePolicy: ArchiveResourcePolicy;
}

interface ArchiveResourcePolicy {
  readonly maxFileEntries: number;
  readonly maxEntryDecompressedBytes: number;
  readonly maxTotalDecompressedBytes: number;
}

interface ColmapTextPayloads {
  readonly cameras: BinaryPayload;
  readonly images: BinaryPayload;
  readonly points3D: BinaryPayload;
}

interface OpenedRecorderArchive {
  readonly identity: ArtifactIdentity;
  readonly fileEntryPaths: readonly ArchiveEntryPath[];
  readonly colmapText: ColmapTextPayloads;
}

interface ImageAssetReference {
  readonly imageId: ImageId;
  readonly name: string;
}

interface ResolvedImageAsset {
  readonly imageId: ImageId;
  readonly name: string;
  readonly path: ArchiveEntryPath;
  readonly bytes: BinaryPayload;
  readonly identity: ArtifactIdentity;
}

interface ArchiveReplacement {
  readonly path: SparseTextPath;
  readonly bytes: BinaryPayload;
}

interface EmittedRecorderZip {
  readonly bytes: BinaryPayload;
  readonly identity: ArtifactIdentity;
  readonly replacedPaths: readonly SparseTextPath[];
}

interface RecorderZipAdapter {
  open(input: RecorderZipInput): Promise<ArchiveOpenOutcome>;
  resolveImageAssets(
    archive: OpenedRecorderArchive,
    references: readonly ImageAssetReference[]
  ): Promise<ImageResolutionOutcome>;
  copyWithReplacements(
    archive: OpenedRecorderArchive,
    replacements: readonly ArchiveReplacement[]
  ): Promise<ArchiveWriteOutcome>;
}
```

The resource-policy values MUST be positive safe integers and MUST be enforced against actual decompressed bytes, not trusted ZIP metadata. Their deployment defaults remain an open decision; the policy used by acceptance evidence MUST be recorded and MUST accept both verified Task 1 fixtures. This is a narrow resource guard, not a promise of general-purpose archive handling.

### Required archive profile

The adapter MUST:

- validate every entry path before exposing or copying entry content;
- require exactly the three supported text paths;
- reject a partial sparse text model;
- reject `cameras.bin`, `images.bin`, or `points3D.bin` under `sparse/0/`, including text/binary coexistence;
- resolve image names by exact, case-sensitive lookup at `images/<NAME>`;
- return resolved assets in typed model order;
- preserve all unreferenced images, `actions/`, `session.json`, and unknown file entries;
- copy the original archive with replacements only for explicitly named, existing `SparseTextPath` entries;
- reject duplicate replacement paths, added paths, deleted paths, and renamed paths;
- compute artifact identity from the complete ZIP bytes;
- return no output ZIP after validation, read, replacement, or write failure.

The adapter MUST NOT infer an image path from image ID, filename suffix, ZIP order, or record position. In the verified fixtures, image ID 1 references `frame-000002.jpg`; `frame-000001.jpg` is unreferenced.

### Path safety

A file-entry path is rejected when it:

- is empty, absolute, drive-qualified, or UNC-like;
- begins or ends with `/`;
- contains any `\` (U+005C REVERSE SOLIDUS), NUL, U+0000-U+001F, or U+007F;
- contains a repeated `/`, an empty segment, a `.` segment, or a `..` segment;
- duplicates another normalized file-entry path;
- collides with another entry when ASCII `A-Z` are folded to `a-z`, because the demonstrated LichtFeld workflow is on Windows.

The adapter rejects rather than repairs these names. It does not decode URL escapes or Unicode-normalize path text. Directory records MAY be ignored and MAY be omitted on output; they are not file entries and are not part of preservation acceptance. The adapter processes archives without extracting entries into tracked directories.

This is the adapter's traversal and lookup policy, not a claim that an arbitrary ZIP is safe to unpack with an arbitrary operating-system extractor. If the external smoke test materializes the emitted ZIP, its recorded procedure MUST use an empty dedicated destination, verify every resolved target remains below that destination, and reject target-platform aliases or illegal names such as Windows device names, alternate-data-stream syntax, and trailing-dot/space aliases.

### Image-name safety

For Iteration 1A, `NAME` MUST be a non-empty safe bare filename that fits the unquoted one-token grammar. It MUST contain no slash, backslash, quote, ASCII whitespace, NUL, or control character, and it MUST NOT be exactly `.` or `..`. The `.jpg` suffix and six-digit `frame-NNNNNN.jpg` pattern are observed recorder/fixture forms, not codec validity requirements; current serializer code accepts an unconstrained name and its tests include the safe name `f.jpg`. This safe-basename rule is a deliberate fail-closed 1A interoperability policy: it is broader than the observed fixture pattern, narrower than the current serializer's unchecked string input, and is not claimed as a recorder invariant.

Two image records MUST NOT use the same name. A name is not rewritten or case-folded before lookup.

### Output fidelity

The output MUST contain the same normalized file-entry path set as the input. For every untouched entry, its decompressed bytes MUST be identical to the input payload.

Iteration 1A does not preserve or compare:

- compressed ZIP bytes;
- entry order;
- compression algorithm or level;
- timestamps;
- archive comments;
- per-entry extra fields;
- directory records.

## 9. Supported recorder-specific COLMAP subset

Iteration 1A accepts a deliberately narrow text subset.

### Common text rules

- Files are valid UTF-8 without a BOM or NUL.
- A file uses either LF or CRLF consistently. Bare CR and mixed line endings are invalid.
- A final line terminator is accepted and canonical output always includes one.
- Before the first data record, a line MAY be empty or begin with `#`.
- After the first data record, comments are invalid. Blank physical lines are valid only where `images.txt` requires the observation line.
- Data fields are separated by one or more ASCII spaces or tabs.
- Quoted tokens are not part of the subset.

Exact numeric token grammars are:

```text
UNSIGNED_INTEGER := 0 | [1-9][0-9]*
FLOAT := -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?
```

`+1`, `.5`, `1.`, `01`, hexadecimal, numeric separators, `NaN`, `Infinity`, and locale decimal commas are not accepted numeric tokens. `-0` is accepted only by `FLOAT`. Syntactic acceptance is followed by safe-integer, finite, sign, and range validation.

### `cameras.txt`

Exactly one data row is accepted:

```text
CAMERA_ID PINHOLE WIDTH HEIGHT FX FY CX CY
```

It has exactly eight tokens. The camera ID, width, and height are positive safe integers. `fx` and `fy` are positive finite numbers. `cx` and `cy` are finite. `PINHOLE` is the only supported camera model.

### `images.txt`

One or more image records are accepted. Each record is exactly two physical lines:

```text
IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME
<empty observation line>
```

The pose line has exactly ten tokens. IDs are positive safe integers. Pose components are finite. The quaternion passes section 12 validation. The observation line contains no token; spaces or tabs on that line are accepted but canonical output emits an empty line.

### `points3D.txt`

Zero or more point rows are accepted:

```text
POINT3D_ID X Y Z R G B ERROR
```

Each row has exactly eight tokens. The point ID is a positive safe integer. XYZ and ERROR are finite; ERROR is non-negative. RGB values are integer bytes in `[0, 255]`. Extra track tokens are invalid. An empty point data body is valid.

### Cross-record validation

- Camera, image, and point IDs are unique within their namespaces.
- Image names are unique.
- Every image camera reference resolves to the single camera.
- IDs MAY be sparse and non-continuous; array order is source record order.
- All observations and tracks are empty in Iteration 1A.
- Header counts are informative comments only. The parser validates actual records, and the writer recomputes counts.

The fixture `ERROR = 1` value is preserved as data but is not treated as measured reprojection error.

## 10. Typed COLMAP data model

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
  readonly cameras: readonly [PinholeCamera];
  readonly images: readonly ColmapImage[];
  readonly points3D: readonly ColmapPoint3D[];
}
```

The element types make observations and tracks explicit, but the supported subset requires both arrays to be empty. Their presence does not contract populated-feature support.

The three arrays preserve source order. The model does not store original comments, whitespace, number lexemes, ZIP entry order, archive metadata, or asset payloads.

The current recorder serializer silently rounds some integer fields and clamps RGB. The new codec MUST NOT copy that behavior: invalid typed values are rejected before serialization.

## 11. COLMAP text reader/writer contract

### Public boundary

```ts
interface GeneratedColmapText {
  readonly codecVersion: "recorder-colmap-text-1a-v1";
  readonly files: ColmapTextPayloads;
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

interface RecorderColmapTextCodec {
  parse(files: ColmapTextPayloads): ColmapParseOutcome;
  serialize(model: RecorderColmapModel): ColmapSerializeOutcome;
  semanticallyEqual(
    left: RecorderColmapModel,
    right: RecorderColmapModel
  ): ModelComparison;
  exactlyPreserved(
    before: RecorderColmapModel,
    after: RecorderColmapModel
  ): ModelComparison;
}
```

### Reader behavior

The reader MUST:

- apply section 9's exact grammar and validation;
- validate record arity before converting fields;
- retain camera, image, and point source order;
- pair each image pose with its immediately following empty observation line;
- distinguish malformed syntax, invalid numbers, non-finite values, invalid ranges, duplicate IDs/names, and missing references;
- report file, one-based physical line, and field name or field index;
- return no partial model after rejection.

It MUST NOT normalize a quaternion, repair an ID, clamp RGB, invent an observation/track, infer an asset, or apply a coordinate conversion.

### Writer behavior

The writer MUST validate the complete model before emitting any file. For one valid model and codec version, repeated calls MUST produce identical UTF-8 bytes.

Canonical output MUST:

- preserve supplied camera, image, and point array order;
- preserve IDs, image names, camera references, and all scalar values under the canonical-zero rule below;
- preserve the stored quaternion representative (`q` rather than `-q`), except that a negative-zero component canonicalizes to positive zero;
- use one ASCII space between tokens;
- emit safe integers in base 10 without a plus sign or unnecessary leading zero;
- emit finite floating values with ECMAScript `Number.prototype.toString` base-10 semantics;
- serialize negative zero as `0`;
- emit an empty observation line after each image pose;
- emit no track tokens;
- use LF and finish every file with LF;
- emit the following fixed headers, substituting canonical decimal counts.

```text
# Camera list with one line of data per camera:
#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]
# Number of cameras: 1

# Image list with two lines of data per image:
#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME
#   POINTS2D[] as (X, Y, POINT3D_ID)
# Number of images: {image-count}, mean observations per image: 0

# 3D point list with one line of data per point:
#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)
# Number of points: {point-count}, mean track length: 0
```

The three blocks above are per-file headers; the separating blank lines are explanatory and are not cross-file output. No blank line is emitted between a file header and its first data record.

### Comparison behavior

`semanticallyEqual` requires equal record counts and order; exact IDs, dimensions, strings, references, RGB, observation state, and track state; and scalar equality under:

```text
abs(a - b) <= max(1e-12, 1e-12 * max(abs(a), abs(b)))
```

For pose orientation, `q` and `-q` compare as equivalent after both quaternions independently pass validation. Negative zero compares as zero.

For component comparison, choose the sign of the right quaternion so its dot product with the left quaternion is non-negative, then apply the scalar tolerance component by component.

`exactlyPreserved` is the stronger no-op predicate. Define `canonicalZero(-0) = +0` and let every other number map to itself. Numeric components compare by `Object.is(canonicalZero(a), canonicalZero(b))`. Counts, order, IDs, strings, references, and integer values are identical; quaternion components preserve the `q` versus `-q` representative under the same canonical-zero rule. This predicate uses no epsilon.

The codec MUST NOT claim original text-byte identity. Original comments, whitespace, number lexemes, and line endings may differ from generated canonical text.

## 12. Coordinate and pose conventions

These rules exist only to prevent reader/writer corruption:

- `images.txt` stores a world-to-camera extrinsic.
- Quaternion file and model order is `[qw, qx, qy, qz]`.
- With column vectors, the transform is:

  ```text
  X_camera = R(qvec) X_world + t
  ```

- `tvec` is not the camera position.
- The camera center in world coordinates is:

  ```text
  C = -R^T t
  ```

- COLMAP camera axes are right-handed: +X right, +Y down, +Z forward.
- Camera-to-world and world-to-camera values MUST NOT be interchanged.
- A math library using quaternion order `[x, y, z, w]` MUST map explicitly to `[qx, qy, qz, qw]` and back.
- Recorder ZIP poses and points already contain the recorder's WebXR-to-COLMAP basis conversion. Iteration 1A MUST NOT apply that conversion again.
- Parsing and serialization perform no implicit unit conversion, rescaling, recentering, axis flip, handedness change, orientation change, or coordinate normalization.
- A quaternion is valid when every component is finite and `abs(norm(q) - 1) <= 1e-6`.
- Invalid quaternions are rejected, not normalized.
- `q` and `-q` represent the same rotation for semantic comparison. The writer nevertheless preserves the supplied `q` versus `-q` representative so an unchanged round trip cannot silently flip it; only a negative-zero component canonicalizes to positive zero.

Synthetic tests MUST include non-identity examples because an identity-only suite can hide order, sign, inversion, and axis mistakes.

## 13. Round-trip and preservation guarantees

The following properties are distinct:

| Property | Required meaning | Does not mean |
|---|---|---|
| Untouched archive-entry preservation | Same normalized file-entry path set; each untouched entry has identical decompressed bytes. | Same compressed bytes, ZIP order, metadata, timestamps, comments, or directory records. |
| Semantic codec round trip | `parse -> serialize -> parse` returns models equal under `semanticallyEqual`. | Same text bytes or exact stored representation. |
| Exact no-op model preservation | The unchanged demonstration also passes `exactlyPreserved`, including record order and quaternion sign. | Same comments, whitespace, line endings, or numeric lexemes. |
| Deterministic generated text | The same valid typed model and codec version always produce identical generated bytes. | Equality to the original recorder text. |
| Exact text-byte identity | Every original sparse-text byte is reproduced. | Not required and not claimed. |

Required verification paths are:

1. **Adapter copy-only test**: emit a copied ZIP with no replacements. This proves only archive copy-through.
2. **Forced codec round trip**: parse all three files, serialize the model, replace all three generated texts, reopen, and reparse. This proves the real reader/writer path and archive preservation together.
3. **Summary demonstration**: execute the same forced codec path while producing the section 15 summary and then supply that emitted ZIP to the external smoke test.

Reusing original text bytes in an unrelated operational no-op MAY be an optimization, but it is not Iteration 1A codec evidence.

## 14. Typed failures

Public boundaries MUST return closed outcomes. Internal exceptions MUST be translated; a rejected operation exposes no partial model or output ZIP.

```ts
type ArchiveError =
  | { readonly kind: "invalid-zip"; readonly message: string }
  | {
      readonly kind: "unsafe-entry-path";
      readonly path: string;
      readonly reason:
        | "absolute-or-drive-qualified"
        | "backslash"
        | "control-character"
        | "empty-or-dot-segment"
        | "repeated-separator";
    }
  | {
      readonly kind: "ambiguous-entry-path";
      readonly paths: readonly string[];
      readonly reason: "duplicate" | "ascii-case-collision";
    }
  | {
      readonly kind: "resource-limit-exceeded";
      readonly limit:
        | "file-entry-count"
        | "entry-decompressed-bytes"
        | "total-decompressed-bytes";
      readonly actual: number;
      readonly maximum: number;
    }
  | {
      readonly kind: "missing-sparse-text";
      readonly missing: readonly SparseTextPath[];
    }
  | {
      readonly kind: "partial-sparse-model";
      readonly present: readonly SparseTextPath[];
    }
  | {
      readonly kind: "binary-sparse-model-unsupported";
      readonly paths: readonly string[];
    }
  | {
      readonly kind: "missing-image-asset";
      readonly imageId: ImageId;
      readonly expectedPath: string;
    }
  | {
      readonly kind: "invalid-replacement";
      readonly path: string;
      readonly reason: "unsupported" | "duplicate" | "not-in-input";
    }
  | {
      readonly kind: "archive-read-failed" | "archive-write-failed";
      readonly message: string;
    };

type ArchiveOpenOutcome =
  | { readonly status: "opened"; readonly archive: OpenedRecorderArchive }
  | { readonly status: "rejected"; readonly error: ArchiveError };

type ImageResolutionOutcome =
  | { readonly status: "resolved"; readonly assets: readonly ResolvedImageAsset[] }
  | { readonly status: "rejected"; readonly error: ArchiveError };

type ArchiveWriteOutcome =
  | { readonly status: "written"; readonly output: EmittedRecorderZip }
  | { readonly status: "failed"; readonly error: ArchiveError };

interface CodecLocation {
  readonly path: SparseTextPath;
  readonly line?: number;
  readonly field?: string;
}

type CodecError =
  | {
      readonly kind: "encoding";
      readonly code: "invalid-utf8" | "bom" | "nul" | "invalid-newline";
      readonly location: CodecLocation;
      readonly message: string;
    }
  | {
      readonly kind: "syntax";
      readonly code:
        | "unexpected-comment"
        | "unexpected-blank-line"
        | "field-count"
        | "missing-camera"
        | "camera-count"
        | "missing-image"
        | "missing-observation-line"
        | "non-empty-observations"
        | "non-empty-track"
        | "camera-model"
        | "image-name";
      readonly location: CodecLocation;
      readonly message: string;
    }
  | {
      readonly kind: "numeric";
      readonly code:
        | "integer-syntax"
        | "float-syntax"
        | "unsafe-integer"
        | "non-finite"
        | "out-of-range"
        | "invalid-quaternion";
      readonly location: CodecLocation;
      readonly token: string;
      readonly message: string;
    }
  | {
      readonly kind: "reference";
      readonly code:
        | "duplicate-camera-id"
        | "duplicate-image-id"
        | "duplicate-point-id"
        | "duplicate-image-name"
        | "missing-camera-reference";
      readonly location: CodecLocation;
      readonly message: string;
    };

type ColmapParseOutcome =
  | { readonly status: "parsed"; readonly model: RecorderColmapModel }
  | { readonly status: "rejected"; readonly errors: readonly CodecError[] };

type ColmapSerializeOutcome =
  | { readonly status: "serialized"; readonly output: GeneratedColmapText }
  | { readonly status: "rejected"; readonly errors: readonly CodecError[] };
```

An implementation MAY report multiple independent codec errors. When it does, their order MUST be deterministic by file order (`cameras`, `images`, `points3D`), physical line, and field.

The summary surface uses the same archive and codec failures; it does not create alternate untyped error messages. External LichtFeld smoke failures are evidence records, not adapter or codec errors.

## 15. Summary CLI/page contract

The assignment permits a CLI or a page. Iteration 1A defines behavior, not presentation technology.

```ts
interface CameraSummary {
  readonly cameraId: CameraId;
  readonly model: "PINHOLE";
  readonly width: number;
  readonly height: number;
  readonly intrinsics: PinholeIntrinsics;
}

interface SelectedImagePoseSummary {
  readonly selection: "requested-image-id" | "first-model-record";
  readonly imageId: ImageId;
  readonly name: string;
  readonly cameraId: CameraId;
  readonly pose: WorldToCameraPose;
}

interface DatasetSummary {
  readonly cameraCount: number;
  readonly imageCount: number;
  readonly point3DCount: number;
  readonly cameras: readonly CameraSummary[];
  readonly selectedImage: SelectedImagePoseSummary;
  readonly referencedImages: {
    readonly expected: number;
    readonly resolved: number;
    readonly allResolved: boolean;
  };
}

interface Iteration1ADemoRequest {
  readonly zip: RecorderZipInput;
  readonly selectedImageId?: ImageId;
}

interface Iteration1ADemoEvidence {
  readonly summary: DatasetSummary;
  readonly inputArchive: ArtifactIdentity;
  readonly outputArchive: ArtifactIdentity;
  readonly replacedPaths: readonly [
    "sparse/0/cameras.txt",
    "sparse/0/images.txt",
    "sparse/0/points3D.txt"
  ];
  readonly semanticRoundTrip: true;
  readonly exactModelPreservation: true;
}

type Iteration1ADemoOutcome =
  | {
      readonly status: "completed";
      readonly evidence: Iteration1ADemoEvidence;
      readonly output: EmittedRecorderZip;
    }
  | {
      readonly status: "rejected";
      readonly failure:
        | { readonly kind: "archive"; readonly error: ArchiveError }
        | { readonly kind: "codec"; readonly errors: readonly CodecError[] }
        | {
            readonly kind: "summary";
            readonly code: "selected-image-not-found";
            readonly imageId: ImageId;
          }
        | { readonly kind: "verification"; readonly comparison: ModelComparison };
    };

interface Iteration1ADemo {
  run(request: Iteration1ADemoRequest): Promise<Iteration1ADemoOutcome>;
}
```

The summary MUST be computed from validated typed records, never from comment headers or ZIP order. It reports:

- number of cameras;
- number of images;
- number of `points3D` records;
- each supported camera's model, dimensions, and intrinsic parameters;
- one selected image's ID, name, camera reference, qvec, and tvec;
- referenced-image expected/resolved counts and whether all resolved.

If `selectedImageId` is absent, the first image in source record order is selected. A supplied ID that is absent is a typed rejection by the summary boundary; it is not silently replaced.

The demonstration MUST call the real adapter and codec, serialize all three files, replace those three files in a copied archive, reopen the output, reparse it, and verify both semantic round trip and exact model preservation. A display-only inspector or original-text copy does not conform.

The LichtFeld smoke check is performed on the demonstration's `output`; it is not part of `Iteration1ADemo.run` and does not create a reader/writer runtime dependency.

## 16. Contract-level test strategy

These are acceptance responsibilities, not implementation tasks.

### Synthetic codec and convention tests

- Identity world-to-camera pose.
- Known translated camera, proving `tvec` is not camera position and checking `C = -R^T t`.
- Known nontrivial rotation with a hand-computed transformed point.
- A case that fails if world-to-camera is interpreted as camera-to-world.
- Quaternion storage order `[qw, qx, qy, qz]` and explicit mapping to `[x, y, z, w]`.
- `q` and `-q` semantic rotation equivalence, while exact no-op preservation retains the original sign.
- Quaternion norm boundary, zero quaternion, malformed floating tokens, `NaN`, positive/negative infinity, unsafe integers, invalid RGB, and non-positive dimensions.
- Duplicate and invalid IDs/names, missing camera references, and missing referenced assets.
- Deterministic repeated serialization.
- Negative-zero canonicalization.
- Empty observations and empty tracks.
- Empty `points3D` data body.
- Sparse and non-continuous valid IDs with preserved source order.
- Rejection of populated observations and tracks without implying feature-reference support.

### Archive tests

- Reject absolute, drive/UNC-like, backslash, traversal, dot-segment, repeated-separator, control-character, duplicate, ASCII-case-colliding, and resource-limit-exceeding entries.
- Reject partial sparse text and binary/text coexistence.
- Preserve every referenced JPEG payload when it is not replaced.
- Preserve unreferenced images.
- Preserve `actions/`, `session.json`, and opaque unknown file entries.
- Keep the normalized file-entry path set unchanged.
- Keep decompressed bytes identical for every untouched entry.
- Replace only selected existing sparse text paths.
- Return no output after validation or write failure.

### Codec round-trip tests

- `parse -> serialize -> parse` semantic equivalence.
- Exact no-op model preservation as a separate, stronger assertion.
- Mandatory empty observation line handling.
- Empty-track handling and point rows with no fabricated track tokens.
- Sparse/non-continuous IDs and order preservation.
- Header counts ignored on read and recomputed on write.
- Byte-level golden output for all three fixed headers, field order and arity, LF endings, final line feeds, and the two-physical-line image record shape; this compares generated canonical text to the contract template, not to original input bytes.
- LF and CRLF input accepted according to the file-level policy; generated output is LF.
- Canonical text is deterministic but need not be byte-identical to input text.

### Summary demonstration tests

- Counts and camera data come from the parsed model, even if header counts are false.
- Default selection uses the first model record rather than ZIP order or smallest ID.
- Explicit image selection succeeds for an existing ID and rejects an absent ID.
- Resolution status reflects the adapter's exact asset lookup.
- The emitted ZIP replaces all three codec outputs and is reopened through the same public boundaries.

No Iteration 1A test requires a pose-quality improvement, measurement metric, or unselected refinement algorithm.

## 17. Task 1 fixture integration

The fixture aliases are read-only and have reproducible repository-history provenance:

| Local read-only alias | Repository-history source | SHA-256 | ZIP bytes | File entries | Images / records | Points |
|---|---|---|---:|---:|---:|---:|
| `dev/task1-fixtures/first-capture.zip` | `TaskOne:dev/zip/2026-07-09_15-46-36utc.zip` | `cba147f0fc418ccf7f5b978d661d22c88172f806b36caafb12ffd31608176e76` | 5,067,918 | 124 | 12 / 11 | 820 |
| `dev/task1-fixtures/second-capture.zip` | `TaskOne:dev/zip/2026-07-09_15-47-48utc.zip` | `43699ee56b34a6ff985811aa29a7e123609be6f302c2a29a526723051972d0ca` | 7,399,937 | 155 | 18 / 17 | 1026 |

Both verified fixtures contain one `PINHOLE` camera, empty observation lines, empty feature tracks, root `session.json`, `actions/`, and an unreferenced `images/frame-000001.jpg`. Every referenced image resolves. ZIP entry order differs from model order.

`first-capture.zip` is the minimum required integration fixture. `second-capture.zip` SHOULD be replayed as additional coverage but is not an Iteration 1A completion gate. Neither archive is extracted, modified, repackaged in place, or written into a tracked directory.

For `first-capture.zip`, the replay MUST assert the known values rather than merely round-trip whatever the parser returned: one camera with ID 1, model `PINHOLE`, dimensions `823 x 1920`, intrinsics `[1254.3877251148224, 1254.169921875, 411.5, 960]`; 11 image records; 820 point records; 12 image assets; referenced names `frame-000002.jpg` through `frame-000012.jpg`; and `images/frame-000001.jpg` as the sole unreferenced image asset.

For the required fixture, integration evidence MUST show:

1. the ZIP opens under the recorded resource policy;
2. all three supported sparse text files parse;
3. every image reference resolves exactly;
4. the required summary is produced;
5. the unchanged typed model is serialized through the actual writer;
6. all three generated sparse texts replace the original sparse texts in a copied ZIP;
7. the emitted ZIP reopens and reparses;
8. semantic equivalence and exact model preservation pass;
9. every non-replaced file entry, including `images/frame-000001.jpg`, retains its normalized path and decompressed bytes;
10. the emitted ZIP passes the LichtFeld compatibility smoke test below.


### LichtFeld compatibility smoke record

The smoke test MUST use the codec-re-emitted output ZIP, not an adapter-only copy. It is an external manual or automated acceptance procedure; automation is not required in 1A.

The record MUST identify:

- input fixture identity and emitted ZIP SHA-256/byte length;
- LichtFeld release/build and binary identity; the Task 1 prebuilt `v0.4.2` is the current reference build;
- the exact command or UI procedure, safe materialization procedure and unpacked dataset layout if applicable, and effective training settings used;
- operating system, GPU, driver, and CUDA environment;
- start/end outcome and a log, screenshot, or equivalent artifact reference;
- the produced splat artifact identity or locator.
- explicitly request image ID `1` and print its world-to-camera pose;

The smoke test passes only when LichtFeld loads the emitted camera model and referenced images without a COLMAP-input error, completes the selected training run normally, and produces a splat artifact that LichtFeld can open. Merely opening the ZIP, parsing it in the new codec, or reaching training start is insufficient for the assignment's "still train" requirement.

This smoke test checks compatibility only. It does not establish deterministic training, source/prebuilt parity, PSNR, SSIM, reprojection error, pose improvement, or visual-quality improvement. Those belong to later work.

Task 1's historical `v0.4.2` runs show that the original archives trained and produced recognizable but visibly flawed splats. They do not prove that a newly codec-re-emitted ZIP trains; the 1A smoke must be recorded anew.

## 18. Iteration 1A acceptance criteria

Iteration 1A is complete only when evidence shows all of the following:

1. A named Task 1 recorder ZIP can be opened safely.
2. `sparse/0/cameras.txt`, `sparse/0/images.txt`, and `sparse/0/points3D.txt` are parsed into the supported typed model.
3. Every model-referenced image resolves correctly and unreferenced images remain preserved.
4. The summary reports camera count, image count, point count, camera model/intrinsics, one selected image pose, and image-resolution status.
5. The parsed unchanged model is serialized through the actual writer; original sparse text is not copied as a substitute.
6. A new recorder-compatible ZIP is emitted by explicitly replacing the three generated COLMAP text files.
7. Untouched file entries preserve their normalized paths and decompressed bytes.
8. Reopening the emitted ZIP proves semantic round-trip equivalence and exact no-op model preservation.
9. All synthetic pose-convention and codec tests in section 16 pass.
10. The codec-re-emitted ZIP completes the section 17 LichtFeld compatibility smoke test.
11. The assignment conformance demo explicitly requests image ID `1` and prints its world-to-camera quaternion and translation. If image ID `1` is absent, the demo fails with the defined missing-image error.

Passing these criteria proves a faithful reader/writer and compatible regenerated dataset. It MUST NOT be reported as improved pose accuracy or improved splat quality.

## 19. Minimal future refinement boundary

This section is non-normative.

A later Goal 2 component may consume the validated typed COLMAP model and produce a model with updated image poses. The final refinement interface, evidence inputs, permitted deltas, configuration, outcomes, and algorithm will be defined only after:

- the LichtFeld workflow is reproducible;
- the measurement harness exists;
- the pose problem has been researched and quantified;
- multiple approaches have been compared and challenged;
- the team and Simon select the first approach in the required review call.

The bounded revision request describes this producer as a "later Goal 1 stage," while the assignment places implementation of the selected refinement under Goal 2 after the Goal 1 research gate. Assignment precedence governs this contract, so it uses the Goal 2/post-gate label and records the wording conflict in section 21.

Iteration 1A deliberately defines only the stable COLMAP-in/COLMAP-out seam. It does not define action-log signals, GPS/depth inputs, pose-graph constraints, bundle-adjustment types, optimizer settings, training-image holdout inputs, algorithm-specific outputs, or a plugin/provider system.

## 20. Subsequent Goal 1 work

This section is informational and does not define later APIs.

### 1B - LichtFeld reproducibility

Build LichtFeld from the source tag matching the Task 1 prebuilt, record the exact toolchain/build identity, compare source and prebuilt on the same input, document an exact repeatable ZIP-to-splat recipe, and assess comparable repeated runs. Under current evidence the matching Task 1 reference is `v0.4.2`; source-build comparison is mandatory later work, not "where feasible."

### 1C - Measurement

Create the assignment-required harness for held-out PSNR/SSIM, controlled visual A/B, and reprojection error when valid feature tracks exist. Include pure metric tests, deterministic split tests, frozen baseline/candidate settings, actual held-out exclusion evidence, and comparable reports. Empty recorder tracks make reprojection error unavailable until valid correspondences exist; unverified exact-view rendering is a prerequisite to solve, not a permanent waiver of the assignment's PSNR/SSIM requirement.

### 1D - Pose research and decision gate

Verify whether LichtFeld pose optimization exists in testable code, quantify the recorder pose problem using the harness, research several refinement approaches, compare trade-offs and prerequisites, challenge the analysis with an LLM, write a recommendation that retains alternatives, and bring it to a formal review call with Simon. The team and Simon, not this contract or an AI, select the first prototype.

### Post-gate

Only after the gate does implementation of the selected refinement prototype begin.

## 21. Open decisions

The following are unresolved and are not silently answered here:

1. Will the Iteration 1A demonstration be presented as a CLI or as a page? The behavior is fixed either way.
2. What finite default archive resource limits fit the chosen runtime while accepting realistic recorder sessions larger than the two current fixtures?
3. Should both Task 1 fixture aliases become mandatory replay gates after the minimum first-fixture path works?
4. Should the safe bare-filename rule remain the recorder-specific 1A policy, or should a future owner-backed recorder contract impose a narrower suffix or naming pattern?
5. The assignment asks the first plan to record early `refine` and harness interfaces, while this bounded 1A direction intentionally postpones their final contracts until 1B-1D evidence exists. Is recording only the stable COLMAP-in/COLMAP-out seam here an acceptable staged interpretation?
6. The bounded request calls pose-producing work a later Goal 1 stage, while the assignment places selected-refinement implementation in Goal 2 after the gate. Is the assignment-aligned Goal 2/post-gate label confirmed?
7. If the Task 1 `v0.4.2` prebuilt is unavailable for the new compatibility smoke, which precisely identified LichtFeld build is the approved 1A replacement?

These questions do not select a refinement method, held-out policy, metric substitute, or quality threshold.

## 22. Extraction and redesign summary

The v2 review is advisory. Only concerns that materially changed the coherent, testable 1A component are reflected below.

| V2/review concern | 1A treatment | Reason |
|---|---|---|
| V2 spans adapter, codec, refiner, and experiment contracts. | **Simplified** to adapter, recorder model/codec, summary surface, and external compatibility evidence. | Only these boundaries implement assignment component 1. |
| ZIP ownership was previously split or ambiguous. | **Retained** as one exclusive adapter owner. | Archive preservation and mutation need one accountable boundary. |
| A no-op could bypass the serializer. | **Redesigned** as separate adapter-copy and forced-codec paths; the demo replaces all three generated texts. | The demonstration must prove the real reader and writer. |
| Archive fidelity was confused with ZIP-byte identity. | **Retained and simplified** to normalized file-entry paths plus identical decompressed bytes for untouched entries. | This is testable and avoids unsupported container guarantees. |
| V2's archive profile promised arbitrary multi-gigabyte handling. | **Redesigned** as an explicit finite runtime policy recorded with evidence, with no speculative universal limits. | Current fixtures are small and the intended runtime is undecided. |
| Unsafe, duplicate, or ambiguous ZIP names could escape or alias. | **Retained** with a narrow reject-not-repair path policy. | Necessary for safe Windows fixture processing; no general archive framework is introduced. |
| V2 required `frame-NNNNNN.jpg`. | **Redesigned** to a safe bare filename and exact `images/<NAME>` lookup. | Fixtures show a `.jpg` pattern, but current serializer code does not enforce a suffix or six-digit form. |
| Parsed order and numeric formatting were underspecified. | **Retained** with source-order preservation, exact input regexes, finite/range checks, round-trip-safe output, and negative-zero policy. | Two implementations need interoperable parsing and deterministic output. |
| Semantic tolerance could hide changes claimed to be unchanged. | **Redesigned** with separate semantic and exact model-preservation predicates. | Tolerance/sign equivalence is useful for meaning; no-op acceptance must detect representation changes, including quaternion sign. |
| Empty observations/tracks were treated as missing data rather than a valid recorder subset. | **Retained** as explicit typed arrays that must be empty in 1A. | This matches verified recorder and fixture behavior without inventing feature support. |
| Coordinate rules included refinement-specific gauge machinery. | **Simplified** to world-to-camera direction, quaternion order, transform equation, camera center, axes, and no implicit conversion. | These are the only geometry rules required to prevent codec corruption. |
| The assignment-required summary surface was absent from v2. | **Redesigned** as a presentation-neutral orchestration contract that must use the real codec. | A CLI/page summary and re-emission are explicit component-1 demonstration requirements. |
| V2's consumer smoke gate had no pass condition. | **Redesigned** to require an identified emitted ZIP/build/procedure/environment and completed training with an openable splat artifact. | "Still train in LichtFeld" must have one reproducible compatibility meaning. |
| Fixture aliases lacked repository-history provenance. | **Retained** with alias-to-`TaskOne` source paths, hashes, sizes, and counts. | A teammate must be able to locate and verify the fixtures independently. |
| Measurement harness, holdout, metric evidence, and quality conclusions were flawed or incomplete. | **Moved to later Goal 1 work** in 1C. | The concerns are assignment-relevant but do not belong in the 1A reader/writer contract. |
| Source-build parity was made optional in v2. | **Moved to later Goal 1 work** in 1B and restored as mandatory there. | It is a direct assignment obligation, separate from reader/writer acceptance. |
| Gauge alignment, cancellation/timeout, pose deltas, and refinement result states added unused complexity. | **Removed from 1A** and left for post-evidence design. | There is no refiner consumer or selected algorithm in this iteration. |
| V2 source precedence elevated review history over verified behavior. | **Redesigned** so assignment, Simon decisions, and verified repository/fixture behavior lead; the lower-order conflict between `AGENTS.md` and this task's permitted sources is explicit. | Advisory review cannot override current evidence, and a forbidden official plan cannot be silently consulted. |
| Task 1 artifacts were sometimes discussed as proof of pose error or quality. | **Retained only as compatibility evidence** with explicit non-quality language. | Task 1 recorded hypotheses and visible artifacts, not causal or quantitative pose proof. |

The resulting contract is intentionally smaller than v2. It preserves the verified archive/codec core, adds the missing assignment demonstration, removes speculative later-stage schemas, and leaves all later Goal 1 obligations visible without designing them prematurely.

### Assignment conformance demo

The generic summary operation may accept an optional `selectedImageId`.

For the required Iteration 1A assignment demo, the caller must explicitly request
the pose of COLMAP image ID `1`. The demo must not rely on source-record order or
silently substitute another image.

If image ID `1` is absent, the summary operation must return the existing
missing-image failure.
