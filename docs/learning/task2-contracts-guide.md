# Task 2 contracts learning guide

**Verified fact — purpose:** This guide helps Filip and Mingna understand the proposed Task 2 contracts before comparing, accepting, or rejecting them.

**Proposed decision — process boundary:** This guide is teaching material, not the official plan, an architecture decision, an algorithm choice, or an entry in `OWNER_DECISIONS.md`.

**Assignment requirement — source caveat:** Assignment statements below are those quoted with page references in the independent Codex audit; the original 12-page assignment document is not present in this checkout, so this guide does not claim an additional independent reading of it.

**Verified fact — audience:** The explanations assume basic TypeScript knowledge and no prior knowledge of COLMAP, camera geometry, Gaussian splatting, archive-preserving pipelines, or evaluation harnesses.

## How to read the labels

| Label | Meaning in this guide |
|---|---|
| **Verified fact** | Directly supported by official documentation, inspected repository code/tests, the two fixture ZIPs, or the completed Task 1 review. |
| **Assignment requirement** | Reported as required by the assignment in the independent Codex audit, with its page reference where useful. |
| **Proposed decision** | A candidate contract, recommendation, risk control, or trade-off; it is not accepted yet. |
| **Unresolved question** | Evidence or owner confirmation is still missing. |
| **Deferred idea** | Explicitly outside the smallest first iteration. |

**Proposed decision — reading rule:** When a sentence contains a recommendation, option, or trade-off, treat it as unaccepted even if it sounds sensible.

## Evidence used

- **Verified fact:** Mingna's proposal is in [`Draft/mingna-contract.md`](../../Draft/mingna-contract.md).
- **Verified fact:** The independent Codex audit is in [`archive/task2/filip-contract-audit.md`](../../archive/task2/filip-contract-audit.md).
- **Verified fact:** Project boundaries and source precedence are in [`AGENTS.md`](../../AGENTS.md).
- **Verified fact:** The completed Task 1 review was read from the linked `task1-data` worktree at `docs/task1-review.md`, dated 11 July 2026.
- **Verified fact:** Recorder behavior was checked in [`colmap-conversions.ts`](../../GpsPlusSlamJs_RecorderApp/src/colmap/colmap-conversions.ts), [`colmap-serializers.ts`](../../GpsPlusSlamJs_RecorderApp/src/colmap/colmap-serializers.ts), [`colmap-zip-contributor.ts`](../../GpsPlusSlamJs_RecorderApp/src/colmap/colmap-zip-contributor.ts), and their tests.
- **Verified fact:** Concrete counts and rows were checked directly in [`first-capture.zip`](../../dev/task1-fixtures/first-capture.zip) and [`second-capture.zip`](../../dev/task1-fixtures/second-capture.zip).
- **Verified fact:** COLMAP format claims are checked against the [official COLMAP output-format documentation](https://colmap.github.io/format.html).
- **Verified fact:** LichtFeld claims are limited to its [official repository](https://github.com/MrNeRF/LichtFeld-Studio) and [official command-line wiki](https://github.com/MrNeRF/LichtFeld-Studio/wiki/Command-Line-Options).

## Charging-station evidence snapshot

| Evidence | First capture | Second capture | Label |
|---|---:|---:|---|
| JPEG entries | 12 | 18 | **Verified fact** |
| `images.txt` records | 11 | 17 | **Verified fact** |
| `points3D.txt` records | 820 | 1026 | **Verified fact** |
| `actions/*.json` entries | 108 | 133 | **Verified fact** |
| Shared camera | `1 PINHOLE 823 1920 ...` | same line | **Verified fact** |
| 2D observations and point tracks | empty | empty | **Verified fact** |
| Stored point `ERROR` | constant `1` | constant `1` | **Verified fact** |

**Verified fact:** Both fixture ZIPs also contain `session.json`; both contain `frame-000001.jpg`, although the first registered image record names `frame-000002.jpg`.

**Verified fact:** Task 1 obtained recognizable splats with visible ghosting, smearing, doubling, and floaters; its two reported LichtFeld v0.4.2 final-error values were `0.0282` and `0.0434`.

**Unresolved question:** Task 1 suspected pose or coordinate problems, but also named coverage, blur, lighting, reflections, vegetation, thin geometry, and frame density, so it did not isolate pose error as the cause.

---

## 1. The complete Task 2 pipeline

- **Verified fact — plain English:** The pipeline carries one captured dataset through reading, optional pose correction, writing, training, and controlled comparison.
- **Assignment requirement — project role:** The audit reports that tooling, reproducible training, measurement, and research must precede selection of a refinement method (assignment pp. 6–9).
- **Verified fact — charging-station example:** A fixture ZIP supplies JPEGs and a sparse COLMAP model; a baseline run already produced a recognizable but ghosted charging-station splat.
- **Proposed decision — failure mode:** If archive handling, pose math, refinement, and measurement are fused, a quality change cannot be traced to one cause and unrelated data can be lost.
- **Verified fact — evidence boundary:** LichtFeld can train from COLMAP datasets, but neither Task 1 nor inspected project evidence proves that LichtFeld v0.4.2 can optimize and export corrected camera poses.
- **Proposed decision — team choice:** The team must choose precise component boundaries, data passed between them, and failure reporting; this guide does not choose them.
- **Proposed decision — Mingna's draft:** Mingna divides the core into typed model, reader/writer, pure `IPoseRefiner`, and `IMeasurementHarness`.
- **Proposed decision — Codex audit challenge:** The audit says the proposal omits the archive adapter, image assets, explicit refinement evidence, effectful tool adapters, experiment configuration, provenance, and outcome diagnostics.
- **Proposed decision — simplest first iteration:** Learn and contract the full seam, while limiting implementation scope to archive-preserving COLMAP text load/save.
- **Unresolved question:** Which later refinement candidate can actually consume the available evidence and return corrected COLMAP extrinsics?

**Proposed decision — pipeline diagram:** The arrows describe responsibilities, not accepted class names.

```text
Recorder ZIP
   |
   v
Archive adapter ---- preserves opaque entries and JPEG payloads
   |
   v
COLMAP text codec --> typed cameras / images / points
   |                              |
   |                              v
   |                    future refinement boundary
   |                              |
   v                              v
Corrected archive writer <-- accepted pose changes
   |
   v
LichtFeld dataset materialization --> paired baseline/candidate runs
   |
   v
Metrics + visual artifacts + provenance
```

## 2. Recorder ZIP versus COLMAP model

- **Verified fact — plain English:** The ZIP is the complete shipping container; `ColmapModel` is only the structured interpretation of three model text files inside it.
- **Assignment requirement — project role:** The audit reports that the recorder ZIP is the sole initial external input/output contract and that recorder/exporter code must not be changed (assignment p. 7).
- **Verified fact — charging-station example:** The first ZIP has 124 entries: 108 actions, 12 JPEGs, `session.json`, and three sparse text files; `ColmapModel` represents only the last three.
- **Proposed decision — failure mode:** Treating the model as the whole dataset can drop photos, action logs, session metadata, and unknown future entries.
- **Verified fact — evidence boundary:** `parseModel({camerasTxt, imagesTxt, points3DTxt})` in Mingna's draft receives strings, not a ZIP or JPEG bytes.
- **Proposed decision — team choice:** The team must decide what archive object or manifest accompanies the parsed model.
- **Proposed decision — Mingna's draft:** It defines the text codec and typed model but no recorder-ZIP contract.
- **Proposed decision — Codex audit challenge:** The audit calls the typed model an insufficient external representation because downstream training also needs image assets and corrected output must retain the original archive.
- **Proposed decision — simplest first iteration:** Keep “archive” and “parsed model” as distinct concepts and make any conversion between them explicit.
- **Unresolved question:** What exact archive abstraction provides safe reads and replacements without forcing a chosen ZIP library into the domain model?

## 3. Why the whole ZIP must be preserved

- **Verified fact — plain English:** Pose refinement should behave like editing selected documents in a sealed folder, not rebuilding the folder from memory.
- **Assignment requirement — project role:** Focusing on `sparse/0/` and `images/` does not authorize deletion of the rest of the recorder ZIP.
- **Verified fact — charging-station example:** `frame-000001.jpg` is present but unreferenced, and the action logs could become evidence for a later GPS/IMU/depth approach.
- **Proposed decision — failure mode:** Rebuilding from referenced image names would lose the unreferenced JPEG and all recorder-specific entries; it could also destroy inputs needed by a later method.
- **Verified fact — evidence boundary:** The current exporter contributes three files under `sparse/` and leaves the rest of the ZIP to other contributors; it does not define Task 2 archive rewriting.
- **Proposed decision — team choice:** The team must define preservation at payload, metadata, entry-order, and whole-container levels.
- **Proposed decision — Mingna's draft:** No preservation rule is stated.
- **Proposed decision — Codex audit challenge:** Preserve every entry payload unless its exact path is deliberately replaced; do not infer that whole-ZIP byte identity is required.
- **Proposed decision — simplest first iteration:** Copy all original payloads unchanged and replace no sparse payload on a true no-op.
- **Unresolved question:** Must timestamps, compression method, comments, and ZIP entry order also be preserved, or only untouched payload bytes and paths?

> **Proposed decision — archive warning:** A corrected ZIP that trains successfully can still be contractually wrong if it silently discards recorder data.

## 4. `cameras.txt`, `images.txt`, and `points3D.txt`

- **Verified fact — plain English:** The three files describe how images are calibrated, where each image camera was, and the sparse 3D seed geometry.
- **Assignment requirement — project role:** The audit reports that these three text files plus `images/` are the clean Task 2 seam; text support is required and binary support is optional later (assignment pp. 7–8).
- **Verified fact — charging-station example:** Both fixtures have one camera line, 11 or 17 image pose records, and 820 or 1026 point rows.
- **Proposed decision — failure mode:** Misreading field order or image two-line structure can attach the wrong pose, camera, feature, or point.
- **Verified fact — evidence boundary:** Official COLMAP text format gives cameras one line each, images two lines each, and points one line each with variable-length tracks; current COLMAP can also include `rigs.txt` and `frames.txt`, while older models without them remain supported.
- **Proposed decision — team choice:** The accepted subset, validation strictness, comment retention, whitespace policy, and unsupported cases remain team choices.
- **Proposed decision — Mingna's draft:** It models the complete traditional fields in all three files.
- **Proposed decision — Codex audit challenge:** The broad types may imply general COLMAP compatibility even though only one `PINHOLE` camera and empty observations/tracks are verified here.
- **Proposed decision — simplest first iteration:** Parse and preserve the observed recorder text subset; reject unsupported populated structures rather than silently dropping them.
- **Unresolved question:** Should the first codec accept harmless variations produced by standard COLMAP, or only exact recorder-produced shapes?

## 5. `ColmapCamera`

- **Verified fact — plain English:** A `ColmapCamera` says how a camera turns a 3D camera-space ray into pixel coordinates; it does not say where a particular photograph was taken.
- **Assignment requirement — project role:** Camera intrinsics are to remain unchanged in the current boundary unless a reviewed plan decides otherwise.
- **Verified fact — charging-station example:** Camera `1` is `PINHOLE`, width `823`, height `1920`, with parameters approximately `[1254.388, 1254.170, 411.5, 960]` meaning `[fx, fy, cx, cy]` for that model.
- **Proposed decision — failure mode:** Treating every `params` array alike can swap focal lengths and principal point or accept the wrong number of parameters.
- **Verified fact — evidence boundary:** COLMAP defines model-specific parameter lists; the recorder currently serializes exactly one shared `PINHOLE` camera.
- **Proposed decision — team choice:** The team must decide whether `model: string` remains broad or is narrowed to the verified model, and how invalid parameter counts are reported.
- **Proposed decision — Mingna's draft:** It uses `model: string` and `params: number[]`, allowing many camera models in shape.
- **Proposed decision — Codex audit challenge:** The type is more general than verified support and may silently promise compatibility the codec cannot safely provide.
- **Proposed decision — simplest first iteration:** Support and validate the recorder's `PINHOLE` case while preserving intrinsics exactly in meaning.
- **Unresolved question:** Does the assignment or Simon expect interoperability with external COLMAP datasets during Task 2, or only recorder ZIPs?

## 6. `ColmapImage`

- **Verified fact — plain English:** A `ColmapImage` is one registered photograph: its identity, filename, camera reference, pose, and optional observed 2D features.
- **Assignment requirement — project role:** Image extrinsics are the proposed correction target; coordinate conversion and pose math must remain isolated and tested.
- **Verified fact — charging-station example:** First-capture image `1` names `frame-000002.jpg`, references camera `1`, and stores quaternion and translation values; its following 2D-observation line is empty.
- **Proposed decision — failure mode:** Confusing an image ID with filename order, losing the empty second line, or resolving the wrong JPEG produces incorrect training views.
- **Verified fact — evidence boundary:** In COLMAP, the first image line holds world-to-camera pose and metadata; the second holds `(X, Y, POINT3D_ID)` triples.
- **Proposed decision — team choice:** The team must define filename validation, duplicate-name behavior, immutability expectations, and representation of the absent observations.
- **Proposed decision — Mingna's draft:** It represents pose as nested quaternion/translation objects and always includes `points2D` as an array.
- **Proposed decision — Codex audit challenge:** The model has only an image name, not the image asset or archive reference that visual refinement and LichtFeld require.
- **Proposed decision — simplest first iteration:** Keep image identity, name, camera reference, and explicitly named world-to-camera pose; represent the verified empty observation state without inventing features.
- **Unresolved question:** Should a missing named JPEG be a parse error, an archive-validation error, or both?

## 7. `ColmapPoint3D`

- **Verified fact — plain English:** A `ColmapPoint3D` is a sparse world-space point with color and, in normal SfM output, evidence linking it to the image features that saw it.
- **Assignment requirement — project role:** The current boundary says to keep the occupancy-derived points unchanged unless a reviewed plan later decides otherwise.
- **Verified fact — charging-station example:** First-capture point `1` is at approximately `(0.470, -0.895, 2.399)`, has RGB `(98, 101, 101)`, stored error `1`, and no track.
- **Proposed decision — failure mode:** Calling the placeholder `1` a measured reprojection error or fabricating tracks would create false geometric evidence.
- **Verified fact — evidence boundary:** Official COLMAP tracks contain pairs `(IMAGE_ID, POINT2D_IDX)`, where the index points into an image's zero-based 2D observation list.
- **Proposed decision — team choice:** The team must decide whether populated tracks are accepted now, rejected explicitly, or deferred while preserving raw text.
- **Proposed decision — Mingna's draft:** It models XYZ, RGB, error, and a full track array.
- **Proposed decision — Codex audit challenge:** The broad structure is semantically correct for COLMAP, but the fixtures do not provide the evidence needed to validate track handling or use `error` as a metric.
- **Proposed decision — simplest first iteration:** Preserve point values and the empty-track state; never reinterpret constant error `1` as measured quality.
- **Unresolved question:** If future standard COLMAP models contain real tracks, will the same codec expand to them or will a separate compatibility mode be needed?

## 8. IDs, references, and `Map`s

- **Verified fact — plain English:** IDs are labels, not array positions; a `Map` lets code find the entity with a given label directly.
- **Assignment requirement — project role:** Typed structures must retain references faithfully enough for unchanged load/save and later pose updates.
- **Verified fact — charging-station example:** Image `1` references camera ID `1`; this relationship must survive even if serialization order changes.
- **Proposed decision — failure mode:** Using `array[id]` assumes IDs are dense and zero-based, so gaps or large IDs can return the wrong entity or waste memory.
- **Verified fact — evidence boundary:** COLMAP states that names ending in `_id` are unordered and non-contiguous, while `_idx` values are ordered, contiguous, and zero-based.
- **Proposed decision — team choice:** The team must decide whether the map key duplicates the ID inside each value, and which one is authoritative if they disagree.
- **Proposed decision — Mingna's draft:** It uses three `Map<number, ...>` collections and repeats each ID inside its entity.
- **Proposed decision — Codex audit challenge:** Maps are sound, but contract validation must forbid duplicate IDs and key/value mismatches; `Map` iteration order must not accidentally define serialization order.
- **Proposed decision — simplest first iteration:** Use ID-keyed lookup with explicit referential-integrity validation and a separate deterministic write order.
- **Unresolved question:** Should parsing preserve source order separately for no-op fidelity, or is a canonical ID order sufficient?

## 9. Camera intrinsics versus extrinsics

- **Verified fact — plain English:** Intrinsics describe the camera's internal projection; extrinsics describe one photograph's position and orientation relative to the world.
- **Assignment requirement — project role:** The recommended Task 2 direction is to refine image extrinsics while leaving intrinsics unchanged; the audit labels that recommendation, not an accepted universal rule.
- **Verified fact — charging-station example:** All registered photos share camera `1` and its `[fx, fy, cx, cy]`, while each image has different quaternion and translation values.
- **Proposed decision — failure mode:** Changing intrinsics while claiming pose-only refinement makes the comparison ambiguous; changing extrinsics without preserving their convention can misalign all images.
- **Verified fact — evidence boundary:** COLMAP stores intrinsics in `cameras.txt` and image extrinsics in the first lines of `images.txt`.
- **Proposed decision — team choice:** The allowed delta must say whether dimensions, camera model, intrinsics, image membership, names, or only pose values may change.
- **Proposed decision — Mingna's draft:** The return type is a whole `ColmapModel`, so it does not encode which fields are allowed to differ.
- **Proposed decision — Codex audit challenge:** A whole-model return needs explicit invariants or a delta/result type, otherwise accidental changes are indistinguishable from intended refinement.
- **Proposed decision — simplest first iteration:** Treat camera data as read-only and make only image pose fields eligible in the future contract.
- **Unresolved question:** Should the type system enforce the allowed delta, or should validation compare input and output models?

## 10. World-to-camera pose convention

- **Verified fact — plain English:** COLMAP's stored pose answers: “Given a point in the reconstruction's world, where is that point in this camera's coordinate system?”
- **Assignment requirement — project role:** The audit reports the required persisted convention as `X_camera = R X_world + t`, with camera center `C = -R^T t` (assignment pp. 7, 10).
- **Verified fact — charging-station example:** For first image `1`, the world origin maps to the stored translation `(1.3863, 1.1485, 0.7874)` because `R·0 + t = t`; that translation is not automatically the camera's world position.
- **Proposed decision — failure mode:** Treating `t` as camera position, applying the inverse transform, or repeating the WebXR conversion yields plausible numbers but wrong camera placement.
- **Verified fact — evidence boundary:** Official COLMAP documentation defines the image pose as world-to-camera; the recorder already converts WebXR camera-to-world data before writing `images.txt`.
- **Proposed decision — team choice:** The team must decide naming, helper functions, tolerances, and how camera-center or camera-to-world views are exposed.
- **Proposed decision — Mingna's draft:** It names fields `quaternion` and `translation` but does not encode transform direction in the type or property names.
- **Proposed decision — Codex audit challenge:** Use explicit world-to-camera naming and non-identity tests to guard against double conversion and `tvec`/camera-center confusion.
- **Proposed decision — simplest first iteration:** Parse and serialize persisted poses without changing convention; centralize any derived conversion in one tested boundary.
- **Unresolved question:** Which fixture/exporter revision should be the canonical orientation baseline if historical outputs differ visually?

> **Verified fact — coordinate warning:** Task 2 receives already converted COLMAP poses. Applying `webxrToColmapPose` again would be a second, incorrect conversion.

> **Verified fact — coordinate warning:** `tvec` is not the camera center except in special rotations and sign arrangements. Use `C = -R^T t` when the world-space camera center is needed.

## 11. Quaternion order `[qw, qx, qy, qz]`

- **Verified fact — plain English:** A quaternion stores rotation in four numbers; COLMAP writes the scalar `w` first.
- **Assignment requirement — project role:** The audit reports `[qw, qx, qy, qz]` as the assignment's required stored order.
- **Verified fact — charging-station example:** First image `1` begins its pose with approximately `[0.89446, 0.19181, -0.38848, -0.11063]` in `w,x,y,z` order.
- **Proposed decision — failure mode:** Reading this as the common library order `[x,y,z,w]` produces a different rotation, often without an obvious parsing error.
- **Verified fact — evidence boundary:** COLMAP uses Hamilton quaternions, and the recorder explicitly converts its library's `[x,y,z,w]` representation to `[w,x,y,z]` for storage.
- **Proposed decision — team choice:** The team must define normalization tolerance and whether equivalent `q` and `-q` rotations compare equal.
- **Proposed decision — Mingna's draft:** Named fields `qw`, `qx`, `qy`, `qz` make order clearer than a raw tuple.
- **Proposed decision — Codex audit challenge:** Byte comparison is too strict for orientation semantics because `q` and `-q` encode the same rotation.
- **Proposed decision — simplest first iteration:** Preserve the parsed sign on a no-op, validate near-unit length, and use sign-invariant comparison when checking rotation equivalence.
- **Unresolved question:** May a serializer normalize slightly non-unit input, or must normalization be rejected because it changes the text and possibly hides bad evidence?

> **Verified fact — coordinate warning:** Never pass a `[qw,qx,qy,qz]` tuple directly to an API that expects `[x,y,z,w]`.

## 12. Parsing text into TypeScript structures

- **Verified fact — plain English:** Parsing turns positional strings into named values and validates that the strings describe a coherent model.
- **Assignment requirement — project role:** The audit reports that Task 2 must parse text into typed structures and support a faithful unchanged load/save cycle (assignment pp. 7–8).
- **Verified fact — charging-station example:** The camera row becomes camera ID `1`, model `PINHOLE`, dimensions, and four parameters; the first image pose line becomes one `ColmapImage`, followed by an empty observations array.
- **Proposed decision — failure mode:** A permissive parser can accept non-finite values, duplicate IDs, missing second image lines, broken references, or unsupported camera parameter counts and later serialize corruption.
- **Verified fact — evidence boundary:** The current recorder only serializes; no inspected production file implements the proposed Task 2 parser.
- **Proposed decision — team choice:** The team must choose accepted syntax, diagnostics, recovery policy, comment handling, and whether source lexemes/order are retained.
- **Proposed decision — Mingna's draft:** `parseModel` is pure over three strings and returns `ColmapModel`, which supports isolated unit tests.
- **Proposed decision — Codex audit challenge:** A plain return type lacks an explicit unsupported/error contract and can imply acceptance of general COLMAP files.
- **Proposed decision — simplest first iteration:** Parse the verified text subset, fail closed with useful diagnostics, and never silently discard fields.
- **Unresolved question:** Should parser errors be exceptions, typed results, or diagnostics collected alongside a rejected model?

**Proposed decision — small illustrative type, not production code:**

```ts
type ParseOutcome<T> =
  | { status: "accepted"; value: T }
  | { status: "rejected"; reasons: string[] };
```

## 13. Semantic equivalence versus byte-identical output

- **Verified fact — plain English:** Two files can mean the same model while differing in spaces, comments, line endings, number spelling, or quaternion sign.
- **Assignment requirement — project role:** The audit reports ambiguous wording between semantic fidelity and “byte-faithful enough”; the acceptance level is not fully defined.
- **Verified fact — charging-station example:** `1`, `1.0`, and `1e0` parse to the same number, but their UTF-8 bytes differ; `q` and `-q` can describe the same image orientation.
- **Proposed decision — failure mode:** Requiring only byte identity misses pose-convention bugs, while requiring only semantics can destroy comments, unknown text, or stable no-op payloads.
- **Verified fact — evidence boundary:** Mingna's phrase “byte-faithful results across all floating-point values and structures” mixes byte fidelity with parsed-value fidelity; parsed structures do not retain byte spelling automatically.
- **Proposed decision — team choice:** The team must define separate guarantees for archive payloads, model values, pose equivalence, and whole-ZIP bytes.
- **Proposed decision — Mingna's draft:** It intends a strong unchanged round trip but does not separate these levels.
- **Proposed decision — Codex audit challenge:** Require semantic model equality, sign-invariant pose equality, untouched payload identity, and no whole-container byte-identity promise.
- **Proposed decision — simplest first iteration:** Preserve original sparse payloads on a true no-op; for changed output, require deterministic valid text whose parsed meaning matches the intended model.
- **Unresolved question:** Must comments and whitespace in a deliberately changed sparse file be retained, or may that file be canonically rewritten?

| Comparison level | Example | Candidate use | Label |
|---|---|---|---|
| Whole ZIP bytes | Same compressed bytes | Usually too strict because metadata/compression can vary | **Proposed decision** |
| Entry payload bytes | Same bytes for `session.json` | Strong preservation check for untouched entries | **Proposed decision** |
| Parsed values | Same IDs and numbers | Core semantic round trip | **Proposed decision** |
| Pose meaning | `q` equals `-q` as orientation | Geometry-aware check | **Verified fact** |

## 14. Deterministic serialization order

- **Verified fact — plain English:** Deterministic serialization means the same model always produces the same ordered text under the same serializer version.
- **Assignment requirement — project role:** Reproducible tooling and regression testing require stable outputs; exact ordering policy is not stated as an assignment fact in the inspected evidence.
- **Verified fact — charging-station example:** A model with image IDs `7`, `1`, and `4` can be written as `1,4,7` even though a `Map` may have been filled as `7,1,4`.
- **Proposed decision — failure mode:** Depending on insertion order makes diffs and hashes vary with parser or algorithm traversal order, hiding meaningful pose changes in noisy output.
- **Verified fact — evidence boundary:** COLMAP IDs are unordered; therefore numeric sorting is a serializer policy, not a COLMAP semantic requirement.
- **Proposed decision — team choice:** The team must select canonical sorting keys and decide whether original order is separately retained for no-op payload preservation.
- **Proposed decision — Mingna's draft:** It uses `Map`s but specifies no write order.
- **Proposed decision — Codex audit challenge:** `Map` lookup is sound, but iteration order must not silently become the format contract.
- **Proposed decision — simplest first iteration:** Preserve original bytes on no-op; when generating changed files, sort cameras, images, and points by numeric ID and document the rule.
- **Unresolved question:** Should observations and tracks retain source order or use a canonical pair ordering when populated-track support arrives?

## 15. Round-trip testing

- **Verified fact — plain English:** A round-trip test loads a dataset, saves it, loads it again, and checks the promised fidelity levels.
- **Assignment requirement — project role:** The audit reports required pure-logic tests and end-to-end replay of real Task 1 ZIPs without re-recording (assignment pp. 4, 7–9).
- **Verified fact — charging-station example:** Both fixture ZIPs exercise real portrait intrinsics, non-identity poses, an unreferenced JPEG, empty observations/tracks, and hundreds of points.
- **Proposed decision — failure mode:** Testing only an identity quaternion or a tiny invented file can miss quaternion order, translation direction, sparse IDs, image-name, and archive-loss bugs.
- **Verified fact — evidence boundary:** Existing recorder tests pin serialization shape and coordinate conversion, but they do not test the proposed parser or archive-preserving writer.
- **Proposed decision — team choice:** The team must define equivalence functions, negative cases, tolerances, and which payload hashes are acceptance evidence.
- **Proposed decision — Mingna's draft:** It names parse–serialize–parse as the success criterion but does not include ZIP replay or failure cases.
- **Proposed decision — Codex audit challenge:** Test archive preservation, semantic equality, sign-invariant orientation, references by filename, unsupported inputs, and a real no-op LichtFeld smoke run.
- **Proposed decision — simplest first iteration:** Run semantic and preservation checks on both fixtures plus focused non-identity pose tests and explicit invalid-input tests.
- **Unresolved question:** What exact tolerance is acceptable for numeric comparison, and when should original lexical spelling be required instead?

## 16. The pure pose-refinement transform

- **Verified fact — plain English:** A pure transform calculates output from explicit input without reading hidden files, launching tools, mutating the input, or depending on unrecorded state.
- **Assignment requirement — project role:** The audit reports a requirement for an independently testable, stable COLMAP-in/COLMAP-out refinement boundary, with external tools replaceable in tests (assignment p. 9).
- **Verified fact — charging-station example:** Given the first capture's model and explicit evidence, the same pure pose core would return the same proposed image poses and diagnostics.
- **Proposed decision — failure mode:** Calling an external executable or discovering JPEGs from hidden paths inside a supposedly pure method makes replay tests dishonest and failures hard to classify.
- **Verified fact — evidence boundary:** Purity is possible for pose math; filesystem access, process execution, LichtFeld training, or external COLMAP runs are effectful.
- **Proposed decision — team choice:** The team must decide which boundary is pure and which replaceable adapter owns effects.
- **Proposed decision — Mingna's draft:** `IPoseRefiner.refine(inputModel, extraSignals?)` is presented as the pure core engine returning a `ColmapModel` synchronously.
- **Proposed decision — Codex audit challenge:** Requiring every future candidate to fit a pure synchronous top-level method is premature; only the mathematical core can honestly guarantee purity across all candidates.
- **Proposed decision — simplest first iteration:** Record an algorithm-neutral refinement port and keep pure pose operations separate, without selecting or implementing an algorithm.
- **Unresolved question:** Which candidate approaches can expose a pure core, and which necessarily require an asynchronous external adapter?

## 17. What the refiner may and may not change

- **Verified fact — plain English:** A pose-only refiner is allowed to propose changes to image extrinsics, not to silently rewrite unrelated dataset content.
- **Assignment requirement — project role:** Current boundaries keep `points3D` and intrinsics unchanged unless a reviewed plan decides otherwise.
- **Verified fact — charging-station example:** A candidate might change the quaternion and translation of images `2`, `5`, and `9`, while camera `1`, image names, point rows, JPEGs, actions, and session data remain identical.
- **Proposed decision — failure mode:** An unconstrained whole-model return can accidentally renumber images, alter calibration, drop points, or change filenames while still type-checking.
- **Verified fact — evidence boundary:** No inspected evidence proves that changing only poses will improve this dataset; the allowed delta is a contract boundary, not a performance fact.
- **Proposed decision — team choice:** The team must define immutable fields, allowed pose changes, validation tolerances, and explicit no-op/failure outcomes.
- **Proposed decision — Mingna's draft:** It returns a full `ColmapModel` and states no field-level invariants or outcome diagnostics.
- **Proposed decision — Codex audit challenge:** Require validated update, validated no-op/insufficient evidence, or failure, plus changed image IDs, convergence/evidence summaries, warnings, and provenance.
- **Proposed decision — simplest first iteration:** Specify “image world-to-camera extrinsics only” as a candidate constraint and validate all other model fields as unchanged; do not yet claim it is universally correct.
- **Unresolved question:** Should a refinement result contain a complete model, a pose delta, or both for validation and archive writing?

## 18. Why fixed `points3D` requires preservation of the world gauge

- **Verified fact — plain English:** A reconstruction has freedom to choose its origin and orientation—and sometimes scale—without changing relative camera geometry; that choice is its gauge.
- **Assignment requirement — project role:** Keeping points fixed is only coherent when refined cameras are expressed in the same world frame and scale as the input points.
- **Verified fact — charging-station example:** If an optimizer shifts every camera one metre east but the 820 charging-station points stay where they were, cameras and points no longer describe the same scene, even if camera-to-camera spacing is unchanged.
- **Proposed decision — failure mode:** Relative-pose checks can pass while the fixed seed cloud projects into the wrong pixels, worsening initialization and training.
- **Verified fact — evidence boundary:** Global rigid or similarity gauge freedom is a camera-geometry property; whether a selected algorithm changes gauge is algorithm-specific and not yet known.
- **Proposed decision — team choice:** The team must decide what input landmarks or alignment method define the preserved frame and how alignment is diagnosed.
- **Proposed decision — Mingna's draft:** It neither states a world-gauge invariant nor explains alignment of returned poses to unchanged points.
- **Proposed decision — Codex audit challenge:** Require refined poses to remain in the exact input world frame and scale, or align an optimizer's result back before writing.
- **Proposed decision — simplest first iteration:** State the input-world-frame invariant now and test it with non-identity data; defer any particular alignment algorithm.
- **Unresolved question:** What evidence is sufficient to detect and correct rotation, translation, and possible scale drift for the eventually selected method?

> **Verified fact — coordinate warning:** “Points are unchanged” does not mean “cameras remain registered to points.” The world gauge must also remain unchanged or be aligned back.

## 19. Why `extraSignals?: any` is not a strong contract

- **Verified fact — plain English:** `any` says callers may pass anything and the refiner may assume anything, so TypeScript cannot explain or validate the evidence.
- **Assignment requirement — project role:** The refinement boundary must be independently testable; hidden or untyped dependencies weaken that boundary.
- **Verified fact — charging-station example:** Visual refinement might need the 12 JPEGs; a future sensor method might need selected action records with timestamps and coordinate conventions; those are different evidence shapes.
- **Proposed decision — failure mode:** A refiner can cast the same value differently, silently require filesystem paths, mix units, or consume held-out RGB without the harness knowing.
- **Verified fact — evidence boundary:** The current `ColmapModel` contains filenames but not JPEG bytes or action-log schemas.
- **Proposed decision — team choice:** The team must define explicit evidence types only after research identifies what a candidate actually needs.
- **Proposed decision — Mingna's draft:** The optional `any` is intended to leave room for future GPS and IMU action-log data.
- **Proposed decision — Codex audit challenge:** Replace `any` with explicit, typed evidence or constraints supplied by separate providers; do not hide asset discovery in the refiner.
- **Proposed decision — simplest first iteration:** Omit untyped signals from the accepted first-iteration contract and record a typed extension point as unresolved.
- **Unresolved question:** Which evidence types—images, feature matches, loop closures, depth, GPS, IMU, or others—will survive the research gate?

**Proposed decision — small illustrative contrast, not production code:**

```ts
// Weak: neither caller nor reviewer knows what is required.
refine(model: ColmapModel, extraSignals?: any): ColmapModel;

// Stronger idea: name evidence only after its schema is known.
refine(model: ColmapModel, evidence: RefinementEvidence): RefinementResult;
```

## 20. The ZIP/archive adapter contract

- **Verified fact — plain English:** The archive adapter opens the recorder ZIP safely, exposes required entries, retains everything else, and applies only deliberate replacements.
- **Assignment requirement — project role:** The recorder ZIP is the external contract, while the reader/writer, refinement transform, and measurement harness should remain independent.
- **Verified fact — charging-station example:** The adapter must find exact paths under `sparse/0/`, resolve image names under `images/`, and carry 108 action entries plus `session.json` through a first-capture no-op.
- **Proposed decision — failure mode:** Path normalization bugs, duplicate entries, unsafe paths, partial sparse models, or rebuilding from typed entities can corrupt or lose the capture.
- **Verified fact — evidence boundary:** The inspected recorder contributor writes all three sparse files or none; it can legitimately write an empty `points3D.txt`.
- **Proposed decision — team choice:** The team must define duplicate-path handling, path safety, archive limits, missing/partial sparse behavior, and preservation metadata.
- **Proposed decision — Mingna's draft:** No archive adapter contract is included.
- **Proposed decision — Codex audit challenge:** Make original archive state an explicit corrected-writer input and copy every entry unless its exact path is approved for replacement.
- **Proposed decision — simplest first iteration:** Validate exact required paths, accept an empty point file, reject missing/partial sparse models, and preserve every untouched payload byte.
- **Unresolved question:** Which ZIP metadata beyond path and payload is part of acceptance, and how will duplicate entry names be handled?

## 21. What LichtFeld needs in addition to `ColmapModel`

- **Verified fact — plain English:** Training needs actual image pixels and run settings, not only camera and point numbers in memory.
- **Assignment requirement — project role:** The measurement flow must run baseline and refined datasets reproducibly and produce numerical and visual evidence.
- **Verified fact — charging-station example:** `ColmapModel` says image `1` is `frame-000002.jpg`; LichtFeld also needs that JPEG in a dataset location, an output path, and chosen training/evaluation settings.
- **Proposed decision — failure mode:** Passing only the model can lead a harness to discover arbitrary files or defaults, causing baseline and candidate runs to differ for reasons unrelated to poses.
- **Verified fact — evidence boundary:** LichtFeld's current official interface accepts a data path and exposes options including images folder, test interval, resize, iterations, strategy, evaluation, and saved evaluation images; this is not proof that every option existed in the Task 1 v0.4.2 build.
- **Proposed decision — team choice:** The team must decide exactly how a recorder ZIP is materialized into a LichtFeld dataset and which tool/version/settings are supported.
- **Proposed decision — Mingna's draft:** `evaluate(model, heldOutImageIds)` omits image assets, materialization, executable/tool identity, output paths, and configuration.
- **Proposed decision — Codex audit challenge:** Add a dataset view or experiment specification that explicitly carries asset mappings and complete run controls.
- **Proposed decision — simplest first iteration:** Document these missing needs without building the full automation; record one reproducible no-op smoke procedure when evidence is available.
- **Unresolved question:** What exact LichtFeld v0.4.2 command, settings, seed behavior, and environment produced the two Task 1 results?

## 22. The measurement harness

- **Verified fact — plain English:** The harness is the referee that runs equivalent baseline and candidate experiments, collects outputs, and reports what can and cannot be concluded.
- **Assignment requirement — project role:** The audit reports a required fixed split, frozen settings, held-out PSNR/SSIM, geometric measurement when available, and controlled visual A/B artifacts (assignment pp. 8, 11).
- **Verified fact — charging-station example:** It should compare the original charging-station poses with candidate poses while using the same JPEGs, training settings, evaluation views, renderer settings, and metric code.
- **Proposed decision — failure mode:** A model-only interface permits changed splits, default settings, preprocessing, versions, or hardware conditions to masquerade as pose improvement.
- **Verified fact — evidence boundary:** The reported Task 1 “final error” is not established as PSNR, SSIM, reprojection error, or perceptual quality.
- **Proposed decision — team choice:** The team must define experiment identity, retries, timeouts, environment capture, per-view aggregation, artifacts, and metric availability.
- **Proposed decision — Mingna's draft:** It returns `psnr`, `ssim`, `meanReprojectionError`, and A/B links from a model and held-out image IDs.
- **Proposed decision — Codex audit challenge:** The interface is too small; use an immutable experiment specification and provenance-rich report, and allow metrics to be unavailable with reasons.
- **Proposed decision — simplest first iteration:** Contract the report shape and provenance requirements, while deferring full LichtFeld orchestration until the baseline procedure is reproducible.
- **Unresolved question:** What run-to-run variation is expected, and how many repeats are required before claiming improvement?

## 23. Frozen configuration and provenance

- **Verified fact — plain English:** Frozen configuration means declared settings cannot drift between baseline and candidate; provenance records exactly what produced each result.
- **Assignment requirement — project role:** Reproducible training and fair baseline/candidate comparison require fixed settings and recorded evidence.
- **Verified fact — charging-station example:** A useful report would identify the fixture hash, model hashes, image split, LichtFeld v0.4.2 build, full settings, seed/repeat policy, hardware, metric implementation, and output artifacts.
- **Proposed decision — failure mode:** Changing resolution, iterations, strategy, image set, random seed, or software version can change PSNR/SSIM independently of pose refinement.
- **Verified fact — evidence boundary:** Task 1 records the LichtFeld version and two scalar errors but not the complete command, settings, seed, hardware/environment, or unambiguous fixture-to-result mapping.
- **Proposed decision — team choice:** The exact manifest fields, identity/hash rules, allowed environmental differences, and repeat policy remain to be chosen.
- **Proposed decision — Mingna's draft:** No experiment configuration or provenance appears in the input or output.
- **Proposed decision — Codex audit challenge:** Make the experiment specification immutable and include all declared inputs and tool/environment identities in the report.
- **Proposed decision — simplest first iteration:** Establish a new canonical baseline if historical settings cannot be recovered; record it completely rather than inferring missing history.
- **Unresolved question:** Can LichtFeld runs be deterministic enough for a single pair, or must acceptance use repeated runs and statistical summaries?

## 24. Held-out images and the visibility policy

- **Verified fact — plain English:** Held-out images are evaluation views not used to train the splat; the visibility policy also states whether refinement may inspect them.
- **Assignment requirement — project role:** The audit reports that quality should be evaluated on held-out images with a fixed split.
- **Verified fact — charging-station example:** If `frame-000010.jpg` is held out from training but its pixels are used to refine camera poses, its score tests a different claim than if its pixels were unseen by both stages.
- **Proposed decision — failure mode:** Using evaluation RGB during refinement and then calling the result unseen-view generalization is data leakage and can overstate improvement.
- **Verified fact — evidence boundary:** LichtFeld exposes a `--test-every` option, but that alone does not define what a separate refiner was allowed to see.
- **Proposed decision — team choice:** The team must choose strict, transductive, or multiple labeled protocols and decide how tiny captures retain enough training coverage.
- **Proposed decision — Mingna's draft:** It accepts `heldOutImageIds` but does not state whether those images are hidden from refinement or only from training.
- **Proposed decision — Codex audit challenge:** Create the split before refinement and record permitted visibility; prefer a strict primary protocol and label transductive results separately if used.
- **Proposed decision — simplest first iteration:** Define visibility semantics in the contract now, while postponing the exact split until coverage and sample-size evidence are reviewed.
- **Unresolved question:** With only 11 or 17 registered images, what split preserves useful training overlap and credible evaluation?

## 25. PSNR and SSIM

- **Verified fact — plain English:** PSNR measures pixel error on a logarithmic scale; SSIM compares local luminance, contrast, and structural patterns. Both compare a rendered held-out view with its reference photograph.
- **Assignment requirement — project role:** The audit reports held-out PSNR and SSIM as required visual-quality metrics (assignment pp. 8, 11).
- **Verified fact — charging-station example:** The trained splat renders the held-out viewpoint of the orange charger; the harness aligns it with the real JPEG and computes both scores on the same prepared pixels.
- **Proposed decision — failure mode:** Different crop, resize, color space, alpha/background, mask, dynamic range, or aggregation rules can change the scores without changing the geometry.
- **Verified fact — evidence boundary:** PSNR is derived from mean squared error and the chosen data range; SSIM has implementation parameters, so “PSNR/SSIM” alone is not a complete metric contract.
- **Proposed decision — team choice:** The team must freeze preprocessing, data range, color channels/space, mask policy, SSIM parameters, per-view reporting, and aggregation.
- **Proposed decision — Mingna's draft:** It returns one `psnr` and one `ssim`, with “higher is better,” but gives no computation or aggregation definition.
- **Proposed decision — Codex audit challenge:** Store per-view values and exact metric configuration; do not let one aggregate hide failures on particular charger viewpoints.
- **Proposed decision — simplest first iteration:** Report per-view and aggregate PSNR/SSIM using one explicitly named implementation and identical preprocessing for baseline and candidate.
- **Unresolved question:** Which image preparation and aggregation rules match both the assignment's intended claim and LichtFeld's available evaluation output?

**Verified fact — metric reference:** The [scikit-image metric documentation](https://scikit-image.org/docs/stable/api/skimage.metrics.html) shows that PSNR requires a data range and SSIM depends on parameters such as data range, windowing, channel axis, and covariance convention.

**Verified fact — interpretation limit:** Higher PSNR/SSIM suggests closer held-out renders under the frozen procedure; neither metric alone proves correct camera geometry or better human-perceived quality.

## 26. Why reprojection error is unavailable without feature tracks

- **Verified fact — plain English:** Reprojection error needs a known 3D point, a camera pose/intrinsics, and the measured 2D pixel where that same point was observed.
- **Assignment requirement — project role:** The audit reports an eventual geometric measure “when available,” while also identifying a conflict with the requested lower reprojection error on current data.
- **Verified fact — charging-station example:** The fixtures have 820/1026 3D points but every image observation list and every point track is empty, so there is no measured pixel target to compare with a projected point.
- **Proposed decision — failure mode:** Averaging the constant point `ERROR = 1`, LichtFeld final error, or invented correspondences would produce a credible-looking but invalid number.
- **Verified fact — evidence boundary:** The recorder serializer documents error `1` as a placeholder and emits no 2D↔3D correspondences.
- **Proposed decision — team choice:** The team must decide how “not available” is represented and what validated future process may create a shared correspondence set.
- **Proposed decision — Mingna's draft:** `meanReprojectionError: number` makes the metric mandatory and provides no unavailable state.
- **Proposed decision — Codex audit challenge:** Represent the metric as unavailable with a machine-readable reason until validated tracks exist; never substitute unrelated scalars.
- **Proposed decision — simplest first iteration:** Report `N/A: no validated 2D–3D correspondences` and seek Simon's confirmation that this does not block early tooling/harness work.
- **Unresolved question:** Will the eventual selected approach produce validated correspondences that can be frozen and applied equally to baseline and candidate poses?

**Verified fact — geometric flow:** Reprojection requires all arrows below.

```text
world point X
   -- world-to-camera pose --> camera-space point
   -- intrinsics -----------> predicted pixel
                                     |
                                     v
                         compare with measured pixel
                         from points2D/track evidence
```

## 27. Minimum first iteration

- **Verified fact — plain English:** The minimum iteration is the smallest slice that proves the dataset seam is safe before depending on refinement or metrics.
- **Assignment requirement — project role:** The audit reports that reader/writer and measurement tooling precede refinement selection; current project boundaries focus first on `sparse/0/` and `images/`.
- **Verified fact — charging-station example:** Both real ZIPs can be loaded and saved without losing any of their 124/155 entries or changing the meaning of their sparse models.
- **Proposed decision — failure mode:** Building reader/writer, archive rewriting, refinement, and full evaluation simultaneously multiplies unresolved assumptions and makes failures hard to localize.
- **Verified fact — evidence boundary:** This is the audit's recommended scope, not an accepted team decision or final plan.
- **Proposed decision — team choice:** Filip and Mingna must accept, narrow, or reject the scope after learning and evidence review.
- **Proposed decision — Mingna's draft:** It proposes all four core contracts together and describes the refiner as the core engine.
- **Proposed decision — Codex audit challenge:** Implement only the text codec plus archive preservation first; record future contracts without choosing or implementing a refiner.
- **Proposed decision — simplest first iteration:** Verified recorder subset, fail-closed validation, unchanged archive payloads on no-op, semantic round trips, and coordinate/reference tests.
- **Unresolved question:** Does Simon expect a demonstrable LichtFeld no-op smoke run within this first slice, or only after the reproducible harness baseline is recovered?

## 28. Deferred later work

- **Deferred idea — plain English:** Deferred work is important but intentionally excluded until earlier contracts and evidence are stable.
- **Assignment requirement — project role:** The audit reports GPS/depth logs, recorder changes, geo-referencing, binary COLMAP, and LichtFeld modifications as later ideas unless evidence changes priority.
- **Verified fact — charging-station example:** The existing actions may later support sensor constraints, but their schema and usefulness are not part of the current parsed `ColmapModel`.
- **Proposed decision — failure mode:** Treating deferred ideas as current requirements can broaden interfaces prematurely and force an algorithm choice before the research gate.
- **Verified fact — evidence boundary:** No inspected evidence establishes LichtFeld pose optimization or generic COLMAP compatibility in the proposed code.
- **Proposed decision — team choice:** The team must revisit priority when experiments or Product Owner decisions provide new evidence.
- **Proposed decision — Mingna's draft:** `extraSignals?: any` reserves space for later GPS/IMU signals, and its broad model types imply wider COLMAP shapes.
- **Proposed decision — Codex audit challenge:** Defer binary files, general models, populated tracks, feature processing, algorithm selection, action parsing, cloud regeneration, intrinsics changes, and full statistical evaluation.
- **Proposed decision — simplest first iteration:** Keep a written deferred list without placeholders that weaken current type safety.
- **Unresolved question:** Which deferred capability is the first one needed by the refinement proposal that survives research and review?

## 29. Decisions Filip and Mingna must make

- **Verified fact — plain English:** These are technical contract choices the student team can prepare and usually own, subject to project review and Simon's product boundaries.
- **Assignment requirement — project role:** AI output remains a draft; the team must understand and review every accepted decision.
- **Verified fact — charging-station example:** The team can inspect real no-op behavior, choose deterministic ordering, define validation, and document fixture-based limitations without claiming pose improvement.
- **Proposed decision — failure mode:** Leaving technical semantics implicit makes two correct-looking implementations disagree on preservation, equality, errors, and metric preparation.
- **Verified fact — evidence boundary:** Source precedence requires contradictions to be reported rather than resolved silently.
- **Proposed decision — team choice:** Candidate team-owned topics include accepted text subset, archive preservation details, model invariants, result/error shapes, canonical ordering, numeric tolerances, and provenance fields.
- **Proposed decision — Mingna's draft:** It gives concise starting interfaces but leaves most acceptance semantics implicit.
- **Proposed decision — Codex audit challenge:** Convert implicit assumptions into explicit, testable contracts and keep unverified features outside the first accepted subset.
- **Proposed decision — simplest first iteration:** Decide only what is necessary to make no-op recorder-ZIP handling safe and testable; record remaining choices as unresolved.
- **Unresolved question:** Which decisions cross from technical implementation detail into product acceptance and therefore need Simon?

## 30. Decisions that should be discussed with Simon

- **Verified fact — plain English:** Simon should confirm choices that alter the promised product outcome, acceptance evidence, or externally visible data guarantee.
- **Assignment requirement — project role:** AI cannot make final Product Owner decisions, and important accepted decisions must later be recorded outside this guide.
- **Verified fact — charging-station example:** Current data cannot supply reprojection error, and a strict held-out protocol may be difficult with only 11/17 registered views; both affect what “improved” can honestly mean.
- **Proposed decision — failure mode:** Quietly changing acceptance from lower reprojection error to `N/A`, or using held-out RGB during refinement without labeling it, can create a misleading product claim.
- **Verified fact — evidence boundary:** The assignment/Product Owner outrank repository behavior and AI proposals in project source precedence.
- **Proposed decision — team choice:** Filip and Mingna should prepare options and evidence, not ask Simon to design the technical interface.
- **Proposed decision — Mingna's draft:** It assumes mandatory numeric reprojection error and held-out IDs but does not identify Product Owner decisions.
- **Proposed decision — Codex audit challenge:** Ask Simon about archive fidelity, unavailable reprojection error, the primary held-out visibility claim, and any change to the eventual acceptance wording.
- **Proposed decision — simplest first iteration:** Bring concise decisions with options, trade-offs, and missing evidence; do not present audit recommendations as already accepted.
- **Unresolved question:** Does Simon require strict unseen-view generalization as the primary claim, and may geometric error remain unavailable until real correspondences exist?

---

## Comparison of the two proposals

| Area | Mingna's draft | Independent Codex audit | Status |
|---|---|---|---|
| Typed COLMAP model | Cameras, images, points in ID-keyed maps | Directionally sound but broader than verified recorder subset | **Proposed decision** |
| Reader/writer | Pure three-string parse and serialize | Add explicit fidelity levels, validation, archive separation, deterministic output | **Proposed decision** |
| Archive | Not defined | Preserve every untouched payload; make original archive explicit | **Proposed decision** |
| Pose convention | WXYZ fields and translation | Name world-to-camera explicitly; guard against double conversion and `tvec` confusion | **Proposed decision** |
| Refiner | Pure synchronous `model + any? -> model` | Separate effectful port from pure math; explicit evidence and outcomes | **Proposed decision** |
| Allowed changes | Implicit whole-model replacement | Pose-only candidate invariant, fixed world gauge, unchanged intrinsics/points | **Proposed decision** |
| Harness | `model + heldOutIds -> metrics` | Immutable experiment spec, assets, frozen settings, provenance, availability states | **Proposed decision** |
| Reprojection | Mandatory number | Unavailable for current fixtures because tracks/observations are empty | **Verified fact** |
| First iteration | All contracts presented together | Implement archive-preserving codec slice first; defer algorithm selection | **Proposed decision** |

## Glossary

| Term | Plain-English meaning | Label |
|---|---|---|
| Archive adapter | Boundary that reads and rewrites the recorder ZIP while retaining opaque entries | **Proposed decision** |
| Baseline | Result produced from the original, unrefined model under frozen settings | **Verified fact** |
| Camera center | Camera's world-space position, `C = -R^T t` for COLMAP world-to-camera pose | **Verified fact** |
| Camera model | Projection formula and corresponding intrinsic parameter layout, such as `PINHOLE` | **Verified fact** |
| Candidate | Result produced from proposed refined poses under the same experiment controls | **Verified fact** |
| Codec | Parser plus serializer for the three COLMAP text files | **Proposed decision** |
| Correspondence | Evidence that a particular 2D feature and 3D point represent the same scene location | **Verified fact** |
| Deterministic serialization | Stable generated text for the same semantic model and serializer policy | **Proposed decision** |
| Extrinsics | An image camera's orientation and translation relative to the reconstruction world | **Verified fact** |
| Gauge | The arbitrary global frame choice—origin, orientation, and sometimes scale—of a reconstruction | **Verified fact** |
| Gaussian splat | A learned 3D scene representation made from many oriented, colored, translucent Gaussian primitives | **Verified fact** |
| Held-out image | A reference view excluded from training; refinement visibility must be stated separately | **Verified fact** |
| Intrinsics | Internal projection values such as focal lengths and principal point | **Verified fact** |
| Opaque entry | ZIP content carried through without interpreting its internal schema | **Proposed decision** |
| Pose | Rotation and translation linking world and camera coordinates | **Verified fact** |
| Provenance | Recorded identity of data, tools, settings, environment, and artifacts that produced a result | **Proposed decision** |
| PSNR | Logarithmic full-reference pixel-error metric; higher is better under one frozen computation | **Verified fact** |
| Reprojection error | Pixel distance between a projected 3D point and its measured 2D observation | **Verified fact** |
| Semantic round trip | Load/save/load preserves model meaning even if textual spelling changes | **Verified fact** |
| SSIM | Full-reference image metric emphasizing local structural similarity | **Verified fact** |
| Track | List of image feature indices that observe one 3D point | **Verified fact** |
| World gauge invariant | Requirement that refined cameras remain expressed in the input model's world frame and scale | **Proposed decision** |
| World-to-camera | Transform mapping a world point to camera coordinates: `Xc = R Xw + t` | **Verified fact** |

## Explain it yourself

**Proposed decision — learning check:** Each teammate should be able to answer these ten questions aloud without reading the guide before contract review begins.

1. **Proposed decision:** Explain why a recorder ZIP and a `ColmapModel` are not interchangeable.
2. **Proposed decision:** Explain what each of `cameras.txt`, `images.txt`, and `points3D.txt` contributes.
3. **Proposed decision:** Explain the difference between intrinsics and extrinsics using one charging-station image.
4. **Proposed decision:** State COLMAP's pose equation and explain why `tvec` is not camera position.
5. **Proposed decision:** Explain why COLMAP IDs fit maps better than array positions.
6. **Proposed decision:** Distinguish payload-byte fidelity, semantic model equality, and pose equivalence.
7. **Proposed decision:** Explain why unchanged points require refined cameras to preserve the input world gauge.
8. **Proposed decision:** Explain why `extraSignals?: any` hides important contract information.
9. **Proposed decision:** List what a fair LichtFeld baseline/candidate comparison must freeze and record.
10. **Proposed decision:** Explain why the current fixtures cannot produce valid reprojection error.

## Decisions to make after the learning process

**Proposed decision — use:** This section prepares later discussion and `OWNER_DECISIONS.md`; it deliberately does not select an option.

**Proposed decision — table labels:** Every decision topic, importance statement, option, and trade-off in the table is proposed decision material; the evidence and owner cells carry their own explicit labels.

| Decision topic | Why it matters | Available options | Main trade-offs | Evidence currently available | Evidence still missing | Recommended decision owner |
|---|---|---|---|---|---|---|
| Accepted COLMAP text subset | Prevents silent corruption and false compatibility claims | Recorder-only strict subset; broader traditional text subset; staged compatibility modes | Narrow is safer and faster; broad improves interoperability but needs more tests | **Verified fact:** recorder emits one shared `PINHOLE` camera and empty observations/tracks | **Unresolved question:** external COLMAP compatibility expected by assignment/Simon | **Proposed decision:** Filip and Mingna |
| Archive preservation level | Defines whether corrected output is still a recorder dataset | Payload identity for untouched entries; preserve additional ZIP metadata; whole-ZIP byte identity | Stronger fidelity costs complexity and may be library-dependent | **Verified fact:** fixtures contain actions, session data, and unreferenced images | **Unresolved question:** which ZIP metadata is product-significant | **Proposed decision:** Simon |
| No-op sparse-file behavior | Makes fidelity testable | Return original payloads; canonical reserialization; both via explicit modes | Original bytes maximize preservation; canonical output simplifies one writer | **Verified fact:** semantic and lexical fidelity differ | **Unresolved question:** assignment meaning of “byte-faithful enough” | **Proposed decision:** Filip and Mingna |
| Deterministic changed-file order | Stabilizes diffs and hashes | Numeric ID order; source order; another canonical key | Numeric order is simple; source order needs extra state | **Verified fact:** COLMAP IDs are unordered and may be sparse | **Unresolved question:** whether source order has downstream significance | **Proposed decision:** Filip and Mingna |
| Parser failure contract | Prevents unsupported data from being normalized silently | Exceptions; typed result; diagnostics plus rejected model | Exceptions are simple; typed results make failure explicit | **Verified fact:** current production code has serializers but no Task 2 parser | **Unresolved question:** preferred repository error conventions | **Proposed decision:** Filip and Mingna |
| Allowed refinement delta | Protects calibration, images, and point cloud | Pose fields only; typed pose delta; full model plus invariant validation | Narrow delta is safer; full model is flexible | **Assignment requirement:** current boundary keeps intrinsics/points unchanged | **Unresolved question:** whether selected method requires broader changes | **Proposed decision:** Filip and Mingna |
| Refinement boundary and purity | Determines testability across in-process and external candidates | Pure top-level transform; effectful port plus pure core; asynchronous job contract | Pure is easy to test; external approaches need effects | **Verified fact:** candidate approach is not selected | **Unresolved question:** surviving candidates and their execution needs | **Proposed decision:** requires an experiment |
| Explicit refinement evidence | Prevents hidden dependencies and leakage | Typed image assets; typed correspondences/constraints; candidate-specific evidence union | Explicit types improve review; premature types can overfit an unchosen method | **Verified fact:** model lacks image bytes; `any` is uninformative | **Unresolved question:** evidence required by selected candidate | **Proposed decision:** requires an experiment |
| Refinement outcome states | Separates update, no-op, insufficient evidence, and failure | Discriminated result; exceptions plus diagnostics; full model only | Explicit states improve safety; add contract detail | **Verified fact:** a valid-looking model need not be an improvement | **Unresolved question:** minimum diagnostics for each candidate | **Proposed decision:** Filip and Mingna |
| World-gauge invariant | Keeps fixed points registered to cameras | Require same gauge; permit gauge change with explicit alignment; allow point transformation | Same gauge is simplest; alignment supports more algorithms | **Verified fact:** fixed points become inconsistent with gauge-shifted cameras | **Unresolved question:** alignment evidence and algorithm behavior | **Proposed decision:** Filip and Mingna |
| Dataset materialization for LichtFeld | Ensures baseline and candidate use identical assets | Temporary directory; stable cached dataset; tool-managed import | Temporary is isolated; caching is faster but risks stale data | **Verified fact:** LichtFeld needs data path/images/settings beyond the model | **Unresolved question:** v0.4.2 exact import behavior and automation surface | **Proposed decision:** requires an experiment |
| Frozen experiment manifest | Makes comparisons reproducible | Minimal settings record; exhaustive manifest; containerized environment | More capture improves reproducibility but costs effort | **Verified fact:** Task 1 provenance is incomplete | **Unresolved question:** determinism, environment sensitivity, required repeats | **Proposed decision:** Filip and Mingna |
| Held-out visibility policy | Defines what quality claim means | Strict unseen RGB; transductive refinement; report both separately | Strict is cleaner but may starve tiny captures; transductive uses more evidence but weakens claim | **Verified fact:** fixtures have only 11/17 registered images | **Unresolved question:** acceptable product claim and feasible split | **Proposed decision:** Simon |
| PSNR/SSIM definition | Prevents metric drift | Adopt LichtFeld output; independent named library; cross-check both | Built-in is convenient; independent code offers control but must match preprocessing | **Verified fact:** metric parameters and preprocessing affect results | **Unresolved question:** LichtFeld v0.4.2 exact evaluation semantics | **Proposed decision:** requires an experiment |
| Reprojection metric availability | Prevents invalid geometric claims | Report N/A; create validated correspondences later; change acceptance measure | N/A is honest but may conflict with acceptance wording; tracks add work and assumptions | **Verified fact:** current fixtures have no observations/tracks | **Unresolved question:** Product Owner acceptance of temporary N/A | **Proposed decision:** Simon |
| Historical versus new baseline | Determines whether Task 1 results are reusable quantitatively | Recover exact Task 1 setup; establish a new canonical baseline; retain Task 1 as qualitative only | Recovery preserves history; new baseline improves provenance | **Verified fact:** version and scalar errors exist, full setup does not | **Unresolved question:** whether missing command/settings can be recovered | **Proposed decision:** requires an experiment |
| First-iteration acceptance boundary | Controls scope and reviewability | Archive-preserving codec only; include no-op LichtFeld smoke; include harness skeleton | Smaller scope lowers risk; broader slice demonstrates more but depends on missing evidence | **Assignment requirement:** seam/tooling precede algorithm selection | **Unresolved question:** Simon's milestone expectation | **Proposed decision:** Simon |

## Process after learning

- **Assignment requirement:** Filip and Mingna compare the Gemini and Codex proposals only after they can explain the contracts in their own words.
- **Assignment requirement:** The team then identifies remaining decisions and records provisional or confirmed outcomes in `OWNER_DECISIONS.md`.
- **Assignment requirement:** Questions requiring Product Owner confirmation go to Simon with options, trade-offs, and evidence.
- **Assignment requirement:** The official Task 2 plan is created from accepted decisions, not copied from either AI draft or this guide.
- **Proposed decision:** Do not fill `OWNER_DECISIONS.md` from this document without the learning, comparison, and owner-confirmation steps.

---

## Final self-test

**Proposed decision — instructions:** Answer without looking back; then open the hidden answers and explain any mismatch in your own words.

1. **Proposed decision:** Which ZIP entries may a pose-only correction delete?
2. **Proposed decision:** What does `cameraId` in an image record reference?
3. **Proposed decision:** In `Xc = R Xw + t`, what does `t` represent, and how is camera center computed?
4. **Proposed decision:** Why are `q` and `-q` a special case for equality?
5. **Proposed decision:** Why is numeric ID sorting a serializer policy rather than a COLMAP semantic fact?
6. **Proposed decision:** Name two ways files can be semantically equal but byte-different.
7. **Proposed decision:** What additional input does visual refinement need that `ColmapModel` does not contain?
8. **Proposed decision:** What invariant connects fixed `points3D` to refined image poses?
9. **Proposed decision:** What must be frozen for a fair baseline/candidate LichtFeld comparison?
10. **Proposed decision:** Can stored point error `1` be averaged as current reprojection error? Why?
11. **Proposed decision:** What is the difference between a strict held-out policy and a transductive one?
12. **Proposed decision:** What is the narrowest reasonable first iteration proposed by the audit?

<details>
<summary>Show answers</summary>

1. **Verified fact:** None; untouched entries must not be deleted under the proposed archive-preservation rule.
2. **Verified fact:** It references the corresponding camera record in `cameras.txt`/the camera map.
3. **Verified fact:** `t` is the translation in the world-to-camera transform, not the world-space camera position; `C = -R^T t`.
4. **Verified fact:** They encode the same 3D rotation, so rotation comparison should be sign-invariant even though bytes differ.
5. **Verified fact:** COLMAP IDs are unordered identifiers; sorting is a chosen deterministic output rule.
6. **Verified fact:** Examples include different whitespace, line endings, comments, numeric spellings, ordering, or opposite quaternion signs with equal orientation.
7. **Verified fact:** It needs the actual JPEG assets or explicit asset references; a chosen method may also need typed matches or other evidence.
8. **Proposed decision:** Refined poses must remain in the input model's world frame and scale, or be explicitly aligned back before writing.
9. **Proposed decision:** Dataset/model identity, images and split, refinement visibility, LichtFeld version/build, all training and evaluation settings, preprocessing, metric implementation, seed/repeats, and relevant environment.
10. **Verified fact:** No; it is a serializer placeholder and no 2D observations/tracks exist from which reprojection residuals could be measured.
11. **Verified fact:** Strict evaluation hides evaluation RGB from refinement and training; transductive evaluation may use it during refinement but not training and must be labeled as a different claim.
12. **Proposed decision:** The verified recorder-text codec plus archive preservation, validation, semantic/no-op round trips, and pose/reference tests, with no refinement algorithm selected.

</details>
