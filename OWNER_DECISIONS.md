# Task 2 Owner Decisions

> **Status: Current decision record.** This file records assignment-fixed requirements, decisions reported from discussions with Simon, and Team 6 technical decisions. A proposal or review recommendation is not accepted merely because it appears elsewhere in the repository.

## Recording context

- Project: SoftwareLab Task 2, Reality Reconstruction via Gaussian Splats.
- Decision group: current scope, operating environment, interaction boundary, and future product direction.
- Initially recorded: 2026-07-21.
- Refiner-planning decisions added: 2026-09-08, based on Filip's account of the latest discussion with Simon and Filip's confirmations during the Team 6 merge discussion. The contract review may correct the wording, but must not silently replace these decisions with an AI proposal.
- Refiner readiness corrections accepted by Filip: 2026-09-08, following `reviews/task2-refiner-plan-readiness-review.md`. They clarify the accepted experiment and do not select a final production refiner.
- Simon decisions below are based on Filip's account of the Product Owner discussions and the Friday review notes recorded by Mingna. If Simon later corrects the wording, this record must be updated rather than silently reinterpreted.
- The Team 6 assignment PDF remains the authoritative requirement source.

## OD-001 — Reader/writer is the current implementation priority

**Status:** Confirmed by Simon

Team 6 will implement and verify the recorder COLMAP ZIP reader/writer before concentrating on LichtFeld configuration, measurement integration, or pose-refinement prototypes.

The purpose of this order is to establish a trustworthy data boundary first. Later experiments must not be confounded by an incorrect parser, serializer, coordinate convention, missing image, or damaged archive.

This decision does not reduce the complete project to a reader/writer. It fixes the first implementation stage.

**Assignment basis:** The reader/writer is Goal 1 component 1. The assignment requires the reader/writer and measurement capability before refinement and treats research/proposals as the gate before selecting a refinement approach.

## OD-002 — Normal operation is local and offline

**Status:** Confirmed by Simon

The Team 6 pipeline will run locally. It will not require a server, cloud execution, a remote API, capture upload, authentication, or an online account during normal operation.

For Iteration 1A, a recorder ZIP is read from the local filesystem and the resulting ZIP is written locally. Later refinement, LichtFeld execution, and evaluation are also intended to run on local machines.

"Offline" means offline after the required software and dependencies have been installed. Initial package installation, source checkout, or LichtFeld dependency acquisition may require network access. Making the initial installation completely offline is not part of the current scope.

## OD-003 — Iteration 1A uses a local CLI

**Status:** Technical decision for Team 6

Iteration 1A will use a small local CLI for the assignment demonstration and Team 6's own experiments. It will not implement an end-user page, a hosted application, a CSUtils button, or recorder UI integration.

The CLI must:

- read a recorder ZIP;
- report the number of images;
- report the camera intrinsics;
- report the world-to-camera pose of image ID `1`;
- write a re-emitted ZIP.

The CLI is an orchestration layer. It must use the same reader and writer that tests and later experiments use; it must not implement a second parser or bypass serialization by copying the original COLMAP text.

## OD-004 — The reusable core remains browser-compatible TypeScript

**Status:** Technical decision for Team 6

The COLMAP model, text codec, archive transformation, and comparison logic will remain independent of Node-specific filesystem APIs where reasonably possible. A small Node-specific CLI wrapper may own local path handling, process exit status, and console output.

This boundary keeps the current implementation useful for local testing without committing Team 6 to a user-facing web interface. It also leaves a feasible reuse path if CSUtils later invokes the same core in a browser.

Browser compatibility does not imply online or hosted execution.

## OD-005 — Iteration 1A uses lean internal error handling

**Status:** Technical decision for Team 6

Iteration 1A will not create a large production error hierarchy or a public result framework. The internal tool must nevertheless fail clearly and safely.

Minimum behavior:

- failures identify the relevant archive entry, COLMAP file, or record when possible;
- unsupported or invalid data produces a clear contextual exception;
- the CLI reports the failure and exits unsuccessfully;
- no partial output ZIP is presented as successful;
- tests can distinguish the important failure cases without depending on fragile full-message text.

A broader user-facing recovery and error-presentation design is deferred until there is an actual CSUtils integration requirement.

## OD-006 — The reader/writer is a foundation for later quality experiments

**Status:** Confirmed by assignment

The project vision remains a local pipeline that can test whether refined recorder poses create measurably better splats:

```text
recorder ZIP
  -> typed COLMAP model
  -> selected future refinement
  -> refined recorder ZIP
  -> local LichtFeld training
  -> local quality evaluation
```

Iteration 1A implements only the trustworthy ZIP and typed-model foundation. It must leave a clean model boundary for later refinement and evaluation without implementing those later stages prematurely.

Recorder-specific raw data such as action logs, depth, GPS, and session metadata must remain preserved in the ZIP even while Iteration 1A treats it as opaque data. Whether later refinement parses or uses those signals remains unresolved.

## OD-007 — CSUtils product integration is deferred

**Status:** Deferred

The work may later be proposed back to the upstream CSUtils `location-based-webxr` project. A future workflow could expose a button after recording that prepares or refines a ZIP for splatting.

Iteration 1A will not implement that button or decide its final location and UX. Product integration should be considered only after the local pipeline performs a useful transformation and the team has evidence that the selected refinement approach is worthwhile.

The current reusable boundary must not prevent later integration, but speculative integration requirements must not expand Iteration 1A.

## OD-008 — Archive, codec, and model-validation ownership is separated

**Status:** Agreed by Filip and Mingna

One recorder ZIP adapter exclusively owns ZIP decoding and encoding, archive-entry paths, image-asset resolution, opaque copy-through, and replacement of the selected COLMAP files. No second component independently reconstructs or writes the archive.

The COLMAP text codec only parses and serializes `cameras.txt`, `images.txt`, and `points3D.txt`. It knows the COLMAP text grammar and coordinate representation, but it does not know about ZIP layout, filesystem paths, LichtFeld execution, refinement, or measurement.

Typed-model validation protects IDs, references, supported record shapes, numeric validity, pose conventions, and the current recorder profile. Validation may be implemented next to the codec as small pure modules; this ownership decision does not require a large framework.

The resulting boundary is:

```text
recorder ZIP
  -> archive adapter
  -> COLMAP text codec
  -> typed model and model validation
  -> COLMAP text codec
  -> archive adapter
  -> output ZIP
```

## OD-009 — The 1A model is recorder-specific but deliberately extensible

**Status:** Agreed by Filip and Mingna

Iteration 1A supports the verified recorder COLMAP text profile required by the assignment. The initial accepted profile is `.txt`, the current `PINHOLE` camera shape, and the observation and track shapes present in the recorder fixtures. Binary COLMAP, a general camera-model registry, and generic COLMAP compatibility remain outside 1A.

The typed model will nevertheless represent cameras, images, image poses, points3D, IDs and references. Observations and tracks will have typed collection fields even when the 1A recorder-profile validator requires those collections to be empty. Camera types should permit later extension through additional explicit variants without implementing those variants now.

This is the intended meaning of a broad foundation: later work can extend the model and validator without replacing the ZIP/codec/model seam, while 1A remains bounded to behavior that can be verified against current recorder fixtures.

## OD-010 — Round-trip fidelity is semantic, deterministic, and archive-preserving

**Status:** Agreed by Filip and Mingna

The shared 1A contract will distinguish three guarantees:

- `parse -> serialize -> parse` preserves the typed model semantically;
- serialization is deterministic and uses round-trip-safe numeric formatting rather than a fixed decimal precision that may introduce drift;
- every untouched archive entry keeps the same normalized path and decompressed bytes.

Source record order is preserved for generated COLMAP records. Quaternion comparisons are sign-invariant because `q` and `-q` represent the same rotation. An unchanged model should also pass a separate no-op value-preservation assertion so tolerant comparison cannot hide unintended serializer changes.

Byte-identical generated COLMAP text, compressed ZIP bytes, ZIP entry order, timestamps, and compression metadata are not required.

## OD-011 — The 1A LichtFeld check is one external compatibility gate

**Status:** Agreed by Filip and Mingna

Normal reader/writer development and verification will use fast local codec, archive, pose-convention, and fixture-replay tests. LichtFeld is not invoked by the reusable component and is not run after every automated test.

After those checks pass, the CLI-emitted ZIP must receive one recorded external compatibility smoke test showing that an identified LichtFeld build can accept it, complete training, and produce an openable artifact. This proves compatibility only. It does not claim identical training behavior, equal visual quality, or pose improvement.

Repeated runs, source-versus-prebuilt comparison, frozen LichtFeld settings, and the reproducible ZIP-to-splat recipe belong to 1B.

## OD-012 — The first shared plan records minimal future seams only

**Status:** Confirmed by assignment

The first shared plan must record the typed COLMAP model, a minimal future refinement signature, and a minimal measurement-harness interface so that the independently developed components share one seam.

For planning purposes, the intended flow is only:

```text
refine(model, optional signals) -> refined model
evaluate(baseline or candidate under a controlled run) -> evaluation report
```

These declarations do not select or implement a refinement algorithm, raw-signal parser, held-out policy, metric procedure, LichtFeld automation layer, or final synchronous/asynchronous adapter design. Those details must follow the evidence and later review gates. Training-image IDs, optimizer-specific settings, and speculative signal schemas must not become 1A implementation requirements merely because they appeared in one independent proposal.

## OD-013 — Refiner development uses geometric gates before a later LichtFeld comparison

**Status:** Confirmed by Simon

The project outcome remains better visual splats. Simon has verbally confirmed, as reported by Filip, that normal refiner development should not repeatedly invoke LichtFeld because splat training is too slow for ordinary iteration. The first refinement work will therefore use deterministic local geometry checks and will not implement PSNR/SSIM automation.

A candidate that passes those checks is only a **geometrically improved candidate**. It is not described as a proven visual improvement until a later controlled original-versus-refined LichtFeld comparison is performed with the same frozen settings. LichtFeld remains an external checkpoint rather than a runtime dependency of the refiner.

The assignment PDF names held-out PSNR/SSIM as end-to-end evidence. Simon's verbal confirmation records their deferral from the current refiner stage; it does not silently amend the PDF. The contract review must retain this traceability and identify whether the later controlled visual comparison substitutes for, or merely precedes, the assignment's final photometric evidence.

## OD-014 — The first refiner experiment is a bounded offline COLMAP proof

**Status:** Technical decision for Team 6

The first refiner activity is one manual, local, offline COLMAP experiment on a frozen real recording with visible loop overlap and observable drift. It is an investigation, not acceptance of COLMAP as the final production refiner.

The initial workflow is:

```text
recorder images, intrinsics and poses
  -> COLMAP SIFT feature extraction
  -> feature matching
  -> triangulation from the registered poses
  -> bundle adjustment
  -> geometric acceptance checks
```

The first run uses COLMAP's standard SIFT implementation and attempts exhaustive matching because that requires no custom pair-selection code. Its runtime is measured rather than predicted. If exhaustive matching is impractical, the smallest fallback is a documented set of sequential-neighbour and explicit start/end loop-closure pairs.

Existing Task 1 ZIPs remain compatibility fixtures unless inspection proves that they contain the loop overlap and drift needed for a refinement experiment. Learned matchers, browser inference, custom track construction and a custom optimizer are not part of this first proof.

## OD-015 — The conservative output changes poses only

**Status:** Technical decision for Team 6

The first experiment keeps camera intrinsics, RGB images and the recorder's delivered `points3D` unchanged. Bundle adjustment may optimize camera extrinsics and temporary triangulated working points internally. Those working points are retained as diagnostic evidence but are not copied into the first refined recorder ZIP.

The refined ZIP is a separate artifact. It changes only accepted image poses and preserves every other recorder entry through the accepted archive adapter. The authoritative reference is the input ZIP's exported COLMAP world frame and inherited metric reference, not raw WebXR coordinates. The first run must pin the COLMAP version, document that version's bundle-adjustment gauge behavior, and verify scale, orientation and origin before pose transfer. It must not silently post-align an unsafe result. A gauge mismatch makes the run `Inconclusive`; a separately reviewed similarity-alignment step may be considered only afterward. Translation vectors must never be transformed as though they were camera centres.

A more aggressive future experiment may replace or regenerate `points3D` using triangulated or sensor-fused geometry. That is a separate, deferred variant. It becomes a candidate only if pose-only refinement is insufficient, and it must never silently replace the conservative output.

## OD-016 — Refined poses have explicit safety and geometry verdicts

**Status:** Technical decision for Team 6

Every candidate must receive exactly one verdict: `Accepted candidate`, `Rejected`, or `Inconclusive`. Rejected or inconclusive refinement never replaces the original poses.

Image identity is mapped by exact filename, never by an assumed COLMAP numerical ID. Only images referenced by the recorder model enter the working reconstruction; extra archive images remain opaque preserved assets. The run records original image ID, filename, COLMAP database ID and returned image ID, and requires a complete bijection with no missing, duplicate or unexpected model images.

The refiner acceptance procedure owns the original-versus-candidate comparison; successful reader/writer validation alone is insufficient. Before delivery and again after reopening the emitted ZIP, it permits changes only to image quaternions and translations. Image membership, names, IDs and references, camera intrinsics, original observations, recorder `points3D` and untouched archive contents must remain equivalent under the accepted semantic contract. It also requires finite normalized quaternions and translations, the accepted world-to-camera and `[qw, qx, qy, qz]` conventions, complete identity mapping and preservation of the input ZIP frame and metric reference.

Geometry scoring uses one contract-defined symmetric point-to-line epipolar-error formula in pixels. The fundamental matrix is derived from each model's poses and fixed intrinsics; it is not re-fitted from the matches. The same correspondence identities are evaluated before and after, every declared loop pair is reported separately, and a median of pair medians may be used only as a summary. Required-pair regression can veto acceptance. Minimum usable support and parallax, positive-depth checks, numeric tolerance, inlier threshold and trajectory-sanity limits are frozen before the candidate is inspected. Undefined or degenerate geometry and insufficient evidence are `Inconclusive`, never zero error or a silently omitted pair. A baseline-only preparation pass may inform these limits before bundle adjustment produces the candidate.

For every declared loop pair, the run records initial matches, geometrically verified matches, surviving triangulated cross-loop tracks and observations actually used by bundle adjustment. Registered-image count or low solver cost does not prove that loop constraints reached the optimizer. Missing required loop support makes the result `Inconclusive`, and the first stage that loses support is diagnosed before changing the matcher or adding priors.

An `Accepted candidate` therefore requires complete filename mapping, loop constraints that reached bundle adjustment, pose-only safety checks, verified frame and scale, no vetoing per-pair regression, and aggregate geometry improvement beyond the frozen tolerance. Supporting evidence records 90th-percentile loop error, fixed-threshold inlier count and ratio, inlier coverage, COLMAP reprojection statistics, registered images, triangulated observations, solver termination, pose deltas and sequential trajectory sanity. Epipolar improvement alone cannot accept a candidate because it does not establish translation scale or sign.

The first run is performed on Mingna's computer using the reviewed settings. The retained handoff includes the input hash, COLMAP version, exact commands and non-default settings, selected loop pairs, full logs, runtime, before/after values, refined model or ZIP, and a recording of the run. Filip and Mingna jointly review and fill the result table. This arrangement does not create permanent component ownership; either developer may implement later tasks, with a driver and reviewer selected per slice.

## OD-017 — Automation follows the reviewed manual result

**Status:** Technical decision for Team 6

Team 6 will not build a general refiner framework before the manual COLMAP result is reviewed. If the experiment is accepted, the team automates that exact proven workflow using the existing ZIP reader/writer boundary and the smallest reliable COLMAP invocation. If it is rejected or inconclusive, only the evidenced failing stage is investigated before automation.

The first automated refiner may remain a separate local desktop program and must require no network service after installation. Exact COLMAP CLI commands are preferred before adding a Python/PyCOLMAP environment or other orchestration layer without demonstrated need.

Browser-native refinement and the CSUtils button remain deferred. Recorder ZIP input/output is the required integration seam. The desired future user experience may be a small post-recording action inside CSUtils, but the implementation technology is selected only after useful refinement is demonstrated and the upstream runtime is verified.

## OD-018 — Refinement complexity is added only after a measured failure

**Status:** Technical decision for Team 6

The default path is the standard COLMAP proof. Team 6 introduces at most one additional source of complexity in response to a diagnosed failure:

1. replace exhaustive matching with documented pair selection only if runtime is impractical;
2. investigate a learned matcher only if standard SIFT does not provide sufficient distributed loop constraints;
3. investigate pose priors or stronger alignment only if ordinary bundle adjustment produces unsafe pose or gauge changes;
4. investigate depth, GPS or action-log signals only if the simpler image-based route is insufficient;
5. investigate regenerated output points only if conservative pose-only refinement passes geometry checks but remains visually insufficient.

LoMa, LightGlue, ONNX/WebGPU, custom track construction, custom PGO, raw-signal fusion and regenerated output geometry are therefore deferred options, not initial implementation requirements. The team stops expanding the pipeline when the smallest safe candidate produces a useful result at the later controlled splat checkpoint.

## Decisions intentionally not recorded yet

The following remain unresolved and must not be inferred from this file:

- whether the later controlled LichtFeld visual comparison substitutes for, or precedes, the assignment's final held-out PSNR/SSIM evidence;
- the exact frozen LichtFeld settings for that later controlled comparison;
- the detailed measurement-harness implementation and any later held-out-view procedure;
- use of action logs, depth, GPS, or other recorder-specific signals;
- selection of the final production refinement approach after the bounded COLMAP result is reviewed;
- the exact production types and asynchronous behavior of the future refinement and measurement interfaces;
- numeric tolerance and sanity thresholds that must be frozen before the first candidate is judged;
- the exact source-module and package locations;
- the pair-programming implementation sequence;
- final CSUtils integration and user experience.
