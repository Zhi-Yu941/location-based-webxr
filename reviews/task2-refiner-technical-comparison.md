# Task 2 Refiner Technical Comparison

Decision-informed comparison for contract review. The bounded first experiment is accepted; no final production refinement architecture is accepted.

Source keys: A = `C:/Users/filip/Downloads/Team 6 - Reality Reconstruction via Gaussian Splats.pdf`; S = `dev/task2-refiner/simon-recommended-colmap-refinement-workflow.pdf`; R = `Draft/refiner-draft.md`; M = `Draft/measurement-harness.md`; T = `Draft/training-strategy.md`; C = `plans/task2-goal1a-contract.md`; E = `reviews/task2-goal1a-implementation-evidence.md`; O = `OWNER_DECISIONS.md`.

## 1. Fixed baseline

- **Constrains refiner:** A, “2.2 The seam that makes this splittable (agree on and document this first)”: standalone recorder ZIP-in/out; independent refinement/evaluation; no recorder/exporter changes. Original images and occupancy points remain unchanged by default; intrinsics refinement is optional.
- **Constrains progression/acceptance:** A, “2.3 The components (build and demo each on its own)” requires measurement before refinement, research/review before approach selection, synthetic/unit and real replay tests, held-out PSNR/SSIM, applicable geometric residuals, and visual A/B. “2.4 The end-to-end proof” requires multiple scenes eventually. Source-build comparison and a repeatable LichtFeld recipe are not established here; the assignment does not make source-build comparison a research-spike prerequisite.
- **Constrains operation:** O, OD-002/004 require offline local operation and browser-compatible reader/writer infrastructure, not browser-only refinement. OD-013–018 accept a bounded COLMAP proof, conservative output, explicit verdicts and evidence-gated automation without selecting the production refiner.
- **Supporting infrastructure with binding boundaries:** C, “5. Component boundary and ownership”, “8. Supported COLMAP profile and typed model”, “9. Coordinate and pose contract”: reuse one archive owner; text/single-`PINHOLE`/empty-track profile; preserve IDs, image membership, opaque bytes and deterministic semantic serialization. W2C/WXYZ remains fixed; camera centre is `-Rᵀt`, not `t`.
- **Supporting evidence:** E records 131 passing 1A tests, Filip’s external compatibility acceptance and deferred AppFramework integration. It is infrastructure evidence, not reproducible refinement-quality evidence.

## 2. Source extraction

### Simon

S, “Goal”, “2. Recommended first experiment”, “4. Suggested manual COLMAP workflow” and “12. PyCOLMAP vs shell commands”: test one real loop with COLMAP extraction, matching, known-pose triangulation and BA before a wrapper. It excludes new SLAM/SfM, a large evaluator and early tuning, but leaves fixed intrinsics, output points, alignment and platform open.

### Mingna

R, “1.2 Evaluation of Candidate Architectural Approaches & Upstream Research Gate (§2.3.4)”, “3. Subsystem Breakdown & Deep Technical Specifications” and “5. Implementation & Verification Roadmap”, selects browser PGO first and COLMAP as fallback. It adds selected pairs, learned matching, custom tracks, scale recovery, triangulation/PnP and GNC-TLS/WASM optimization before Simon’s manual proof. Its separate ZIP preserves intrinsics and delivered points. Byte-faithful point text exceeds C’s unchanged-value guarantee, and claims about matcher success, browser performance and LichtFeld pose optimization lack retained evidence. Its W2C translation-to-camera-centre scaling also requires correction before use.

### Measurement and training

M, “1. Executive Summary & Purpose”, §§3 and 5, proposes an independent desktop harness, every-eighth-image holdout, reprojection metrics and rendered/reference PSNR/SSIM. It assumes unevidenced headless training and held-out rendering; valid tracks are required for reprojection, and image filtering alone does not prove leakage control. T’s training controls and quality claims likewise lack a retained repeatable configuration, so both documents supply later options rather than first-experiment dependencies.

## 3. Technical comparison matrix

A: §§2.2–2.6; S: headings cited above; R: §§1–5; M: §§2–8; T: cited headings. The relationship column records the accepted resolution where O now settles an earlier proposal difference.

| Decision area | Assignment/accepted baseline | Simon’s recommendation | Team 6 drafts | Relationship | Importance |
|---|---|---|---|---|---|
| First experiment | Review gate; global correction | Real-loop COLMAP proof | Browser PGO primary | Accepted bounded COLMAP proof; final architecture open (O, OD-014) | High |
| Manual proof before automation | Measurement precedes refinement | Manual first | Solver/browser milestones first | Accepted manual evidence and joint review before automation (O, OD-017) | High |
| COLMAP reuse | Allowed candidate | Reuse existing operations | Fallback; custom optimizer primary | Accepted for the first experiment only (O, OD-014) | High |
| Runtime environment | Local; refiner platform open | Desktop; Python later | Browser refiner; desktop evaluator | Local offline desktop first; product runtime deferred (O, OD-017) | High |
| Offline requirement | Mandatory after installation | Local tools implied | Client-side claim; packaging absent | Fixed: no runtime network service after installation (O, OD-002) | High |
| Feature extraction | Required for BA route | Default SIFT starting point | ALIKED/DaD candidates | Standard COLMAP SIFT first; learned models deferred (O, OD-014/018) | Medium |
| Feature matching | New visual constraints | COLMAP matching | LightGlue/LoMa/ONNX | COLMAP matching first; learned matching requires measured SIFT failure (O, OD-018) | High |
| Pair-selection policy | Unset | Exhaustive first; sequential+loops later | Neighbours plus geometric gates | Attempt exhaustive once; use documented sequential+loop pairs only if runtime is impractical (O, OD-014) | Medium |
| Track construction | BA requires real tracks | COLMAP correspondences | Custom Union-Find/RANSAC | COLMAP owns first-experiment tracks; custom construction deferred (O, OD-014/018) | High |
| Triangulation | Working tracks before BA | Known registered poses | Bounded local submaps/PnP | Known-pose COLMAP triangulation accepted for first proof (O, OD-014) | High |
| Pose priors | Conventions fixed; method open | Initialization now; priors later | Odometry constraints; pinned anchor | Defer priors; preserve gauge/frame and escalate only after unsafe BA evidence (O, OD-015/018) | High |
| Bundle adjustment | Candidate, not selected | Joint poses/working points | PGO primary; BA fallback | Joint COLMAP BA accepted for experiment; final refiner remains open (O, OD-014/015) | High |
| Intrinsics policy | Fixed default; optional extension | Optional camera optimization | Explicitly fixed | Fixed for conservative experiment (O, OD-015) | High |
| points3D policy | Preserve delivered occupancy cloud | Joint working geometry; export unclear | Untouched output cloud | Working points internal; recorder points unchanged; aggressive variant deferred (O, OD-015) | High |
| Refined ZIP output | Separate preserved archive | Wrapper after proof | Immutable transform plus writer | Separate pose-only ZIP through accepted archive owner (O, OD-015/017) | High |
| Reprojection measurement | Only when tracks exist | Pre/post BA statistics | Trackless output gives N/A | Supporting metric on temporary working tracks; not copied to output model (O, OD-016) | High |
| Photometric measurement | Held-out PSNR/SSIM required | Visual-first; lighter final evidence | Required automated PSNR/SSIM | Deferred from current stage by Simon; final assignment substitution remains explicit (O, OD-013) | High |
| LichtFeld cadence | External gate; later cadence unset | Selected controlled A/B | Training inside each evaluation | No routine use; one later frozen-settings A/B for a selected candidate (O, OD-013) | High |
| Raw ARCore signals | Preserved; later optional | No initial dependency | Later depth/GPS/action parsing | Deferred until the image-only route has an evidenced failure (O, OD-018) | Medium |
| Browser implementation timing | Core reusable; product open | Desktop proof first | Browser implementation first | Browser and CSUtils integration deferred; ZIP remains the seam (O, OD-017) | High |

## 4. Historical conflicts and accepted resolutions

### Resolved conflict: First implementation commitment

**Simon’s position:** S “Goal” and “12. PyCOLMAP vs shell commands” require manual COLMAP proof before wrapper construction.

**Team draft position:** R §1.2 selects custom browser PGO; §5 begins its implementation.

**Why they cannot both remain unchanged:** They assign incompatible first deliverables and dependency budgets.

**Accepted resolution:** O, “OD-014 — The first refiner experiment is a bounded offline COLMAP proof”, selects one manual real-loop COLMAP investigation before automation. Browser PGO remains research input rather than the first contract deliverable. This does not select COLMAP as the final production refiner.

**Decision status:** Technical decision for Team 6.

### Partially resolved conflict: Sufficient final evidence

**Simon’s position:** S “7. Bundle-adjustment optimization statistics” treats solver numbers as sufficient quantitative presentation evidence.

**Team draft position:** M requires held-out PSNR/SSIM; R’s final milestone requires their improvement.

**Why they cannot both remain unchanged:** Geometric statistics alone cannot satisfy A’s required photometric acceptance.

**Accepted current-stage resolution:** O, “OD-013 — Refiner development uses geometric gates before a later LichtFeld comparison”, records Simon’s verbal approval to avoid routine LichtFeld use and defer PSNR/SSIM automation. Geometry selects a candidate; one later frozen-settings LichtFeld A/B provides the visual checkpoint. Until then, the claim is “geometrically improved candidate,” not “better splat.”

**Remaining source conflict:** A, §2.3, still names held-out PSNR/SSIM as end-to-end evidence. The contract must not claim that this PDF requirement was deleted. Contract review must state whether Simon’s later visual checkpoint substitutes for, or only precedes, the final photometric evidence.

## 5. Accepted smallest merge

1. **First proof:** Freeze one real loop recording with visible start/end overlap and observable drift. Task 1 fixtures remain compatibility inputs unless separately shown suitable for refinement evidence.
2. **COLMAP route:** Use standard SIFT, matching, known-pose triangulation and bundle adjustment. Attempt exhaustive matching once and record its runtime; use documented sequential-neighbour and explicit loop pairs only if exhaustive matching is impractical.
3. **Mutation and frame boundary:** Fix intrinsics and preserve images and recorder `points3D`. Optimize extrinsics and temporary points internally. The input ZIP's exported COLMAP frame is authoritative. Pin and verify COLMAP's gauge; do not silently align a changed scale, origin or orientation. Transfer only accepted poses into a separate ZIP.
4. **Identity handoff:** Send only model-referenced images to COLMAP, preserve extra assets opaquely, and map original IDs to returned poses through an exact filename bijection. Working tracks and points never enter the strict 1A model.
5. **Acceptance:** A refiner-specific comparison before and after ZIP serialization permits only `qvec`/`tvec` changes. Score frozen correspondences per loop pair with one defined pixel epipolar formula derived from poses and fixed intrinsics, plus positive-depth and degeneracy checks. Epipolar improvement alone cannot establish scale or translation sign.
6. **Loop support:** For each declared pair, retain counts for initial matches, verified matches, triangulated cross-loop tracks and observations used by BA. Missing required optimized support is `Inconclusive`.
7. **Evidence:** Mingna performs the first reviewed run on his computer within the accepted COLMAP/SIFT boundary. The handoff includes input hash, pinned version, commands/settings, loop pairs, logs, runtime, metrics, model or ZIP and video. Filip and Mingna jointly complete the verdict table without creating permanent ownership.
8. **Automation gate:** Automate only an accepted manual workflow. Rejection or insufficient evidence triggers investigation of the first failing stage, not a general framework.

Every run ends as `Accepted candidate`, `Rejected`, or `Inconclusive`. Rejected and inconclusive outputs keep the original poses.

## 6. Required contract-review decisions and evidence

The merge direction is fixed, but the contract must not invent these values:

- identify the exact first recording and declared loop-closure image pairs;
- record Mingna’s exact proposed COLMAP settings before the candidate result is inspected;
- define the symmetric point-to-line pixel formula, per-pair aggregation, usable support/parallax, positive-depth rule, epipolar/inlier tolerances and trajectory vetoes before inspecting a candidate;
- pin the COLMAP version, document its gauge constraints and verify the input ZIP's exported COLMAP frame and inherited metric reference; a mismatch is `Inconclusive` before any separately reviewed alignment;
- record the filename/ID mapping and the stage-by-stage loop-support table;
- state whether the later visual A/B replaces or only precedes the assignment’s held-out PSNR/SSIM evidence;
- choose source locations and wrapper technology only after the manual commands succeed.

These are contract parameters or evidence tasks, not permission to reopen the accepted experiment boundary.

## 7. Contract-ready progression and deferrals

```text
1A reader/writer complete
  -> freeze one suitable loop recording and settings
  -> manual offline COLMAP proof
  -> deterministic geometry and safety verdict
  -> Team 6 review
  -> automate only an accepted workflow
  -> one later controlled LichtFeld A/B checkpoint
  -> escalate only after a measured failure
  -> CSUtils integration later
```

- **Keep as future seams:** Replaceable refiner/evaluator, pair-policy substitution, optional raw signals, local/offline operation, ZIP input/output and diagnostic reporting.
- **Defer until SIFT evidence requires them:** LightGlue/ALIKED, LoMa/DaD, ONNX, WebGPU/WASM, learned-model preprocessing and custom match/track construction.
- **Defer until BA evidence requires them:** Soft pose priors, custom PGO, GNC-TLS, depth/GPS/action fusion and broader metric-scale recovery.
- **Defer as aggressive output:** Replacement or regeneration of recorder `points3D`; compare it separately with original and conservative pose-only outputs.
- **Defer from ordinary development:** LichtFeld training, PSNR/SSIM automation, headless rendering, HTML dashboards, caching and trainer-setting research.
- **Exclude from the first contract:** Browser product implementation, CSUtils UI, reader/writer redesign, binary/general COLMAP support, trainer patches and speculative production APIs.

The escalation order is pairing only after impractical runtime, learned matching only after inadequate SIFT loop constraints, priors/alignment only after unsafe BA, raw signals only after the image-only route is insufficient, and regenerated points only after pose-only refinement remains visually insufficient. Add one source of complexity at a time and stop when the smallest safe approach produces useful visual benefit.

## 8. Readiness verdict

**Ready for a bounded refiner contract review.**

The contract may define the manual experiment, evidence format and go/no-go gates. It must not create the production wrapper, select browser PGO, promise visual improvement from geometry alone or silently remove the assignment’s final photometric requirement. New automation begins only after the first manual result is jointly reviewed.
