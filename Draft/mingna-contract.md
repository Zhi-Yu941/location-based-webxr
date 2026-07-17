# Pose Refinement Pipeline: Initial Architecture & Seam Plan

> **Status: Current proposal.** Independent Mingna-led Task 2 architecture candidate; the file credits Mingna Sun and Filip Kral. It remains separate from Filip's proposal lineage and is not an official plan or accepted decision record.

**Date:** 2026-07-14
**Authors:** Mingna Sun, Filip Kral
**Component:** COLMAP Reader/Writer & Pose Refinement Core

## 1. Use Case & Problem Statement
The raw COLMAP zips exported by the `location-based-webxr` recorder contain camera poses derived from real-time ARCore visual-inertial SLAM. Over a trajectory, these poses suffer from drift and lack global consistency (e.g., paths fail to close loops correctly). When fed directly into LichtFeld-Studio, this drift manifests as blurry, ghosted, or doubled edges in the resulting Gaussian Splat. 

Our goal is to build an offline refinement pipeline that takes this raw COLMAP zip, applies global multi-view constraints (e.g., visual loop closure or bundle adjustment) to correct the drift, and outputs a corrected COLMAP zip. This refined zip should train into a measurably sharper splat.

## 2. Goals & Success Criteria
1. **Lossless Round-Trip (The Baseline):** We must be able to parse `sparse/0/` (cameras.txt, images.txt, points3D.txt) into memory and write it back to disk. 
    * *Success Criteria:* The written model matches the original structurally and mathematically. Poses must match within float tolerance, and quaternion sign flips (due to the double-cover nature of quaternions, where $q$ and $-q$ represent the identical 3D rotation) must be handled as mathematically equivalent, preventing false positives in validation. LichtFeld must be able to train on the output identically to the input.
2. **Pure Extrinsics Transformation:** The refinement must only target camera extrinsics. 
    * *Success Criteria:* `points3D.txt` (the occupancy grid) is passed through 100% untouched.
    * *World-Gauge Alignment Invariant:* The refined camera poses must remain registered in the exact same world coordinate frame and scale as the untouched `points3D.txt` (avoiding gauge translation, rotation, or scale drift).
3. **Measurable Improvement:** Every change must be quantifiable.
    * *Success Criteria:* We can evaluate the refined model using Held-out PSNR/SSIM, reprojection error, and visual A/B against a frozen baseline.

## 3. Data Contracts & Types (The "Seam")
To separate logic from file I/O, we will map the COLMAP format to strict TypeScript interfaces. 

> **CRITICAL CONVENTION WARNING:** 
> COLMAP `images.txt` stores quaternions in `[qw, qx, qy, qz]` (WXYZ) order. This represents the **World-to-Camera** transformation. All mathematical operations must respect this handedness and order.

```typescript
// --- COLMAP Model Definitions ---

export interface ColmapCamera {
  cameraId: number;
  model: string; // e.g., 'PINHOLE'
  width: number;
  height: number;
  params: number[]; // e.g., [fx, fy, cx, cy]
}

export interface ColmapImage {
  imageId: number;
  qw: number; // Quaternion W (World-to-Camera)
  qx: number; // Quaternion X
  qy: number; // Quaternion Y
  qz: number; // Quaternion Z
  tx: number; // Translation X
  ty: number; // Translation Y
  tz: number; // Translation Z
  cameraId: number;
  name: string; // e.g., 'frame-000001.jpg'
  // 2D feature observations as a flattened array of [x, y, point3D_id, ...]
  // (empty in raw recorder zip, but needed for schema completeness and future refinement tracking)
  points2D?: number[]; 
}

export interface ColmapPoint3D {
  point3DId: number;
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  error: number; // Defaults to 1.0 in recorder's occupancy grid
  track: number[]; // Feature tracks (empty in raw recorder zip)
}

export interface ColmapModel {
  cameras: Map<number, ColmapCamera>;
  images: Map<number, ColmapImage>;
  points3D: Map<number, ColmapPoint3D>;
}

// --- Optional: Raw Action Log Signals (For future iterations) ---
export interface ActionLogSignals {
  odometry: any[]; // Full-rate SLAM poses
  gps: any[]; // GPS fixes for global anchoring
  depth: any[]; // Point cloud depth frames for ICP
}
```

## 4. Core Pipeline Interfaces
The business logic will be decoupled from the file system. These pure functions will be the core of our unit tests.

```typescript
// --- File I/O Interfaces (The Reader/Writer) ---

/**
 * PURE/IO FUNCTION: Reads a COLMAP model from a directory.
 * Parses cameras, images, and points3D from sparse/0/ into strong TS types.
 * MVP should support .txt, with .bin as a nice-to-have.
 */
export async function readColmapModel(inputDirectory: string): Promise<ColmapModel> {
  // 1. Read cameras.txt -> Map<number, ColmapCamera>
  // 2. Read images.txt -> Map<number, ColmapImage>
  // 3. Read points3D.txt -> Map<number, ColmapPoint3D>
  throw new Error("Not implemented yet");
}

/**
 * PURE/IO FUNCTION: Writes a COLMAP model back to a directory.
 * 
 * CRITICAL TEST INVARIANT (Round-Trip): 
 * A model read from disk and immediately written back must match the original 
 * structurally and mathematically (same image list, poses within float tolerance).
 * To satisfy Edge Case 4 (Preservation of Unreferenced Archive Assets), the writer
 * can accept an optional source directory (or ZIP payload references) to copy
 * over unreferenced JPEGs, action logs, and session configuration metadata.
 */
export async function writeColmapModel(
  model: ColmapModel, 
  outputDirectory: string,
  sourceDirectoryOrZip?: string // Optional path to original source folder or ZIP to preserve untouched files
): Promise<void> {
  // 1. Format and write Map<number, ColmapCamera> -> cameras.txt
  // 2. Format and write Map<number, ColmapImage> -> images.txt (Ensure QW QX QY QZ order!)
  // 3. Format and write Map<number, ColmapPoint3D> -> points3D.txt
  // 4. Copy unreferenced images and metadata logs from sourceDirectoryOrZip if provided
  throw new Error("Not implemented yet");
}

/**
 * PURE FUNCTION: The heart of the refinement pipeline.
 * Takes the parsed baseline model and outputs a new model with optimized extrinsics.
 * 
 * INVARIANTS: 
 * 1. refinedModel.points3D MUST equal baselineModel.points3D.
 * 2. Refined camera extrinsics must remain aligned to the original world coordinate frame 
 *    of baselineModel.points3D (no gauge translation, rotation, or scale drift).
 */
export function refine(
  baselineModel: ColmapModel, 
  trainingImageIds?: number[], // Explicit list of image IDs allowed for training/optimization
  signals?: ActionLogSignals // Optional auxiliary data from recorder json logs
): ColmapModel {
  // TODO: Implement Pose-Graph Optimization (TS) or bridge to external COLMAP BA
  return baselineModel; 
}

/**
 * MEASUREMENT HARNESS: The Referee.
 * Generates the metrics to prove if `refinedModel` is actually better.
 */
export interface QualityMetrics {
  psnr: number;                   // Peak Signal-to-Noise Ratio of held-out views (higher is better)
  ssim: number;                   // Structural Similarity Index Measure (closer to 1.0 is better)
  meanReprojectionError?: number; // Mean Reprojection Error (lower is better, optional/null if no feature tracks exist)
  abRenderLinks: string[];        // Paths or URLs to automatically generated side-by-side comparison renders
}

export interface IMeasurementHarness {
  /**
   * Evaluates the Splat rendering quality of a specific COLMAP model.
   * 
   * @param model The model under test (can be either the baseline or refined variant).
   * @param imageFolder The folder containing the original JPGs.
   */
  evaluate(
    model: ColmapModel, 
    imageFolder: string
  ): Promise<QualityMetrics> {
    // 1. Split train/test sets deterministically (e.g., hold out every 8th frame).
    // 2. Shell out to LichtFeld-Studio CLI to train model using identical seeds/settings.
    // 3. Render held-out views and compute PSNR/SSIM against original JPGs.
    // 4. Return delta metrics.
    throw new Error("Not implemented yet");
  }
}
```

## 5. Architectural Review & Edge Cases

### Edge Case 1: Variadic Camera Parameters and Model Types
* **Description:** The `ColmapCamera` interface defines `params: number[]`. While the recorder exports a single `PINHOLE` camera with 4 parameters (`[fx, fy, cx, cy]`), COLMAP itself supports up to 12 different camera models (e.g. `SIMPLE_PINHOLE` [3 params], `SIMPLE_RADIAL` [4 params], `OPENCV` [8 params], etc.).
* **Potential Failure:** If the pipeline's serialization code or the refinement module assumes `params` always has a length of 4, it will crash or silently drop lens distortion coefficients when handling datasets from external cameras or updated recorder versions.
* **Mitigation / Contract Constraint:**
  * Avoid hardcoded index mappings (like `fx = params[0]`). Implement a camera model registry or helper functions that map parameters safely based on the `model` string.
  * Throw an explicit error during parsing if the number of parameters does not match the expected count for the specified camera model.

### Edge Case 2: Floating-Point and Quaternion Double-Cover in Round-Trip
* **Description:** Converting double-precision floats to text and reading them back introduces precision errors. Additionally, quaternions are subject to double-cover ($q$ and $-q$ represent the same rotation). Normalizing quaternions or differences in library float formatting can cause simple byte or string diff tests to fail.
* **Potential Failure:** An exact byte/string matching test will fail due to differing decimal places or sign-flipped quaternions, even though the trajectory is mathematically identical.
* **Mitigation / Contract Constraint:**
  * Do not use exact string/byte diffs for validating round-trip correctness of text files.
  * Compare the parsed models structurally: check camera parameters and image poses within a coordinate tolerance ($\epsilon = 10^{-6}$).
  * Test orientation equivalence sign-invariantly (i.e. checking if $q_1 \approx q_2$ or $q_1 \approx -q_2$) to prevent false failures from quaternion double-cover. Ensure the writer prints with a fixed precision (e.g. 10 decimal places) to minimize serialization noise.

### Edge Case 3: World-Gauge Drift and Camera-Point Registration
* **Description:** A global trajectory optimization algorithm (like a pose graph optimizer) might solve camera poses in a local coordinate frame or scale that differs from the original world coordinate frame.
* **Potential Failure:** If the refined camera extrinsics are written back using a new local gauge while the occupancy point cloud `points3D.txt` is kept untouched in the original gauge, the camera trajectory and point cloud will become misaligned, destroying the initialization for LichtFeld-Studio.
* **Mitigation / Contract Constraint:**
  * The refinement algorithm must ensure that the output camera extrinsics are registered and aligned back to the original input world coordinate frame and scale (e.g., through a rigid 3D transform alignment or by constraining the trajectory's initial pose).

### Edge Case 4: Preservation of Unreferenced Archive Assets (Dangling Images)
* **Description:** The recorder ZIP contains assets in `images/` (e.g., `frame-000001.jpg`) that are present in the archive but are not referenced in the `images.txt` index file.
* **Potential Failure:** If the writer recreates the ZIP package using only the images parsed into the `ColmapModel` structure, these unreferenced image assets will be silently dropped, altering the ZIP archive's contents.
* **Mitigation / Contract Constraint:**
  * The Reader/Writer or ZIP adapter must maintain a manifest of all files present in the input archive. When writing the updated archive, any file that was not explicitly modified (including unreferenced JPEGs, auxiliary logs, and session configuration metadata) must be copied through to the output archive unchanged.

## 6. Product Owner (PO) Review Questions
This section documents open questions, alternatives, and design decisions to be clarified during the Product Owner review:

### Question 1: Reader/Writer Boundary & Archive Preservation
* **Problem:** The raw recorder ZIP contains not only the COLMAP `sparse/0/` model and images but also auxiliary files like `session.json` and `actions/*.json`. Recreating a new ZIP from only the parsed `ColmapModel` would lose this metadata.
* **Proposal/Decision:** Confirm that the reader/writer should accept the ZIP archive directly as input and output a new ZIP archive, ensuring all other entries (images, action logs, metadata) are copied through untouched, and only `sparse/0/` text files are modified.

### Question 2: Baseline Reprojection Error Feasibility
* **Problem:** In the raw exporter ZIP, `points3D.txt` has empty feature track fields and `images.txt` has empty `points2D` lists. This makes computing a baseline reprojection error or bundle adjustment residuals mathematically impossible without running additional feature extraction/matching first.
* **Proposal/Decision:** Report geometric reprojection error as `N/A: no correspondences` in early iterations, rather than blocking quality comparisons.

### Question 3: Refinement Technical Stack and Interface Purity
* **Problem:** Currently, the `refine` signature is planned as a pure, synchronous TypeScript function. If a later research iteration redirects us to use external tools (e.g., calling COLMAP BA or training-time optimization in C++/CUDA), this interface must become asynchronous and stateful.
* **Proposal/Decision:** Keep the synchronous TS signature as the baseline contract for now (reflecting the team's lean towards a pure TS stack), but acknowledge that it will be refactored to an async/adapter interface if external tools are selected.

### Question 4: Held-Out View Leakage Mitigation
* **Problem:** To prevent transductive leakage (where the refiner uses hold-out evaluation images to optimize the trajectory, yielding artificially high evaluation metrics), the refiner's input must be restricted.
* **Proposal/Decision:** Implement a data-splitting helper function and pass a list of allowed training images `trainingImageIds: number[]` into the `refine` function to ensure hold-out images do not contribute to optimization.

### Question 5: Supported COLMAP Subset and Defensive Validation
* **Problem:** COLMAP has a broad specification (multiple cameras, binary files, 12 camera models), while the recorder app only exports a single `PINHOLE` camera.
* **Proposal/Decision:** Adopt a strict, fail-closed validation policy in the reader for Iteration 1, explicitly throwing errors for binary formats, multi-camera setups, non-PINHOLE camera models, or pre-existing feature tracks.

### Question 6: LichtFeld-Studio Evaluation Split Mechanism
* **Problem:** To evaluate held-out views, the harness must render them. However, LichtFeld-Studio trains on all images defined in `images.txt`. If we delete test images from `images.txt`, LichtFeld won't know their refined poses at test time; if we keep them, LichtFeld will train on them, causing leakage.
* **Proposal/Decision:** Confirm how the harness should configure LichtFeld-Studio to evaluate held-out images. (e.g., should the harness replace the held-out image files with blank/masked placeholders during training to hide their visual content, or does LichtFeld-Studio support a specific training/validation subset flag?)

### Question 7: Non-Deterministic Splat Training & Evaluation Noise
* **Problem:** 3D Gaussian Splatting training on GPUs has inherent non-determinism (due to random seeds, floating point optimization order, and GPU scheduling). This can cause training runs on the same input ZIP to result in slightly different final metrics (PSNR/SSIM). A marginal quality gain could be noise rather than pose improvement.
* **Proposal/Decision:** Confirm the validation criteria: should the harness run multiple training runs per model and average the quality metrics, or do we freeze the training random seed inside LichtFeld CLI (if supported) to establish a deterministic comparison baseline?
