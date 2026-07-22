# Task 2 Owner Decisions

> **Status: Current decision record.** This file records assignment-fixed requirements, decisions reported from discussions with Simon, and Team 6 technical decisions. A proposal or review recommendation is not accepted merely because it appears elsewhere in the repository.

## Recording context

- Project: SoftwareLab Task 2, Reality Reconstruction via Gaussian Splats.
- Decision group: current scope, operating environment, interaction boundary, and future product direction.
- Recorded: 2026-07-21.
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

## Decisions intentionally not recorded yet

The following remain unresolved and must not be inferred from this file:

- the precise scope and completion gate for the LichtFeld 1B work;
- the baseline LichtFeld settings and which variables will be frozen;
- when LichtFeld runs beyond the single 1A compatibility smoke are required and when retained evidence may be reused;
- the measurement-harness implementation and held-out-view procedure;
- use of action logs, depth, GPS, or other recorder-specific signals;
- selection or implementation of a pose-refinement approach;
- the exact production types and asynchronous behavior of the future refinement and measurement interfaces;
- timeboxes and stop conditions for refinement investigations;
- the exact source-module and package locations;
- the pair-programming implementation sequence;
- final CSUtils integration and user experience.
