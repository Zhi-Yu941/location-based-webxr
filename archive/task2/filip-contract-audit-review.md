# Hostile architecture review — Filip’s independent Task 2 contract proposal

> **Status: Historical.** Advisory AI review of the superseded Filip audit. Its findings remain evidence but are not requirements, accepted decisions, or an official plan.

## Verdict

Filip’s proposal is directionally strong but is **not yet suitable as an equal contract candidate for the later architecture comparison**. It correctly identifies most of the dangerous boundaries and several subtle failure modes, but it stops at an audit/checklist for a future contract. The assignment explicitly asks for concrete TypeScript model types, a refinement signature and a harness interface; none is present.

The smallest defensible response is not to discard the proposal. Keep its narrow recorder-first scope, pose-convention discipline, archive copy-through idea, gauge warning and metric honesty. Remove the speculative component graph, then add four small, typed boundaries with precise invariants and failure results.

Evidence used for this review was limited to `AGENTS.md`, the 12-page SoftwareLab assignment, the completed Task 1 review from the `TaskOne` branch, `archive/task2/filip-contract-audit.md`, relevant files under `GpsPlusSlamJs_RecorderApp/src/colmap/`, and the entry structure plus `sparse/0/*.txt` of the two Task 1 fixtures. No comparison draft, Mingna/Gemini draft or official/merged Task 2 plan was read.

## Findings

### 1. The file is an audit of a future contract, not a contract

Severity:  
Blocker

Challenge:  
There are no concrete TypeScript declarations for the COLMAP model, archive input/output, image assets, pose delta, refinement request/result, experiment specification/report or typed failures. The literal absence of `any` proves nothing because the weak concepts remain untyped prose nouns such as “evidence,” “diagnostics,” “snapshot/manifest,” “environment” and “artifacts.”

Evidence:  
The assignment §2.2 (p. 7) explicitly requires the first plan to record “the TypeScript types for the COLMAP model, the `refine` signature, and the harness interface” so the components can be built independently. Filip’s lines 3 and 9 call the document an audit and not contract-complete; lines 128–141 give only an ownership table; lines 263–280 recommend content for a future plan.

Why it matters:  
Two implementers can produce incompatible meanings of model identity, unavailable metrics, archive lifetime and refinement failure while both claiming to follow this proposal. No compiler or contract test can expose the mismatch.

Smallest fix:  
Add minimal, non-implementation TypeScript shapes for four public boundaries: recorder ZIP adapter, COLMAP text codec, refiner port and measurement harness. Use readonly domain records and closed/discriminated result unions; do not use `any` or open-ended diagnostic bags.

Classification:  
unclear contract

### 2. ZIP ownership is assigned three times

Severity:  
Major

Challenge:  
The archive adapter owns opaque-entry preservation, the dataset view owns the original archive snapshot/manifest, and the corrected-archive writer again owns archive mutation and preservation. The proposal therefore blurs the recorder ZIP, the TypeScript model and the output writer after correctly saying they are different layers.

Evidence:  
Filip lines 132, 134 and 138 assign overlapping responsibility. The assignment §2.2–§2.3.1 distinguishes the recorder ZIP, the interpreted `sparse/0` model plus image assets, and the ZIP emitted for LichtFeld.

Why it matters:  
A refiner could accidentally receive archive state, one component could keep only hashes while another needs the original bytes, or two components could disagree about path normalization and replacement ownership. A writer given only a typed model may rebuild a COLMAP-only ZIP and lose `actions/`, `session.json`, unknown entries and the unreferenced first JPEG.

Smallest fix:  
Make one recorder ZIP adapter own safe entry enumeration, opaque payload retention and copy-with-explicit-replacements. Make the codec own only sparse text bytes and typed COLMAP values. Keep the refiner unaware of ZIP internals. A thin orchestrator may connect them; a separate “dataset snapshot owner” and “corrected archive writer” are unnecessary.

Classification:  
unclear contract

### 3. The no-op fidelity test can pass without exercising the writer

Severity:  
Major

Challenge:  
Exact no-op payload copying and codec round-trip correctness are conflated. Returning the original three sparse payloads unchanged can satisfy Filip’s strongest test even if parsing or serialization is broken.

Evidence:  
Filip lines 82, 163 and 238–239 require unchanged payload hashes on a true no-op. The assignment §2.2 and §2.3.1 require a real load → save round trip proving that cameras, poses, points and quaternion/translation conventions survive the reader/writer.

Why it matters:  
A parser could swap `qw` and `qx`; the no-op archive path could still copy `images.txt` byte-for-byte and pass. The first actual pose edit would invoke the serializer and corrupt every camera.

Smallest fix:  
Define and test three separate properties:

- archive copy-through: untouched entry names and decompressed payload bytes are identical;
- forced codec round trip: parse → canonical encode → parse yields complete semantic equality;
- pose edit: a synthetic non-identity pose delta changes only the seven `qvec`/`tvec` scalars for the targeted image when the emitted ZIP is read back.

Exact sparse-file reuse may remain an optimization for a no-op, but it is not proof of codec correctness.

Classification:  
missing correctness requirement

### 4. “Only `images.txt` differs” is not a pose-only invariant

Severity:  
Major

Challenge:  
The proposal constrains the changed file, not the changed model fields. `images.txt` also contains image IDs, camera IDs, names, ordering, comments and the second-line observations.

Evidence:  
`AGENTS.md` requires unchanged intrinsics and `points3D` for this iteration. Assignment §2.3 component 5 (p. 9) requires refinement to leave points and the image list unchanged. Filip line 154 says only `images.txt` may differ, while lines 236–237 and 271 discuss the model without a machine-checkable allowed-delta definition.

Why it matters:  
A writer may rename an image, reorder records, change its camera reference, drop the mandatory empty observation line or silently mutate untargeted poses and still pass a file-level “only `images.txt` changed” assertion.

Smallest fix:  
Represent refinement as a pose delta keyed by `IMAGE_ID` and validate it before writing. Permit only `qvec` and `tvec` changes. Require exact equality of camera records/intrinsics, point records, image ID set and order, names, camera references, observation state, asset mapping and all untargeted poses.

Classification:  
missing correctness requirement

### 5. Ordering, numeric formatting and tolerance policies are still undefined

Severity:  
Major

Challenge:  
The proposal identifies serialization noise as a risk but never selects a deterministic policy for record order, floating-point encoding, negative zero, quaternion sign, numeric comparison or newlines.

Evidence:  
Filip lines 76, 157–163 and 272 mention the ambiguity without resolving it. The current recorder serializer emits arrays in caller order and uses locale-independent JavaScript `String(n + 0)` for floats (`colmap-serializers.ts:102–111, 126–145`). Both fixtures are UTF-8/LF-only; `images.txt` record order is ascending by image ID even though ZIP image entry order is descending. Fixture quaternions are unit length within floating precision, and the second fixture legitimately contains negative `qw` values.

Why it matters:  
Map/object iteration or ZIP enumeration can create noisy or nondeterministic output. Low-precision formatting can perturb poses. Locale-dependent decimal commas can make output unreadable. Sign-canonicalizing all quaternions can destroy byte fidelity even though `q` and `-q` describe the same rotation.

Smallest fix:  
Preserve input sparse-record order, never derive it from ZIP order or filename ordinal, and define a locale-independent round-trip-safe float format. Validate integers rather than defensively rounding them. State absolute-plus-relative numeric tolerances, compare rotations sign-invariantly, preserve original lexemes on archive no-op, and explicitly choose normalization/sign behavior for newly generated poses.

Classification:  
unclear contract

### 6. The accepted text grammar and failure behavior are not contract-complete

Severity:  
Major

Challenge:  
“Fail closed” is a principle, not a parser contract. The accepted field arities, ID/range rules, reference checks, blank-line handling, error taxonomy and output-on-failure guarantee are missing. Binary/text coexistence is also undefined.

Evidence:  
Filip lines 83, 226–237 and 246 list broad unsupported cases. Verified recorder output is narrower: one `PINHOLE` camera with four parameters; each image has a 10-field pose line followed by an empty `POINTS2D` line; each point has exactly eight fields; comments contain non-authoritative counts (`colmap-serializers.ts:67–134`). Both fixtures have two final LFs in `images.txt`, so removing all blank lines destroys record structure. The assignment says `.bin` is nice-to-have and LichtFeld can read text or binary, but no precedence is established when both exist.

Why it matters:  
A parser can mispair image records, silently round malformed IDs, accept a missing camera reference, or preserve a stale `.bin` model beside rewritten text that LichtFeld may prefer. A generic thrown string gives neither callers nor tests a stable failure contract.

Smallest fix:  
Add an accepted-subset grammar table and typed errors such as `{code, path, line, field, message}`. Require positive safe-integer IDs/dimensions, finite numbers, exact parameter counts, unique IDs/names, valid camera/image references and mandatory empty observation/track state. Treat header counts as comments. Reject any `.bin` model in iteration 1, including text/binary coexistence. Guarantee no output artifact on validation/write failure.

Classification:  
missing correctness requirement

### 7. Archive safety and preservation need a small normative rule, not labels

Severity:  
Major

Challenge:  
“Safe entry access,” “payload identity” and “snapshot/manifest” are ambiguous. It is not stated whether identity concerns decompressed file bytes, compressed ZIP records or metadata, and no path-collision policy exists for Windows materialization.

Evidence:  
Filip lines 81–82, 132, 154, 163 and 256 use those terms without definitions. The two fixtures contain no explicit directory entries; `images/` and `sparse/0/` exist as path prefixes. Their ZIP entry order differs from model order. The assignment requires a corrected ZIP LichtFeld can consume, not byte-identical ZIP containers.

Why it matters:  
One implementation may attempt impossible raw compressed-record preservation; another may reject a valid fixture for lacking directory records. Duplicate normalized paths, `..`, absolute paths or case-colliding names can overwrite files when staged for Windows LichtFeld. A hash-only manifest cannot reproduce unknown payloads.

Smallest fix:  
Define fidelity as the same normalized file-entry name set plus identical decompressed bytes for every untouched entry. Explicitly exclude entry order, compression, timestamps, comments and directory records unless Simon requests them. Retain an opaque byte source/archive handle, reject unsafe relative paths and duplicate/case-colliding normalized names, and impose modest entry/total-size limits.

Classification:  
unclear contract

### 8. World-gauge preservation is necessary but not sufficient for point-cloud validity

Severity:  
Major

Challenge:  
The proposal correctly detects arbitrary solver gauge, but its smallest fix implies that alignment back to the input gauge restores camera/point registration. It does not. Local pose corrections can remain in the exact original gauge while the unchanged occupancy cloud, generated using the old poses, becomes a stale seed.

Evidence:  
Filip lines 16, 66, 85, 98 and 166–172 discuss gauge and registration. Assignment §2.5.2 (p. 10) explicitly warns that the occupancy cloud was unprojected with the old poses and can be stale after a large correction. The current exporter applies the same `G = diag(1,-1,-1)` to original cameras and points (`colmap-conversions.ts:109–133`; `colmap-zip-contributor.ts:162–184`), proving only original convention consistency. The fixtures contain no 2D observations/tracks, so they cannot verify post-refinement camera/point correspondence.

Why it matters:  
A solver can return correctly gauge-aligned cameras that have moved substantially relative to the fixed seed cloud. All relative-pose and gauge tests can pass while LichtFeld initialization becomes worse.

Smallest fix:  
State three separate facts: the `points3D.txt` payload remains unchanged; output poses must use input world frame and scale; neither guarantees physical seed-cloud validity after local correction. Require an explicit `Sim(3)` alignment record only for adapters that solve in another gauge, record correction magnitude/stale-cloud risk, and let the paired harness decide benefit. Use synthetic known-correspondence tests for convention math; do not claim Task 1 points validate registration.

Classification:  
missing correctness requirement

### 9. Coordinate protection is good but not yet normative enough

Severity:  
Major

Challenge:  
World-to-camera, quaternion order and camera-center math are correctly stated, but the contract omits the full camera-axis/handedness convention, matrix/vector convention, source-unit/no-rescaling rule and actual quaternion acceptance behavior.

Evidence:  
Filip lines 33, 52–53, 84 and 237 correctly warn against a second WebXR conversion and name world-to-camera semantics. The verified repository contract is more precise: COLMAP camera coordinates are +X right, +Y down, +Z forward; `X_camera = R X_world + t`; qvec is `[qw,qx,qy,qz]`; the persisted world already has the shared `G` basis applied (`colmap-conversions.ts:30–43, 53–76, 79–133`). Filip says only “non-unit beyond a stated tolerance,” but states no tolerance or normalize/reject policy.

Why it matters:  
An implementation can use the correct quaternion tuple order but transpose `R`, use a camera-to-world library API, rescale translation or silently normalize malformed input. Identity-only tests will not catch several of these mistakes.

Smallest fix:  
Add one normative convention block covering axes, handedness, column/row-vector multiplication, quaternion-to-library mapping, source units with no rescaling, `tvec` versus camera center, and validation/normalization rules. Pin it with identity, translated and non-trivially rotated synthetic tests plus sign-invariant quaternion equivalence.

Classification:  
missing correctness requirement

### 10. The measurement harness is a requirements list, not an experiment contract

Severity:  
Major

Challenge:  
The proposal names the right provenance fields but defines no `ExperimentSpec`, `ExperimentReport`, required/optional fields, comparability predicate, versioning rule or closed run status.

Evidence:  
Assignment §2.2 and §2.3 component 3 (pp. 7–8) require an agreed harness interface before refinement. Filip lines 88, 141, 184–190 and 276 say a future manifest should contain dataset identity, split, build/version, settings, repeats, environment and preprocessing, but give no schema or acceptance semantics. Lines 257–259 leave central policies unresolved.

Why it matters:  
Two reports can differ in training resolution, iterations, binary build, image split, preprocessing or missing output while both look “provenance rich.” A warning may be treated as non-fatal by one implementation and invalidate comparison in another.

Smallest fix:  
Define a small versioned, LichtFeld-specific experiment spec and report now. Include source/archive and model identities, exact split, visibility policy, trainer/build manifest, complete effective configuration, repeat policy, metric policy, artifact hashes and closed statuses such as `completed`, `invalid-comparison`, `failed` and `unsupported`. A candidate may be ranked only when both paired manifests match except for an explicitly permitted pose delta and all required artifacts exist.

Classification:  
unclear contract

### 11. Held-out PSNR/SSIM assumes an unverified rendering capability

Severity:  
Major

Challenge:  
No permitted evidence proves that LichtFeld v0.4.2 can programmatically render a trained splat from an exact supplied COLMAP camera and export the resulting image. The proposal assigns training and metrics but no component owns this essential operation.

Evidence:  
Assignment §2.3 component 3 (p. 8) requires held-out rendering. Filip lines 139–140 assign dataset materialization/training to a LichtFeld adapter and pair comparison to metric evaluators, but omit render-at-specified-view. Task 1 review lines 7–53 and 111–128 prove only two v0.4.2 training/viewer smoke tests; no exact-camera render command or API is recorded. `AGENTS.md` forbids assuming undocumented LichtFeld behavior.

Why it matters:  
Without a predicted image at the declared held-out pose, neither PSNR/SSIM nor a controlled A/B artifact exists. An interactive screenshot from an approximate view is not a comparable metric input.

Smallest fix:  
Make exact-view rendering an explicit operation of the LichtFeld adapter and verify it before committing the metric contract. If v0.4.2 cannot provide it, the harness must return a typed `unsupported` result and surface a human decision; it must not invent commands or silently use viewer screenshots.

Classification:  
unsupported assumption

### 12. The split and visibility policy are not operational, and “strict unseen” is overstated

Severity:  
Major

Challenge:  
The split universe, materialization procedure and visibility matrix are undefined. The recommended strict policy is also stronger than the assignment and cannot currently prove that the held-out view is unseen, because the shared occupancy seed may already contain full-session depth/RGB information with no per-frame provenance.

Evidence:  
Assignment §2.3 component 3 requires frames held out from LichtFeld training; §2.5.5 (p. 11) allows held-out poses to be refined when the comparison remains frozen and fair. Filip lines 101, 190, 202–208 and 258 recommend hiding evaluation RGB from both refinement and training but do not define materialization. Fixture evidence is decisive: the ZIPs contain 12/18 JPEGs but only 11/17 `images.txt` records; in each, `frame-000001.jpg` is unreferenced and has no pose. The exporter builds points from a session occupancy grid without per-image tracks (`colmap-zip-contributor.ts:134–184`).

Why it matters:  
Enumerating `images/` can select an unposed JPEG. Leaving held-out rows/assets visible to training causes leakage. Calling the result “strict unseen-view generalization” is misleading if the fixed seed contains information derived across the capture. The stricter policy can also bias the later algorithm comparison against methods that naturally use all images for pose refinement.

Smallest fix:  
Define eligible views as exactly the `images.txt` records whose `NAME` resolves to an asset; preserve but exclude unreferenced JPEGs. Partition by stable image ID and name, use the identical manifest for baseline/candidate, and specify how evaluation RGB is withheld from training while its pose is retained for rendering. Record separate visibility for trainer, refiner and seed cloud. Treat training-only holdout and strict RGB-to-refiner holdout as separately labelled protocols for Simon to choose, never pooled as one benchmark.

Classification:  
missing correctness requirement

### 13. PSNR, SSIM and controlled A/B are named but not defined

Severity:  
Major

Challenge:  
“Exact preprocessing” and “comparable output” are placeholders. Color space/range, orientation, resize/resampling, crop/mask/background, SSIM implementation, aggregation, coverage and view pairing are all absent.

Evidence:  
Filip lines 190 and 276 mention image-pair preprocessing, per-view values, aggregates and fixed A/B viewpoints but select no policy. Assignment §2.5.5 requires the same held-out frames and frozen training settings. The Task 1 screenshots are uncontrolled viewer captures, not exact reference/prediction pairs.

Why it matters:  
Library defaults, a favorable crop or omission of failed views can manufacture a numerical improvement. Baseline and candidate screenshots from slightly different cameras can look persuasive while proving nothing.

Smallest fix:  
Freeze one versioned pixel policy: orientation, resolution/resampler, sRGB or linear domain, numeric range, full-frame or named mask, background and invalid-pixel handling, SSIM implementation/constants and coverage. Report every paired view before one stated aggregate. Match quantitative and visual artifacts by the same image ID/name and a fixed camera/view manifest with identical renderer settings.

Classification:  
unclear contract

### 14. Reproducible LichtFeld build/recipe work is missing from the concrete minimum

Severity:  
Major

Challenge:  
The proposal remembers provenance but does not make the assignment’s source-build, same-release comparison and repeatable training recipe a distinct Goal 1 deliverable with acceptance criteria.

Evidence:  
Assignment §2.3 component 2 (p. 8) requires building the same release tag as the Task 1 prebuilt, recording exact commands/layout/resolution settings, comparing source and prebuilt outputs and checking repeated-run comparability. Task 1 records only LichtFeld v0.4.2. Filip line 239 requires merely a v0.4.2 no-op smoke check; line 249 defers automation; the proposed plan outline at lines 263–280 has no separate reproducible-build/recipe component.

Why it matters:  
Different source revisions, binaries or effective defaults can change output enough to be mistaken for a pose improvement. A rich report cannot repair an unestablished baseline recipe.

Smallest fix:  
Keep automation deferred, but retain a manual reproducibility record as a separate Goal 1 component: exact tag/commit, prebuilt artifact identity, source-build identity, complete effective command/config/layout, environment essentials, repeated-run comparison and source/prebuilt parity result. Record a seed only if the verified build actually exposes one.

Classification:  
missing correctness requirement

### 15. The generic evidence/provider architecture is premature and not algorithm-neutral

Severity:  
Major

Challenge:  
The proposal replaces vague `signals?` with an “evidence/constraint provider,” then requires constraint/inlier coverage in common diagnostics. That silently favors graph/feature methods even though the assignment keeps external COLMAP and trainer-side photometric optimization open. It still supplies no async/effectful refiner signature.

Evidence:  
Filip lines 86–87, 100, 121–125, 135–139, 175–181 and 217 propose the provider and universal diagnostics. Assignment §2.3.4–§2.3.5 (pp. 8–9) explicitly defers algorithm choice and allows in-process, external-tool and trainer-backed candidates behind one replaceable boundary.

Why it matters:  
A trainer-backed optimizer may have losses and checkpoints rather than constraints/inliers; an external tool needs filesystem/process context and asynchronous failure handling. Stabilizing the wrong provider hierarchy now either excludes viable candidates or forces a rewrite after the research gate.

Smallest fix:  
Specify only the common refiner invariants and a typed async-capable request/result boundary now: model, resolved image-asset access, versioned algorithm configuration, status, changed image IDs, pose delta and provenance. Keep pure pose math inside an implementation. Defer algorithm-specific constraints, inliers, external-tool fields and provider types until a candidate is selected.

Classification:  
unnecessary complexity

### 16. The independent test strategy does not yet prove the harness or pose contract

Severity:  
Major

Challenge:  
The proposal names fixture replay and non-identity tests but does not allocate the synthetic/fake evidence needed for metrics, orchestration failures, pose-only deltas or gauge adapters. Task 1 fixtures cannot supply expected PSNR/SSIM, geometric correspondences or ground-truth corrected poses.

Evidence:  
Assignment §2.3 components 1, 3 and 5 require unit tests on known inputs plus replay tests. Filip lines 237–240 and 277 mention broad tests only. In both fixtures every image observation line is empty; every point row has exactly eight fields, placeholder `ERROR=1` and no track. Task 1 supplies no exact-pose prediction images or ground-truth camera trajectory.

Why it matters:  
An incorrect color range, quaternion conversion, missing-view aggregation or error-state transition can still pass an end-to-end smoke run. Demanding “metric no worse” from an unselected algorithm makes tests nondeterministic and conflates integration with quality research.

Smallest fix:  
Use synthetic COLMAP models with known non-identity transforms for codec/pose/gauge tests; tiny known image pairs for metric math; and fake trainer/renderer adapters for orchestration, timeout, missing-artifact and comparability tests. Use Task 1 ZIPs for archive/model integration, split/materialization, reprojection `N/A` and manual LichtFeld smoke only.

Classification:  
missing correctness requirement

### 17. The minimum iteration requires a recorded configuration that the same proposal says is missing

Severity:  
Minor

Challenge:  
The proposed included scope requires a LichtFeld v0.4.2 smoke check “under a recorded configuration,” but the evidence ledger and human questions say that command/settings/seed/environment cannot currently be recovered.

Evidence:  
Filip lines 77 and 259 list missing training provenance; line 239 makes recorded configuration part of the minimum acceptance.

Why it matters:  
The iteration can be declared blocked or accepted depending on whether “recorded” means the old Task 1 run or a newly established baseline.

Smallest fix:  
State explicitly that the smoke check must establish a **new canonical recorded configuration** if the old command cannot be recovered. Do not imply that the Task 1 run is reproducible evidence.

Classification:  
unclear contract

### 18. Fixture-to-result mapping is recoverable; the proposal overstates missing provenance

Severity:  
Minor

Challenge:  
The proposal says the mapping between fixtures and Task 1 training results is unrecorded. The permitted repository history makes that mapping conclusive, although the command/configuration remains missing.

Evidence:  
Filip lines 77 and 259. On the `TaskOne` branch, the original ZIPs are named `2026-07-09_15-46-36utc.zip` and `2026-07-09_15-47-48utc.zip`; their Git blob IDs exactly match current `first-capture.zip` and `second-capture.zip`, respectively. Task 1 review lines 7–9 and 51–53 label the same timestamps with final errors `0.0282` and `0.0434`. Therefore `first-capture.zip` maps to `15-46-36`/`0.0434`, and `second-capture.zip` maps to `15-47-48`/`0.0282`.

Why it matters:  
Treating recoverable provenance as lost creates an unnecessary human question and can lead to relabelling or duplicating existing evidence.

Smallest fix:  
Record the recovered mapping and its Git blob identities. Continue to mark commands, settings, build identity, hardware and seed availability as unknown.

Classification:  
unsupported assumption

### 19. “All three sparse files or none” overstates repository guarantees

Severity:  
Minor

Challenge:  
The exporter emits zero files on precondition failure and attempts three on the success path, but no permitted evidence proves transactional rollback after an `addFile` I/O failure.

Evidence:  
Filip line 50 states “all three text files or none.” `colmap-zip-contributor.ts:98–145` validates before writing, then awaits three sequential `addFile` calls. There is no rollback in that component.

Why it matters:  
Treating atomicity as verified behavior can make the new reader assume partial sparse models are impossible. A failed export or damaged ZIP can still be partial.

Smallest fix:  
Say: “On successful contribution it writes all three; a known precondition failure writes zero; transactionality on I/O failure is not established.” Keep partial sparse models as explicit invalid input.

Classification:  
unsupported assumption

## What is already sound

- The recorder ZIP is correctly treated as the external input/output, while `sparse/0` plus model-referenced images is the interpreted COLMAP dataset seam.
- The proposal clearly distinguishes persisted COLMAP world-to-camera poses from recorder-side WebXR camera-to-world conversion and correctly forbids applying that conversion again.
- `X_camera = R X_world + t`, quaternion order `[qw,qx,qy,qz]`, and camera center `C = -R^T t` are correct and worth preserving.
- Narrow, fail-closed support for the observed recorder text subset is appropriate for the first iteration. Binary/general COLMAP support is not required now.
- Intrinsics and `points3D` should remain unchanged as the initial experimental control, with the added gauge and stale-seed caveats above.
- Preserving action logs, `session.json`, unknown entries and unreferenced JPEGs is sensible. Both fixtures prove why rebuilding only from model references is unsafe.
- Reprojection error is correctly `N/A` for current fixtures. The constant point `ERROR=1` and LichtFeld final-error scalar are invalid substitutes.
- The proposal correctly refuses to select a refinement algorithm or assume LichtFeld pose optimization exists.
- Paired baseline/candidate runs, frozen settings, per-view outputs, provenance and controlled A/B artifacts are the right harness principles.
- It correctly notes that both Task 1 fixtures show the same charging-station scene and cannot satisfy the assignment’s eventual multi-scene proof.

## Features that should remain

- Recorder-specific text subset with explicit unsupported-input errors.
- One named, typed world-to-camera pose representation.
- Reference resolution by `images.txt` `NAME`, never ZIP order or filename ordinal.
- Exact preservation of untouched non-model archive entry payloads.
- A machine-checked “only image extrinsics may change” invariant.
- Input-world-frame/scale preservation for corrected poses.
- Capability-aware metrics with typed unavailable reasons.
- Paired experiment provenance and rejection of undeclared baseline/candidate differences.
- Synthetic non-identity math tests plus Task 1 ZIP replay.
- Research/review as the gate before choosing a refinement algorithm.

## Features that should be simplified

- Collapse archive adapter, dataset snapshot owner and corrected writer into one recorder ZIP boundary.
- Keep the `ColmapModel` independent of archive state and LichtFeld staging.
- Use one forced semantic codec round trip plus archive copy-through tests; do not build token-preserving machinery merely to make all sparse text byte-identical after re-encoding.
- Keep four public components: ZIP adapter, text codec, refiner port and measurement harness. Trainer invocation, rendering and metric functions can initially be typed sub-boundaries inside the harness.
- Use one versioned LichtFeld experiment manifest/report rather than a generic experiment framework.
- Keep common refiner diagnostics minimal. Algorithm-specific constraints, inliers, losses and solver state belong to the chosen adapter later.
- Use separate small component plans after agreeing the shared seam instead of a speculative 16-section monolith.

## Features that should be deferred

- Binary COLMAP, multiple cameras/models, populated observations/tracks and general external-COLMAP compatibility.
- Action-log parsing, GPS, depth, ICP and occupancy-cloud regeneration.
- Feature extraction/matching, loop closure, bundle adjustment, pose graphs and algorithm-specific evidence providers.
- Any assumption or modification concerning LichtFeld pose optimization.
- Intrinsic refinement, recorder/exporter changes, georeferencing and orientation cosmetics.
- Generic multi-trainer support and statistical-significance machinery beyond the assignment’s repeated comparability check.
- ZIP-container metadata fidelity beyond names plus decompressed bytes of untouched entries.
- A strict unseen-to-refinement benchmark unless Simon explicitly selects it and its seed-data visibility can be described honestly.
- Automated LichtFeld build orchestration. The assignment-required reproducible manual build/recipe itself is not deferred.

## Minimum safe version of Filip’s proposal

The minimum safe candidate is much smaller than Filip’s nine-boundary architecture. This is a contract and acceptance boundary, not an implementation task list:

1. **Recorder ZIP adapter**
   - Accept only unique, safe relative file-entry names.
   - Require the exact three text sparse files and every JPEG referenced by a model image record.
   - Preserve every untouched entry’s name and decompressed bytes, including unreferenced images and recorder-specific content.
   - Expose an opaque source handle, typed model and name-resolved image assets; never expose archive mutation to the refiner.

2. **COLMAP text codec**
   - Support exactly the verified one-`PINHOLE`, empty-observation/empty-track recorder subset.
   - Preserve sparse record order; encode finite values deterministically and locale-independently.
   - Reject malformed/unsupported data with typed, location-aware errors.
   - Prove parse → encode → parse semantic equality independently of archive copy-through.

3. **Pose-delta/refiner contract only**
   - Async-capable typed request/result; no implementation or selected algorithm yet.
   - Permit only `qvec`/`tvec` changes keyed by existing image ID.
   - Return distinct `updated`, `unchanged`, `insufficient-evidence` and `failed` outcomes.
   - Require input world frame/scale and explicit alignment evidence only when an adapter solves in another gauge.
   - Keep pure convention/validation math separate from effects.

4. **Measurement contract only**
   - One versioned paired experiment spec/report with archive/model hashes, referenced-view split, visibility policy, exact LichtFeld build and effective settings, repeat policy, renderer/pixel policy, per-view artifacts/metrics, aggregate, logs and closed status.
   - Report reprojection as unavailable with reason for current fixtures.
   - Return `unsupported` until exact-view LichtFeld rendering is verified.

5. **Iteration-1 acceptance boundary**
   - Production scope is limited to the ZIP adapter and text codec; the refiner and harness remain contract-only.
   - Acceptance evidence covers grammar, failures, numeric/convention behavior and forced semantic round trips on synthetic inputs.
   - Both Task 1 ZIPs replay successfully, opaque entries remain preserved, and one no-op output completes a recorded LichtFeld smoke check under a newly established canonical configuration.
   - The reproducible v0.4.2 source-build/recipe and harness remain mandatory Goal 1 outcomes before any refiner implementation.

This provides the same first-iteration value with less architecture: a safe recorder-ZIP seam that can be tested now, plus stable but deliberately small future ports.

## Questions requiring human or Simon decisions

1. Does archive fidelity mean identical decompressed contents for untouched file entries, explicitly excluding ZIP order, compression, timestamps, comments and directory records?
2. Is the primary evaluation protocol training-only holdout with refinement allowed to see evaluation RGB, or strict RGB withholding from both refinement and training? If both are wanted, they must be reported separately.
3. If the selected final method remains track-free, must the team create an independent frozen correspondence evaluator, choose another geometric metric, or may the reprojection axis remain permanently `N/A`?
4. Is an async/effectful refiner port with pure internal math accepted as the practical interpretation of the assignment’s schematic “pure transform” language?
5. Is LichtFeld v0.4.2 the canonical Goal 1 comparison build, and is a documented manual exact-view render procedure acceptable if no programmatic renderer exists?
6. Is the first codec intentionally recorder-specific and fail-closed for binary models, other camera models and populated tracks?
7. What minimum alignment evidence will Simon require if a later solver works in an arbitrary `Sim(3)` gauge?
8. Which additional scene or scenes will supply the assignment’s eventual more-than-one-scene proof?

The following are engineering decisions, not Product Owner questions: exact parser grammar, error types, deterministic ordering/float policy, path safety, allowed pose-only delta and unit-test cases. The team should resolve those in the contract rather than escalate them as product ambiguity.
