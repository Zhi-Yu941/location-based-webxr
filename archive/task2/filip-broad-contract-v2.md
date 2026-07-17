# Filip's Task 2 contract, version 2

> **Status: Superseded.** Independent broad Filip contract candidate retained for history. Its Iteration 1A scope was replaced by `Draft/filip-contract-1a.md`; its later-stage sections were not accepted as an official plan.

> Status: Independent broad architecture candidate.
> This document spans more than one Goal 1 work package.
> It is not the implementation plan and will be mined against the
> assignment requirements matrix.


## 1. Status and purpose

Status: independent candidate contract for team and Product Owner review.

This document replaces the architecture-audit form of archive/task2/filip-contract-audit.md with a concrete, minimal contract. It is not the official Task 2 plan, a production implementation, an algorithm selection, or a record of Product Owner approval.

The contract incorporates all 19 findings accepted in archive/task2/filip-contract-audit-review-disposition.md. Qualified findings remain qualified: exact-view rendering, image metrics, held-out visibility, and the external LichtFeld workflow still need evidence or a human decision. OWNER_DECISIONS.md is absent, so this document attributes no decision to Simon.

Normative terms have their usual meanings:

- MUST and MUST NOT define an invariant required for a conforming boundary.
- SHOULD describes a default that may be changed only by a reviewed contract revision.
- MAY describes permitted behavior.

The TypeScript declarations below define public shapes and signatures only. They contain no implementation, function body, refinement algorithm, or implementation task.

The source order used here is: the SoftwareLab assignment; confirmed Simon decisions, of which none were found; accepted human dispositions; OWNER_DECISIONS.md, which is absent; verified recorder and fixture behavior; Task 1 evidence; the original Filip draft; and architecture recommendations.

## 2. Assignment-derived objective

The assignment's destination is a reproducible transformation from a recorder-produced COLMAP ZIP to a corrected COLMAP ZIP whose image poses are globally improved, followed by evidence that identical LichtFeld training produces a better splat. The assignment also requires the COLMAP reader/writer and measurement capability to precede selection and implementation of a refinement method.

For the first iterations, the recorder ZIP is the sole external input/output contract. The reusable contribution lives in location-based-webxr, does not modify the recorder or exporter, and is independently testable across the COLMAP seam:

recorder ZIP -> typed COLMAP model -> corrected typed COLMAP model -> corrected recorder-compatible ZIP

LichtFeld is an external C++/CUDA trainer and an assignment-level validation concern. It is not part of the reusable component's runtime dependency graph:

baseline ZIP and corrected ZIP -> external LichtFeld experiment -> evidence and comparison report

The assignment requests held-out PSNR/SSIM, reprojection error, and visual A/B evidence for the eventual improvement claim. Current evidence cannot support all of those measurements:

- the recorder fixtures contain no usable feature tracks, so reprojection error is unavailable;
- exact supplied-camera rendering from LichtFeld is unverified, so PSNR and SSIM are unavailable;
- approximate interactive screenshots can be exploratory visual evidence but are not quantitative measurements.

This is a source conflict in capability, not permission to invent substitute metrics. The experiment contract therefore represents unavailable and failed measurements explicitly while preserving the assignment's eventual validation objective.

## 3. Scope and non-goals

The contract has exactly four public boundaries:

1. Recorder ZIP adapter.
2. Recorder-specific COLMAP text codec and typed model.
3. Algorithm-independent pose-refinement port.
4. External experimental measurement specification and report.

The reusable component covers the first three boundaries as contracts, while iteration-one implementation is limited to the ZIP adapter and text codec. The experimental measurement boundary is separate.

In scope:

- safe inspection and copy-through of recorder ZIPs;
- the verified recorder text subset under sparse/0/;
- model-referenced image resolution under images/;
- preservation of recorder-specific and unknown archive entries;
- typed parsing, validation, canonical serialization, and semantic comparison;
- an async-capable pose-only refinement port defined without an algorithm;
- a versioned description of external baseline/candidate experiments and their evidence states.

Non-goals:

- changing recorder/exporter behavior;
- implementing or choosing a pose-refinement method;
- parsing actions/, GPS, depth, or odometry;
- general COLMAP compatibility;
- a plugin, provider, optimizer, or future-sensor framework;
- importing, linking, or invoking LichtFeld from the ZIP adapter, codec, or refiner;
- asserting that a corrected pose set improves quality without an external paired experiment;
- treating the fixture point ERROR value or LichtFeld's final-error scalar as reprojection or visual quality;
- promising byte-identical text re-encoding or byte-identical ZIP containers.

## 4. Verified facts

### Recorder source

- The current exporter writes one shared PINHOLE camera and gives every image record that camera reference.
- images.txt records contain IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, and a bare NAME, followed by an empty observation line.
- points3D.txt records contain POINT3D_ID, X, Y, Z, R, G, B, and placeholder ERROR. The writer has no track field, and the contributor uses ERROR = 1 because no measured reprojection error exists.
- The serializer emits records in supplied array order. It does not sort by ID or archive order.
- Current numeric output uses JavaScript number-to-string behavior for finite-valued floats. Existing serializers round several integer fields, but not the cameras.txt cameraId, and round/clamp RGB; they do not provide complete validation. The new codec MUST validate and reject invalid values rather than silently round or clamp them.
- The exporter already converts WebXR camera-to-world data to COLMAP world-to-camera extrinsics and applies the same fixed world-basis change to camera poses and occupancy points. Task 2 MUST NOT apply that recorder-side conversion again.
- On a successful contribution, the exporter attempts all three sparse text writes. Known precondition failures write zero sparse files. The writes are sequential; transactionality after an intermediate I/O failure is not established. A partial sparse model is therefore invalid input.
- The current colmap source directory contains serializers and exporter-side conversions, but no text parser, ZIP reader, copy-through writer, or archive-safety contract.

### Task 1 fixtures

- first-capture.zip is 5,067,918 bytes with SHA-256 cba147f0fc418ccf7f5b978d661d22c88172f806b36caafb12ffd31608176e76. It has 124 file entries: session.json, 12 images, 108 action files, and the three sparse text files.
- second-capture.zip is 7,399,937 bytes with SHA-256 43699ee56b34a6ff985811aa29a7e123609be6f302c2a29a526723051972d0ca. It has 155 file entries: session.json, 18 images, 133 action files, and the three sparse text files.
- Neither fixture relies on explicit directory records. ZIP entry order differs from COLMAP model order and is not semantic.
- Both fixtures contain one camera row: 1 PINHOLE 823 1920 1254.3877251148224 1254.169921875 411.5 960.
- first-capture.zip has 11 image records and 820 points. second-capture.zip has 17 image records and 1026 points.
- In each fixture, images/frame-000001.jpg exists but is unreferenced. Every referenced image resolves successfully. Rebuilding images/ from model references would lose recorder data.
- Every image has an immediately following empty observation line. Every point row has eight fields, ERROR = 1, and an empty track.
- Fixture quaternions are unit length within floating-point precision. The second fixture includes negative qw values, so positive-qw sign canonicalization is not recorder behavior.
- The sparse texts are strict UTF-8 without a BOM, use LF line endings, and have trailing line feeds.

### Task 1 external evidence

- Both LichtFeld v0.4.2 smoke tests trained and produced recognizable splats with visible blur, ghosting, smearing, doubled features, edge noise, and floating splats.
- first-capture.zip maps to 2026-07-09_15-46-36utc and reported final error 0.0434.
- second-capture.zip maps to 2026-07-09_15-47-48utc and reported final error 0.0282.
- Those scalar errors are not validated visual-quality or reprojection metrics. The exact historical command, complete effective settings, binary/build identity, environment, and seed behavior remain unknown.
- Both fixtures depict the same charging-station subject. They do not satisfy the assignment's eventual more-than-one-scene proof.
- No permitted evidence verifies automated exact supplied-camera rendering, automated LichtFeld orchestration, or released LichtFeld pose optimization.

## 5. Assumptions and unresolved questions

The following are not established facts:

- Pose error is the dominant cause of the Task 1 artifacts. Capture overlap, motion blur, frame density, lighting, reflections, vegetation, and thin geometry remain plausible confounders.
- The two fixtures are representative enough to select a refinement method.
- The unchanged occupancy cloud remains a useful initialization after a large local pose correction.
- A LichtFeld run is reproducible enough for a single baseline/candidate pair to establish causality.
- A suitable held-out visibility policy has been selected.

Known contradictions and open evidence gaps:

- The assignment requests reprojection-error evidence but also states that recorder points have no feature tracks. The fixtures confirm the tracks are empty. This contract reports reprojection error as unavailable until a validated track set exists.
- The assignment requests held-out PSNR/SSIM, but no permitted evidence establishes exact supplied-camera rendering or a pixel-comparison policy. Those metrics remain unavailable.
- The assignment describes a schematic pure refine transform, while accepted review requires an async-capable boundary that can honestly wrap effectful implementations. This contract keeps validation and pose math pure where applicable but does not require the public port to be synchronous.
- The assignment uses both semantic round-trip language and "byte-faithful enough" wording without defining byte identity. This contract requires semantic round-trip and deterministic canonical output, not original-text byte identity.
- Task 1 mentions quoted image names after the first record. Current serializer behavior and both fixtures instead use bare names throughout. Iteration one supports the verified bare recorder form and rejects quoted names; the unreproduced observation remains evidence to recover, not a silently adopted grammar.
- The accepted disposition separates LichtFeld as an external Goal 1 activity, although its closing wording also suggests only future mention. This contract follows the detailed accepted finding: external validation remains required at assignment level but is outside the reusable dependency graph.
- No OWNER_DECISIONS.md exists. Held-out policy, minimum external evidence, and acceptance of the reusable/external split remain Simon decisions.

Archive thresholds and numeric tolerances below are engineering policies of this candidate. They are concrete so implementations and tests can agree, but they may be revised after evidence from larger valid recorder archives.

## 6. System boundary and data flow

### Reusable ZIP-refinement flow

1. The Recorder ZIP adapter validates the archive and exposes the three sparse text payloads.
2. The COLMAP text codec parses and validates those payloads into a typed model.
3. The ZIP adapter resolves each typed image NAME to an images/ asset while preserving unreferenced assets opaquely.
4. The pose-refinement port receives the immutable model and resolved referenced assets.
5. A successful updated result contains only validated pose changes in the original world frame and scale.
6. The codec serializes the corrected model deterministically.
7. The ZIP adapter creates a copy with explicit sparse-file replacements and copies all other file entries through.

For a pose-only correction, sparse/0/images.txt is the only required replacement. cameras.txt and points3D.txt SHOULD remain untouched archive entries. A forced three-file codec round trip is a separate test path, not the normal pose-update path.

### External experimental flow

1. Identify baseline and candidate ZIPs and their typed model identities.
2. Define a fixed split, visibility policy, LichtFeld build, effective settings, repeat policy, environment, and requested evidence.
3. Run LichtFeld externally, manually or through later experimental automation.
4. Record artifacts, metric availability, failures, and pair comparability.

Dependency rules:

- Only the ZIP adapter owns ZIP enumeration, decompression, entry lookup, preservation, and writing.
- The codec owns only COLMAP text bytes, typed values, validation, semantic equality, and canonical text.
- The refiner owns pose proposals and diagnostics, not ZIP state, serialization, metric evaluation, or hidden asset discovery.
- The experimental measurement package may consume ZIP artifacts but MUST NOT be imported by the adapter, codec, or refiner.
- No additional public dataset-snapshot owner, corrected-archive writer, evidence provider, or optimizer provider exists.

## 7. Core terminology

- Recorder archive: the complete input ZIP, including sparse/0/, images/, actions/, session.json, and unknown entries.
- File entry: a non-directory ZIP entry with a normalized safe relative path and decompressed bytes.
- Normalized path: a validated forward-slash relative path whose segments contain no empty, dot, or dot-dot segment. Normalization is used for lookup and collision detection; safe original path text is preserved.
- Untouched entry: a file entry whose normalized path is absent from the explicit replacement list.
- Replacement: new decompressed bytes for one existing supported sparse text path.
- Typed model: the validated recorder-specific COLMAP values defined in section 9. It contains no ZIP state.
- Image asset: the file entry at images/NAME resolved for a typed image record.
- Unreferenced image: an images/ file entry not named by a typed image record. It is preserved but is not automatically an experimental view.
- Canonical text: deterministic codec output for a valid typed model and codec version.
- Semantic equality: equality under section 10's exact-field, numeric-tolerance, order, and quaternion-sign rules.
- World gauge: the input model's world origin, axes, orientation, units, and scale.
- Pose delta: the set of image-ID-keyed before/after world-to-camera poses accepted by the allowed-delta validator.
- Eligible experimental view: an image record whose NAME resolves to an image asset.
- External experiment: LichtFeld training, rendering, artifact collection, and comparison performed outside the reusable component.

Shared identity types:

~~~ts
type Sha256Hex = string;

interface ImmutableBytes {
  readonly byteLength: number;
  copy(): Uint8Array;
}

interface ArtifactIdentity {
  readonly algorithm: "sha256";
  readonly digestHex: Sha256Hex;
  readonly byteLength: number;
}

interface ModelIdentity {
  readonly codecVersion: "recorder-colmap-text-v1";
  readonly canonicalTextSha256: Sha256Hex;
}
~~~

SHA-256 text MUST be 64 lowercase hexadecimal characters. Byte lengths MUST be non-negative safe integers.

ImmutableBytes exposes no mutable backing view. copy() MUST return a new Uint8Array whose mutation cannot affect the source or another copy. A boundary receiving bytes MUST take a defensive snapshot before asynchronous work and MUST NOT retain a caller-owned mutable buffer.

ArtifactIdentity.digestHex is SHA-256 of the exact artifact bytes. ModelIdentity.canonicalTextSha256 uses this versioned preimage:

1. Take canonical cameras.txt, images.txt, and points3D.txt bytes in that exact order.
2. For each payload, append UTF-8 bytes of its SparseTextPath, one NUL byte, its unsigned 64-bit big-endian byte length, then its exact payload bytes.
3. Concatenate the three framed payloads and hash the result with SHA-256.

Every field named canonicalJson MUST be the RFC 8785 JSON Canonicalization Scheme representation, encoded as UTF-8 without a BOM. Its accompanying SHA-256 is over those exact UTF-8 bytes.

SplitManifest.sha256, EffectiveTrainingConfiguration.canonicalSha256, and ActualRunManifest.manifestSha256 use RFC 8785 UTF-8 over their complete containing object with that digest field omitted. ExperimentReport.specSha256 is SHA-256 of RFC 8785 UTF-8 for the complete ExperimentSpec stored in that report; ExperimentSpec has no digest field to omit. Other digest preimages are defined at their fields rather than inferred from this paragraph.

## 8. Recorder ZIP adapter contract

### Public boundary

~~~ts
type SparseTextPath =
  | "sparse/0/cameras.txt"
  | "sparse/0/images.txt"
  | "sparse/0/points3D.txt";

type ArchivePath = string;

interface RecorderZipInput {
  readonly bytes: ImmutableBytes;
  readonly label?: string;
}

interface ColmapTextPayloads {
  readonly cameras: ImmutableBytes;
  readonly images: ImmutableBytes;
  readonly points3D: ImmutableBytes;
}

interface RecorderArchiveHandle {
  readonly kind: "recorder-archive";
  readonly identity: ArtifactIdentity;
  readonly fileEntryPaths: readonly ArchivePath[];
  readonly colmapText: ColmapTextPayloads;
}

interface ImageAssetReference {
  readonly imageId: ImageId;
  readonly name: string;
}

interface ResolvedImageAsset {
  readonly imageId: ImageId;
  readonly name: string;
  readonly path: ArchivePath;
  readonly bytes: ImmutableBytes;
  readonly identity: ArtifactIdentity;
}

interface ArchiveReplacement {
  readonly path: SparseTextPath;
  readonly bytes: ImmutableBytes;
}

interface RecorderZipCopyRequest {
  readonly archive: RecorderArchiveHandle;
  readonly replacements: readonly ArchiveReplacement[];
}

interface RecorderZipArtifact {
  readonly bytes: ImmutableBytes;
  readonly identity: ArtifactIdentity;
  readonly replacedPaths: readonly SparseTextPath[];
}

interface RecorderZipAdapter {
  open(input: RecorderZipInput): Promise<ArchiveOpenOutcome>;

  resolveImageAssets(
    archive: RecorderArchiveHandle,
    references: readonly ImageAssetReference[]
  ): Promise<ImageResolutionOutcome>;

  copyWithReplacements(
    request: RecorderZipCopyRequest
  ): Promise<ArchiveWriteOutcome>;
}
~~~

### Ownership and behavior

The adapter MUST:

- enumerate and validate every archive path before exposing or materializing an entry;
- require all three exact sparse text paths;
- reject a partial sparse text set;
- reject cameras.bin, images.bin, or points3D.bin under sparse/0/, including text/binary coexistence;
- expose the sparse payloads as bytes without interpreting COLMAP syntax;
- resolve each model image NAME to the exact case-sensitive path images/NAME;
- return resolved images in typed model order;
- preserve unreferenced images, actions/, session.json, and unknown future file entries;
- create an output by copying the source archive and replacing only explicitly listed existing sparse text paths;
- reject duplicate replacement paths and replacement paths outside SparseTextPath;
- compute artifact identities from complete ZIP bytes;
- return typed outcomes and return no output artifact after validation, read, replacement, or write failure.

The adapter MUST NOT:

- parse or serialize COLMAP values;
- derive images from ZIP order, filename ordinal, or numeric image ID;
- rebuild the archive from model references;
- expose unknown entry payloads to the refiner;
- change a file-entry path, add a file, or delete a file in iteration one;
- own pose math, refinement, LichtFeld execution, or metric evaluation.

### Path policy

For file entries, the adapter MUST reject:

- empty paths, absolute paths, drive-letter paths, UNC-style paths, backslashes, NUL, or ASCII control characters;
- leading or trailing slash, repeated slash, and "." or ".." segments;
- duplicate normalized paths;
- collisions under Unicode NFC plus locale-independent lowercase comparison;
- encrypted, symbolic-link, or other non-regular file entries.

Directory records MAY be read for validation and MAY be omitted from output. They are not file entries and are not part of fidelity acceptance.

Iteration-one safety limits are:

- at most 10,000 file entries;
- at most 1,024 UTF-8 bytes per entry path;
- at most 512 MiB decompressed bytes per file entry;
- at most 4 GiB total decompressed file bytes.

Limits MUST be enforced against bytes actually decompressed, not only untrusted ZIP metadata.

### Fidelity

The output MUST have the same set of normalized file-entry names as the input. For every path absent from replacements, its decompressed bytes MUST be identical to the input bytes. The contract does not preserve compressed bytes, entry order, compression algorithm, timestamps, archive comments, extra fields, or directory records.

An empty replacement list is a valid copy-only no-op. It proves adapter copy-through, not codec correctness.

## 9. COLMAP typed data model

~~~ts
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

interface ColmapModel {
  readonly cameras: readonly [PinholeCamera];
  readonly images: readonly ColmapImage[];
  readonly points3D: readonly ColmapPoint3D[];
}
~~~

The arrays are ordered model data. The codec preserves their parsed order; IDs need not be continuous or start at one.

Iteration-one validation requires:

- every ID and dimension to be a positive safe integer;
- exactly one camera, with an arbitrary valid camera ID;
- at least one image;
- unique camera IDs, image IDs, point IDs, and image names;
- every image cameraId to reference the one camera;
- fx and fy to be positive finite numbers; cx and cy to be finite;
- finite qvec and tvec components and a valid unit quaternion;
- each RGB component to be an integer in [0, 255];
- finite non-negative point error;
- observations to be empty;
- tracks to be empty;
- image names to match the exact verified bare-basename expression <code>^frame-[0-9]{6}\.jpg$</code> and contain no quote, whitespace, slash, or backslash.

The observation and track types make the COLMAP concepts explicit. Non-empty values are invalid in iteration one and do not imply implemented feature-track support.

## 10. COLMAP text codec contract

### Public boundary

~~~ts
interface CanonicalColmapText {
  readonly codecVersion: "recorder-colmap-text-v1";
  readonly files: ColmapTextPayloads;
  readonly modelIdentity: ModelIdentity;
}

type SemanticDifferenceCode =
  | "record-count"
  | "record-order"
  | "identifier"
  | "camera"
  | "image-name"
  | "camera-reference"
  | "observation"
  | "point-track"
  | "numeric-value"
  | "pose-orientation";

type SemanticEqualityResult =
  | { readonly equal: true }
  | {
      readonly equal: false;
      readonly code: SemanticDifferenceCode;
      readonly path: string;
    };

interface ColmapTextCodec {
  parse(files: ColmapTextPayloads): ColmapParseOutcome;
  serialize(model: ColmapModel): ColmapSerializeOutcome;
  semanticallyEqual(
    left: ColmapModel,
    right: ColmapModel
  ): SemanticEqualityResult;
}
~~~

### Accepted recorder-specific grammar

All three payloads MUST be strict UTF-8 without a BOM or NUL. Input MAY use LF or CRLF consistently within one file; bare CR is invalid. Canonical output uses LF.

Comments begin with "#" and are permitted only before the first data record. Comment counts are informative and MUST NOT override parsed records.

| File | Iteration-one data grammar |
|---|---|
| cameras.txt | Exactly one eight-token record: CAMERA_ID PINHOLE WIDTH HEIGHT FX FY CX CY. |
| images.txt | One or more image records. Each ten-token pose line is IMAGE_ID QW QX QY QZ TX TY TZ CAMERA_ID NAME and MUST be followed immediately by a physical line containing no non-whitespace token. |
| points3D.txt | Zero or more eight-token records: POINT3D_ID X Y Z R G B ERROR. Extra track tokens are invalid. An empty data body is valid. |

Tokens are separated by one or more ASCII spaces or tabs on input. Numeric grammar accepts ASCII decimal integers and syntactically valid decimal/scientific numeric lexemes with "." as decimal separator. After conversion, every numeric value MUST be finite. NaN, Infinity, hexadecimal notation, numeric separators, and locale-specific commas are invalid.

A BOM or NUL maps to syntax code bom-or-nul-not-allowed. A token that does not match the floating-number grammar maps to numeric code invalid-number; a matching token whose value is not finite maps to non-finite. Integer fields use invalid-integer, unsafe-integer, or the applicable range code.

The parser MUST:

- retain data-record order independently for cameras, images, and points;
- pair each image pose line with its mandatory empty observation line;
- validate exact arity before numeric conversion;
- reject unsupported camera models, quoted or path-bearing names, populated observations, populated tracks, malformed IDs, duplicates, and invalid references;
- return all locations as file path, one-based line, and field name or index;
- return no partial model after an error.

### Numeric and quaternion policy

- Integers MUST be validated, never rounded.
- RGB MUST be validated, never rounded or clamped.
- All floating values MUST be finite.
- A qvec is valid when abs(norm(qvec) - 1) is at most 1e-6.
- Parsed and newly supplied quaternions MUST NOT be silently normalized.
- Quaternion sign MUST be preserved during serialization. There is no positive-qw rule.
- q and -q are orientation-equivalent for semantic comparison.
- Negative zero is semantically equal to zero and is serialized as "0".
- Other finite numbers are serialized with ECMAScript base-10 Number.prototype.toString semantics: locale-independent and shortest round-trip-safe for the stored binary64 value.
- Scalar semantic equality holds when:

  abs(a - b) <= max(1e-12, 1e-12 * max(abs(a), abs(b))).

- Quaternion comparison first chooses the sign of the right quaternion that gives a non-negative dot product with the left, then applies the scalar tolerance component-wise. Both inputs must independently pass quaternion validation.

### Deterministic serialization

For one valid model and codec version, repeated serialization MUST produce identical canonical text bytes.

Canonical output MUST:

- emit the arrays in their supplied model order and never sort by ID, ZIP order, or filename;
- use fixed recorder-compatible comment headers whose counts are computed from the model;
- use one ASCII space between tokens;
- emit decimal safe integers without leading plus signs or unnecessary leading zeros;
- use the numeric policy above;
- emit one empty observation line after every image pose line;
- emit no point track tokens;
- use LF and end each file with an LF.

The fixed headers are exactly:

~~~text
# cameras.txt
# Camera list with one line of data per camera:
#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]
# Number of cameras: 1

# images.txt
# Image list with two lines of data per image:
#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME
#   POINTS2D[] as (X, Y, POINT3D_ID)
# Number of images: {image-count}, mean observations per image: 0

# points3D.txt
# 3D point list with one line of data per point:
#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)
# Number of points: {point-count}, mean track length: 0
~~~

The "# cameras.txt", "# images.txt", and "# points3D.txt" labels above identify templates and are not emitted. Braced counts are replaced by canonical decimal safe integers. No blank line is emitted between a file's header and first data record.

Serialization MUST validate the complete model first and return no file payload after failure. Canonical text is not promised to match original comments, whitespace, number lexemes, line endings, or bytes.

### Semantic equality

Semantic equality requires:

- equal record counts and equal record order;
- exact IDs, camera model, dimensions, image names, camera references, RGB values, observation state, and track state;
- scalar numeric equality under the stated tolerance;
- sign-equivalent quaternion comparison;
- no ignored extra record or unsupported field.

Because record order is contracted data, two models with reordered but otherwise equal records are not semantically equal under recorder-colmap-text-v1.

## 11. Pose-refinement port contract

### Public boundary

~~~ts
interface RefinementConfiguration {
  readonly implementationId: string;
  readonly implementationVersion: string;
  readonly schemaVersion: string;
  readonly canonicalJson: string;
  readonly sha256: Sha256Hex;
}

interface PoseRefinementRequest {
  readonly model: ColmapModel;
  readonly imageAssets: readonly ResolvedImageAsset[];
  readonly configuration: RefinementConfiguration;
}

interface PoseChangeMagnitude {
  readonly rotationRadians: number;
  readonly cameraCenterDistance: number;
}

interface PoseChange {
  readonly imageId: ImageId;
  readonly before: WorldToCameraPose;
  readonly after: WorldToCameraPose;
  readonly magnitude: PoseChangeMagnitude;
}

type GaugeAlignmentRecord =
  | { readonly status: "not-used" }
  | {
      readonly status: "applied";
      readonly solverToInputScale: number;
      readonly solverToInputRotation: QuaternionWxyz;
      readonly solverToInputTranslation: Vector3;
      readonly evidence: string;
    };

type RefinementWarningCode =
  | "point-cloud-may-be-stale"
  | "gauge-alignment-applied"
  | "external-validation-required";

interface RefinementWarning {
  readonly code: RefinementWarningCode;
  readonly message: string;
  readonly imageIds: readonly ImageId[];
}

interface RefinementProvenance {
  readonly implementationId: string;
  readonly implementationVersion: string;
  readonly configurationSha256: Sha256Hex;
}

type PoseRefinementResult =
  | {
      readonly status: "updated";
      readonly model: ColmapModel;
      readonly changes: readonly PoseChange[];
      readonly changedImageIds: readonly ImageId[];
      readonly gaugeAlignment: GaugeAlignmentRecord;
      readonly warnings: readonly RefinementWarning[];
      readonly provenance: RefinementProvenance;
    }
  | {
      readonly status: "unchanged";
      readonly model: ColmapModel;
      readonly changes: readonly [];
      readonly changedImageIds: readonly [];
      readonly gaugeAlignment: GaugeAlignmentRecord;
      readonly warnings: readonly RefinementWarning[];
      readonly provenance: RefinementProvenance;
    }
  | {
      readonly status: "insufficient-evidence";
      readonly reason:
        | "input-does-not-support-a-justified-update"
        | "no-valid-pose-update";
      readonly gaugeAlignment: GaugeAlignmentRecord;
      readonly warnings: readonly RefinementWarning[];
      readonly provenance: RefinementProvenance;
    }
  | {
      readonly status: "failed";
      readonly error: RefinementError;
      readonly gaugeAlignment: GaugeAlignmentRecord;
      readonly warnings: readonly RefinementWarning[];
      readonly provenance: RefinementProvenance;
    };

interface PoseRefinementPort {
  refine(request: PoseRefinementRequest): Promise<PoseRefinementResult>;
}
~~~

The configuration payload is implementation-owned, versioned canonical JSON with a matching digest. It does not create a plugin system or a common vocabulary for constraints, inliers, losses, checkpoints, processes, or sensor data.

### Required behavior

The port MUST:

- treat the request model and image bytes as immutable;
- require imageAssets to contain exactly one asset per model image, in model order, with no duplicate or extra asset;
- require each asset's imageId and name to equal its model image, its path to equal images/NAME exactly, and its identity to match its exposed bytes;
- return a new model for updated results and never mutate the input;
- validate input before refinement and validate output before returning updated;
- report every semantically changed image ID exactly once and in input image order;
- include before/after poses and change magnitudes for exactly those IDs;
- preserve the input world frame, axes, origin, units, and scale;
- report whether a solver-to-input gauge alignment was applied;
- return insufficient-evidence rather than inventing a correction;
- return failed rather than returning a partially valid model.

For updated, the only permitted model fields to change are qvec and tvec for image IDs listed in changes. The following MUST remain unchanged:

- camera records, IDs, order, model, dimensions, and intrinsics;
- image count, IDs, order, names, camera references, and observations;
- point count, IDs, order, XYZ, RGB, error, and tracks;
- all qvec and tvec tuples of untargeted images.

Untargeted pose tuples MUST be numerically identical to the input tuples; a sign-only quaternion rewrite is not permitted on an untargeted image. An updated result MUST contain at least one semantic pose change. An unchanged result MUST contain a model semantically equal to the input and empty change lists.

Rotation magnitude is the sign-invariant geodesic angle between normalized valid before/after quaternions, in [0, pi]. Translation magnitude is Euclidean distance between camera centers computed in the unchanged input world units. Both values MUST be finite and non-negative.

Every outcome reports gaugeAlignment. "not-used" means no solver-to-input transform affected the returned or attempted result. An "applied" record requires a positive finite scale, a finite unit rotation satisfying section 10, a finite translation, and non-empty alignment evidence.

If an implementation solves in another gauge, it MUST record the Sim(3) mapping used to return its solution to the input gauge. A result that cannot be returned to and validated in the input world frame and scale is not updated.

Preserving the world gauge and leaving points3D unchanged do not establish that the occupancy cloud remains an ideal physical initialization. A substantial local pose correction can make the seed cloud stale. The result MUST include point-cloud-may-be-stale when its implementation-specific reviewed threshold is exceeded; this contract does not invent a universal quality threshold.

No refinement algorithm is selected here.

## 12. Coordinate and world-gauge invariants

These rules are normative across codec, refiner, delta validation, and tests:

- COLMAP camera coordinates form a right-handed frame with +X right, +Y down, and +Z forward.
- A point is represented as a column vector.
- An images.txt pose is a world-to-camera extrinsic:

  X_camera = R(qvec) X_world + t.

- Quaternion file and model order is [qw, qx, qy, qz].
- A math library using [x, y, z, w] MUST be mapped explicitly as [qx, qy, qz, qw].
- tvec is not the camera position. Camera center is:

  C = -R^T t.

- Camera-to-world and world-to-camera transforms MUST NOT be mixed. Inversion or transposition must occur only at an explicitly named, tested conversion boundary.
- Recorder ZIP values are already in the persisted COLMAP world convention. The Task 2 component MUST NOT repeat the WebXR-to-COLMAP basis conversion.
- No implicit coordinate rescaling, unit conversion, reorientation, recentering, origin shift, axis flip, or gauge normalization is allowed.
- qvec validation uses section 10's finite/unit tolerance. Invalid input is rejected; it is not silently normalized.
- Rotation comparison is sign-equivalent, but serialization preserves the supplied sign.
- Only explicitly targeted qvec and tvec values may change.
- All non-pose model data must remain semantically unchanged.

World-gauge preservation means the output cameras are expressed in the exact input world frame and scale. It prevents arbitrary global solver drift from being written beside the original points. It does not prove that locally moved cameras still make the unchanged occupancy cloud an optimal seed.

## 13. Experimental measurement contract

This boundary is a separate experimental package or document schema. It may read baseline/candidate artifacts produced by the reusable flow, but the ZIP adapter, codec, and refiner MUST NOT depend on it or on LichtFeld.

### Specification types

~~~ts
interface ExperimentView {
  readonly imageId: ImageId;
  readonly name: string;
}

interface SplitManifest {
  readonly eligibleViews: readonly ExperimentView[];
  readonly trainingViews: readonly ExperimentView[];
  readonly evaluationViews: readonly ExperimentView[];
  readonly sha256: Sha256Hex;
}

type SeedCloudVisibility =
  | { readonly kind: "session-wide-without-per-image-provenance" }
  | { readonly kind: "training-images-only" }
  | { readonly kind: "other"; readonly description: string };

type HeldOutVisibilityPolicy =
  | {
      readonly kind: "training-only-holdout";
      readonly trainerRgb: "training-only";
      readonly refinerRgb: "all-eligible";
      readonly seedCloud: SeedCloudVisibility;
    }
  | {
      readonly kind: "strict-rgb-holdout";
      readonly trainerRgb: "training-only";
      readonly refinerRgb: "training-only";
      readonly seedCloud: SeedCloudVisibility;
    };

type LichtFeldBuildIdentity =
  | {
      readonly kind: "prebuilt";
      readonly releaseVersion: string;
      readonly binary: ArtifactIdentity;
    }
  | {
      readonly kind: "source";
      readonly releaseVersion: string;
      readonly tag: string;
      readonly commit: string;
      readonly binary: ArtifactIdentity;
      readonly buildConfiguration: ArtifactIdentity;
    };

interface EffectiveTrainingSetting {
  readonly name: string;
  readonly value: string;
  readonly origin: "explicit" | "default" | "observed";
}

interface EffectiveTrainingConfiguration {
  readonly settings: readonly EffectiveTrainingSetting[];
  readonly canonicalSha256: Sha256Hex;
  readonly invocation: "manual" | "automated";
  readonly procedureReference: string;
}

interface RepeatPolicy {
  readonly runCountPerArchive: number;
  readonly seedPolicy:
    | { readonly kind: "fixed"; readonly seed: string }
    | { readonly kind: "varied"; readonly seeds: readonly string[] }
    | { readonly kind: "not-exposed" };
  readonly aggregation: "report-each-and-arithmetic-mean";
}

interface ExperimentEnvironment {
  readonly operatingSystem: string;
  readonly cpu: string;
  readonly gpu: string;
  readonly gpuDriver: string;
  readonly cudaRuntime: string;
  readonly machineIdentity: string;
}

interface PixelComparisonPolicy {
  readonly version: string;
  readonly orientation: string;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly resizeMethod: string;
  readonly colorSpace: "srgb" | "linear-rgb";
  readonly numericRange: string;
  readonly cropOrMask: string;
  readonly backgroundPolicy: string;
  readonly invalidPixelPolicy: string;
  readonly ssimImplementation: string;
  readonly ssimConstants: string;
  readonly perViewAggregation: string;
  readonly minimumCoverage: string;
}

interface ExperimentalMetricPolicy {
  readonly requested: readonly ("psnr" | "ssim" | "reprojection-error")[];
  readonly pixelPolicy?: PixelComparisonPolicy;
  readonly reprojectionTrackSet?: ArtifactIdentity;
  readonly reprojectionResidualPolicyVersion?: string;
}

interface GlobalArtifactReference {
  readonly kind:
    | "configuration"
    | "log"
    | "splat"
    | "metric-data"
    | "pose-delta-validation";
  readonly identity: ArtifactIdentity;
  readonly locator: string;
}

interface ViewArtifactReference {
  readonly kind:
    | "exact-view-render"
    | "reference-image"
    | "visual-ab";
  readonly view: ExperimentView;
  readonly identity: ArtifactIdentity;
  readonly locator: string;
}

interface ExploratoryVisualArtifactReference {
  readonly kind: "exploratory-visual";
  readonly approximateViewDescription: string;
  readonly identity: ArtifactIdentity;
  readonly locator: string;
}

type ArtifactReference =
  | GlobalArtifactReference
  | ViewArtifactReference
  | ExploratoryVisualArtifactReference;

interface ExperimentProvenance {
  readonly repositoryRevision: string;
  readonly recorderSourceDescription: string;
  readonly operator: string;
  readonly recordedAtIso8601: string;
}

interface ExperimentSpec {
  readonly schemaVersion: "lichtfeld-paired-experiment-v1";
  readonly experimentId: string;
  readonly baselineArchive: ArtifactIdentity;
  readonly candidateArchive: ArtifactIdentity;
  readonly baselineModel: ModelIdentity;
  readonly candidateModel: ModelIdentity;
  readonly lichtfeldBuild: LichtFeldBuildIdentity;
  readonly training: EffectiveTrainingConfiguration;
  readonly split: SplitManifest;
  readonly visibility: HeldOutVisibilityPolicy;
  readonly repeats: RepeatPolicy;
  readonly environment: ExperimentEnvironment;
  readonly metrics: ExperimentalMetricPolicy;
  readonly provenance: ExperimentProvenance;
}
~~~

Eligible views MUST be exactly the ordered image records whose names resolve to assets. The split MUST partition eligible views into disjoint training and evaluation lists with no duplicate ID or name. Unreferenced images remain in the ZIP but MUST NOT enter the split automatically.

SplitManifest.sha256 MUST use section 7's RFC 8785 rule over the complete split object, with sha256 omitted. EffectiveTrainingConfiguration.canonicalSha256 MUST use the same rule over settings, invocation, and procedureReference, with canonicalSha256 omitted; the setting list includes effective defaults. runCountPerArchive MUST be a positive safe integer; repeat indices MUST be zero-based safe integers smaller than that count.

A varied seed list MUST contain exactly runCountPerArchive entries in repeat-index order. A fixed seed applies to every repeat. ActualRunManifest.actualSeed MUST equal the fixed or indexed varied seed; it is null only when the build exposes no seed.

The contract defines two held-out policies but selects neither:

- training-only holdout hides evaluation RGB from LichtFeld training but permits the refiner to use it;
- strict RGB holdout hides evaluation RGB from both training and refinement.

Both policies record seed-cloud visibility because the recorder occupancy cloud may contain session-wide information without per-image provenance. Results from different visibility policies are not comparable and MUST NOT be pooled.

Every ViewArtifactReference MUST name an eligible view and MUST match that view's image ID and name. A visual-ab artifact contains both role outputs for that one declared view; it cannot pair approximate or differently identified viewpoints.

An approximate viewer screenshot is represented only as ExploratoryVisualArtifactReference with a non-empty viewpoint description. It MUST NOT appear in a supported metric's per-view artifacts and cannot establish exact-view capability or quantitative evidence.

### Report and closed states

~~~ts
type CapabilityOutcome =
  | {
      readonly status: "supported";
      readonly evidence: readonly ArtifactReference[];
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "not-verified"
        | "exact-supplied-camera-rendering-unverified"
        | "automated-orchestration-unverified";
    }
  | {
      readonly status: "failed";
      readonly error: ExperimentError;
    };

type MetricName = "psnr" | "ssim" | "reprojection-error";

interface ExperimentRunKey {
  readonly role: "baseline" | "candidate";
  readonly repeatIndex: number;
  readonly archive: ArtifactIdentity;
}

interface ActualRunManifest {
  readonly schemaVersion: "lichtfeld-actual-run-v1";
  readonly run: ExperimentRunKey;
  readonly inputModel: ModelIdentity;
  readonly lichtfeldBuild: LichtFeldBuildIdentity;
  readonly training: EffectiveTrainingConfiguration;
  readonly split: SplitManifest;
  readonly visibility: HeldOutVisibilityPolicy;
  readonly repeats: RepeatPolicy;
  readonly actualSeed: string | null;
  readonly environment: ExperimentEnvironment;
  readonly metrics: ExperimentalMetricPolicy;
  readonly manifestSha256: Sha256Hex;
}

type PoseOnlyPairInvalidReason =
  | "camera-data-changed"
  | "image-identity-or-order-changed"
  | "image-observations-changed"
  | "point-data-changed"
  | "untargeted-pose-changed"
  | "invalid-target-pose"
  | "archive-non-pose-entry-changed";

type PoseOnlyPairValidation =
  | {
      readonly status: "valid";
      readonly validatorVersion: string;
      readonly baselineArchive: ArtifactIdentity;
      readonly candidateArchive: ArtifactIdentity;
      readonly baselineModel: ModelIdentity;
      readonly candidateModel: ModelIdentity;
      readonly changedImageIds: readonly ImageId[];
      readonly deltaSha256: Sha256Hex;
      readonly evidence: GlobalArtifactReference;
    }
  | {
      readonly status: "invalid";
      readonly validatorVersion: string;
      readonly baselineArchive: ArtifactIdentity;
      readonly candidateArchive: ArtifactIdentity;
      readonly baselineModel: ModelIdentity;
      readonly candidateModel: ModelIdentity;
      readonly reasons: readonly PoseOnlyPairInvalidReason[];
      readonly evidence?: GlobalArtifactReference;
    };

type MetricUnavailableReason =
  | "feature-tracks-absent"
  | "exact-supplied-camera-rendering-unverified"
  | "pixel-comparison-policy-unverified"
  | "not-requested";

type RunMetricOutcome =
  | {
      readonly status: "supported";
      readonly run: ExperimentRunKey;
      readonly metric: MetricName;
      readonly unit: string;
      readonly perView: readonly {
        readonly view: ExperimentView;
        readonly value: number;
        readonly artifacts: readonly ViewArtifactReference[];
      }[];
      readonly runAggregate: number;
      readonly policyVersion: string;
      readonly artifacts: readonly ArtifactReference[];
    }
  | {
      readonly status: "unavailable";
      readonly run: ExperimentRunKey;
      readonly metric: MetricName;
      readonly reason: MetricUnavailableReason;
    }
  | {
      readonly status: "failed";
      readonly run: ExperimentRunKey;
      readonly metric: MetricName;
      readonly error: ExperimentError;
    };

type RoleMetricAggregate =
  | {
      readonly status: "supported";
      readonly role: "baseline" | "candidate";
      readonly metric: MetricName;
      readonly unit: string;
      readonly aggregation: "arithmetic-mean-of-run-aggregates";
      readonly sourceRuns: readonly ExperimentRunKey[];
      readonly value: number;
      readonly policyVersion: string;
    }
  | {
      readonly status: "unavailable";
      readonly role: "baseline" | "candidate";
      readonly metric: MetricName;
      readonly reason: MetricUnavailableReason;
    }
  | {
      readonly status: "failed";
      readonly role: "baseline" | "candidate";
      readonly metric: MetricName;
      readonly error: ExperimentError;
    };

type ExternalRunStatus =
  | { readonly status: "completed" }
  | {
      readonly status: "unsupported";
      readonly reason:
        | "exact-view-rendering"
        | "automated-orchestration"
        | "environment";
    }
  | { readonly status: "failed"; readonly error: ExperimentError };

interface ExternalRunReport {
  readonly run: ExperimentRunKey;
  readonly manifest: ActualRunManifest;
  readonly status: ExternalRunStatus;
  readonly artifacts: readonly ArtifactReference[];
}

type ComparisonInvalidReason =
  | "archive-pair-is-not-pose-only"
  | "lichtfeld-build-mismatch"
  | "training-configuration-mismatch"
  | "split-mismatch"
  | "visibility-policy-mismatch"
  | "repeat-policy-mismatch"
  | "environment-mismatch"
  | "metric-policy-mismatch"
  | "missing-artifact"
  | "external-run-failed"
  | "capability-unavailable"
  | "undeclared-difference";

type ComparisonOutcome =
  | {
      readonly status: "comparable";
      readonly scope: "requested-evidence" | "structural-only";
    }
  | {
      readonly status: "not-comparable";
      readonly reasons: readonly ComparisonInvalidReason[];
    };

interface ExperimentReport {
  readonly schemaVersion: "lichtfeld-paired-report-v1";
  readonly spec: ExperimentSpec;
  readonly specSha256: Sha256Hex;
  readonly poseOnlyPair: PoseOnlyPairValidation;
  readonly exactViewRendering: CapabilityOutcome;
  readonly automatedOrchestration: CapabilityOutcome;
  readonly runs: readonly ExternalRunReport[];
  readonly runMetrics: readonly RunMetricOutcome[];
  readonly roleMetricAggregates: readonly RoleMetricAggregate[];
  readonly artifacts: readonly ArtifactReference[];
  readonly comparison: ComparisonOutcome;
}
~~~

Two pose-effect runs are comparable only when:

- specSha256 is the section 7 digest of report.spec;
- poseOnlyPair baseline/candidate archive and model identities exactly equal report.spec's corresponding four identities;
- poseOnlyPair is valid and proves that baseline/candidate archive and model differences are limited to the declared pose delta;
- runs contain exactly one baseline and one candidate entry for every repeat index required by report.spec.repeats, with no duplicate or extra role/repeat key;
- each baseline run key/archive and manifest.inputModel equal report.spec.baselineArchive and baselineModel, and each candidate run equals the corresponding candidate identities;
- every ExternalRunReport.run equals its manifest.run, and every run metric references that same run key;
- each actual run manifest's build, training, split, visibility, repeat policy, environment, and metric policy equal report.spec and therefore match the paired run;
- each required repeat and artifact exists;
- every requested metric and required capability is supported and no required run, artifact, or metric failed;
- each role aggregate uses exactly the completed run-level outcomes for that role and metric;
- all differences are declared and the only permitted dataset difference is the accepted pose delta.

ComparisonOutcome is sufficiency for the evidence requested by ExperimentSpec, not merely configuration similarity. An unavailable requested metric or required capability makes the result not-comparable with capability-unavailable. A metric explicitly not requested does not invalidate comparison. If the requested metric list is empty, a valid comparison can have scope structural-only but cannot support a quality-improvement claim.

Exact-view rendering is a required capability exactly when PSNR or SSIM is requested. Automated orchestration is a required capability exactly when report.spec.training.invocation is automated. Its unavailability does not invalidate a declared manual experiment.

For a valid poseOnlyPair, evidence.kind MUST be pose-delta-validation. deltaSha256 is SHA-256 of section 7 canonical JSON for the ordered PoseChange list, and changedImageIds MUST equal that list's image IDs. The validation covers both typed-model field equality and archive copy-through equality outside the declared images.txt pose replacement.

ExperimentReport MUST contain exactly one RunMetricOutcome for each run and each MetricName, using unavailable/not-requested where applicable, plus exactly one RoleMetricAggregate for each role and metric. A supported role aggregate MUST use every supported repeat for that role and no run from the other role.

A source-build versus prebuilt parity experiment intentionally changes the build and is separate evidence; it is not a pose-effect comparison.

Current capability rules:

- exact-view rendering is unavailable until an exact supplied-COLMAP-camera operation or repeatable exact manual procedure is verified;
- PSNR and SSIM are unavailable until exact-view rendering and a complete versioned PixelComparisonPolicy are verified;
- reprojection error is unavailable whenever observations/tracks needed by the stated residual policy are absent;
- automated LichtFeld orchestration is unavailable until verified;
- Task 1 final-error values may be retained as log evidence only;
- manual approximate A/B screenshots may be exploratory-visual artifacts but cannot satisfy a supported quantitative metric.

If external validation is performed, it MUST establish a new canonical recorded configuration when historical Task 1 settings cannot be recovered. Recovered historical evidence, unknown historical fields, and new reproducible evidence MUST be labelled separately.

## 14. Typed errors and closed outcomes

No public boundary may expose an untyped thrown string or partially successful value. Internal exceptions MUST be translated to one of these closed outcomes.

### Archive outcomes

~~~ts
type ArchiveError =
  | {
      readonly kind: "invalid-zip";
      readonly message: string;
    }
  | {
      readonly kind: "unsafe-entry-path";
      readonly path: string;
      readonly reason:
        | "absolute"
        | "drive-or-unc"
        | "backslash"
        | "control-character"
        | "empty-or-dot-segment"
        | "path-too-long";
    }
  | {
      readonly kind: "duplicate-entry-path";
      readonly paths: readonly string[];
    }
  | {
      readonly kind: "case-colliding-entry-path";
      readonly paths: readonly string[];
    }
  | {
      readonly kind: "unsupported-entry-kind";
      readonly path: string;
    }
  | {
      readonly kind: "archive-limit-exceeded";
      readonly limit:
        | "file-count"
        | "entry-uncompressed-bytes"
        | "total-uncompressed-bytes";
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
      readonly reason: "unsupported-path" | "duplicate-path" | "missing-source-path";
    }
  | {
      readonly kind: "archive-read-failed" | "archive-write-failed";
      readonly message: string;
    };

type ArchiveOpenOutcome =
  | {
      readonly status: "opened";
      readonly archive: RecorderArchiveHandle;
    }
  | { readonly status: "rejected"; readonly error: ArchiveError };

type ImageResolutionOutcome =
  | {
      readonly status: "resolved";
      readonly assets: readonly ResolvedImageAsset[];
    }
  | { readonly status: "rejected"; readonly error: ArchiveError };

type ArchiveWriteOutcome =
  | {
      readonly status: "written";
      readonly artifact: RecorderZipArtifact;
    }
  | { readonly status: "failed"; readonly error: ArchiveError };
~~~

### Codec outcomes

~~~ts
type CodecLocation =
  | {
      readonly kind: "text";
      readonly path: SparseTextPath;
      readonly line: number;
      readonly field?: string;
    }
  | {
      readonly kind: "model";
      readonly path: string;
    };

type CodecSyntaxCode =
  | "invalid-utf8"
  | "bom-or-nul-not-allowed"
  | "invalid-newline"
  | "unexpected-comment"
  | "unexpected-blank-line"
  | "unexpected-field-count"
  | "missing-camera-record"
  | "unsupported-camera-count"
  | "missing-image-record"
  | "missing-observation-line"
  | "non-empty-observations"
  | "non-empty-track"
  | "unsupported-camera-model"
  | "unsupported-image-name";

type CodecNumericCode =
  | "invalid-integer"
  | "invalid-number"
  | "unsafe-integer"
  | "out-of-range"
  | "non-finite"
  | "non-positive"
  | "invalid-quaternion";

type CodecReferenceCode =
  | "duplicate-camera-id"
  | "duplicate-image-id"
  | "duplicate-point-id"
  | "duplicate-image-name"
  | "missing-camera-reference";

type CodecError =
  | {
      readonly kind: "syntax";
      readonly code: CodecSyntaxCode;
      readonly location: CodecLocation;
      readonly message: string;
    }
  | {
      readonly kind: "numeric";
      readonly code: CodecNumericCode;
      readonly location: CodecLocation;
      readonly value: string;
      readonly message: string;
    }
  | {
      readonly kind: "reference";
      readonly code: CodecReferenceCode;
      readonly location: CodecLocation;
      readonly referencedId?: number;
      readonly message: string;
    };

type ColmapParseOutcome =
  | { readonly status: "parsed"; readonly model: ColmapModel }
  | { readonly status: "rejected"; readonly errors: readonly CodecError[] };

type ColmapSerializeOutcome =
  | {
      readonly status: "serialized";
      readonly output: CanonicalColmapText;
    }
  | { readonly status: "rejected"; readonly errors: readonly CodecError[] };
~~~

Implementations MAY collect multiple independent codec errors. Text-error ordering MUST be deterministic by file order, line, and field; model-validation errors MUST be deterministic by cameras, images, points3D, array index, and field. A rejected outcome contains no model or text output.

### Refiner and experiment failures

~~~ts
type RefinementError =
  | {
      readonly kind:
        | "invalid-input-model"
        | "invalid-input-assets"
        | "invalid-output-model";
      readonly message: string;
    }
  | {
      readonly kind: "cancelled" | "timed-out";
      readonly message: string;
    }
  | {
      readonly kind: "implementation-failed";
      readonly message: string;
    };

type ExperimentError =
  | {
      readonly kind: "invalid-specification";
      readonly message: string;
    }
  | {
      readonly kind: "external-run-failed";
      readonly message: string;
    }
  | {
      readonly kind: "timed-out";
      readonly phase:
        | "external-run"
        | "artifact-collection"
        | "metric-evaluation";
      readonly message: string;
    }
  | {
      readonly kind: "missing-artifact";
      readonly artifactKind: ArtifactReference["kind"];
      readonly message: string;
    }
  | {
      readonly kind: "metric-evaluation-failed";
      readonly metric: MetricName;
      readonly message: string;
    };
~~~

The refiner's updated, unchanged, insufficient-evidence, and failed union is closed. Metric and capability outcomes are likewise closed as supported, unavailable, or failed. Unavailable is a valid evidence state, not an exception and not a zero value.

## 15. Round-trip and archive-fidelity definitions

These properties are separate and MUST be tested separately:

| Property | Contract | What it does not prove |
|---|---|---|
| Archive copy-through fidelity | Same normalized file-entry name set; every untouched file entry has identical decompressed bytes. | Codec correctness, compressed ZIP identity, entry order, metadata, or pose convention. |
| Semantic codec round trip | parse(original) -> serialize -> parse yields a semantically equal complete model. | Original text bytes, comments, whitespace, numeric lexemes, or archive preservation. |
| Deterministic canonical output | The same valid typed model and codec version produce identical canonical text bytes on repeated serialization. | Equality to the original recorder text. |
| Byte-identical text | Every original text byte is reproduced. | Not required and not claimed. |

Three acceptance paths follow:

1. Copy-only no-op: open an archive and write with no replacements. Every file payload is untouched. This tests only the adapter.
2. Forced codec round trip: parse all three texts, serialize all three canonically, explicitly replace all three, reopen, and parse. The models must be semantically equal; every non-replaced archive entry must retain identical decompressed bytes.
3. Pose edit: apply a known valid pose delta to a synthetic or fixture-derived typed model, serialize, replace only sparse/0/images.txt, reopen, and parse. Only targeted qvec/tvec values may differ.

Reusing original sparse bytes on an operational no-op is permitted. It is an archive optimization, not evidence that the parser or serializer works.

## 16. Contract-level test strategy

These are test responsibilities and acceptance properties, not implementation tasks or an algorithm-quality requirement.

### Synthetic unit tests

- Identity world-to-camera pose.
- Known camera translation, checking tvec against camera center rather than treating it as position.
- Known nontrivial rotation with a hand-computed world-point result.
- A case that fails if world-to-camera and camera-to-world are mixed.
- q and -q semantic equivalence, plus preservation of supplied quaternion sign.
- Quaternion norm boundary, zero quaternion, NaN, positive/negative Infinity, malformed numbers, unsafe integers, invalid RGB, and negative dimensions.
- Duplicate camera/image/point IDs and image names; a missing image-to-camera reference; adapter rejection of a missing image-name-to-asset reference; and populated observation/track rejection without implying track-reference support.
- Exact record-arity and mandatory empty image-line validation.
- Repeated deterministic serialization of the same model.
- Negative-zero canonicalization without semantic change.
- Sparse and non-continuous valid IDs.
- Pose-only delta acceptance for targeted qvec/tvec and rejection of changes to IDs, order, names, references, observations, cameras, points, and untargeted poses.
- Gauge-alignment records and output-in-input-gauge validation on a known non-identity case.
- Refiner rejection when assets are missing, extra, duplicated, reordered, mismatched by ID/name/path, or inconsistent with their byte identities.
- Async refiner timeout maps to failed/timed-out with no model.

### Archive tests

- Reject absolute, drive, UNC, backslash, traversal, dot-segment, repeated-separator, control-character, overlong, duplicate, case-colliding, and limit-exceeding entries.
- Reject partial sparse models and binary/text coexistence.
- Preserve session.json, actions/, unknown future entries, and unknown entries under known directories.
- Preserve unreferenced images.
- Verify identical decompressed bytes for every untouched file entry.
- Verify the output normalized file-entry name set is unchanged.
- Verify only explicitly selected existing COLMAP text paths are replaced.
- Verify an empty replacement list produces a copy-only no-op.
- Verify mutation of one ImmutableBytes copy cannot affect its source, another copy, archive preservation, or artifact identity.
- Verify failed validation or writing returns no output artifact.

### Codec round-trip tests

- parse -> serialize -> parse semantic equivalence independently of archive copying.
- Empty image observations are valid and remain empty.
- Empty point tracks are valid and remain empty.
- An empty points3D data body is valid.
- Populated observations and tracks are rejected in iteration one.
- Sparse/non-continuous IDs remain unchanged.
- Parsed record order remains unchanged even when it differs from ID order.
- Header counts are ignored on parse and recomputed on serialize.
- LF and CRLF input produce the same typed model; canonical output is LF.
- Original text need not be byte-identical to canonical output.

### Task 1 fixture integration tests

For both first-capture.zip and second-capture.zip:

- open safely, parse successfully, and resolve every referenced image;
- preserve images/frame-000001.jpg despite its absence from images.txt;
- preserve actions/, session.json, all other images, and unknown entries;
- verify the expected 11/17 images and 820/1026 points without interpreting ZIP order;
- perform copy-only no-op and forced-codec round-trip output generation;
- verify archive fidelity and semantic model equality after reopening;
- generate a recorder-compatible output with only an explicitly supplied pose replacement when the pose-edit path is exercised;
- record that the output is structurally accepted by the existing consumer pipeline, using a manual smoke procedure if automation is unavailable;
- make no claim that fixture replay, a no-op output, or a synthetic pose edit improves pose or splat quality.

The structural smoke record is external acceptance evidence. It does not make LichtFeld a core test dependency and does not require automated orchestration.

### Experimental validation tests

Using contract fixtures or fake external results:

- exact-view rendering unverified -> capability unavailable and PSNR/SSIM unavailable;
- empty observations/tracks -> reprojection-error unavailable;
- missing required artifact -> typed error and not-comparable;
- failed external run -> failed status and not-comparable;
- timed-out external run, artifact collection, or metric evaluation -> typed timed-out failure and not-comparable;
- mismatched build, training configuration, split, visibility, repeat policy, environment, or metric policy -> not-comparable with the matching reason;
- unavailable metrics remain explicit and are never emitted as zero;
- an unavailable requested metric or required capability -> not-comparable, while a metric explicitly not requested does not invalidate an otherwise structural comparison;
- unavailable exact-view rendering invalidates requested PSNR/SSIM, while unavailable automation does not invalidate a manual experiment;
- every run metric is bound to its role/repeat/archive key, every view artifact is bound to its image ID/name, and each per-role mean uses exactly that role's completed repeat outcomes;
- spec, pose-pair, run, and model identities must agree; missing, duplicate, out-of-range, or extra role/repeat runs -> not-comparable;
- intended specs that match but actual run manifests that differ -> not-comparable;
- approximate manual screenshots are representable only as exploratory-visual artifacts and cannot transition PSNR/SSIM to supported;
- a complete matching pair with all required artifacts can transition to comparable without asserting that candidate metrics are better.

## 17. First minimum iteration

### Must be defined and implemented in iteration one

The minimum implementation boundary is:

- the safe Recorder ZIP adapter, including path validation, archive limits, exact sparse-file discovery, referenced-image resolution, and typed archive outcomes;
- the recorder-specific COLMAP text codec and typed model;
- fail-closed syntax, numeric, quaternion, ID, and reference validation;
- deterministic canonical serialization and semantic comparison;
- independent forced semantic round-trip tests;
- archive copy-through fidelity for all untouched file entries;
- preservation of unreferenced images, actions/, session.json, and unknown entries;
- copy-with-explicit-replacements output;
- copy-only no-op ZIP generation;
- the ability to emit a corrected ZIP when supplied a separately validated images.txt replacement, without generating that correction algorithmically;
- replay of both Task 1 fixtures and a recorded structural consumer-pipeline smoke check;
- no modification to recorder/exporter code and no production dependency on LichtFeld.

Iteration one is accepted when these properties hold. It does not require a refiner implementation, supported quality metric, or quality-improvement result.

## 18. Contracted but deferred capabilities

### Must be defined now but may be implemented later

The following are fully defined by this document but are outside the minimum implementation boundary:

- the async-capable pose-refinement port;
- pose-only allowed-delta validation across original and corrected models;
- changed-image and pose-magnitude reporting;
- input-world-frame and scale preservation, including optional recorded solver-gauge alignment;
- stale-point-cloud warnings;
- the external LichtFeld ExperimentSpec and ExperimentReport;
- supported, unavailable, and failed metric/capability states;
- fixed split and explicit held-out visibility representation;
- paired-run comparison-validity rules;
- a new canonical LichtFeld configuration and reproducibility record if external validation proceeds.

The assignment's sequencing remains: external measurement and research evidence must reach the owner-agreed minimum before implementation of a real refinement algorithm begins. This is a gate, not a runtime dependency.

Source-build/prebuilt comparison remains a separate assignment Goal 1 activity where feasible. Its artifacts may be referenced as external provenance, but this pose-effect contract does not pretend to define a build-parity comparison.

## 19. Completely deferred scope

### Completely deferred

- An actual pose-refinement algorithm or algorithm selection.
- Feature extraction, matching, bundle adjustment, loop closure, pose graphs, joint trainer pose optimization, or similar solver logic.
- Action-log parsing.
- GPS, depth, odometry, ICP, or future sensor integration.
- Binary COLMAP and text/binary coexistence.
- Multiple cameras, non-PINHOLE models, general external-COLMAP support, quoted/path-bearing image names, and populated observations or feature tracks.
- Reprojection-error calculation or creation of a correspondence set.
- Camera-intrinsic refinement.
- Occupancy-cloud regeneration or point refinement.
- Recorder/exporter changes.
- Generic plugin, provider, evidence-provider, trainer, or optimizer architecture.
- Automated LichtFeld build, training, rendering, or artifact orchestration.
- Automated exact-view rendering until a real capability is verified.
- Automated PSNR or SSIM until exact supplied-camera rendering and a complete pixel policy are verified.
- Statistical-significance machinery beyond recording repeats and reporting each result plus its mean.
- Georeferencing, orientation cosmetics, capture guidance, additional splat formats, and in-app splat viewing.

External manual LichtFeld validation and evidence recording are not completely deferred; they remain a separate assignment-level workstream governed by section 13.

## 20. Risks

| Risk | Consequence | Contract control |
|---|---|---|
| World-to-camera/camera-to-world mix or qvec order error | Numerically valid but mirrored, inverted, or displaced cameras | Normative convention, non-identity tests, explicit math-library mapping |
| Treating tvec as camera position | Wrong translations and pose magnitudes | Camera-center formula and known-translation tests |
| Reapplying recorder basis conversion | Double-flipped model | Persisted-world invariant and prohibition on implicit conversion |
| Archive reconstruction from model references | Loss of actions, session metadata, unknown entries, or frame-000001.jpg | One archive owner and copy-with-explicit-replacements |
| A no-op bypasses serialization | Broken codec remains undetected until the first pose edit | Separate forced codec round trip |
| Silent numeric repair | IDs, RGB, or poses change without a declared delta | Fail-closed integer/RGB/quaternion validation |
| Record reordering | Noisy output and broken image identity assumptions | Parsed-order preservation |
| Solver gauge drift | Correct relative poses written in the wrong world frame | Output-in-input-gauge rule and recorded alignment |
| Large local pose changes with fixed points | Stale occupancy seed may worsen training | Unchanged-points fact separated from stale-seed warning and external A/B validation |
| Unsupported metric substitution | Credible-looking but invalid quality claims | Closed unavailable states; no use of point ERROR or trainer final error |
| Held-out leakage | Metric measures transductive consistency rather than the stated claim | Explicit trainer/refiner/seed visibility and non-comparability across policies |
| LichtFeld version/configuration drift | Tool changes are attributed to pose changes | Exact build identity, effective settings, environment, and repeat policy |
| Same-scene fixture overfitting | Improvement fails on other subjects | No quality claim from current fixtures; eventual multi-scene evidence remains required |
| Arbitrary archive limits reject a valid larger capture | Safe input is refused | Concrete visible limits, typed error, and revision based on recorder evidence rather than silent relaxation |

## 21. Questions for Simon

These questions are intentionally unanswered in this candidate:

1. Is it acceptable that the reusable contribution produces a corrected recorder/COLMAP ZIP without requiring LichtFeld at runtime?
2. Can LichtFeld remain an external experimental validation workstream rather than a production dependency?
3. Is the first implementation allowed to prioritize safe ZIP preservation and a faithful COLMAP text round trip before a real refinement algorithm?
4. Is a recorder-specific fail-closed COLMAP text subset acceptable initially?
5. May reprojection error remain unavailable while fixtures contain no usable feature tracks?
6. What minimum LichtFeld validation evidence is required before refinement implementation begins?
7. Which held-out visibility policy should eventually be used?

## 22. Changes from archive/task2/filip-contract-audit.md

The original draft was an architecture audit. Version 2 is a normative candidate contract.

| Accepted review finding | Visible resolution |
|---|---|
| 1. Audit, not contract | Sections 7-14 provide TypeScript boundary types, immutable byte access, reproducible identities, signatures, failures, and closed outcomes. |
| 2. ZIP ownership repeated | Sections 6 and 8 give all archive behavior to one adapter and remove the snapshot/writer split. |
| 3. No-op can bypass writer | Sections 15-16 separate copy-only, forced codec, and pose-edit tests. |
| 4. File-level delta too weak | Section 11 permits only targeted qvec/tvec changes and lists every preserved field. |
| 5. Ordering/numeric policy absent | Sections 9-10 fix parsed order, finite numeric rules, round-trip-safe formatting, negative zero, tolerance, quaternion sign, and LF output. |
| 6. Grammar/failure incomplete | Sections 10 and 14 define exact arities, blank lines, IDs, references, empty tracks, typed locations, and no partial output. |
| 7. Archive safety/fidelity unclear | Section 8 defines safe paths, collisions, limits, decompressed-byte fidelity, and excluded ZIP metadata. |
| 8. Gauge does not ensure point validity | Sections 11-12 separate unchanged points, preserved gauge, alignment on every outcome, validated Sim(3) data, pose magnitude, and stale-seed warning. |
| 9. Coordinate rules incomplete | Section 12 fixes axes, column-vector convention, world-to-camera equation, qvec order, camera center, units, and no implicit conversion. |
| 10. Harness not a contract | Section 13 defines a versioned LichtFeld-specific spec, actual-run manifests, role/repeat-bound metrics, role aggregates, artifacts, pose-pair evidence, and comparability. |
| 11. Exact-view rendering unverified | Section 13 makes it an unavailable capability and blocks PSNR/SSIM support. |
| 12. Held-out visibility undefined | Section 13 defines two labelled protocols, eligible views, and seed visibility without selecting a policy. |
| 13. Pixel metrics undefined | Section 13 defines the required versioned pixel policy, binds view artifacts to image ID/name, and keeps metrics unavailable until policy and rendering are verified. |
| 14. Reproducible LichtFeld work missing | Sections 13 and 18 retain a separate external Goal 1 record without a core runtime dependency. |
| 15. Provider architecture premature | Sections 6 and 11 remove providers and keep one async port plus opaque versioned implementation configuration. |
| 16. Tests do not prove boundaries | Section 16 separates synthetic, archive, codec, fixture, timeout/failure, run-manifest, metric-attribution, and experimental-state responsibilities. |
| 17. Historical configuration missing | Sections 4, 13, and 18 distinguish incomplete Task 1 evidence from a future new canonical record. |
| 18. Fixture/result mapping recoverable | Section 4 records both recovered timestamp/error mappings. |
| 19. Sparse-write atomicity overstated | Section 4 states successful/known-precondition behavior and unverified intermediate-failure transactionality; sections 8 and 16 reject partial models. |

Complexity removed:

- nine speculative boundaries are reduced to four;
- archive snapshot and corrected writer ownership are collapsed into the adapter;
- the generic evidence/provider hierarchy is removed;
- algorithm-specific constraints, inliers, losses, checkpoints, and process details are absent;
- general COLMAP, sensor, trainer, and plugin abstractions are deferred;
- exact source-lexeme preservation and whole-ZIP identity are not required.

No strict held-out policy, algorithm, metric substitute, LichtFeld pose-optimization claim, or point-cloud-validity claim has been promoted from an unconfirmed proposal.

## Revision summary

### Accepted review findings applied

- All 19 accepted findings have explicit resolutions in section 22.
- The result is a concrete four-boundary contract with typed models, errors, outcomes, invariants, fidelity definitions, and test responsibilities.

### Complexity removed

- One ZIP owner replaces overlapping archive components.
- The model has no archive state.
- The refiner has no generic provider graph.
- LichtFeld experiment types are specific to the required paired validation rather than a general experiment framework.

### Experimental work separated

- The reusable flow ends at a corrected recorder-compatible ZIP.
- External LichtFeld training, rendering, metrics, artifacts, and comparison live in a separate contract.
- Unsupported capabilities and unavailable metrics remain explicit.

### Remaining owner decisions

- Acceptance of the reusable/external dependency split.
- Acceptance of ZIP/codec-first iteration sequencing.
- Acceptance of the narrow fail-closed recorder subset.
- Reprojection-error availability expectations.
- Minimum LichtFeld evidence before refinement.
- Held-out visibility policy.

### Evidence still needed

- Exact supplied-camera rendering capability or a repeatable exact manual procedure.
- A complete pixel-comparison policy before PSNR/SSIM.
- Valid feature tracks and a frozen residual policy before reprojection error.
- A newly recorded LichtFeld build, complete effective configuration, environment, repeat behavior, and artifacts.
- Recovery of the quoted-filename example, if it exists.
- Larger and more varied recorder archives to validate safety limits and subset coverage.
- More than one scene for the eventual assignment-level improvement proof.
