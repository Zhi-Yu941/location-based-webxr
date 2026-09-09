# Refiner merge: plan-readiness review

Date: 2026-09-08. Reviewed `reviews/task2-refiner-technical-comparison.md`, especially sections 5-8, against the assignment, `OWNER_DECISIONS.md`, Simon's workflow, the accepted 1A boundary and current code. This is an advisory review, not an amendment to accepted decisions or an implementation plan.

**Verdict: ready to draft a bounded manual-experiment plan; not yet sufficient to execute and accept a candidate without interpretation.** The COLMAP-first direction is sound. Five Major corrections below make its acceptance and handoff precise without reopening the selected experiment or adding a production framework.

## Checks actually performed

| Check | Result | What it establishes |
|---|---|---|
| Existing reader/writer build and unit suite | Build passed; 7 files / 131 tests passed | Current infrastructure works under its existing contract, not that refinement works. |
| Read both Task 1 ZIPs independently using Python's ZIP library | First: 11 model images, 12 JPEGs, 820 points. Second: 17 model images, 18 JPEGs, 1,026 points. Both contain unreferenced `frame-000001.jpg`; model ID 1 names `frame-000002.jpg`. | Model membership differs from archive image membership. |
| Recompute both fixture hashes | Matched retained Task 1 hashes | The inspected fixtures are the established compatibility inputs. |
| Actual source validator with a nonempty image observation list | Rejected as `unsupported-profile` | The 1A codec/model validator cannot consume a full feature-bearing working reconstruction. |
| In-memory first-fixture edits through the freshly built public writer and reader | Pose change, dropped image, changed focal length and changed point XYZ all wrote and reopened successfully | Model validity does not enforce the future refiner's mutation restrictions. No ZIP was written to disk. |
| Synthetic symmetric epipolar-distance counterexamples | Correct, tenfold-baseline and reversed-baseline candidates all reduced error from 19.900744 px to 0; zero baseline was undefined | This metric cannot establish scale, translation sign or nondegenerate geometry. |
| Synthetic pooled-median counterexample | Pooled median improved 10 to 1 while one pair worsened 1 to 100 | An unspecified aggregation can hide a failed loop pair. |
| Synthetic W2C similarity-transform check | Camera centres and projections transformed consistently under a nonidentity rotation, translation and scale | Pose alignment must transform rotations and translations together. |

The standard `pnpm test` launcher initially failed while trying to prepare its pinned pnpm version. Direct dependency access also failed in the sandbox. The existing local build and Vitest executables then ran successfully with elevated local access, without installing packages. This review did not rerun formatting, lint or typecheck gates independently.

No `colmap` executable was discoverable on PATH. No COLMAP optimization or LichtFeld run was executed, and no new recording was demonstrated to have suitable visual overlap and drift. The 131 passing tests are infrastructure evidence only. COLMAP-specific checks below use official documentation and pinned 3.13.0 source as concrete examples, not as a claim about Mingna's still-unidentified installation.

## Findings

### 1. The primary geometry verdict is not yet a reproducible acceptance rule

**Severity:** Major

**Challenge:** Section 5.4 freezes correspondences and names median symmetric epipolar error, but does not define its formula, units, aggregation, degenerate cases or which supporting values can veto acceptance. Two reviewers can legitimately compute different verdicts.

**Evidence:** Sections 5.4 and 6; OD-016. The synthetic checks above demonstrate identical zero error for a correct baseline, a baseline ten times longer and a reversed baseline. A zero translation produces a zero essential matrix and undefined point-to-line distance. Pooling 100 correspondences from one pair and 10 from another hid a severe regression in the smaller pair.

**Why it matters:** An orientation correction can improve the score while a scale or cheirality error survives. An almost stationary start/end pair can make the primary metric unusable. A well-textured pair can dominate a pooled median. The existing high-level safety language intends to prevent these failures, but does not yet say how.

**Smallest fix:** Give the manual scorer one documented recipe: compute the fundamental matrix from each model's poses and fixed intrinsics, use one stated symmetric point-to-line formula and pixel convention, retain the same correspondence identities, and define per-pair reporting and aggregation. Do not independently refit a fundamental matrix and call that a pose score. Specify minimum usable support/parallax, positive-depth checks and which per-pair/trajectory regressions veto acceptance. Degenerate or insufficient evidence is `Inconclusive`, never zero error or a silently omitted pair. Freeze the numeric limits before inspecting the candidate. This is a small metric/check procedure, not a general evaluation framework.

**Classification:** unclear contract; missing correctness requirement.

### 2. The frame/scale requirement is both ambiguous and partly deferred

**Severity:** Major

**Challenge:** Section 6 says to verify the original ARCore frame, while section 7 postpones alignment until unsafe BA. Neither statement identifies the exact reference frame or the evidence that establishes scale. The first pose-only export already needs this protection.

**Evidence:** Section 5.3, section 6, final paragraph of section 7; OD-015 versus OD-018. In `GpsPlusSlamJs_RecorderApp/src/colmap/colmap-conversions.ts:76`, the exporter defines `G = diag(1,-1,-1)`, applies it to world-to-camera poses at line 113, and applies it to points at line 132. Raw WebXR coordinates therefore differ from the input ZIP's exported world coordinates. The accepted 1A contract section 9 prohibits another axis, origin or scale change. COLMAP 3.13.0's standalone BA explicitly fixes a gauge; this does not establish what another version does or prove that its chosen anchors preserve the intended recorder reference. [Pinned BA controller](https://github.com/colmap/colmap/blob/3.13.0/src/colmap/controllers/bundle_adjustment.cc#L82).

**Why it matters:** Aligning refined cameras to raw WebXR coordinates while leaving exported points alone applies the world flip to only one side. Initializing BA with metric camera positions is also not an independent measurement of metric scale. A similarity fit against a drifting trajectory can restore a chosen reference convention without proving physical accuracy.

**Smallest fix:** Say **the input ZIP's exported COLMAP world frame and inherited metric reference**. Before pose transfer, document the pinned version's gauge constraints or one verified alignment procedure, its anchor identities and failure conditions. Basic gauge verification is mandatory; stronger priors/alignment remain deferred. For a similarity `X_out = s Q X_work + a`, the W2C conversion is `R_out = R_work Q^T`, `C_out = s Q C_work + a`, `t_out = -R_out C_out`. Do not transform `tvec` as if it were a camera centre.

Preserving this global frame does **not** preserve every old point-to-image projection after a local pose correction. A synthetic 0.1 m camera correction changed a fixed point's projection by 20 px at 5 m depth with a 1,000 px focal length, with no global gauge change. This is not a reason to reject the assignment's unchanged-cloud policy: whether that conservative output helps splatting remains the later A/B research question, not a geometric guarantee.

**Classification:** unclear contract; missing correctness requirement; deferred research question.

### 3. The recorder-to-COLMAP-to-recorder handoff needs an explicit identity rule

**Severity:** Major

**Challenge:** The sequence names existing images and poses but omits the conversion between the recorder profile and COLMAP's working reconstruction. Reusing the archive owner does not define that conversion.

**Evidence:** Sections 5.2-5.3. Both fixtures contain an extra JPEG, and their image ID 1 does not name the first JPEG. COLMAP's known-pose instructions require model/database identity correspondence and describe an empty initial point model. More concretely, 3.13.0 `point_triangulator` defaults to clearing points and transcribing image IDs from database filenames. Thus numerical IDs must not be assumed stable across the tool boundary. [Known-pose workflow](https://colmap.github.io/faq.html#reconstruct-sparse-dense-model-from-known-camera-poses), [pinned triangulator entry point](https://github.com/colmap/colmap/blob/3.13.0/src/colmap/exe/sfm.cc#L492).

`Task2_Goal1A/src/colmap/validate.ts:154` and `:220` reject observations/tracks; `text-codec.ts:33` and `:56` use that validator. The direct source probe confirmed the rejection.

**Why it matters:** Extracting every archived JPEG can introduce images without registered recorder poses. Returning rows by numeric ID can attach one image's refined pose to another image. Passing the triangulated model through the strict 1A codec fails, while copying the whole COLMAP output into the recorder ZIP violates the conservative output policy.

**Smallest fix:** Add one handoff paragraph: use an explicit list of model-referenced image names, preserve extra archive assets opaquely, retain a checked filename-based mapping between original IDs and COLMAP IDs, and initialize a separate working model with fixed recorder intrinsics/poses and no occupancy tracks. After optimization, use COLMAP's supported export/API to obtain poses and map them back into the original typed model. Require a complete bijection and reject missing, duplicate or unexpected model images. Keep working tracks/points outside the recorder model. The archive adapter remains the only recorder ZIP owner; no general 1A codec expansion is needed.

Also record fixed-intrinsics settings at every relevant tool stage, not just in the final ZIP. COLMAP normally refines intrinsics during BA unless instructed otherwise. Copying the original camera back after optimizing against different intrinsics would produce an inconsistent pose-only candidate. [Fix intrinsics](https://colmap.github.io/faq.html#fix-intrinsics).

**Classification:** missing correctness requirement; unclear contract.

### 4. No component is assigned the pose-only safety comparison

**Severity:** Major

**Challenge:** The merge requires all safety gates, but does not say who compares the candidate with the original. Successful output reader validation is necessary and insufficient.

**Evidence:** Section 5.4 and OD-016. `Task2_Goal1A/src/colmap/round-trip.ts:106` validates the supplied model and verifies its serialization, not whether its edits are allowed by a refiner. Through that actual writer, all three prohibited refiner variants succeeded: dropping one model image, changing `fx`, and changing a point's X coordinate. This is appropriate reader/writer behavior, not a 1A defect.

**Why it matters:** A future wrapper can produce a perfectly readable ZIP with damaged invariants and mistake the writer's successful reopen for refiner acceptance. The same gap applies when a human copies poses during the manual experiment.

**Smallest fix:** Assign the original-versus-candidate comparison to the refiner acceptance procedure, before delivery and after serialization. It compares all non-pose model fields exactly under the accepted semantic contract, checks identity mapping and pose/frame safety, and verifies untouched archive payloads. The writer continues to own ZIP preservation. Use the existing comparison helpers where appropriate, excluding only intended pose differences; do not require no-op pose equality for a real refinement. Record a failed gate as `Rejected`, and unavailable required evidence as `Inconclusive`.

Clarify artifact timing too: section 5 permits a model or ZIP, but a ZIP-level gate needs a ZIP. A manual model-only result may support continued investigation; it cannot certify delivered ZIP preservation. Permit a reviewed one-off pose-transfer check before general workflow automation, or explicitly leave the delivery gate pending. Do not report unchecked gates as passed.

**Classification:** missing correctness requirement; unclear contract.

### 5. Good matches and many registered images do not prove that BA received loop constraints

**Severity:** Major

**Challenge:** The evidence list counts matches, registered images and observations but does not require proof that useful start/end constraints survive into the optimization. Its escalation order could blame SIFT for a triangulation or filtering failure.

**Evidence:** Sections 5.2, 5.4 and 7; OD-014/016/018. These cameras are registered at initialization, so their registration count is not proof of visual support. COLMAP 3.13.0's triangulator applies angle/error tests and can omit two-view tracks; its BA controller removes negative-depth observations before solving. Matching and surviving optimization residuals are different sets. [Pinned triangulator](https://github.com/colmap/colmap/blob/3.13.0/src/colmap/sfm/incremental_triangulator.cc#L441), [pinned BA filtering](https://github.com/colmap/colmap/blob/3.13.0/src/colmap/controllers/bundle_adjustment.cc#L75).

**Why it matters:** A recording can have strong start/end matches that do not triangulate under the drifted initial poses. BA then improves local tracks without receiving the intended loop-closing evidence. Unsupported cameras can remain in the model, and disconnected track components can retain separate freedoms despite a nominal global gauge choice. Lower solver cost alone does not diagnose this.

**Smallest fix:** Retain a small stage-by-stage table for the declared loop pairs: matched correspondences, geometrically verified correspondences, surviving triangulated cross-loop tracks and actual optimized support. Show which images have no usable observations and whether the relevant trajectory is connected through those tracks. Insufficient loop support makes the loop-refinement proof inconclusive. Diagnose the first stage that loses support before changing a matcher or adding priors. No custom track builder or graph framework is required.

**Classification:** missing correctness requirement; unsupported assumption.

## What should remain

Keep the manual offline COLMAP/SIFT proof, one deliberately chosen recording, measured exhaustive matching, fixed intrinsics, temporary working points, pose-only recorder output and joint review. Keep the existing archive/codec implementation. Keep rejected and inconclusive outputs from replacing the original poses. These are coherent, appropriately small decisions.

Keep browser PGO, learned matchers, raw-signal fusion, new point clouds, dashboards and general wrappers deferred. The Ponytail guidance influenced this review by limiting corrections to the manual handoff and acceptance procedure; none requires a new production abstraction or a replacement algorithm.

## Minimum plan that can be reviewed and executed

The plan needs only a frozen run manifest, the exact manual commands/settings and intermediate artifact names, the working-model/pose-transfer mapping, a short geometry/safety procedure, and the three-outcome verdict table. The manifest must identify the recording hash, model image list, loop pairs, installed COLMAP build, hardware/backend, intrinsics settings and declared thresholds. Retain the correspondence data and intermediate models used to compute the verdict, not only screenshots or rounded totals.

The first recording and numerical thresholds are still genuinely unset in section 6. Filling them is part of preparing this run, not a reason to design a configurable product. An exploratory attempt can expose missing information, but cannot receive `Accepted candidate` under thresholds chosen after seeing its result. A small scorer and safety check may precede BA; deferring workflow automation must not also defer the means to judge it.

## Decisions for people

- **Filip and Mingna:** Select the first suitable loop recording, COLMAP version/settings, usable loop pairs, metric convention and numeric limits. Choose and verify the frame/scale reference and the manual handoff. Decide who records each check; permanent component ownership is unnecessary.
- **Simon:** Clarify whether the later controlled visual A/B substitutes for, or precedes, the assignment's final held-out PSNR/SSIM evidence. Assignment sections 2.3-2.4 still explicitly require the latter. OD-013 accurately records deferral, not deletion. This unresolved final acceptance question does not block the bounded geometry experiment.

The assignment and Simon's workflow support doing a small evidence-producing experiment. They do not establish that this recording, this installed COLMAP configuration or the conservative pose-only output will improve splats. That is the result the experiment must discover.

## Reproducing the counterexample

This diagnostic was executed in memory using bundled Python/NumPy. It is review evidence, not a proposed production metric implementation; the team still needs to accept one exact metric convention.

```python
import numpy as np

K = np.diag([1000., 1000., 1.])
Ki = np.linalg.inv(K)
x1 = np.array([200., 100., 1.])
x2 = np.array([0., 100., 1.])

def distance(t):
    x, y, z = t
    E = np.array([[0., -z, y], [z, 0., -x], [-y, x, 0.]])
    F = Ki.T @ E @ Ki  # identity relative rotation in this example
    l2, l1 = F @ x1, F.T @ x2
    a, b = np.linalg.norm(l2[:2]), np.linalg.norm(l1[:2])
    if min(a, b) < 1e-12:
        return None
    return abs(x2 @ F @ x1) * (1/a + 1/b) / 2

assert distance([-1., .1, 0.]) > 19.9
assert distance([-1., 0., 0.]) == 0
assert distance([-10., 0., 0.]) == 0
assert distance([1., 0., 0.]) == 0
assert distance([0., 0., 0.]) is None
assert np.median([10.]*100 + [1.]*10) == 10
assert np.median([1.]*100 + [100.]*10) == 1
```

Fixture SHA-256 values verified in this review:

- `first-capture.zip`: `cba147f0fc418ccf7f5b978d661d22c88172f806b36caafb12ffd31608176e76`
- `second-capture.zip`: `43699ee56b34a6ff985811aa29a7e123609be6f302c2a29a526723051972d0ca`

Build/test commands actually completed in `Task2_Goal1A`:

```text
node node_modules/tsdown/dist/run.mjs --config config/tsdown.config.ts
node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts
```

The merged comparison and decision record were not edited. No implementation tasks, production code, commits or pushes were created.
