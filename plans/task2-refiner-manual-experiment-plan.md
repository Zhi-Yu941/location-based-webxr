# Task 2 Refiner — Manual COLMAP Experiment Plan

> **Status:** Confirmed and readiness-reviewed; the two review corrections were applied on 2026-09-10. Slice 1 implementation has not started.

## 1. Purpose and completion boundary

Test whether one frozen recording yields a geometrically improved, frame-compatible, pose-only recorder ZIP through manual offline COLMAP. Completion means retained evidence, exactly one verdict, and Filip/Mingna review—not necessarily success. This cannot establish physical ground truth, better splats, or a production refiner.

OD-013 excludes routine LichtFeld and PSNR/SSIM automation. A later controlled visual checkpoint remains required; final photometric evidence remains unresolved (§16).

## 2. Accepted inputs and dependencies

OD-013–018 and `reviews/task2-refiner-technical-comparison.md`, sections 5–8, govern this plan. Reuse Goal 1A unchanged; its evidence does not prove refinement quality.

The assignment was independently rechecked at `C:/Users/filip/Downloads/Team 6 - Reality Reconstruction via Gaussian Splats.pdf`, “Goal 2 — build the pose-refinement pipeline” and “2.5 Recommended approaches & the hard parts”. The similarly named `(1).pdf` is Simon's workflow, also stored at `dev/task2-refiner/simon-recommended-colmap-refinement-workflow.pdf`.

## 3. Preconditions and frozen run manifest

Use one JSON manifest. Fields may be pending only until the phase that produces them:

- `runId`, `input.path`, `input.sha256`, `imageNames` (complete model list), `chronologicalNames`, `sequentialPairs`, `loopPairs` (each marked required), `overlapEvidence`, `driftEvidence` (baseline screenshots and rationale).
- `colmap.executable/version/build/hash`, `nodeVersion`, `os`, `cpu`, `gpu`, `siftBackend`, `offlineCheck`, `commands` (exact executable, arguments, working directory), `nonDefaultSettings`, `effectiveSettingsEvidence` (including defaults).
- `intrinsicsByStage` (model, dimensions, fx/fy/cx/cy, camera association, disabled focal/principal/extra-parameter refinement), `matchingStrategy`, `exhaustiveTimeLimit`, `resourceLimits`, `fallbackPairs`.
- `metricFormula` (§8), `pixelConvention`, `correspondenceFile/hash`, `minVerifiedMatches`, `minBATracks`, `minBAObservations`, `minParallaxDegrees`, `minPositiveDepthRatio`, `depthEpsilon`, `inlierThresholdPx`, `coverageGridRows/Columns`, `minCoverageEachImage`.
- `numericEpsilon`, `quaternionTolerance`, `improvementTolerancePx`, `pairMedianRegressionPx`, `pairP90RegressionPx`, `maxInlierRatioDrop`, `maxCoverageDrop`, `gaugeAnchors/behaviorEvidence`, `scaleTolerance`, `originTolerance`, `orientationTolerance`, `maxCentreDelta`, `maxRotationDelta`, `sequentialStepLimits`, `sequentialTurnLimits`.
- `artifactPaths`, `baselineEvidenceHashes`, `freezeTime`, `filipApproval`, `mingnaApproval`.

- **Preparation gate:** require input/hash, image and pair selection, overlap/drift evidence, tool/build identity, commands, backend and resource/runtime limits. Baseline-derived fields may be explicitly `pending`.
- **Baseline gate:** run extraction, matching and fixed-pose triangulation; retain their artifacts, then fill correspondence/evidence hashes, support/parallax observations, effective intrinsics/settings and justified metric/safety limits. Filling a declared pending field keeps the same run; changing an already frozen value starts a new run.
- **Pre-BA gate:** require every acceptance field, evidence hash and both approvals, test numeric limits against synthetic failures, then freeze the completed manifest. A pending field is valid at preparation and invalid here. Never tune it against the candidate.

No suitable recording is currently identified under `dev/task2-refiner/`.

## 4. Workspace and artifacts

Proposed local root: `Task2_Goal1A/experiment-runs/<UTC-timestamp>-<UUID>/`; creation must fail if it exists. Add `/experiment-runs/` to `Task2_Goal1A/.gitignore` during implementation and verify `git check-ignore` before copying data.

```text
input/original.zip                 immutable copy; hash before/after
images/                            referenced originals only
database/features.db              frozen extraction checkpoint
database/exhaustive.db             first matching attempt
database/selected.db               conditional clean fallback
models/known/                      initial TXT, empty working points
models/triangulated/               pre-BA working model
models/adjusted/                   separate post-BA model
exports/{triangulated,adjusted}/    COLMAP TXT exports
poses.json                         filename/ID/pose table
output/candidate.zip               separate, never overwrites input
logs/                              help, commands, stdout/stderr, timing
metrics/                           correspondences, support, scores, safety
evidence/                          screenshots, video, hashes
manifest.json                      frozen parameters
verdict.md                         gates, result, joint signatures
```

Keep generated experiment artifacts untracked and retain the run directory on durable local storage. Git contains only small tooling, tests, the manifest template and documentation. Never alter Task 1 fixtures or `dev/`.

## 5. Recorder-to-COLMAP handoff

Read and retain the original `RecorderDataset` with `readRecorderZip(bytes)`. Experiment-local code may use `recorderZipAdapter.open/resolveImages` for extraction and payload comparison without exposing it publicly. Extract resolved model images unchanged, without resizing or EXIF rotation; leave extra images in the archive.

Read database identities and cameras through pinned-schema, read-only inspection. Create `models/known/` with the fixed PINHOLE camera, filename-mapped original W2C poses, empty observations and empty working points. Do not import occupancy points or treat initial poses as soft priors. Verify poses/intrinsics before triangulation.

Record `(originalImageId, exactFilename, databaseImageId, returnedImageId)` and camera association. Require case-sensitive filename bijections at every boundary. Missing, duplicate or unexpected names reject handoff; never repair them through sorting, ID arithmetic or nearest poses.

Keep working observations/tracks outside the recorder model; do not expand its validator.

## 6. Manual COLMAP procedure

Verify every version-dependent argument against the pinned build, retain its help, and record expanded commands. Do not guess flags or defaults.

Disable and verify intrinsics refinement at every optimizing stage. Keep poses fixed during triangulation; BA alone changes extrinsics. Camera values/dimensions stay equal to input. Freeze SIFT backend/image-size settings and retain original-image keypoint coordinates.

Every stage retains its numbered command, exit status, elapsed time, full stdout/stderr and artifact hashes in `logs/`. In the table, R means `Rejected` (demonstrated violation); I means `Inconclusive` (missing/insufficient evidence). Either stops progression except the explicitly permitted runtime fallback.

| Stage / operation | Artifact and pass condition → next | R / I conditions |
|---|---|---|
| 1. `colmap feature_extractor`: selected `images/`, original camera settings | `features.db`; complete identity/camera checks, SIFT keypoints → copy database to exhaustive attempt | R: extra images/wrong calibration; I: extraction failure or unusable features |
| 2. `colmap exhaustive_matcher`: exhaustive database | `exhaustive.db`, raw/verified matches → runtime assessment | R: unintended settings/input change; I: incomplete/error/resource stop |
| 3. Assess measured matching runtime/resources against frozen limits | `metrics/runtime.json`; practical completed attempt → verification | R: altered limits; I: impractical attempt → stage 4 only |
| 4. Conditional pair-list matching | Copy clean `features.db` to `selected.db`; pinned build's verified pair-list matching operation on exact sequential+loop list → verification | R: undeclared pairs/settings or contaminated checkpoint; I: unsupported operation/incomplete matching |
| 5. Inspect/export raw and geometrically verified correspondences | `metrics/correspondences.json`; frozen IDs/coordinates, distributed required-pair support → known-model creation and triangulation | R: corrupt identities; I: inadequate loop support/coverage |
| 6. `colmap point_triangulator`: selected database, images, known model | `models/triangulated/`; fixed poses/intrinsics, supported connected cross-loop tracks, baseline scores → freeze complete manifest, then BA | R: changed intrinsics/identities; I: weak parallax, lost tracks, altered gauge/poses |
| 7. `colmap bundle_adjuster`: triangulated → adjusted directory | `models/adjusted/`; recorded termination, residual participation, fixed intrinsics → export/safety evaluation | R: intrinsics changed/nonfinite output; I: failed solver, unproven participation or gauge |
| 8. Pinned build's verified TXT model export | `exports/`, `poses.json`; complete mapped poses and working observations/tracks → §§7–10 | R: malformed/mismatched export; I: unavailable export/evidence |

Never run incremental reconstruction to replace known poses. Stop before BA if the manifest or baseline evidence is incomplete. Preserve both matching attempts; fallback does not inherit partial exhaustive matches.

## 7. Loop-constraint evidence

Create one table per declared loop pair in `metrics/loop-support.md`:

| Pair | Raw matches | Verified matches | Triangulated cross-loop tracks | BA-used observations/tracks | Positive-depth support | Connectivity/unsupported images | First loss and evidence path |
|---|---|---|---|---|---|---|---|
| Exact filenames | Count + keypoint IDs | Count + retained IDs | Track IDs linking both images | Actual residual identities/counts | Before/after count and ratio | Relevant connected component | Stage/reason or none |

Match identities include filenames and original keypoint indices. Trace them into exported point tracks and observations. Establish BA participation using pinned-build filtering/selection evidence and retained residual information; reconcile global residual counts. Output tracks alone are not proof of solver participation. If this cannot be established without new instrumentation, stop `Inconclusive` and review the evidence gap—not a new optimizer. Require all declared loop pairs and relevant sequential images to share usable connectivity. Registration count or solver cost alone never passes this gate.

## 8. Geometry and safety checks

For W2C poses `(R_i,t_i)`, define `R_ji=R_j R_i^T`, `t_ji=t_j-R_ji t_i`, `F=K_j^-T [t_ji]_x R_ji K_i^-1`. Compute F independently from each model, never fit it to evaluated matches.

For homogeneous pixels `x_i=(u_i,v_i,1)`, `l_j=F x_i`, `l_i=F^T x_j`:

`e_px = |x_j^T F x_i| × (1/√(l_jx²+l_jy²) + 1/√(l_ix²+l_iy²)) / 2`.

Use original-resolution continuous COLMAP pixel coordinates, top-left image origin, x right/y down; verify the pinned keypoint pixel-centre convention and record it, without adding an assumed half-pixel offset. Normalize nonzero F by its Frobenius norm before denominator tests. Nonfinite values, zero baseline, near-zero denominators or inadequate parallax produce I, not zero or dropped pairs.

Score the full frozen verified correspondence set before/after; never filter against the candidate. The inlier subset for each model is exactly its correspondences with `e_px<=inlierThresholdPx`. Coverage is occupied cells from that subset divided by all cells, separately in both images, over `[0,width)×[0,height)`. Cell indices are `min(columns-1,floor(u*columns/width))` and likewise for rows; an out-of-image coordinate makes the pair `Inconclusive`. Report pair median, nearest-rank p90, inlier count/ratio and both coverage fractions. Ratio and coverage drops are absolute fractions. Summary is median of pair medians only; required-pair vetoes remain independent.

For depth/parallax, use the same full frozen pair set as the denominator for both models. For each match, compute world rays from normalized `K^-1x` bearings and their clamped-dot-product angle; triangulate once by linear two-view DLT from `K[R|t]`, without RANSAC, reselection or refinement. Report failures, nonfinite points, depth `<=depthEpsilon` in either camera and angles below `minParallaxDegrees`; never remove them from the denominator. Positive-depth ratio counts only finite points in front of both cameras. Either model below frozen support/parallax/positive-depth minima is `Inconclusive`; a candidate loss beyond numeric tolerance vetoes acceptance. Epipolar improvement cannot establish scale or translation sign.

Report pre/post COLMAP reprojection statistics, population changes, residual counts and termination separately; recorder placeholder errors are not measurements.

Frame protection uses input exported coordinates, not raw WebXR. `GpsPlusSlamJs_RecorderApp/src/colmap/colmap-conversions.ts`, `webxrToColmapPose/webxrToColmapWorldPoint`, already applies the basis change. For every pose require finite values, unit WXYZ quaternion (tolerance no looser than existing `1e-6`), `X_camera=RX_world+t`, and centre `C=-R^T t`; never repair invalid quaternions silently.

Before BA, document the pinned gauge's anchor identities and constrained quantities. Verify they are nondegenerate, constrain origin/orientation/scale and remain tied to the input throughout triangulation and BA. Compare those anchor values and scale-defining distances/components directly before/after against frozen tolerances; also inspect global baseline-length ratios, centre/rotation deltas and chronological step/turn bounds. Connected support is mandatory; each unconstrained component defeats a global gauge claim. Initial metric poses alone are insufficient proof. If actual gauge behavior or preservation cannot be established, I. No fitted similarity or post-alignment repairs this run; separately reviewed alignment is deferred. These checks preserve inherited scale, not independently measured physical accuracy.

## 9. Pose-only transfer and ZIP verification

The experiment acceptance procedure owns mutation enforcement, not the codec. Copy original model records in original order; replace only mapped image `pose.qvec/tvec`. Before writing, mask candidate poses back to original values and apply `exactlyPreserved` from `Task2_Goal1A/src/colmap/model-comparison.ts`; explicitly assert original observations/tracks remain empty. This checks membership, filenames, IDs, camera references/intrinsics and all original point values. Run pose/frame gates separately.

Use `writeRecorderZip(originalDataset,candidateModel)` then reopen emitted bytes through `readRecorderZip`. Repeat mutation enforcement, mapping, pose/frame checks and compare reopened poses with the approved candidate using `semanticallyEqual`. Using the existing adapter, compare path/kind sets and decompressed bytes of all non-model entries: referenced/unreferenced images, `actions/`, `session.json`, directories and unknown entries. Generated text is semantically preserved, not byte-identical; compressed ZIP identity is irrelevant.

Publish verified bytes to a new, no-overwrite path and retain the hash. A model-only result cannot pass ZIP acceptance; writer validation alone does not enforce allowed refiner mutations.

## 10. Verdict procedure

Record every gate as pass/fail/unknown with evidence paths, before/after values and frozen limits in `verdict.md`.

- **Accepted candidate:** all filename, loop-to-BA, fixed-intrinsics, frame/metric-reference, pose-only, pair-veto, aggregate-improvement and ZIP-reopen/post-serialization gates pass.
- **Rejected:** demonstrated identity/calibration/mutation corruption, unsafe nongauge pose change, pair veto, or a fully evidenced valid experiment lacking required improvement. Never replace original poses.
- **Inconclusive:** insufficient support, degeneracy, unavailable required evidence, failed execution or gauge mismatch. Never replace original poses. Explicit gauge/support rules take precedence over interpreting their scores; independently proven corruption remains Rejected.

A geometric candidate is not a visually improved splat; later controlled visual improvement is not automatically final assignment PSNR/SSIM evidence.

## 11. Test-first implementation slices

Proposed files, not APIs: H=`Task2_Goal1A/src/refiner-experiment.ts`; T=`Task2_Goal1A/src/refiner-experiment.test.ts`; C=`Task2_Goal1A/scripts/refiner-experiment.mjs`; J=`Task2_Goal1A/scripts/refiner-manifest.template.json`. Keep one helper, one test file and a thin CLI. Add an experimental build entry without changing `src/colmap/index.ts`, package exports or the production API.

C exposes separate `prepare`, `handoff`, `score`, `safety`, `transfer`, and `verdict` stages; it does not launch COLMAP. Use Node filesystem/crypto and, after schema verification, read-only `node:sqlite` only for required database evidence. If unavailable, review a native COLMAP export before adding a dependency.

Run focused tests while developing and `pnpm test` once at each review point; it already formats, lints, typechecks, builds and runs unit tests. X=`node scripts/refiner-experiment.mjs`. Do not commit automatically.

After slice 2, perform manual baseline extraction, matching and fixed-pose triangulation. Slices 3–4 consume those retained artifacts and close the pre-BA gate. Slice 6 resumes at BA; it does not repeat preparation.

| Slice / dependencies / driver → reviewer / hours | Goal; files; first test → implementation | Verification; retained evidence; review point |
|---|---|---|
| 1 / none / Filip → Mingna / 2h | Freeze run and isolate input. Add H/T/C/J, build entry; modify `.gitignore`. First: missing fields, existing destination, hash mismatch, extra image, and pending baseline field allowed at preparation but rejected by pre-BA validation → phase-aware manifest checks, exclusive workspace, referenced-only extraction and hashes. | `pnpm test`; `X prepare <run>`; verify ignore. Retain hashes, baseline suitability and template; review before real preparation. |
| 2 / 1 / Mingna → Filip / 3h | Exact handoff. H/T/C. First: shuffled IDs, missing/duplicate/unexpected/case-changed names → database identity inspection, bijection, known TXT model and pose-table export. Include populated working observations without invoking recorder validator. | U/B/V; `X handoff <run>` on synthetic export/database; retain mapping and calibration comparison. Review handoff before triangulation. |
| 3 / 1–2 / Filip → Mingna / 5h | Deterministic scorer. H/T/C. First: known residual, wrong translation scale/sign, zero baseline, pooled-median regression and lost inlier cells → §8 formula, frozen identities, pair summaries and inlier coverage. | `pnpm test`; `X score <run>`; retain expected/actual and baseline scores. Freeze metric policy before BA. |
| 4 / 2–3 / Mingna → Filip / 5h | Gauge/pose safety. H/T/C. First: global frame changes, quaternion/tvec mistakes, nonfinite/negative-depth results, lost fixed-population support, disconnected support and trajectory jump → frame, DLT/parallax/depth and continuity checks. | `pnpm test`; `X safety <run>`; retain counterexamples and gauge evidence. Close the frozen pre-BA gate. |
| 5 / 2 / Filip → Mingna / 2h | Mutation enforcement. H/T. First: pose-only edit passes; dropped image, camera/point/reference/name/observation edit fails → masked-pose comparison plus strict empty-collection assertions. | U/B/V; retain mutation matrix. Review that general writer validation cannot substitute for this gate. |
| 6 / 1–5 and closed pre-BA gate / Mingna → Filip / 4h active | Resume §6 at BA and export. H/T only if evidence decoding needs completion. First: stage-support ledger detects lost loop observations → read-only track/residual join; no custom tracks. | `pnpm test`; run frozen COLMAP commands; retain video, models, logs/runtime, manifest, loop tables and metrics. Review the first failure or completed geometry evidence. |
| 7 / 5–6, provisional geometry pass / Filip → Mingna / 3h | Pose transfer and delivery. H/T/C. First: synthetic ZIP preserves extra asset/actions/unknown entry; corruption, serialization drift and overwrite fail → §9 separate writer/reopen checks. | U/B/V; `X transfer <run>` then `X safety <run>`; retain pre/post comparisons and candidate hash. Review delivery gate; model-only evidence cannot pass. |
| 8 / all applicable / Mingna → Filip / 2h | Joint verdict. H/T/C. First: missing gate cannot accept; pair regression vetoes pooled gain → small three-verdict truth table/report. No COLMAP automation. | U/B/V; `X verdict <run>`; both sign `verdict.md`, including stopped stages and automation go/no-go. Rejected/inconclusive runs skip transfer and still complete review. |

## 12. Pair-programming and review points

Mingna performs the first reviewed COLMAP run on his computer. He supplies input hash, pinned version, commands/settings, hardware/backend, pairs, logs, runtime, intermediate models, metrics, candidate model/ZIP and video. Filip and Mingna jointly freeze parameters and fill the verdict table. Driver/reviewer assignments are per slice, not permanent component ownership; hand over only with reproducible evidence.

Automation entry condition: jointly reviewed `Accepted candidate`, including ZIP delivery. A later plan may automate only the proven local/offline commands and existing archive seam. No post-review architecture is selected here (`OWNER_DECISIONS.md`, “OD-017 — Automation follows the reviewed manual result”).

## 13. Time estimate

Estimates are elapsed two-person working hours. Recording acquisition, installation waits and unattended COLMAP runtime are additional measured wall time.

| Work | Optimistic | Realistic | Contingency |
|---|---:|---:|---:|
| Preparation/tooling | 12h | 20h | 28h |
| First manual run: active operation | 2h | 4h | 8h |
| Debugging evidenced failures | 2h | 6h | 12h |
| Joint review | 1h | 2h | 3h |
| Current total | 17h | 32h | 51h |
| Conditional automation: provisional budgeting allowance only | 4h | 8h | 16h |

Re-estimate automation after acceptance; these allowances are not authorization or a post-review implementation plan. Automation and all deferred work are outside current totals.

## 14. Stop and escalation rules

Follow `OWNER_DECISIONS.md`, “OD-018 — Refinement complexity is added only after a measured failure”. Record the evidence that activates any escalation, its decision owner and the separate plan or amendment it requires. Diagnose the first failing stage, change one source of complexity at a time, and preserve the original ZIP and failed evidence.

## 15. Deferred work

All work deferred by OD-017, OD-018 and `reviews/task2-refiner-technical-comparison.md`, section 7, remains outside these slices. COLMAP-native working artifacts do not create a new general codec or production refiner API.

## 16. Open Product Owner question

Does the later controlled LichtFeld A/B substitute for, or precede, final held-out PSNR/SSIM evidence? OD-013 defers current-stage automation, not the assignment requirement. Retain that obligation pending Simon's explicit clarification; this question does not block the bounded geometry experiment.

## 17. Go/no-go checklist

- [ ] Reviewed plan; suitable immutable recording and baseline evidence; installed offline tools verified.
- [ ] Exact commands, matching fallback limits, pairs, gauge behavior and every threshold frozen before BA.
- [ ] Synthetic scorer, mapping, safety, mutation and ZIP tests pass.
- [ ] Every required loop has traceable optimized support; no unknown gate is marked passed.
- [ ] Frame/scale/intrinsics and pose-only preservation checked before and after serialization.
- [ ] Pair vetoes and aggregate improvement applied; exactly one evidenced verdict jointly signed.
- [ ] Original retained; automation only after accepted manual delivery; later visual checkpoint and final evidence distinction retained.
