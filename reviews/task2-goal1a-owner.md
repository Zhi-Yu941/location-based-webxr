# Goal 1A Decision Brief

> **Status: Current review.** Pre-call decision brief for the product owner. “Team 6 technical decisions” and the proposed call outcome are proposals, not accepted decisions, until recorded in `OWNER_DECISIONS.md`.

## 1. What Iteration 1A delivers

Iteration 1A creates a standalone bridge between the recorder and LichtFeld. It accepts a recorder ZIP, reads the COLMAP text model under `sparse/0/`, resolves its image references, and represents cameras, images and 3D points as a typed model. It then writes a structurally faithful ZIP while retaining the images and other untouched archive content. A small CLI or page reports the image count, camera intrinsics and pose of image 1, and re-emits the ZIP. Acceptance includes an unchanged round trip on a real Task 1 capture and a compatibility check showing that LichtFeld can still train the emitted ZIP. It does not improve poses yet.

## 2. Why the proposals initially looked different

Filip designed deeply for the narrow Iteration 1A reader/writer milestone, including archive preservation, validation and acceptance details. Mingna described a broader portion of Goal 1, so his document also anticipated refinement, future inputs and measurement concerns. That broader horizon made the proposals appear farther apart than their equivalent content is. This brief compares only the parts that directly govern the same Iteration 1A capability; later refinement and measurement architecture is excluded.

## 3. Shared conclusions

- The recorder ZIP is the external boundary and existing recorder/exporter code remains unchanged.
- The three COLMAP model files become typed cameras, images and 3D points.
- COLMAP text is the minimum format; binary support is optional.
- Untouched assets and recorder-specific content should pass through to the output.
- Round-trip acceptance is structural and mathematical, not byte-identical ZIP reproduction.
- Poses remain COLMAP world-to-camera transforms with WXYZ quaternion order.

## 4. Important differences

| Decision area | Filip | Mingna | Smallest combined recommendation |
|---|---|---|---|
| ZIP boundary | Direct ZIP-in/ZIP-out contract | Goal says ZIP, but concrete interfaces also allow directories | Require ZIP-in/ZIP-out; keep directory handling internal if useful |
| Archive ownership | One archive adapter owns assets and copying | Reader/writer or adapter may own a manifest | Give one component sole archive responsibility |
| Initial COLMAP subset | Recorder-specific text: one `PINHOLE` camera, empty tracks | Text MVP, but also anticipates broader model support | Support the recorder's current text format only; broaden later |
| Preservation | Every untouched entry keeps the same path and payload | Same intent, but preservation input is optional in one interface | Make preservation unconditional for ZIP output |
| Round trip and numbers | Deterministic output plus separate exact and tolerant model checks | Fixed decimal output with tolerant, quaternion-sign-invariant comparison | Use deterministic output and sign-invariant semantic acceptance; do not require byte identity |
| Pose safeguards | Detailed direction, ordering and no-repeat-conversion rules | World-to-camera and WXYZ stated, fewer operational safeguards | Retain the full convention checks and known-input tests |
| Summary/demo | Covers the required summary, image ID 1 and re-emission | Required summary and demo details are absent | Use the assignment-exact CLI/page demo |
| LichtFeld evidence | Successful training and an openable result; no parity claim | Says training should be "identical" without defining it | Prove compatibility only; defer parity and quality claims |

## 5. Recommended combined Iteration 1A

- **Input:** one recorder-produced ZIP, with `sparse/0/` and `images/` as the required content.
- **Output:** one re-emitted ZIP containing a valid COLMAP model that LichtFeld can train.
- **Component ownership:** one archive boundary owns ZIP reading, replacement and preservation; a separate COLMAP reader/writer owns model parsing and serialization; the summary surface only orchestrates them.
- **Minimum supported format:** the recorder's current text model: `cameras.txt`, `images.txt` and `points3D.txt`, including its single `PINHOLE` camera and current empty observation/track shape. Binary and broader COLMAP variants are optional later extensions.
- **Preservation guarantee:** replace only the generated COLMAP text entries. Preserve every other archive path and its decompressed payload, including images, logs, metadata and unknown entries. ZIP compression details, timestamps and byte-identical containers are not acceptance requirements.
- **Round-trip guarantee:** an untouched model retains the same cameras, image identities and references, poses within agreed tolerance, points and image list. Quaternion sign equivalence is accepted.
- **Demo:** a plain CLI or page reads a ZIP, shows image count, camera intrinsics and the pose of image ID 1, then emits the output ZIP.
- **Tests:** known-input pose-convention tests; reader/writer and archive preservation tests; and an end-to-end unchanged replay using a real Task 1 ZIP. The emitted ZIP must complete a LichtFeld training smoke test and produce an openable artifact.
- **Non-goals:** pose refinement, metric design, action-log use, recorder/exporter changes, LichtFeld source integration, binary/general COLMAP support, and any claim that output quality is identical or improved.

## 6. Team 6 technical decisions

1. Fix the internal ID, reference-validation and source-order rules.
2. Select deterministic numeric serialization and the exact comparison tolerances.
3. Choose one public failure style and make invalid input fail without partial output.
4. Define archive path normalization and duplicate-entry handling.
5. Define quaternion validity, normalization and sign-equivalence checks.
6. Select the CLI or page form and assign component ownership between Filip and Mingna.

## 7. Decisions for the Owner

| Decision | Recommendation | Alternative | Consequence |
|---|---|---|---|
| Iteration scope | Limit 1A to the recorder's current COLMAP text ZIP | Require binary or general COLMAP now | Broader support increases effort before the first verifiable seam exists |
| Required capability | Require standalone ZIP-in/ZIP-out with summary and faithful copy-through | Accept directory-based model I/O only | Directory-only delivery does not satisfy the recorder ZIP contract |
| LichtFeld boundary | Treat LichtFeld as an external compatibility check | Build or integrate LichtFeld into 1A | Integration couples this milestone to separate tooling work |
| Acceptance evidence | Require unit tests, one real Task 1 unchanged replay, and completed LichtFeld training with an openable artifact | Require "identical" training or visual quality | Identity is undefined here and belongs with later measurement work |
| Progression | Start later Goal 1 work only after the 1A acceptance evidence passes | Begin refinement before the seam is proven | Later results may be confounded by reader/writer or coordinate errors |

## 8. Proposed call outcome

1. Iteration 1A is a standalone recorder-ZIP-in/COLMAP-ZIP-out capability and will not modify recorder or exporter code.
2. Required format support is the recorder's current COLMAP text model; binary and broader camera/model support are not required for 1A.
3. The output will replace only the COLMAP text model and preserve every other archive entry's path and decompressed payload; byte-identical ZIP containers are not required.
4. The demo will report image count, camera intrinsics and the pose of image ID 1, then re-emit the ZIP.
5. Acceptance requires convention and preservation tests, an unchanged round trip of a real Task 1 ZIP, and a LichtFeld run that completes with an openable artifact.
6. LichtFeld remains external to the 1A implementation; source-build integration, output parity and quality improvement are outside this milestone.
7. Later Goal 1 refinement work begins only after 1A passes, and the refinement approach remains a separate review decision.
