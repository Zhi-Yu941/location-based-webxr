# Task 2 contract planning audit

Status: independent Codex draft for team and Product Owner review. This is an audit, not the official plan and not an algorithm decision.

Evidence inspected: `AGENTS.md`; the 12-page SoftwareLab assignment; `task1-review.md`; files under `GpsPlusSlamJs_RecorderApp/src/colmap/`; and only the ZIP entry structure plus `sparse/0/*.txt` from the two Task 1 fixtures. The Gemini draft, comparison review and official Task 2 plan were not read.

## Audit conclusion

The proposed COLMAP seam is directionally correct and follows the assignment. It is not yet contract-complete.

The highest-risk gaps are:

- "faithful round trip" does not define archive versus model fidelity;
- the typed model omits image assets and archive-preservation state needed by downstream components;
- `refine(model, signals?)` hides required evidence and assumes a pure implementation that some candidate approaches cannot provide;
- keeping `points3D` unchanged is safe only if the refined poses remain in the input model's world frame;
- `model -> metrics` is too small a harness interface;
- baseline reprojection error is not computable from the supplied recorder model because both 2D observations and point tracks are empty;
- the held-out-view protocol and LichtFeld run controls are not defined well enough to support a causal "refinement improved quality" claim.

The minimum first iteration should therefore be the text-format reader/writer and archive-preservation slice only. Contracts for refinement and measurement should be recorded now, but no refinement algorithm should be selected or implemented in that iteration.

## 1. What the assignment explicitly requires

### Required direction and sequence

- Work plan-first, with a component plan stating the problem, goals, requirements, success criteria, architecture and open questions before production code (assignment p. 3).
- Complete Goal 1 - tooling, reproducible training, measurement and research - before Goal 2, the chosen refinement implementation (pp. 6-9).
- Build the COLMAP reader/writer and measurement harness before refinement, and use the research/proposals review as the gate before choosing an approach (p. 8).
- For initial iterations, use the recorder ZIP as the sole external input/output contract and do not modify the recorder or exporter (p. 7).
- Treat `sparse/0/{cameras,images,points3D}.txt` plus `images/` as the clean COLMAP seam; action logs are recorder-specific optional signals for later work (p. 7).
- Parse the model into typed structures and support a faithful unchanged load/save round trip. Text is required; binary is explicitly nice-to-have (pp. 7-8).
- Keep coordinate conversion and pose math isolated and unit-tested. Persisted `images.txt` poses are COLMAP world-to-camera transforms with quaternion order `[qw,qx,qy,qz]` and translation `[tx,ty,tz]` (pp. 7, 10).
- Define an independently testable refinement component with a stable COLMAP-in/COLMAP-out boundary. An external tool, if selected later, must be hidden behind that boundary and replaceable in tests (p. 9).
- Define a harness that compares baseline and refined runs with a fixed split and frozen training settings, reporting held-out PSNR/SSIM, a geometric measure when available, and controlled visual A/B artifacts (pp. 8, 11).
- Test pure logic with unit tests and replay real Task 1 ZIPs end-to-end without re-recording. Each component also needs a small standalone demonstration (pp. 4, 7-9).
- The eventual product claim must be demonstrated on more than one scene, numerically and visually, against a no-refinement baseline (pp. 9-10).

### Assignment recommendations, not accepted decisions

- Refine image extrinsics only; leave intrinsics and the occupancy `points3D` cloud unchanged.
- Prefer global/offline correction over per-frame tweaks.
- Consider TS pose graph plus visual loop closure, external COLMAP SfM/BA, and trainer-side joint pose optimization as options. The stated TS lean is explicitly still subject to research and review.
- Defer GPS/depth action-log signals, recorder changes, geo-referencing, binary COLMAP support and LichtFeld modifications to later iterations unless evidence changes priority.

## 2. Evidence ledger

### Verified facts

- The current exporter writes all three `sparse/0` text files or none. It skips the sparse model when projection data, usable frame dimensions or valid intrinsics are unavailable. An empty `points3D.txt` is still a supported exporter result (`colmap-zip-contributor.ts:98-145`).
- The current exported subset is one shared `PINHOLE` camera. `images.txt` has a pose line followed by an empty `POINTS2D` line. `points3D.txt` has XYZ/RGB/error fields and no track entries (`colmap-serializers.ts:71-133`).
- The current exporter converts WebXR camera-to-world poses to already-persisted COLMAP world-to-camera poses. It applies `G = diag(1,-1,-1)` consistently to the selected world basis and point positions. Task 2 must not apply the WebXR-to-COLMAP conversion again (`colmap-conversions.ts:53-133`).
- `tvec` is not camera position. For stored rotation `R` and translation `t`, `X_camera = R X_world + t` and camera center is `C = -R^T t`.
- Both fixtures use the same camera line: one `PINHOLE` camera, portrait size `823 x 1920`, camera ID 1.
- First fixture: 12 JPEG entries, 11 image records, 820 points. Second fixture: 18 JPEG entries, 17 image records, 1026 points. In both, `frame-000001.jpg` is present but unreferenced; image ID 1 names `frame-000002.jpg`. Every referenced JPEG exists.
- Every fixture image record has an empty second line. Every point row has exactly eight fields, error `1`, and no track. The reported `ERROR` is therefore a placeholder, not measured reprojection error.
- Fixture filenames are bare and unquoted. Current serializer code also emits bare, unquoted names (`colmap-serializers.ts:107`; `colmap-zip-contributor.ts:128-132,188-191`).
- Task 1 records two successful LichtFeld v0.4.2 smoke tests. Both splats were recognizable but visibly ghosted/smeared/doubled despite reported final errors of `0.0282` and `0.0434`. This proves basic pipeline feasibility, not pose correctness, reproducibility or metric validity.
- No permitted evidence establishes that LichtFeld pose optimization exists or that the reported LichtFeld final-error scalar measures visual quality.

### Assumptions requiring evidence

- Pose error is the dominant cause of the Task 1 artifacts. The review also names coverage, frame density, blur, lighting, reflections, vegetation and thin geometry, without isolating variables.
- The two fixtures are representative enough to select a refinement method.
- The current repository revision produced both fixtures and therefore defines their exact orientation convention.
- The occupancy cloud remains a useful initialization after every plausible pose correction.
- One shared `PINHOLE` camera remains the future recorder contract rather than only the current observed subset.
- A LichtFeld run can be made deterministic enough that one baseline/refined pair is conclusive.

### Unresolved questions and contradictions

- The assignment demands lower reprojection error as an eventual proof while also stating that recorder points have no feature tracks. The fixtures confirm there are no 2D-3D observations from which baseline reprojection error can be computed.
- `colmap-serializers.ts.md:29` says points remain in raw WebXR world coordinates, while current code, conversion documentation and ZIP-contributor documentation apply the shared Y/Z world rotation to points and extrinsics. The sidecar statement is stale or contradictory. It must not be used as the Task 2 convention.
- The current code claims its world rotation makes new exports upright, while the assignment warns of a possible upside-down cosmetic result and says not to chase it. No permitted downstream experiment establishes which fixture/exporter versions exhibit which behavior.
- Task 1 asks why names become quoted after the second `images.txt` record. Neither provided fixture nor current serializer reproduces that observation. Quote-specific behavior must not be treated as part of the current recorder contract without the originating file.
- The assignment alternates between semantic fidelity (same values within tolerance) and "byte-faithful enough." It does not define whether ZIP entry order, compression, timestamps, comments, whitespace, float lexemes or only model meaning matter.
- Task 1 does not record the complete LichtFeld command, settings, seed, hardware/environment or mapping between each fixture and each reported result.

### Proposed decisions for review

- Treat the recorder ZIP as an opaque archive shell containing one interpreted COLMAP dataset. Preserve every unmodified entry payload, including `actions/`, `session.json`, unknown entries and unreferenced images.
- Do not require binary identity of the ZIP container. Require payload identity for untouched entries and semantic equality for the accepted model subset; on a true no-op, preserve the three sparse text payloads unchanged as well.
- Scope iteration 1 to the observed recorder text subset. Reject unsupported camera models, non-empty observations/tracks, binary models and missing/incomplete sparse models with explicit diagnostics rather than silently normalizing them.
- Store and expose poses explicitly as world-to-camera. Provide any camera-center/camera-to-world view through one tested conversion boundary; never reuse recorder-side WebXR conversion in Task 2.
- Require the refiner output to remain in the input model's world gauge. If a later algorithm solves in another gauge, align its result back before writing while recording that alignment in diagnostics.
- Replace the untyped optional `signals?` idea with explicit refinement evidence or constraints. Image/depth/GPS processing belongs to separate providers, not inside the model codec.
- Separate the effectful refiner port from pure pose math. In-process algorithms may be pure; external COLMAP or trainer-backed algorithms cannot honestly be specified as a pure synchronous transform.
- Define the harness around an immutable experiment specification and a provenance-rich report, not just `model -> metrics`.
- Mark reprojection error `not available` until a method creates validated 2D-3D correspondences. Do not substitute the fixture's constant point `ERROR` or LichtFeld final error.
- Require any later geometric comparison to use the same frozen correspondence set, residual definition and outlier policy for baseline and refined poses.
- Make refinement outcome explicit: validated pose updates, insufficient evidence/validated no-op, or failure. "Improved" is a harness conclusion, not a refiner postcondition.

### Main risks

| Risk | Concrete consequence | Control needed in the contract |
|---|---|---|
| Double basis conversion or treating `tvec` as camera position | Mirrored/flipped/translated cameras with numerically valid quaternions | Named world-to-camera type and non-identity convention tests |
| Gauge drift while points stay fixed | Corrected trajectory becomes unregistered from the seed cloud | Original-world-frame invariant and gauge-alignment diagnostics |
| Archive reconstruction from the typed model | Loss of actions, session data, unknown entries or unreferenced JPEGs | Copy-through archive ownership and entry-payload checks |
| Hidden evidence dependencies | Refiner quietly reads ZIP, images or global state and cannot be tested independently | Explicit evidence/constraint boundary |
| Held-out leakage | Better PSNR/SSIM reflects use of evaluation images, not generalization | Split manifest and declared refiner visibility policy |
| Trainer nondeterminism/config drift | A random or configuration change is attributed to pose refinement | Frozen run manifest, repeat policy and tolerance |
| Metric substitution | Placeholder error is reported as geometry improvement | Capability-aware `N/A` metrics with reasons |
| Capture-quality confounding | A pose algorithm is selected to solve blur or poor coverage | Same-source paired A/B and several representative scenes |
| Over-general COLMAP claim | Parser appears reusable but corrupts unsupported models | Explicit accepted subset and fail-closed validation |

## 3. Proposed contract review

### Sound ideas

- The recorder ZIP is the correct external seam for initial work.
- Leaving recorder/exporter code untouched is both assignment-compliant and risk-reducing.
- Text `sparse/0` plus images is the correct first focus; `.bin` and action logs add no value to the first reader/writer proof.
- Model codec, pose math, external training and experiment orchestration should be independent.
- Unchanged intrinsics and points are a useful initial experimental control, provided the world-gauge invariant is added.
- A real no-op round trip and Task 1 replay are the right first evidence.
- Algorithm choice must remain behind the research/measurement gate.

### Premature decisions or claims

- A top-level "pure" refinement transform is premature because seeded candidates include external processes and trainer-side optimization. Purity is a requirement for internal math where applicable, not for every implementation adapter.
- `refine(model, signals?)` is not a usable contract: images are already needed by the recommended visual route, while depth/GPS/action-log access is later and platform-specific.
- Unconditional `points3D` pass-through is not safe for large corrections or a changed global gauge. It is a first-iteration invariant to test, not a universal truth.
- A generic COLMAP reader is broader than the observed recorder contract. Multiple cameras, other camera models, non-empty observations/tracks and binary files are unverified scope.
- A LichtFeld-backed pose optimizer is not a viable selected component without evidence that it exists and can export corrected poses. Improving only an internal training state would not satisfy the required corrected-COLMAP-ZIP seam.
- "Metrics no worse on all three axes" is not currently enforceable because one quantitative axis is undefined and visual A/B is not a scalar ordering.

### Missing interfaces and ownership

| Boundary | Owns | Must not own |
|---|---|---|
| Recorder archive adapter | ZIP validation, safe entry access, opaque-entry preservation, image asset references | COLMAP pose math or LichtFeld execution |
| COLMAP text codec | Parsing/serialization and accepted-subset validation | ZIP I/O, WebXR conversion or refinement |
| Dataset view | Typed model plus explicit image-asset mapping and original archive snapshot/manifest | Algorithm-specific constraints |
| Evidence/constraint provider | Feature matches, loop closures, depth/GPS-derived constraints when selected | Model serialization or training |
| Refiner port | Producing corrected extrinsics plus diagnostics/failure result | Archive mutation, hidden asset discovery or metric evaluation |
| Pure pose core | Coordinate conversions and selected optimization math | Filesystem/process access |
| Corrected-archive writer | Applying an accepted model delta while preserving all other payloads | Deciding whether a refinement is better |
| LichtFeld adapter | Dataset materialization, trainer invocation, timeout/cancellation and artifacts | Metric definitions or refinement selection |
| Metric evaluators | PSNR/SSIM and any evidence-backed geometric calculation | Training or dataset mutation |
| Measurement harness | Frozen experiment manifest, paired orchestration, provenance and report | Unrecorded defaults or algorithm logic |

No component in this plan owns recorder/exporter changes.

### Serious issues

Challenge:
The proposed writer can be interpreted as creating a new COLMAP-only ZIP from the typed model rather than correcting the original recorder ZIP.

Why it matters:
Both fixtures contain recorder-specific data and an unreferenced first JPEG. Rebuilding from model references would silently lose data, and later depth/GPS refinements would lose their own future inputs.

Smallest fix:
Make the original archive snapshot/manifest an explicit writer input. Copy every entry unless its path is deliberately replaced; for iteration 1 only `sparse/0/images.txt` may eventually differ.

Challenge:
"Faithful load -> save" has no testable definition.

Why it matters:
A semantically identical model can differ in comments, whitespace, numeric spelling, quaternion sign and ZIP metadata. Conversely, a byte-stable file can still carry a wrong pose convention.

Smallest fix:
Define three levels separately: archive-entry preservation, semantic model equality and pose equivalence. Do not require whole-ZIP byte identity. On no-op, require unchanged entry payload hashes; for rotations compare orientation sign-invariantly because `q` and `-q` are equivalent.

Challenge:
Keeping points fixed does not by itself keep cameras and points registered.

Why it matters:
A global optimizer may return an equally valid trajectory in a translated, rotated or scaled gauge. Writing those cameras beside points in the original gauge produces a worse dataset while every relative-pose test passes.

Smallest fix:
Add an output invariant: refined poses use the exact input world frame and scale. Require explicit alignment back to the input gauge and test camera-point registration with a non-identity fixture.

Challenge:
The refiner signature hides the signal that makes refinement possible and incorrectly requires every candidate to be pure.

Why it matters:
A pose graph without new constraints reproduces the input trajectory; visual loop closure needs JPEGs; COLMAP BA needs files/processes; joint trainer optimization may not emit a model. Hidden access creates coupling and makes unit tests dishonest.

Smallest fix:
Use a replaceable refiner boundary with explicit typed evidence/constraints and a result carrying diagnostics. Keep only its mathematical core pure. Require an algorithm candidate to demonstrate how it produces corrected COLMAP extrinsics before it can pass the research gate.

Challenge:
The harness boundary omits the variables that determine the result.

Why it matters:
Different image splits, trainer versions, flags, seeds, resolution, iteration counts, hardware or output-camera conventions can create an apparent improvement unrelated to poses.

Smallest fix:
Make the harness input an immutable experiment specification containing source dataset identity, split manifest, baseline/refined model identities, LichtFeld build/version, complete settings, seed/repeat policy, environment and exact image-pair preprocessing. Materialize baseline and candidate through the same dataset path and reject undeclared differences. Make the report include per-view values, aggregates, artifacts, warnings and all provenance.

Challenge:
The requested reprojection metric is undefined for current recorder fixtures.

Why it matters:
Using constant point error `1`, LichtFeld's final error, or invented correspondences would produce a credible-looking but invalid geometric claim.

Smallest fix:
Report reprojection error as unavailable with a machine-readable reason until validated feature tracks exist. Gate the reader/writer and initial harness on the metrics that are actually available; obtain Product Owner confirmation before changing eventual acceptance wording.

Challenge:
"Held out" is ambiguous if refinement can use every image before training.

Why it matters:
If held-out JPEGs contribute features or photometric residuals to refinement, PSNR/SSIM is a transductive consistency score, not unseen-view generalization. Comparing it to a strict baseline would be misleading.

Smallest fix:
Create the split before refinement and record what the refiner may see. Prefer a strict primary protocol that withholds evaluation RGB from both refinement and training; if an all-images/transductive protocol is useful, label and report it separately.

Challenge:
The refiner has no explicit insufficient-evidence or failure outcome.

Why it matters:
A capture with no reliable loop closures or correspondences may still yield a syntactically valid but arbitrary partial correction. A model transform cannot guarantee that its own result improves rendering.

Smallest fix:
Require distinct validated-update, validated-no-op/insufficient-evidence and failure outcomes, with constraint/inlier coverage, convergence, changed image IDs, warnings and provenance. Only the paired harness may decide whether an accepted output is better.

Challenge:
The current evidence supports only a narrow recorder subset, yet a broad typed COLMAP model can imply unsupported compatibility.

Why it matters:
Silently dropping non-empty observations/tracks, normalizing unknown camera models or accepting a partial sparse model can corrupt a legitimate external COLMAP dataset.

Smallest fix:
Name and validate the iteration-1 subset explicitly. Missing `sparse/0` is unsupported input, not an empty model; empty `points3D` is valid. Defer generic and binary support until it has its own evidence and acceptance cases.

## 4. Minimum first iteration

This is a scope slice and acceptance boundary, not an implementation task list.

### Included

- One component plan and reviewed contracts for the whole seam, with implementation scope limited to reader/writer plus archive preservation.
- Input: recorder ZIPs with the observed text subset under exact `sparse/0` paths and an `images/` directory.
- Typed, immutable representation of camera, image identity/reference and explicitly world-to-camera extrinsics; points and empty observation/track state represented or preserved without interpretation loss.
- Fail-closed validation for absent/partial sparse models, invalid references, duplicate IDs/paths, non-finite values, non-unit quaternions beyond a stated tolerance, unsupported camera/model variants and non-empty observations/tracks.
- No-op output that preserves every archive entry payload, including `frame-000001.jpg`, action logs and session metadata.
- Semantic round-trip checks on both Task 1 fixtures, non-identity coordinate-convention tests, reference checks by `NAME` rather than ZIP order or filename ordinal, and a LichtFeld v0.4.2 smoke check of one no-op output under a recorded configuration.
- Contract-only placeholders for the future refiner port and harness experiment specification; no refinement algorithm or claimed improvement.

The two fixtures are recordings of the same charging-station subject according to Task 1. They provide two replay cases but do not, by themselves, satisfy the eventual assignment proof on more than one scene.

### Deferred

- `.bin`, general COLMAP compatibility, multiple cameras/models, populated observations/tracks and filenames outside the verified recorder naming subset.
- Feature extraction/matching, loop closure, pose graphs, bundle adjustment, joint pose optimization and algorithm selection.
- Action-log parsing, depth/GPS signals, occupancy-cloud regeneration, intrinsics modification and recorder/exporter changes.
- Automated LichtFeld build orchestration, full metric harness, statistical evaluation and before/after quality claims.
- Orientation cosmetics, geo-referencing and migration of older ZIPs.

This is smaller than implementing reader/writer, refinement and harness together, and it satisfies the assignment's sequencing gate: establish the seam before depending on it.

## 5. Questions that materially block the plan

1. **Archive fidelity acceptance - Product Owner/team:** Must a corrected ZIP retain every original entry payload, including `actions/`, `session.json`, unknown entries and unreferenced images, with whole-container byte identity explicitly not required? Recommended answer: yes.
2. **Unavailable geometric metric - Product Owner:** May reprojection error be reported as `N/A: no correspondences` until a selected approach creates validated tracks, rather than blocking the reader/writer and early harness? Recommended answer: yes; never substitute either stored point error or LichtFeld final error.
3. **Held-out policy - Product Owner/team:** Is the primary quality claim strict unseen-view evaluation, where evaluation RGB is unavailable to both refinement and training, or a transductive all-images refinement evaluation? Recommended answer: strict primary protocol; report transductive results separately if needed.
4. **Baseline and fixture provenance - team:** What exact LichtFeld v0.4.2 command/settings/seed/environment produced each Task 1 result, which result maps to which fixture, and which exporter revision/orientation convention produced the ZIPs? If this cannot be recovered, may the team establish a new recorded canonical baseline instead? Recommended answer: establish a new baseline and record hashes/configuration rather than infer missing history.

Algorithm choice, pipeline form and LichtFeld pose-opt are important research questions, but they do not block the first reader/writer plan and therefore are not listed here as plan blockers.

## 6. Exact sections recommended for the first plan Markdown file

1. **Document status, owners and approval gate** - draft status, authors/reviewers, Product Owner decisions required, source precedence.
2. **Use case and problem statement** - why a recorder ZIP needs a safe COLMAP transformation seam.
3. **Authoritative evidence and contradictions** - assignment clauses, verified exporter/fixture facts, unresolved conflicts without silent resolution.
4. **Goals, non-goals and success criteria** - concrete iteration outcome and what it does not claim.
5. **Iteration-1 scope and deferred scope** - accepted text subset, archive boundaries, explicit later work.
6. **External recorder ZIP contract** - required/optional paths, opaque entries, image assets, invalid/unsupported cases and preservation guarantees.
7. **Typed COLMAP domain contract** - cameras, images, points, IDs/references, observations/tracks and immutability rules for the accepted subset.
8. **Reader/writer fidelity contract** - payload fidelity, semantic equality, numeric/rotation equivalence, deterministic output and error behavior.
9. **Coordinate and pose conventions** - world-to-camera equation, quaternion order, camera-center conversion, units, scale and world-gauge invariant.
10. **Component boundaries and dependency direction** - archive adapter, codec, dataset view, evidence provider, refiner, writer, trainer adapter, metrics and harness ownership.
11. **Algorithm-neutral refinement contract** - explicit evidence input, allowed model delta, diagnostics/failure semantics, gauge alignment and external-adapter rule; no chosen algorithm.
12. **Measurement experiment contract** - paired baseline/refined derivation through the same materialization path, split visibility, frozen trainer manifest, exact PSNR/SSIM preprocessing and aggregation, fixed A/B viewpoints, metrics with availability rules, repeat/tolerance policy, artifacts and provenance.
13. **Validation, test strategy and standalone demos** - pure convention tests, fixture round trips, archive preservation, negative cases and LichtFeld no-op smoke proof.
14. **Risks and smallest mitigations** - coordinate, gauge, archive loss, unsupported formats, leakage, nondeterminism and capture confounding.
15. **Open decisions, owner and decision deadline** - only questions that change the contract or acceptance criteria.
16. **Iteration estimate and actual completion field** - the assignment-required estimate after scope is accepted; no implementation task breakdown in this contract audit.

The plan should not contain a chosen refinement algorithm, production code, recorder changes or unsupported claims about LichtFeld pose optimization.
