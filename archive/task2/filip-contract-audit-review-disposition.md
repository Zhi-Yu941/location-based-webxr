# Filip Contract Review — Finding Dispositions

> **Status: Historical.** Draft finding disposition used to prepare the broad v2 candidate. “Accepted” refers to the revision workflow, not to Product Owner approval; this is not `OWNER_DECISIONS.md`.

Status: Draft  
Reviewed artifact: `archive/task2/filip-contract-audit.md`  
Review: `archive/task2/filip-contract-audit-review.md`  
Next artifact: `archive/task2/filip-broad-contract-v2.md`

## Overall disposition

All findings from the hostile architecture review are accepted.

The original document successfully identified important architectural risks, but it was mainly an audit of a future contract rather than a concrete contract itself. The revised version will therefore replace broad architectural descriptions with a small set of explicit TypeScript contracts.

The revised contract will prioritize a self-contained tool that:

1. accepts a recorder ZIP;
2. parses the supported COLMAP text model into typed TypeScript data;
3. applies or accepts pose-only changes;
4. serializes the corrected model;
5. writes a corrected ZIP;
6. preserves all unrelated recorder ZIP contents.

The intended contribution should remain independent of LichtFeld and suitable for integration or contribution back to CSUtils.

LichtFeld will be treated as an external experimental validation tool, not as a required runtime dependency of the ZIP-refinement component.

## Scope decision

### Core contract scope

The revised contract will define four boundaries:

1. Recorder ZIP adapter
2. COLMAP text codec
3. Pose-refinement port
4. Experimental measurement interface

The first implementation priority will be:

- recorder ZIP adapter;
- COLMAP text codec;
- typed validation;
- semantic round-trip testing;
- archive-preservation testing;
- generation of a valid corrected ZIP.

### Experimental LichtFeld scope

The tool must not depend directly on LichtFeld to perform its main responsibility.

The expected core output is:

```text
recorder ZIP
→ corrected recorder-compatible COLMAP ZIP
```

## Finding dispositions
### Finding 1 — The file is an audit, not a contract

Disposition: Accepted

Reason:

The original draft identified architecture risks but did not provide the concrete TypeScript contracts required by the assignment.

Required change:

Add minimal TypeScript contracts for:

recorder ZIP adapter;
COLMAP model and codec;
pose-refinement request/result;
experimental measurement specification/report;
typed failures.

The contracts must define boundaries and invariants without implementing an algorithm.

### Finding 2 — ZIP ownership is assigned multiple times

Disposition: Accepted

Reason:

Archive preservation and mutation must have one clear owner.

Required change:

Create one recorder ZIP adapter responsible for:

safe archive-entry enumeration;
access to original payload bytes;
extraction of COLMAP text and referenced images;
preservation of all untouched entries;
creation of a corrected ZIP through explicit replacements.

The COLMAP codec will handle only text-to-model and model-to-text conversion.

The pose refiner will not know about ZIP internals.

### Finding 3 — The no-op test may avoid the serializer

Disposition: Accepted

Reason:

Copying the original text files unchanged would not prove that parsing and serialization work correctly.

Required change:

Separate tests into:

Archive copy-through test
Untouched file names and decompressed bytes remain identical.
Forced codec round-trip test
Parse → encode → parse produces a semantically equivalent model.
Pose-edit test
A known synthetic pose change modifies only the allowed pose fields after serialization and re-parsing.


### Finding 4 — “Only images.txt differs” is too weak

Disposition: Accepted

Reason:

images.txt contains more than poses. A file-level comparison does not prevent accidental changes to IDs, names, camera references or observation lines.

Required change:

Define a pose delta keyed by imageId.

Only these fields may change:

quaternion / qvec;
translation / tvec.

The following must remain unchanged:

image IDs;
image order;
image names;
camera references;
observations;
camera intrinsics;
points3D;
untargeted image poses.


### Finding 5 — Ordering and numeric policies are undefined

Disposition: Accepted

Reason:

Unspecified ordering and float formatting may produce nondeterministic or numerically altered output.

Required change:

The revised contract must define:

preservation of parsed record order;
locale-independent numeric serialization;
round-trip-safe precision;
handling of negative zero;
integer validation;
absolute and relative comparison tolerances;
sign-invariant quaternion comparison;
normalization/sign policy for newly generated quaternions.

Exact original lexemes may be reused for an archive-level no-op, but semantic codec correctness must still be tested separately.

### Finding 6 — Accepted text grammar and failure behavior are incomplete

Disposition: Accepted

Reason:

The first codec should explicitly support the verified recorder-specific subset instead of claiming broad COLMAP compatibility.

Required change:

Define an accepted-subset grammar for:

one text PINHOLE camera model;
camera parameter count;
image pose line structure;
mandatory second image-observation line;
empty observations;
point rows with empty tracks;
unique IDs and names;
valid camera references;
finite numeric values;
positive safe-integer identifiers and dimensions.

Iteration one will reject:

binary COLMAP models;
text/binary coexistence;
unsupported camera models;
populated observations or tracks unless later added explicitly;
partial sparse models;
malformed references.

Errors must use typed, location-aware results.

No output ZIP may be emitted after validation or write failure.

### Finding 7 — Archive safety and fidelity are unclear

Disposition: Accepted

Reason:

The initial contract should preserve meaningful archive content without promising exact ZIP-container replication.

Required change:

Archive fidelity will mean:

same normalized untouched file-entry names;
identical decompressed bytes for untouched entries.

The initial contract will not guarantee preservation of:

ZIP entry order;
compression algorithm;
timestamps;
ZIP comments;
directory records;
compressed binary representation.

The adapter must reject:

absolute paths;
.. traversal;
duplicate normalized paths;
case-colliding paths where unsafe;
unreasonable archive sizes or entry counts.
### Finding 8 — World-gauge preservation does not guarantee point-cloud validity

Disposition: Accepted

Reason:

Keeping cameras in the original coordinate frame does not prove that the unchanged occupancy cloud remains a good initialization after large local pose changes.

Required change:

The revised contract will separate these claims:

points3D remains unchanged.
Refined camera poses remain in the input world frame and scale.
The unchanged point cloud may become stale after substantial pose correction.

The refinement result should report:

pose-change magnitude;
whether external gauge alignment was used;
stale-point-cloud risk or warning.

The contract will not claim that world-gauge preservation proves physical camera/point consistency.

### Finding 9 — Coordinate conventions are not normative enough

Disposition: Accepted

Reason:

Quaternion order alone is insufficient to prevent coordinate mistakes.

Required change:

Add a normative coordinate-convention section defining:

COLMAP camera axes;
world-to-camera direction;
X_camera = R X_world + t;
quaternion order [qw, qx, qy, qz];
translation versus camera center;
C = -Rᵀt;
vector/matrix convention;
source units;
no implicit rescaling;
conversion to TypeScript/math-library quaternion formats;
quaternion validation and normalization policy.

Add synthetic tests for:

identity pose;
translated pose;
nontrivial rotation;
quaternion sign equivalence;
world-to-camera versus camera-to-world confusion.


### Finding 10 — The harness is not a concrete experiment contract

Disposition: Accepted

Reason:

A list of desired metrics is not enough to ensure reproducible baseline/candidate comparisons.

Required change:

Define small versioned types such as:

ExperimentSpec;
ExperimentReport;
closed run status;
metric availability result;
comparability result.

The specification should be capable of recording:

input archive/model identity;
train/evaluation split;
visibility policy;
external trainer identity;
effective configuration;
repeat policy;
artifact references;
metric policy;
provenance.

This remains an external or experimental contract and must not create a runtime dependency from the ZIP-refinement tool to LichtFeld.

### Finding 11 — Exact-view LichtFeld rendering is unverified

Disposition: Accepted — Experimental / needs evidence

Reason:

Current evidence proves training and interactive viewing, not automated rendering from an exact held-out camera.

Required change:

Do not require PSNR/SSIM from the initial ZIP-refinement implementation.

The experimental harness must support a typed result such as:

unsupported:
exact supplied-camera rendering is not verified

A later spike may investigate whether LichtFeld v0.4.2 provides:

a programmatic render operation;
a repeatable manual exact-view procedure;
no suitable mechanism.

Question for Simon:

Can exact-view rendering and quantitative LichtFeld metrics remain experimental, while the main contribution produces a corrected compatible ZIP?

### Finding 12 — Held-out and visibility policies are undefined

Disposition: Accepted — Experimental decision required

Reason:

Different visibility policies test different claims, and the current occupancy seed may already contain information from across the recording.

Required change:

Define eligible views as image records in images.txt whose names resolve to actual assets.

Unreferenced images must:

be preserved in the ZIP;
not automatically become evaluation views.

Potential protocols must be labelled separately:

Training-only holdout
Evaluation images are hidden from LichtFeld training but may be visible to refinement.
Strict RGB holdout
Evaluation image RGB is hidden from both refinement and training.

No policy is accepted yet.

This should be discussed with Simon before becoming a mandatory benchmark.

### Finding 13 — PSNR, SSIM and A/B comparison are undefined

Disposition: Accepted — Experimental / deferred until rendering is verified

Reason:

Quantitative comparison requires an exact and frozen pixel-processing policy.

Required change:

If exact-view rendering becomes available, define a versioned pixel policy covering:

orientation;
output resolution;
resize method;
color space;
numeric range;
masks/crops;
background handling;
invalid pixels;
SSIM implementation and constants;
per-view reporting;
aggregate calculation;
minimum coverage.

Until then, metrics must be reported as unsupported rather than guessed from screenshots.

Controlled manual A/B screenshots may be retained as exploratory evidence but not treated as quantitative proof.

### Finding 14 — Reproducible LichtFeld work is missing

Disposition: Accepted — Separate experimental Goal 1 activity

Reason:

The assignment requires reproducible LichtFeld investigation, but the reusable ZIP-refinement component should not depend on LichtFeld.

Required change:

Separate the work into:

Core component

Produces a valid corrected recorder/COLMAP ZIP without importing or invoking LichtFeld.

Experimental validation

Documents externally:

LichtFeld version/tag;
binary/build identity;
command or UI procedure;
effective settings;
environment;
baseline/candidate archive identities;
repeat observations;
source/prebuilt comparison where feasible.

This evidence can demonstrate the usefulness of the output ZIP, but it does not become part of the core production API.

Ask Simon whether this external-validation separation is acceptable for the eventual CSUtils contribution.

### Finding 15 — Generic evidence/provider architecture is premature

Disposition: Accepted

Reason:

No refinement algorithm has been selected, so algorithm-specific abstractions would prematurely constrain future options.

Required change:

Remove the generic evidence-provider hierarchy.

Define only a small async-capable refiner boundary containing:

typed input model;
image-asset access if required;
versioned algorithm configuration;
typed outcome;
changed image IDs;
pose delta;
provenance;
warnings/failure state.

Algorithm-specific concepts such as:

constraints;
inliers;
losses;
checkpoints;
external-process details;

will remain internal to the selected implementation.

### Finding 16 — Test strategy does not prove the contracts

Disposition: Accepted

Reason:

Task 1 fixtures do not contain ground-truth corrected poses, feature tracks or exact metric images.

Required change:

Use separate test categories:

Synthetic tests
known camera transforms;
quaternion conventions;
pose-only delta validation;
world-gauge alignment;
parser/serializer behavior;
known image pairs for metrics if metrics are later implemented.
Fake-adapter tests
external-process failure;
timeout;
unsupported rendering;
missing artifacts;
invalid comparison;
report-state transitions.
Task 1 integration fixtures
archive preservation;
model parsing;
unreferenced-image preservation;
empty-track handling;
semantic round trip;
generation of a corrected/no-op ZIP;
optional manual LichtFeld smoke test.

No test will require an unselected algorithm to improve quality.

### Finding 17 — Recorded configuration is missing

Disposition: Accepted

Reason:

The original Task 1 configuration cannot currently be treated as fully reproducible.

Required change:

If LichtFeld validation is performed, establish a new canonical experimental configuration.

The new record should clearly distinguish:

recovered Task 1 evidence;
unknown historical settings;
newly established reproducible settings.

This remains external experimental documentation.

### Finding 18 — Fixture/result mapping was recoverable

Disposition: Accepted

Reason:

The mapping between the two ZIPs and Task 1 results can be recovered from filenames and repository evidence.

Required change:

Record the mapping explicitly:

2026-07-09_15-46-36utc.zip → final error 0.0434;
2026-07-09_15-47-48utc.zip → final error 0.0282.

The following remain unknown unless recovered separately:

exact LichtFeld command;
complete settings;
build identity;
hardware/environment details;
seed availability.
Finding 19 — Sparse-file export atomicity was overstated

Disposition: Accepted

Reason:

The exporter writes the three files sequentially, and transactional rollback on I/O failure has not been verified.

Required change:

Replace the previous claim with:

On successful contribution, the exporter writes all three sparse text files. A known precondition failure writes none. Transactionality after an intermediate I/O failure is not established.

The new parser must treat partial sparse models as invalid input.
## Accepted minimum safe contract

The revised candidate contract will include:

### 1. Recorder ZIP adapter

Responsible for:

- safe input archive validation;
- archive-entry access;
- COLMAP text-file extraction;
- image asset resolution;
- opaque preservation of untouched entries;
- copy-with-explicit-replacements output;
- typed archive errors.

### 2. COLMAP text codec

Responsible for:

- recorder-specific text parsing;
- typed model creation;
- deterministic serialization;
- semantic equality;
- typed syntax/reference errors;
- forced codec round-trip tests.

### 3. Pose-refinement port

Defined now, not necessarily implemented now.

Responsible for:

- accepting a valid typed model;
- returning typed pose-only updates;
- preserving all invariants;
- reporting changed images and pose deltas;
- preserving world frame and scale;
- returning closed outcomes such as:
    - updated;
    - unchanged;
    - insufficient evidence;
    - failed.

No algorithm is selected in this contract.

### 4. Experimental measurement contract

Defined separately from the production ZIP-refinement tool.

Responsible for describing:

- an external baseline/candidate experiment;
- provenance and comparable configuration;
- artifact availability;
- supported or unsupported metrics;
- comparison validity.

LichtFeld-specific implementation is experimental and does not become a required dependency of the core tool. MIght only be mentioned as a experimental feature for the future.
