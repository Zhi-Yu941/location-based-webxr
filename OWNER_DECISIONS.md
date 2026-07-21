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

## Decisions intentionally not recorded yet

The following remain unresolved and must not be inferred from this file:

- the precise scope and completion gate for the LichtFeld 1B work;
- the baseline LichtFeld settings and which variables will be frozen;
- when a LichtFeld run is required and when retained evidence may be reused;
- the measurement-harness implementation and held-out-view procedure;
- use of action logs, depth, GPS, or other recorder-specific signals;
- selection or implementation of a pose-refinement approach;
- timeboxes and stop conditions for refinement investigations;
- the exact source-module and package locations;
- the pair-programming implementation sequence;
- final CSUtils integration and user experience.
