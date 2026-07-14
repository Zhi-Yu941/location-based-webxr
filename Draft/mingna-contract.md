# Pose Refinement Pipeline: Initial Architecture & Seam Plan

**Date:** 2026-07-14
**Authors:** Mingna Sun, Filip Kral
**Component:** COLMAP Reader/Writer & Pose Refinement Core

## 1. Use Case & Problem Statement
The raw COLMAP zips exported by the `location-based-webxr` recorder contain camera poses derived from real-time ARCore visual-inertial SLAM. Over a trajectory, these poses suffer from drift and lack global consistency (e.g., paths fail to close loops correctly). When fed directly into LichtFeld-Studio, this drift manifests as blurry, ghosted, or doubled edges in the resulting Gaussian Splat. 

Our goal is to build an offline refinement pipeline that takes this raw COLMAP zip, applies global multi-view constraints (e.g., visual loop closure or bundle adjustment) to correct the drift, and outputs a corrected COLMAP zip. This refined zip should train into a measurably sharper splat.

## 2. Goals & Success Criteria
1. **Lossless Round-Trip (The Baseline):** We must be able to parse `sparse/0/` (cameras.txt, images.txt, points3D.txt) into memory and write it back to disk identically. 
    * *Success Criteria:* The byte-level difference or logical difference (allowing for float precision) is negligible, and LichtFeld trains on the output identically to the input.
2. **Pure Extrinsics Transformation:** The refinement must only target camera extrinsics. 
    * *Success Criteria:* `points3D.txt` (the occupancy grid) is passed through 100% untouched.
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
  // 2D feature observations (empty in raw recorder zip, but needed for schema completeness)
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
 * exactly (structurally faithful, same image list, poses within float tolerance).
 */
export async function writeColmapModel(model: ColmapModel, outputDirectory: string): Promise<void> {
  // 1. Format and write Map<number, ColmapCamera> -> cameras.txt
  // 2. Format and write Map<number, ColmapImage> -> images.txt (Ensure QW QX QY QZ order!)
  // 3. Format and write Map<number, ColmapPoint3D> -> points3D.txt
  throw new Error("Not implemented yet");
}

/**
 * PURE FUNCTION: The heart of the refinement pipeline.
 * Takes the parsed baseline model and outputs a new model with optimized extrinsics.
 * 
 * INVARIANT: refinedModel.points3D MUST equal baselineModel.points3D
 */
export function refine(
  baselineModel: ColmapModel, 
  signals?: ActionLogSignals // Optional auxiliary data from recorder json logs
): ColmapModel {
  // TODO: Implement Pose-Graph Optimization (TS) or bridge to external COLMAP BA
  return baselineModel; 
}

/**
 * MEASUREMENT HARNESS: The Referee.
 * Generates the metrics to prove if `refinedModel` is actually better.
 */
export interface MeasurementReport {
  baselinePsnr: number;
  refinedPsnr: number;
  baselineSsim: number;
  refinedSsim: number;
  meanReprojectionErrorDiff: number;
}

export async function evaluateSplatQuality(
  baselineModel: ColmapModel,
  refinedModel: ColmapModel,
  imageFolder: string
): Promise<MeasurementReport> {
  // 1. Split train/test sets deterministically (e.g., hold out every 8th frame).
  // 2. Shell out to LichtFeld-Studio CLI to train both models using identical seeds/settings.
  // 3. Render held-out views and compute PSNR/SSIM against original JPEGs.
  // 4. Return delta metrics.
  throw new Error("Not implemented yet");
}
```

## 5. Open Questions for AI & PO Review
Which refinement algorithm to implement first? Should we stay purely in TypeScript (Pose-Graph Optimization with visual loop closures extracted from the JPEGs) or should we script an external call to COLMAP's Feature Extractor & Bundle Adjuster?

Handling of .bin vs .txt: The framework exports .txt but COLMAP/LichtFeld supports .bin. Should our TS parser handle .bin natively immediately, or just stick to .txt for MVP?

Action Log usage: Should we inject ActionLogSignals (depth + GPS) in Iteration 1, or strictly stick to visual constraints (COLMAP model + images) first?