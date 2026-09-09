# Manual refiner experiment plan — implementation-readiness review

Date: 2026-09-10.

Reviewed `plans/task2-refiner-manual-experiment-plan.md` against `AGENTS.md`, assignment sections 2.2–2.4, current OD-013–018, the previous plan-readiness review, and the existing reader/writer comparison, archive, model and build/test seams.

**Verdict: ready to implement after two targeted plan corrections.** The selected experiment does not need redesign. The document now addresses the five previous readiness findings. It is not yet a runnable experiment: recording selection, the installed COLMAP build, expanded commands and justified numeric limits are explicitly outstanding. Those are legitimate preparation work, not evidence that the architecture is wrong.

This is an advisory review. The plan's confirmed status and accepted decisions are not modified.

## Findings

### 1. Define phase-specific manifest requirements before implementing `prepare`

**Severity:** Major

**Evidence:** Plan lines 19–28 call every listed field mandatory pre-run, including correspondence hashes, baseline evidence and gauge behavior. The same passage permits a baseline-only pass to establish those values. Slice 1 (line 142) starts with missing-field rejection and `prepare`; slice 2 obtains database identities only after feature extraction; slice 6 (line 147) is labelled execution of all of sections 6–7 even though slices 3–4 need baseline scores and pinned-build evidence before then.

**Mismatch:** The intended two-phase freeze is sensible, but the validator and slice boundaries do not distinguish the phases. A literal implementation can reject preparation because its outputs do not yet exist, or weaken validation globally to get past that deadlock. “Changes create a new run/manifest” also needs to distinguish filling previously pending baseline fields from altering already frozen inputs.

**Concrete failure:** `prepare` requires `correspondenceFile/hash` before images have been extracted and matched. Alternatively, a developer allows missing values everywhere, inadvertently allowing BA with unfrozen thresholds.

**Minimum correction:** Keep one manifest and the existing CLI. Add a short required-by-phase rule:

- Preparation requires the fixed input, pair selection, tool identity, commands and resource limits; baseline-derived fields may be explicitly pending.
- Baseline preparation executes extraction, matching and fixed-pose triangulation, retaining their artifacts and completing pending fields without changing the original frozen inputs.
- Before BA, require every acceptance field, evidence hash and joint approval, and freeze the completed manifest. Changing a frozen choice starts a new run.

Clarify that baseline operations occur before the slice-3/4 review points; slice 6 resumes at BA once those prerequisites pass. Add one phase-transition test: the same pending baseline field is allowed at preparation and rejected at the pre-BA gate. No workflow engine or second manifest format is needed.

**Classification:** unclear contract.

### 2. Define coverage and depth populations so safety verdicts are reproducible

**Severity:** Major

**Evidence:** Plan line 106 requires occupied grid-cell fractions and a coverage veto, but does not say whether coverage uses all frozen matches or the pose-derived inliers. OD-016 explicitly calls for **inlier coverage**. Lines 24 and 108 introduce positive-depth and parallax thresholds, temporary triangulation and exclusions, but do not define the ratio denominator or how failed triangulations enter it.

**Mismatch:** Freezing correspondence identities correctly stabilizes the epipolar score. However, coverage of that entire fixed set cannot change when poses change: the image coordinates are unchanged. It cannot implement the intended inlier-coverage regression check. Similarly, a depth ratio computed only over surviving positive-depth points can conceal lost or invalid support.

**Concrete failure:** The in-memory population check used frozen matches spanning four cells. After only one cell retained inliers, all-match coverage was still `1.00`, whereas inlier coverage was `0.25`. A second population check with 70 positive-depth results out of 100 fixed matches gave `0.70` against the frozen population but `1.00` if only 70 surviving results were counted. These are arithmetic counterexamples, not a COLMAP run.

**Minimum correction:** Specify that the score always evaluates the full frozen correspondence set, while coverage counts cells occupied by that model's `e_px <= inlierThresholdPx` subset, separately in each image. Define the grid domain/boundaries and express ratio/coverage drops as absolute fractions or explicitly chosen relative changes.

For depth/parallax, name the fixed per-pair support population and one reproducible triangulation/angle procedure used on both models. Define what happens to failed, nonfinite, behind-camera and low-parallax results; do not remove them from a denominator silently. State which threshold failures are `Inconclusive` under the existing degeneracy rule. One small synthetic test should demonstrate that lost support cannot improve the reported ratio. This only completes the existing safety gate; it adds no new metric or optimizer.

**Classification:** unclear contract; missing correctness requirement.

## What is already sound

- Scope and claims are bounded: one manual offline experiment, not selection of a production algorithm or proof of better splats. The unresolved final assignment evidence remains visible.
- Archive operations stay in the existing adapter; recorder text stays in the codec; working tracks stay outside the restricted recorder model. Internal adapter reuse is possible without changing the public API.
- Filename bijections and referenced-only extraction handle the real distinction between model images and extra ZIP images.
- Intrinsics are fixed at every relevant stage. Gauge checks use the input exported world frame, with no silent post-alignment. Temporary working points do not replace delivered occupancy points.
- The epipolar formula, pose-derived fundamental matrices, equal-weight pair summary, frozen scoring membership and explicit degenerate outcomes address the previous metric weaknesses.
- Loop-to-BA evidence is required rather than inferred from registration or solver cost. Unknown participation cannot be marked passed.
- Mutation enforcement is assigned correctly. Masking only poses, checking empty observations/tracks, then using `exactlyPreserved` fits the existing helper. Post-serialization checks and separate no-overwrite delivery are appropriate.
- The three-way verdict permits an honest failed investigation to complete, and keeps automation conditional on accepted delivery.

## Small simplifications and execution risks

**Suggestion — verify the hardest tool evidence early.** Before spending the full tooling estimate, verify on the selected installation that gauge behavior and loop-to-residual participation can be established using the permitted evidence. Section 7 already correctly stops if this needs new instrumentation. Bring that feasibility check forward; do not weaken its gate or build a general residual-inspection framework. This is an ordering suggestion, not a newly discovered COLMAP limitation or another approval requirement.

**Suggestion — avoid duplicate full validation commands.** The package's `pnpm test` already performs formatting, lint, both typechecks, build and unit tests. Use focused unit tests while developing and the full gate at review points; the repeated U/B/V sequence need not run build and unit tests twice at every checkpoint.

Ponytail guidance influenced these recommendations by favoring a phase rule, precise metric populations and earlier feasibility evidence over additional abstractions. Keep the small helper/test/CLI structure; do not add production APIs, an orchestrator, learned matching, pose priors or alignment to resolve these findings.

## Checks actually performed

| Check | Result and limit |
|---|---|
| Read the complete proposed plan and current OD-013–018 | The previous five review concerns are substantially incorporated. |
| Re-read assignment sections 2.2–2.4 from the PDF | ZIP seam, unchanged occupancy points, independent tested components and final geometric/photometric/visual proof remain traceable. This experiment is not the final deliverable. |
| Inspect adapter, model-comparison helpers, model types and package/build/test configuration | Named reuse points exist; tests discover the proposed source test location. A new build entry is still required as the plan says. |
| Execute actual comparison helpers directly against in-memory models | Pose-only edit passed masked comparison; changed intrinsics, point coordinates, filename and missing image each failed. Quaternion sign-equivalent poses passed semantic comparison. |
| Execute synthetic coverage/depth population checks | Demonstrated `1.00` versus `0.25` coverage and `0.70` versus `1.00` depth ratios under different population definitions. |

No implementation exists for the proposed experiment helpers yet, so these checks do not validate their future behavior. The earlier 131-test result was not rerun or presented as a new result. No real recording was optimized, no installed COLMAP build was certified, and no LichtFeld run was performed in this review.

## Minimum next step

Correct the manifest phases and metric-population definitions in the plan, then implement the bounded preparation slice. Select and verify the actual recording/build before claiming run readiness. Keep Simon's final photometric-evidence question outside the current experiment's execution gate.

Only this review file was authored. No plan, accepted decision, implementation source, commit or push was changed or created.
