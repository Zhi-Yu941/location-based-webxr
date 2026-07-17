# Review of Filip's Task 2 contract, version 2

> **Status: Historical.** Advisory AI review of the superseded broad v2 candidate. Its findings remain evidence; the bounded Iteration 1A proposal addresses only the 1A subset.

## Verdict

Version 2 is a substantial architectural improvement. The ZIP adapter, recorder-specific COLMAP codec, pose-only invariants, coordinate conventions, and separation from LichtFeld are now concrete enough to compare seriously. The proposal no longer confuses the recorder archive, the COLMAP model, the TypeScript representation, and the external LichtFeld experiment.

The full proposal is still **not ready to enter the later comparison as an equally sound Task 2 contract**. Its archive/codec half is credible; its measurement half is not. Section 13 is an elaborate experiment report schema, not the assignment-required measurement harness. Worse, a report can claim a holdout without proving what LichtFeld actually trained on, and a metric can be marked supported without complete, bound evidence. Those are blockers because they allow a formally "comparable" experiment that is not a valid experiment.

The correct response is not to add another layer of providers or generic abstractions. Add the one missing executable harness boundary, bind it to the actual trainer input and evaluation artifacts, close the supported-metric invariants, and cut speculative schema. After those changes, the proposal is suitable as a strong candidate.

This review used only `AGENTS.md`, the SoftwareLab assignment, the completed Task 1 review, `archive/task2/filip-broad-contract-v2.md`, relevant verified files under `GpsPlusSlamJs_RecorderApp/src/colmap/`, and narrowly required Task 1 fixture archive structure and `sparse/0/` text evidence. It did not inspect Mingna's proposal, Gemini material, earlier contract reviews or dispositions, comparison reviews, or an official Task 2 plan.

## Findings

### Finding 1 - The fourth boundary is not a measurement harness

Severity: Blocker

Challenge: The document defines experiment data and report shapes, but no callable component that takes declared inputs, drives or coordinates a LichtFeld run, and returns the report.

Evidence: Assignment section 2.2 requires a measurement harness with a model-in to metrics-out interface, and section 2.3 component 3 describes a small harness that runs LichtFeld and produces comparable quality metrics. V2 lines 43-50 name the fourth boundary an "external experimental measurement specification and report"; line 721 permits it to be merely a document schema; lines 904-1089 define only data; line 1108 allows a manual experiment; and line 1513 completely defers automated LichtFeld training, rendering, and orchestration. No `MeasurementHarness`, `run`, or equivalent operation exists.

Why it matters: A manually populated report cannot enforce the actual inputs, cannot provide the required independently testable component, and cannot act as the gate before refinement. The team could possess an impeccable schema while still having no harness.

Smallest fix: Add one LichtFeld-specific callable boundary that accepts the paired experiment specification and the baseline/candidate inputs and returns a typed report. Its external execution may remain behind the boundary and may be faked in unit tests. Do not add a provider framework. If the first harness is intentionally manual rather than executable, record that as an explicit Simon-approved deviation from the assignment.

Classification: missing correctness requirement

### Finding 2 - The held-out policy is a label, not proof of exclusion

Severity: Blocker

Challenge: `trainerRgb: "training-only"` states an intention but does not identify or verify the dataset LichtFeld actually consumed.

Evidence: V2 lines 731-755 define split and visibility labels, and lines 885-896 require list partitioning. `ExperimentRunKey.archive` and `ActualRunManifest.inputModel` still identify the full recorder archive/model (lines 924-943), which contain every model image and RGB asset. There is no identity for a materialized training-only LichtFeld dataset, no verified selection file or command, and no log requirement proving the evaluation views were excluded. The assignment requires the selected frames to be held back from training, not merely listed as held out.

Why it matters: LichtFeld can train on all images while the report says it used a holdout. PSNR/SSIM would then measure training-view reconstruction and could falsely validate a pose change.

Smallest fix: Bind every run to an actual trainer-input artifact derived from exactly `trainingViews`, or to a verified LichtFeld selection mechanism whose command/configuration and logs prove the same fact. Keep the evaluation-camera/reference manifest separate. If strict RGB holdout is selected, bind the refiner's actual input in the same way.

Classification: missing correctness requirement

### Finding 3 - A supported metric can be empty, partial, or unrelated

Severity: Major

Challenge: The closed metric states look rigorous, but the supported branch does not enforce the evidence needed to support the metric.

Evidence: `CapabilityOutcome.supported` accepts any artifact array, including an empty one (lines 905-920). `RunMetricOutcome.supported` accepts an arbitrary `perView` array, arbitrary JavaScript `number` values, an arbitrary unit string, and a self-reported aggregate (lines 983-997). It does not require the views to equal the evaluation split, one exact-view render and one source reference per evaluation view, finite or otherwise explicitly allowed values, or recomputation of the aggregate. `ExperimentalMetricPolicy.pixelPolicy`, track-set identity, and residual policy are optional (lines 820-825). Lines 1092-1106 refer to "required" artifacts but never define the required set per metric.

Why it matters: An empty PSNR result, PSNR calculated on training views, NaN, or a reprojection result based on a different correspondence set can reach `comparison.status = "comparable"`.

Smallest fix: Define metric-specific supported invariants. PSNR/SSIM must cover exactly the evaluation views and bind each value to the exact render, original reference image identity, and pixel policy. Reprojection support must require a frozen track-set identity, residual policy, and coverage. Require non-empty evidence, define valid numeric domains, and derive aggregates from the declared per-view/per-run values rather than trusting a supplied number.

Classification: missing correctness requirement

### Finding 4 - The mandatory source-build comparison has been made optional

Severity: Major

Challenge: The proposal demotes a direct assignment requirement to a separate activity "where feasible" and deliberately leaves its acceptance undefined.

Evidence: Assignment section 2.3 Goal 1 component 2 requires building LichtFeld from source, checking out the same release tag as the Task 1 prebuilt, comparing both on the same input, recording exact commands, and establishing a reproducible recipe. Task 1 records v0.4.2. V2 line 1114 correctly says source/prebuilt parity is not a pose-effect comparison, but line 1496 makes the activity conditional and says this contract does not define it.

Why it matters: A source build can behave differently from the known prebuilt, and the difference can later be blamed on poses. More basically, the contract would declare Task 2 complete while omitting an assigned Goal 1 deliverable.

Smallest fix: Keep parity outside the pose-effect comparison, but add a short mandatory source-build parity record or checklist: upstream identity, v0.4.2 tag/commit, prebuilt and source binary identities, build configuration/toolchain, identical input and training settings, captured commands, repeats, artifacts, and a stated equivalence criterion. Simon may decide the tolerance or blocker fallback; the activity itself is not optional under the current assignment.

Classification: missing correctness requirement

### Finding 5 - The split is neither reproducible nor required to be useful

Severity: Major

Challenge: A `SplitManifest` can be hand-picked after seeing results, can contain an empty evaluation set, and does not identify the source image bytes.

Evidence: `ExperimentView` contains only image ID and name (lines 725-729). `SplitManifest` records lists and a hash (lines 731-736), but no generator version, seed, selection rule, requested count/fraction, temporal or coverage policy, minimum evaluation size, or freeze point. Lines 885-887 require only a disjoint partition. The assignment requires holding out a few frames and unit-testing the held-out split logic. The Task 1 fixtures provide 11 and 17 eligible model views, but V2 defines no policy for selecting among them.

Why it matters: A cherry-picked easy view can manufacture improvement, while an empty evaluation set can satisfy the structural partition and produce no evidence. A replaced image with the same ID/name is also not detected at the view level.

Smallest fix: Add a small versioned split policy with a deterministic rule and seed where relevant, a non-empty/minimum evaluation requirement, and a rule that freezes the split before the paired runs. Bind each view to its source image identity. The actual count/fraction and strict-versus-training-only visibility remain human decisions.

Classification: unclear contract

### Finding 6 - Training and build provenance remain stringly typed and incomplete

Severity: Major

Challenge: Exact equality of two incomplete, ambiguous manifests does not prove equal training.

Evidence: `EffectiveTrainingSetting` is a free-form name/value/origin triple and `procedureReference` is a free string (lines 772-783). The contract does not forbid duplicate setting names, define canonical names, preserve exact ordered arguments, identify the working directory/dataset layout, capture environment variables, or bind claimed resolved defaults to a configuration dump or log. `LichtFeldBuildIdentity.source` has tag, commit, binary, and a build-configuration hash (lines 757-770), but no upstream repository identity, dirty-tree state, or structured compiler/CMake/CUDA/vcpkg provenance. Nevertheless, lines 1092-1104 use equality of these values as a comparability gate.

Why it matters: Baseline and candidate manifests can compare equal after both omit a changed default. A binary hash proves which binary ran only if execution evidence binds that binary to the run; it does not make the build reproducible.

Smallest fix: Record exact ordered invocation, dataset layout/working directory, unique effective setting names, all resolved defaults, and identities for the emitted effective-config and run logs. For source builds, record repository URL, full commit, dirty state, toolchain versions, and dependency configuration. Keep these fields LichtFeld-specific rather than creating a generic trainer abstraction.

Classification: unclear contract

### Finding 7 - "Unchanged" and preserved fields are not exact

Severity: Major

Challenge: The proposal says cameras, points, and untargeted poses do not change, then defines conformance using a tolerant, quaternion-sign-equivalent relation.

Evidence: V2 lines 674-681 say only targeted qvec/tvec fields may change and that an unchanged result need only be semantically equal. Line 715 says non-pose data must remain semantically unchanged. Semantic equality tolerates scalar differences up to the section 10 tolerance and treats q and -q as equal (lines 494-504 and 547-555). That conflicts with line 496's sign-preservation rule and the stronger "remain unchanged" wording. The second fixture contains two negative-qw records, proving quaternion sign is observable recorder representation.

Why it matters: A refiner can alter point/camera floats within tolerance or flip quaternion signs while reporting `unchanged` or omitting the image from the declared delta. Serialized bytes and model identity then change outside the claimed pose update.

Smallest fix: Define a separate exact-preservation predicate for contract invariants: identical IDs/order and identical stored numeric tuples, including quaternion sign and an explicit negative-zero rule. Use tolerant/sign-equivalent equality only for semantic codec round-trip and orientation comparison. Require exact preservation for `unchanged`, all non-target fields in `updated`, and pose-only pair validation.

Classification: missing correctness requirement

### Finding 8 - The exact filename regex is not verified recorder behavior

Severity: Major

Challenge: The codec rejects recorder outputs that the permitted current exporter code does not itself forbid.

Evidence: V2 lines 419 and 485 require `^frame-[0-9]{6}\.jpg$`. In `colmap-serializers.ts`, `ColmapImageRecord.name` is an unconstrained string and line 107 writes it verbatim. `colmap-zip-contributor.ts` lines 187-190 only strip a forward-slash prefix. `colmap-serializers.test.ts` line 91 explicitly serializes `f.jpg`. The two Task 1 fixtures prove only that their 28 referenced names happen to match the six-digit pattern.

Why it matters: A valid ZIP produced through current code with a different safe basename is rejected even though the recorder ZIP is supposed to be the external contract.

Smallest fix: Accept a unique safe bare basename that resolves exactly below `images/`, excluding separators, controls, quoting ambiguity, and traversal. Alternatively label the regex as a fixture-only policy until the actual filename generator or a Simon decision establishes it as a recorder guarantee.

Classification: unsupported assumption

### Finding 9 - The Sim(3) gauge record has no transformation equation

Severity: Major

Challenge: The proposal correctly recognizes that unchanged points do not prove gauge preservation, but its alignment record is not precise enough to make gauge restoration interoperable or testable.

Evidence: `GaugeAlignmentRecord` provides a scale, quaternion, translation, and free-form evidence string (lines 588-596). Lines 685-689 require a solver-to-input Sim(3), while section 12 defines column vectors and COLMAP world-to-camera poses. The contract never states whether the mapping is `X_input = s R X_solver + t` or its inverse, nor the exact camera-center, orientation, and tvec update equations. The proposed non-identity test at line 1391 therefore has no unique expected result.

Why it matters: Two implementations can record inverse alignments under the same fields. A pose set can remain internally coherent yet be written in a frame inconsistent with the unchanged occupancy points.

Smallest fix: State the direction and exact Sim(3) equation, define how it maps camera centers and rotations back to input-world coordinates, derive the resulting world-to-camera tvec, and bind the evidence to a defined alignment method/artifact rather than only prose. Keep the current warning that local corrections can still make the fixed seed cloud stale.

Classification: unclear contract

### Finding 10 - The iteration-one consumer smoke gate is undefined

Severity: Major

Challenge: "Structurally accepted by the existing consumer pipeline" is mandatory acceptance language without a reproducible pass condition.

Evidence: V2 line 104 admits that the historical Task 1 command, effective settings, build identity, environment, and seed behavior are unknown. Lines 1432 and 1472 nevertheless require a recorded structural consumer-pipeline smoke check for generated outputs. The completed Task 1 review records only LichtFeld v0.4.2, two successful smoke tests, two unexplained final-error values, and visual observations; it does not define how a regenerated ZIP passes.

Why it matters: One reviewer may count "opens without error" as success while another requires training completion. The original fixtures succeeding says nothing about a canonicalized or pose-edited output.

Smallest fix: Define which generated outputs are checked and record the output hash, LichtFeld binary/version identity, exact procedure, environment, pass condition, and log/artifact references. A narrow valid pass condition could be successful model load and training start with no COLMAP-input error; choose it explicitly. Until then, do not make the smoke record a gate.

Classification: unclear contract

### Finding 11 - Unverified rendering does not justify omitting pure metric and split contracts

Severity: Major

Challenge: V2 correctly keeps PSNR/SSIM unavailable end-to-end, but also omits the independently testable metric and split logic required by the assignment.

Evidence: Assignment section 2.3 component 3 explicitly requires unit tests for PSNR/SSIM on known image pairs and for held-out split logic. V2 lines 1437-1454 test only report-state behavior using fake external results. Line 1515 defers automated PSNR/SSIM until exact rendering and a pixel policy are verified. Exact-view rendering is an integration prerequisite, not a prerequisite for defining and testing pure pixel metrics or deterministic splitting.

Why it matters: The team can reach refinement research with no trusted metric implementation even after exact rendering becomes available. Bugs in color range, orientation, masking, MSE, or split selection would then be confused with LichtFeld behavior.

Smallest fix: Contract the pure metric operations and deterministic split operation, including policy input, typed failure, and golden test behavior. Keep only the external render-to-metric integration unavailable until exact supplied-camera rendering is verified.

Classification: missing correctness requirement

### Finding 12 - The proposal is still far larger than its current consumers justify

Severity: Major

Challenge: V2 calls itself minimal while committing to a large speculative integrity and reporting surface before any actual harness consumer exists.

Evidence: The contract is 1,626 lines. Section 7 defines nested RFC 8785 self-hash rules; section 8 sets 512 MiB per-entry and 4 GiB decompressed limits; sections 13-14 define hundreds of lines of run, capability, metric, aggregation, artifact, digest, and error types; and section 18 says all of that is fully contracted despite being deferred. The verified fixtures are only about 5.1 MB and 7.4 MB, while `ImmutableBytes.copy()` and full decompressed-byte validation make multi-gigabyte acceptance a significant runtime commitment. Exact rendering, automated orchestration, supported metrics, and an actual refiner do not yet exist.

Why it matters: The team must review, implement, and preserve semantics that have no current caller, while the one required caller-facing harness operation is absent. The complexity creates false confidence and makes later evidence-driven correction harder.

Smallest fix: Retain archive/model hashes and a single versioned experiment manifest, but defer nested self-hash graphs, role-aggregate object trees, implementation-specific stale thresholds, and unused execution states until a real consumer proves their need. Use a conservative recorder-evidence-based archive profile rather than promising multi-gigabyte browser handling. Preserve traversal/duplicate checks and typed limit failures; simplify the arbitrary breadth, not the safety invariant.

Classification: unnecessary complexity

### Finding 13 - The accepted numeric input grammar is not exact

Severity: Minor

Challenge: Output formatting is clear, but the input grammar still leaves independent parsers free to disagree.

Evidence: V2 line 476 accepts "syntactically valid decimal/scientific numeric lexemes" and line 478 assigns different errors depending on whether a token matches that grammar. No exact grammar or regular expression states whether forms such as `+1`, `.5`, `1.`, `01`, `1e+2`, or `-0` are accepted. The contract otherwise claims exact recorder-specific arity and deterministic error classification.

Why it matters: Two implementations can accept different archives or return different error codes while both claim conformance.

Smallest fix: State exact ASCII regular expressions for integer and floating tokens, then keep the existing safe-integer, finite, sign, and range checks after conversion.

Classification: unclear contract

### Finding 14 - Cancellation and timeout outcomes have no control input

Severity: Minor

Challenge: The refiner advertises `cancelled` and `timed-out` failures, but the request provides neither a cancellation signal nor a deadline/timeout policy.

Evidence: `PoseRefinementRequest` contains model, assets, and implementation configuration only (lines 570-574). `RefinementError` adds `cancelled` and `timed-out` (lines 1315-1317), and line 1393 requires a timeout mapping test. No contract says who initiates cancellation, what duration applies, or whether an implementation-owned timeout hidden inside canonical JSON is required.

Why it matters: Callers cannot rely on or test these states consistently; an implementation can wait forever or invent its own timeout while still conforming.

Smallest fix: Remove these two outcomes until an effectful refiner consumer needs them, or add one explicit execution-control field with defined ownership. Do not introduce a broader process-management abstraction.

Classification: unnecessary complexity

### Finding 15 - Fixture aliases are not reproducible locators

Severity: Minor

Challenge: Hashes identify the fixtures after acquisition, but the contract does not tell a fresh checkout where the named aliases come from.

Evidence: V2 lines 89-103 and 1423 use `first-capture.zip` and `second-capture.zip`. Git evidence maps those exact blobs to `TaskOne:dev/zip/2026-07-09_15-46-36utc.zip` and `TaskOne:dev/zip/2026-07-09_15-47-48utc.zip`; their Git blob identities match the local fixture aliases. The contract records SHA-256 and size but not these source locators or an approved fixture-installation rule.

Why it matters: Fixture integration tests are not independently repeatable if a teammate has only the contract and repository history.

Smallest fix: Add a two-row alias-to-`TaskOne:<path>` provenance table alongside the existing SHA-256 and size, or name the approved fixture acquisition location.

Classification: unclear contract

### Finding 16 - The report can say "comparable" but cannot state the assignment's proof

Severity: Major

Challenge: The contract validates experimental comparability but has no result that expresses whether the candidate is better, no-worse, or worse across the required evidence and scenes.

Evidence: `ComparisonOutcome` contains only `comparable` or `not-comparable` (lines 1067-1075). Line 1106 explicitly limits it to sufficiency of requested evidence, and line 1454 allows a complete pair to become comparable without asserting improvement. Assignment section 2.4 requires higher held-out PSNR/SSIM, lower reprojection error, visibly cleaner A/B evidence, and success on more than one scene. V2 line 105 correctly observes that both current fixtures show the same scene, but lines 1618-1626 leave multi-scene proof only as evidence still needed. No scene identity, metric direction/delta, A/B judgement, or suite-level conclusion is contracted.

Why it matters: A perfectly conforming report cannot answer the project's eventual acceptance question, and two captures of the charging station can be mistaken for scene diversity outside the schema.

Smallest fix: Add a small, separate quality conclusion over valid comparable reports: per-metric baseline/candidate values and deltas with direction, an explicit human A/B outcome, scene identity, and a suite result requiring the owner-agreed number of distinct scenes. Do not invent thresholds in this draft; make them explicit decisions.

Classification: missing correctness requirement

### Finding 17 - The draft's stated evidence precedence conflicts with AGENTS.md

Severity: Minor

Challenge: A review disposition is promoted above verified repository behavior even though it is not an authoritative source under the project rules.

Evidence: `AGENTS.md` orders sources as assignment, Simon decisions, verified repository/tool behavior, reviewed accepted plan, Task 1 evidence, research, and AI drafts. V2 lines 9 and 19 cite an accepted review disposition and place accepted human dispositions before verified recorder/fixture behavior. V2's own unsupported filename restriction demonstrates why review history cannot override current code evidence.

Why it matters: A previously accepted review response can silently become "fact" even when repository behavior contradicts it.

Smallest fix: Use the `AGENTS.md` precedence verbatim. Treat review disposition only as revision history; every normative requirement must stand on assignment, Simon decision, verified behavior, or an explicitly labelled candidate policy.

Classification: unsupported assumption

## What is already sound

- The four conceptual owners are cleanly separated: the ZIP adapter owns the archive, the codec owns COLMAP text and typed values, the refiner owns pose proposals, and the experiment boundary owns external evidence. There is no recorder-ZIP/COLMAP-model/TypeScript/LichtFeld-dataset conflation in the reusable flow.
- The contract now contains real TypeScript shapes and signatures and contains no `any`. The important public outcomes are discriminated unions rather than loosely structured exceptions.
- Archive fidelity is realistically scoped to the same normalized file-entry set and identical decompressed bytes for untouched entries. It explicitly excludes compressed-byte identity, ZIP order, timestamps, comments, extra fields, and directory records.
- Copy-only, forced codec round trip, and pose-edit acceptance paths are separated. This closes the previous class of false no-op tests in which original bytes bypass the codec.
- Model order is treated as data and serialization preserves supplied order. ZIP order is correctly declared non-semantic.
- Canonical float output, negative-zero handling, LF output, final line feeds, quaternion sign preservation, q/-q orientation comparison, and unit-quaternion validation are substantially clearer.
- Camera intrinsics and all point fields are required to remain unchanged during pose-only refinement. The proposal also correctly distinguishes tvec from camera center and pins the world-to-camera equation and quaternion ordering.
- The document correctly says that unchanged points do not, by themselves, prove correct world gauge or a still-useful seed cloud after large local corrections.
- It honestly marks fixture reprojection error unavailable because observations/tracks are empty, and it refuses to reinterpret point `ERROR = 1` or Task 1's LichtFeld final-error scalar as quality metrics.
- Fixture facts, hashes, counts, ordering, unreferenced images, encoding, line endings, quaternion norms/signs, and Task 1 result mappings were verified.

## Features that should remain

- One ZIP/archive owner with copy-through and explicit sparse-text replacement.
- Preservation of unreferenced `images/frame-000001.jpg`, `actions/`, `session.json`, and unknown future entries.
- A narrow, fail-closed recorder text subset for the first codec iteration, with binary/general COLMAP explicitly deferred.
- A typed one-camera PINHOLE model, ordered images/points, strict numeric validation, and mandatory empty observation/track state for the verified subset.
- Separate semantic model equality and archive payload fidelity.
- Deterministic canonical text and a forced parse-serialize-parse fixture path.
- The async-capable, algorithm-neutral pose-refinement port with exact pose-only delta reporting.
- Normative world-to-camera, camera-center, axes, quaternion-order, and no-second-basis-conversion rules.
- Explicit `supported` / `unavailable` / `failed` evidence states and the rule that unavailable is never reported as zero.
- Exact build/configuration/split/visibility/environment matching as a concept for paired experiments, once those values are tied to actual execution.

## Features that should be simplified

- Replace the large experiment object graph with one small specification, one actual-run record per role/repeat, metric-specific results, and one report validator.
- Keep archive/model/configuration identities, but remove recursive RFC 8785 digest machinery until an executable consumer needs cross-process canonical JSON identities.
- Reduce archive limits to a conservative recorder profile supported by real captures and the intended runtime. Keep traversal, duplicate-path, and decompression-limit protection.
- Replace free-form training setting arrays with exact invocation plus a captured effective-configuration/log identity.
- Use exact preservation for the pose-only invariant; reserve tolerant semantic equality for codec comparisons.
- Relax the six-digit filename regex to a safe bare-basename rule unless stronger recorder evidence appears.
- Remove untriggerable cancellation/timeout states and implementation-specific stale-cloud thresholds until their consumers and policies exist. Keep the qualitative stale-cloud warning in the contract rationale.
- Use a short source-build parity checklist rather than another generic comparison framework.

## Features that should be deferred

- Selection or implementation of any pose-refinement algorithm.
- Action-log, GPS, depth, odometry, ICP, feature matching, bundle adjustment, loop closure, and pose-graph integration.
- Binary COLMAP, multiple cameras, non-PINHOLE models, populated observations/tracks, and general external-COLMAP compatibility.
- Reprojection-error support until a validated frozen correspondence set and residual policy exist. Its interim unavailability must not be mistaken for a permanent assignment waiver.
- End-to-end PSNR/SSIM support until exact supplied-camera rendering and a complete pixel policy are verified. Pure metric and split logic should not be deferred.
- Automated LichtFeld orchestration only if a callable harness boundary exists and Simon accepts a manual first integration; the harness itself cannot be replaced by a report document.
- Multi-run statistical machinery beyond recording individual repeats and a simple declared aggregation.
- Generic plugin/provider/trainer/evidence frameworks, georeferencing, preview applications, additional output formats, and recorder/exporter changes.

## Minimum safe version of Filip's proposal

The minimum safe candidate is much smaller than V2 while retaining its useful architecture:

1. **Recorder ZIP adapter contract.** Open one recorder ZIP, reject basic unsafe/duplicate paths and an evidence-based size limit, require the three text files, resolve model-referenced safe image basenames, and copy the archive with explicit existing sparse-file replacements. Untouched file entries retain their names and decompressed bytes; ZIP metadata is out of scope.

2. **Recorder COLMAP text codec contract.** Represent one PINHOLE camera, ordered images with world-to-camera qvec/tvec and empty observations, and ordered occupancy points with empty tracks. Parse an exact ASCII numeric grammar, validate without repair, preserve order and quaternion sign, serialize deterministically, and define both semantic round-trip equality and exact preserved-field equality.

3. **Pose-refinement port contract.** One async algorithm-neutral request/result boundary over the validated model and referenced image assets. `updated` may change only declared image qvec/tvec tuples; `unchanged` and every non-target field are exact. Any solver-gauge alignment uses one normative Sim(3) equation back to the input world frame. No refinement algorithm is selected.

4. **Measurement harness contract.** One callable paired-experiment operation. Its minimal spec identifies baseline/candidate archives and models, the actual training-only input artifacts, deterministic split policy and manifest, held-out visibility, exact LichtFeld binary/version, exact invocation/effective settings, environment, seed/repeats, requested metrics, and artifact locations. Its report uses closed metric-specific states and cannot mark a metric supported without complete bound evidence.

5. **External source-build parity record.** A separate mandatory assignment record compares the v0.4.2 prebuilt with a source build of the same tag under a defined procedure. It is not a pose-effect comparison and is not a reusable runtime dependency.

6. **Acceptance meaning.** Task 1 fixtures prove archive/codec structure and copy-through, synthetic models prove pose/gauge math, and fake external-run records prove harness validation. No fixture replay, structural smoke, or unavailable metric claims pose improvement. Improvement is concluded only from valid paired evidence under an owner-approved gate and later across distinct scenes.

## Questions requiring human or Simon decisions

1. Must the first measurement harness execute LichtFeld, or will Simon explicitly accept a callable harness with a documented manual external executor for the first experiment?
2. Which held-out policy is the intended claim: training-only holdout (refiner may see evaluation RGB) or strict RGB holdout (neither trainer nor refiner sees it)? How should the session-wide occupancy seed be disclosed?
3. What deterministic split rule and minimum evaluation count/fraction should be frozen before experiments? Should selection favor temporal spacing, view coverage, or a simpler seeded rule?
4. What minimum supported evidence must exist before implementation of a real refiner may begin? Structural comparability alone should not satisfy this gate.
5. May reprojection error be unavailable only for the initial fixture-based gate, and what must happen before the assignment's final proof if a valid correspondence set still does not exist?
6. What counts as source-build/prebuilt parity for v0.4.2, and what is the approved blocker path if the mandated source build cannot be completed on available hardware?
7. What exactly passes the generated-ZIP LichtFeld smoke check: successful load, training start, or completed training? Which outputs must be checked?
8. What split, repeat/seed minimum, pixel policy, and A/B review procedure define a fair paired comparison?
9. What quantitative/no-worse thresholds and human A/B outcome constitute "better," and how many distinct scenes are required for the final proof?
10. Is the first archive profile limited to known recorder captures, and what conservative compressed/decompressed size limits fit the intended browser or Node runtime?
11. Is a safe arbitrary bare basename the recorder contract, or is the six-digit `frame-NNNNNN.jpg` pattern to be made an explicit owner-backed restriction?

These questions do not include the final pose-refinement algorithm. That decision remains correctly gated on measurement and research evidence.
