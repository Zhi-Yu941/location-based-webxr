# Task 2 Goal 1A Technical Comparison

> **Status: Current comparison.** Advisory comparison of the independent Iteration 1A proposal content. Merge candidates and verdicts are recommendations only until Team 6 and Simon record decisions.

Scope: only recorder ZIP handling, COLMAP text codec/model, faithful output ZIP, summary surface, and LichtFeld compatibility. Statements labelled “missing” are not inferred from later-stage material.

## 1. Assignment baseline

**Mandatory**

- Treat the recorder ZIP as the sole first-iteration boundary: a self-contained tool/app in the fork reads a recorder ZIP and writes a ZIP without changing recorder/exporter code. Start with `sparse/0/` plus `images/`; action-log parsing is later.
- Parse `cameras.txt`, `images.txt`, and `points3D.txt` into typed cameras (model/intrinsics), images (extrinsics), and 3D points; resolve image references; write a model ZIP that LichtFeld can train on.
- Preserve an unchanged Task 1 model structurally: same cameras, same poses within formatting tolerance, same points, and intact image list. The assignment does not require byte-identical text or ZIP containers.
- Use COLMAP world-to-camera extrinsics, quaternion order `[qw,qx,qy,qz]`, and translation `[tx,ty,tz]`; do not repeat the exporter’s WebXR-to-COLMAP conversion. Protect the convention with known-input unit tests and a round-trip assertion.
- Add a replay end-to-end test using a real Task 1 ZIP, plus a standalone demo.
- The demo must be a plain CLI or page that reads a ZIP, prints image count, camera intrinsics, and the pose of image ID 1, then re-emits a diffable ZIP that still trains in LichtFeld.
- Keep the typed COLMAP model as the stable seam so reader/writer and later `refine(model, signals?)` work remain independently testable.

**Conditional**

- The presentation may be either CLI or page; one is required. Later extra recorder signals may be passed to refinement, but they are not part of this iteration.

**Nice-to-have**

- COLMAP `.bin` support; `.txt` is the required path.

## 2. Proposal extraction

### Filip

- **Pipeline/ownership (explicit):** ZIP adapter -> text codec/typed model -> image resolution -> summary -> forced serialization of all three texts -> copied ZIP with replacements -> reopen/compare -> external smoke test. The adapter exclusively owns archives/assets; the codec owns syntax/model; the summary orchestrates; LichtFeld remains external.
- **Subset/model (explicit):** UTF-8 COLMAP text only; exactly one `PINHOLE` camera; empty observations/tracks; typed ordered cameras, images, points, IDs and references. Binary, multiple cameras and other models are rejected.
- **Preservation/round trip (explicit):** same normalized file-entry paths and identical decompressed bytes for untouched images, logs, metadata and unknown entries. Semantic round trip, exact no-op model preservation, and deterministic generated text are separate; original text/ZIP byte identity is excluded.
- **Pose/numbers (explicit):** world-to-camera WXYZ, transform equation, camera-center rule, no implicit conversion, validated unit quaternion, source order, round-trip-safe number strings, canonical zero, and preserved quaternion representative.
- **Failures/tests/demo (explicit):** closed typed archive/codec/summary outcomes; synthetic pose/codec, archive, forced-codec, summary and Task 1 replay tests. Demo prints required data and emits the tested ZIP; smoke passes only after completed training produces an openable splat.
- **Non-goals (explicit):** refinement algorithm, measurement, source build, binary/general COLMAP, intrinsic/point modification, recorder changes, and quality claims. The assignment-check review found that default record selection did not guarantee image ID 1; the current document’s appended rule and acceptance criterion explicitly correct that defect.

### Mingna

- **Pipeline/ownership (explicit/ambiguous):** the overall goal is raw ZIP -> typed model -> writer -> corrected ZIP, with I/O separated from pure logic. The concrete APIs are directory-in/directory-out and make the preservation source optional; another section says “Reader/Writer or ZIP adapter” owns the archive manifest, while direct ZIP-in/out is a PO question.
- **Subset/model (explicit/ambiguous):** `.txt` is MVP and `.bin` nice-to-have. Maps type cameras, images and points; observations/tracks anticipate future data. One constraint calls for a multi-model registry, while an unresolved PO proposal says Iteration 1 should reject binary, multiple cameras, non-`PINHOLE`, and populated tracks.
- **Preservation/round trip (explicit):** all unmodified files, including dangling images, logs and session metadata, must copy unchanged. Model comparison is structural/mathematical with epsilon `1e-6` and sign-invariant quaternions; fixed 10-decimal output is proposed. IDs, reference validation, record ordering and archive-byte criteria are missing.
- **Pose/failures (explicit/missing):** world-to-camera and WXYZ are explicit. Transform direction formula, no-double-conversion rule, quaternion validity and a complete error contract are missing; only explicit parser throws for camera-parameter mismatch are stated.
- **Tests/demo (explicit/missing):** round-trip and quaternion double-cover checks are explicit, and core functions are intended for unit tests. A Task 1 replay test, required summary, image ID 1, re-emitting demo behavior, and a reproducible smoke procedure are missing. “Train identically” is required but undefined.
- **Non-goals:** none are explicitly bounded for 1A; refinement, signals and measurement content is later-stage and excluded from this comparison.

## 3. Coverage matrix

| Topic | Assignment | Filip | Mingna | Difference type | Importance |
|---|---|---|---|---|---|
| 1. ZIP input/output boundary | ZIP in/out | Explicit ZIP bytes | Goal says ZIP; APIs use directories; ZIP is open | Ambiguous | High |
| 2. Archive ownership | Asset-handling module; owner unspecified | One exclusive adapter | Writer or adapter | Ambiguous | Medium |
| 3. Preservation of images and unknown entries | Resolve images; image list intact; unknowns unspecified | All untouched entries preserved | Same intent, but source optional | Complementary | High |
| 4. COLMAP text files and camera-model support | Three texts; binary nice-to-have; recorder is single `PINHOLE` | Strict single `PINHOLE`, text only | Text MVP; registry conflicts with strict open proposal | Ambiguous | High |
| 5. Typed cameras, images and points | Required | Explicit | Explicit | Shared | High |
| 6. IDs, references and ordering | Resolve references; image list intact | Validates IDs/references and preserves order | Fields/Maps only; guarantees missing | Filip-only coverage | High |
| 7. Numeric serialization | Pose tolerance; faithful output | Deterministic round-trip-safe strings; exact no-op check | Fixed 10 decimals; epsilon `1e-6` | Direct conflict | High |
| 8. Semantic versus byte-identical round trip | Structural/math; no explicit byte identity | Semantic plus exact model, not text/ZIP bytes | Semantic only; rejects byte diff | Complementary | High |
| 9. World-to-camera and quaternion conventions | W2C, WXYZ, translation, no repeated basis conversion | Full convention contract | W2C/WXYZ only | Complementary | High |
| 10. Typed failures | Not prescribed | Closed typed outcomes | Exceptions/throws; incomplete | Direct conflict | Medium |
| 11. Summary CLI/page | Required | Complete | Missing | Filip-only coverage | High |
| 12. Pose of image 1 | Required | Explicit after reviewed correction | Missing | Filip-only coverage | High |
| 13. LichtFeld compatibility smoke test | Re-emitted ZIP must still train | Defined completion evidence | “Train identically,” procedure undefined | Ambiguous | High |
| 14. Minimal future refinement seam | Stable typed-model transform seam | Stable model; final API deferred | Concrete synchronous `refine` plus later inputs | Complementary | Medium |

## 4. Material conflicts

1. **Numeric/no-op contract.** Filip: deterministic round-trip-safe numbers and an exact model-preservation predicate in addition to semantic comparison. Mingna: fixed 10 decimals and epsilon `1e-6`, with quaternion sign ignored. Both cannot remain because rounding can fail Filip’s exact predicate. Filip risks excess strictness; Mingna risks masking serialization drift. Smallest merge: sign-invariant semantic comparison plus deterministic round-trip-safe serialization and a separate exact no-op assertion. **Decision owner: Team 6.**
2. **Public failures.** Filip returns typed closed outcomes; Mingna’s API throws. One boundary cannot promise both. Typed results add contract volume; exceptions weaken exhaustive handling and test precision. Smallest merge: choose one public style while retaining Mingna’s fail-closed validation cases. **Decision owner: Team 6.**
3. **Smoke-test strength.** Filip requires compatibility only and disclaims parity; Mingna requires the output to train “identically.” These are different acceptance claims. Filip may miss subtle behavior change; Mingna’s undefined identity is not reproducibly testable. Smallest merge: require successful load, completed training and an openable artifact; move parity/quality claims later. **Decision owner: Assignment.**

## 5. Merge candidates

1. **Retain from Filip:** exclusive ZIP adapter. **Retain from Mingna:** manifest/copy-through intent. **Remove:** optional preservation and directory-only public boundary. **Result:** one ZIP owner replaces only generated sparse texts and preserves every other entry.
2. **Retain from Filip:** ordered recorder-specific model and validation. **Retain from Mingna:** I/O/pure-model separation. **Remove:** unresolved multi-model registry from 1A. **Result:** strict text/`PINHOLE` baseline with explicit future extensibility.
3. **Retain from Filip:** separate semantic/exact predicates. **Retain from Mingna:** sign-invariant orientation comparison. **Remove:** fixed 10-decimal requirement. **Result:** deterministic, testable, non-byte-identical round trip.
4. **Retain from Filip:** typed failure locations/categories. **Retain from Mingna:** explicit parameter-count rejection. **Remove:** uncategorized public throws. **Result:** fail-closed diagnostics without partial output.
5. **Retain from Filip:** summary, ID 1 correction and recorded smoke gate. **Retain from Mingna:** no byte-diff acceptance. **Remove:** undefined “identically.” **Result:** assignment-exact demo and compatibility evidence.
6. **Retain from Filip:** defer algorithm/API decisions. **Retain from Mingna:** future transform consumes/returns typed models. **Remove:** training IDs, signals, optimizer comments and measurement types from 1A. **Result:** minimal future seam only.

## 6. Sufficiency verdict

| Criterion | Filip | Mingna | Smallest combined version |
|---|---|---|---|
| Assignment coverage | **Sufficient** — including the reviewed image-ID-1 correction. | **Partially sufficient** — summary/demo and firm ZIP boundary are absent. | **Sufficient** — all explicit component-1 duties are covered. |
| Implementation clarity | **Sufficient** — boundaries and predicates are precise. | **Partially sufficient** — archive and camera scope contradict or remain open. | **Sufficient** — the six merges resolve those ambiguities. |
| Round-trip testability | **Sufficient** — semantic, exact and archive checks are separable. | **Partially sufficient** — tolerance exists, but order/IDs/full fidelity are underspecified. | **Sufficient** — precise predicates remain without byte identity. |
| Preservation guarantees | **Sufficient** — path set and untouched payloads are testable. | **Partially sufficient** — mandatory prose conflicts with optional source input. | **Sufficient** — copy-through is unconditional. |
| Coordinate safety | **Sufficient** — direction, order and conversion guards are testable. | **Partially sufficient** — core labels exist, but operational safeguards are missing. | **Sufficient** — Filip’s codec guards cover Mingna’s seam. |
| First-iteration size | **Partially sufficient** — extensive archive policy exceeds the smallest demonstrator. | **Insufficient** — later refinement/measurement and generic-model concerns dominate. | **Sufficient** — only strict ZIP/codec/demo/smoke behavior remains. |
