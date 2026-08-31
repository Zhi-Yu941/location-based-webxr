# Pose Refiner Component Specification & Implementation Plan (Task 2 Goal 2)

> **Status:** Draft / Specification  
> **Component:** Task 2 — Component 5 (The Pose-Refinement Transform) & Component 6 (End-to-End Pipeline)  
> **Component Pure Contract (In-Memory):** `refine(model: ColmapModel, images: Map<string, Blob>, signals?) -> Promise<ColmapModel>`  
> **Pipeline Tool Contract (External File Seam):** Raw COLMAP Zip (`sparse/0/` + `images/` + `actions/*.json`) $\rightarrow$ Refined COLMAP Zip  
> **Referee Integration:** Validated by Measurement Harness via Held-Out PSNR/SSIM and Visual A/B  

---

## 1. Executive Summary & Research Gate Findings

### 1.1 The Core Problem: ARCore Trajectory Drift
Outdoor captures recorded with mobile AR frameworks (WebXR / ARCore) provide real-time Visual-Inertial Odometry (VIO) poses stored in `sparse/0/images.txt`. While locally smooth and accurate frame-to-frame, these trajectories suffer from **cumulative global drift**:
- Along circular or orbit trajectories around an object (e.g., 200+ images), small incremental errors accumulate.
- When the trajectory loops back to the starting viewpoint, the orbit **fails to close** (loop closure error), creating severe spatial misalignment between the earliest and latest frames.
- Feeding these raw poses directly into 3D Gaussian Splatting (3DGS) trainers like LichtFeld-Studio results in visible double edges, ghosting, and blurred geometry that cannot be repaired by Gaussian densification or pruning alone.
- Crucially, the COLMAP export's `points3D.txt` consists of raw occupancy grid points (placeholder error `1.0`, zero feature tracks), not triangulated feature matches. Therefore, global consistency must be established by discovering new multi-view visual constraints.

---

### 1.2 Evaluation of Candidate Architectural Approaches & Upstream Research Gate (§2.3.4)

In accordance with Task 2 Goal 1 (§2.3.4), candidate strategies were evaluated to solve the pose drift problem:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                ARCHITECTURAL OPTIONS GATEWAY                                    │
├───────────────────────────────┬──────────────────────────────────┬───────────────────────────────┤
│  Plan A: TS In-Stack PGO / BA │  Plan B: External COLMAP SfM     │  Plan C: Splat Joint Pose-Opt │
│  (Browser WebGPU / ONNX)      │  (Native CLI Runner)             │  (LichtFeld --pose-opt)       │
├───────────────────────────────┼──────────────────────────────────┼───────────────────────────────┤
│ ✔ In-stack (TypeScript/WebXR) │ ✔ Gold-standard SfM quality      │ ✖ Documented only             │
│ ✔ Zero native toolchain deps  │ ✖ Heavy external C++ dependency  │ ✖ NOT implemented on main/PRs │
│ ✔ Fast client-side execution  │ ✖ Cannot run in browser / device │ ✖ Dead end for current phase  │
│ ➔ SELECTED AS PRIMARY PLAN    │ ➔ RETAINED AS FALLBACK / BENCH   │ ➔ ELIMINATED / REJECTED       │
└───────────────────────────────┴──────────────────────────────────┴───────────────────────────────┘
```

#### Upstream Research Gate (Phase 1 Evaluation)
Prior to TypeScript implementation, an upstream offline Python evaluation (LoMa-B vs. LightGlue+ALIKED) established matcher viability on real ARCore datasets. This desktop benchmark confirmed that deep feature matching yields sufficient spatial inlier distribution across wide-baseline loop candidates. This was strictly a research gate to select the ONNX model weights and does not form part of the active TypeScript/Browser build pipeline.

#### Plan A: Global Pose-Graph Optimization (PGO) in TS (Recommended Primary Path)
* **Concept:** Retain the recorder's ARCore SLAM trajectory as relative-motion odometry constraints (initialized directly from the initial poses in `sparse/0/images.txt`), and introduce new multi-view constraints that eliminate accumulated drift:
  - **Iteration 1 (Pure COLMAP Mode — Zero Action-Log Dependency):** Compute visual loop closures exclusively from the JPEG images in `images/` using browser-based deep feature matchers (LightGlue+ALIKED / LoMa-B via ONNX Runtime Web). To prevent geometric circular logic failures (using drifted poses to triangulate points that scale loop edges), Iteration 1 defaults to **Baseline Distance Scale Alignment (Priority 3)** for loop translation scaling, while reserving multi-view triangulation strictly for bounded local sub-maps. Operates strictly on the COLMAP sparse model (`sparse/0/`) + images without parsing `actions/*.json`.
  - **Iteration 2 (Enhanced Action-Log Parsing Mode):** Parse richer auxiliary signals bundled in `actions/*.json` (without modifying recorder code) to unlock **Priority 1 (ARCore Depth Unprojection)** for direct 3D-2D PnP scale recovery, **Depth-ICP constraints** between overlapping frames, optional **Depth-Guided Pre-Warping**, and **GPS anchor constraints**, featuring a 3-tier graceful degradation policy.
* **Pros:** Fully native to the `location-based-webxr` TypeScript ecosystem; zero native C++ / CUDA / external COLMAP dependencies; runs purely client-side in the browser.
* **The Honest Catch (Trade-off & Technical Reality):** A pose-graph optimizer does not create information out of thin air: without high-quality new constraints, PGO will simply reproduce the raw odometry trajectory. The real engineering leverage lies in generating robust, geometrically verified visual loop closures (via strict Epipolar/RANSAC and multi-view tracks) to pull drifted poses back into global consistency.
* **Status:** **Selected as the Primary Path (Recommended).**

#### Plan B: External COLMAP SfM + Global Bundle Adjustment
* **Concept:** Shell out to native desktop COLMAP CLI binaries. Run feature extraction (`colmap feature_extractor`), matching (`colmap exhaustive_matcher`), triangulation with fixed poses (`colmap point_triangulator`), and global bundle adjustment (`colmap bundle_adjuster`) using ARCore poses as priors.
* **Pros:** Extremely mature, robust geometric solver; establishes the theoretical upper-bound for classical photogrammetric accuracy.
* **Cons:** Leaves the TypeScript / WebXR ecosystem; requires users to install CUDA/C++ COLMAP binaries on desktop; cannot run client-side on mobile or web.
* **Status:** **Retained as Desktop Benchmark / Fallback Alternative (not expanded in this phase).**

#### Plan C: Splat Trainer Joint Pose Optimization (LichtFeld `--pose-opt`)
* **Concept:** Rely on LichtFeld-Studio's documented runtime joint scene + camera pose optimization flags (`--pose-opt direct` / `--pose-opt mlp`, based on 3R-GS / BARF) during 3DGS training.
* **Research Findings & Elimination Justification:**
  - An exhaustive source-code and repository audit was conducted across LichtFeld-Studio's official GitHub repository, including release tags (v0.4.2, v0.5.x), the `main` development branch, open PRs, and active forks.
  - **Conclusion:** While `--pose-opt` is referenced conceptually in `docs/features/poseopt.md`, the actual flag parsing, optimizer parameters, and gradient backpropagation to camera extrinsics are **unimplemented / missing in the codebase**.
  - **Decision:** Plan C is technically infeasible without authoring a massive native CUDA/C++ extension to LichtFeld-Studio. **Plan C is definitively eliminated from the active roadmap.**

---

## 2. Plan A Architecture: In-Stack Browser-Based Pose Refinement Pipeline

The end-to-end refinement tool follows a clean, three-stage pipeline architecture centered around the typed COLMAP seam:
1. **COLMAP Reader (Component 1):** Unzips the raw archive, parses text/binary COLMAP files into a typed in-memory `ColmapModel`, and resolves image/signal buffers via chunked streaming.
2. **Pose Refiner (Component 5 - Pure Transform Core):** Executes client-side deep feature matching, Union-Find multi-view track generation, spatial distribution filtering, metric scale recovery via prioritized depth unprojection / prior baseline alignment / wide-baseline 3D-2D PnP (with cheirality/parallax degeneracy protection), and robust GNC-TLS pose-graph optimization (`refine: ColmapModel -> ColmapModel'`).
3. **COLMAP Writer (Component 1):** Re-serializes the refined model into a standardized COLMAP folder layout and repackages the `Refined COLMAP Zip` for LichtFeld training.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              END-TO-END POSE REFINEMENT PIPELINE                                       │
│                                                                                                        │
│  ┌────────────────────────┐                                                                            │
│  │     Raw COLMAP Zip     │ (sparse/0/ + images/ + optional actions/*.json)                            │
│  └───────────┬────────────┘                                                                            │
│              │                                                                                         │
│              ▼                                                                                         │
│  ┌────────────────────────┐                                                                            │
│  │  COLMAP Model Reader   │ (Component 1: Streaming Unzip, parse cameras.txt, images.txt, points3D.txt)│
│  └───────────┬────────────┘                                                                            │
│              │                                                                                         │
│              │ In-Memory Data: ColmapModel + Image Streaming Queue + Auxiliary Signals?                │
│              ▼                                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                    POSE REFINER COMPONENT (Component 5: Pure Transform Core)                     │  │
│  │                                                                                                  │  │
│  │    ┌───────────────────────┐   Pair & Spatial Heuristics                                         │  │
│  │    │ Pair Selection Engine │ ─── (1) Sequential Neighbors (i <-> i+1, i+2)                       │  │
│  │    │  & Spatial Filtering  │ ─── (2) Orbit Loop Pairs (Frustum overlap + Angle Δθ < 60°)         │  │
│  │    └───────────┬───────────┘ ─── (3) 8x8 Grid Coverage Check (≥ 25% occupancy required)         │  │
│  │                │                                                                                 │  │
│  │                ▼                                                                                 │  │
│  │    ┌───────────────────────┐   ONNX Runtime Web (WebGPU / WASM fallback)                         │  │
│  │    │ Deep Feature Matcher  │ ─── Keypoint Extractor: ALIKED / DaD                                │  │
│  │    │  (LightGlue / LoMa-B) │ ─── Matcher: LightGlue-ONNX (Baseline) / LoMa-B (Candidate)         │  │
│  │    └───────────┬───────────┘ ─── Iter 2 Option: Depth Pre-Warping via actions/*.json Depth Maps  │  │
│  │                │                                                                                 │  │
│  │                ▼                                                                                 │  │
│  │    ┌───────────────────────┐   Pairwise Inlier Pruning & Track Clustering                        │  │
│  │    │ 2D Inlier Filter &    │ ─── 5-Point RANSAC Epipolar Filtering (E-Matrix Check)              │  │
│  │    │  Union-Find Builder   │ ─── Disjoint-Set Multi-View Track Generation (Strict 1-to-1 Check)  │  │
│  │    └───────────┬───────────┘                                                                     │  │
│  │                │                                                                                 │  │
│  │                ▼                                                                                 │  │
│  │    ┌───────────────────────┐   Metric Scale Recovery & Degeneracy Protection                     │  │
│  │    │ Metric Scale Resolver │ ─── Priority 1 (Iter 2): ARCore Depth Unprojection (3D-2D PnP)      │  │
│  │    │  & Degeneracy Checker │ ─── Priority 2 (Local Sub-maps): Wide-Baseline Triangulation + EPnP │  │
│  │    └───────────┬───────────┘ ─── Priority 3 (Iter 1 Default): Baseline Distance Scale Alignment │  │
│  │                │             └── Cheirality (Z > 0) + Parallax (> 2.5°) Fallback Protection      │  │
│  │                ▼                                                                                 │  │
│  │    ┌───────────────────────┐   Robust Pose-Graph Optimizer (WASM Solver: Eigen::SimplicialLDLT)  │  │
│  │    │    GNC-TLS Solver     │ ─── Pinned World Anchor (Image 0: T0 = T0^(0))                      │  │
│  │    │  (Custom Eigen WASM)  │ ─── Metric Odometry Priors + Metric Loop Edges                      │  │
│  │    └───────────┬───────────┘ ─── Dynamic Edge Weighting (μ_e -> 0 hard rejection for outliers)  │  │
│  └────────────────┼─────────────────────────────────────────────────────────────────────────────────┘  │
│                   │                                                                                    │
│                   │ In-Memory Data: Refined ColmapModel (Updated extrinsics, points3D untouched)       │
│                   ▼                                                                                    │
│  ┌────────────────────────┐                                                                            │
│  │  COLMAP Model Writer   │ (Component 1: Format-faithful serialization & zip packing)                 │
│  └───────────┬────────────┘                                                                            │
│              │                                                                                         │
│              ▼                                                                                         │
│  ┌────────────────────────┐                                                                            │
│  │   Refined COLMAP Zip   │ (Delivered to LichtFeld-Studio / Referee Measurement Harness)              │
│  └────────────────────────┘                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Subsystem Breakdown & Deep Technical Specifications

### 3.1 Image Pair Selection & Robust Outlier Pre-Filtering
Matching all $O(N^2)$ image pairs for a 200+ image orbit is computationally wasteful and noise-prone. The pair selector enforces strict geometric and spatial distribution gates:
1. **Sequential Neighbor Pairs:** Pairs $(i, i+1)$ and $(i, i+2)$ to maintain baseline odometry continuity.
2. **Loop-Closure / Cross-View Candidate Pairs:**
   - **Frustum Overlap:** 3D bounding box / frustum intersection volume $> 15\%$.
   - **Viewing Angle Threshold:** Optical axis orientation difference $\Delta \theta < 60^\circ$.
   - **Temporal Orbit Spacing:** Index difference $|i - j| > N_{\text{min\_orbit}}$ (e.g., $|i - j| \ge 30$).
3. **Spatial Grid Distribution Check ($8 \times 8$ Grid):**
   - Outdoor captures with repetitive textures (e.g., grass, brick walls, identical windows) produce dense, clustered inliers on symmetric features (perceptual aliasing).
   - Inlier matches are partitioned into an $8 \times 8$ uniform image grid. A loop candidate is **immediately rejected** unless inliers occupy $\ge 25\%$ (16/64) of the cells, preventing localized false-positive clusters from contaminating the graph.

---

### 3.2 Browser-Based Deep Feature Matching, Track Building & Memory Management

#### 1. Models & Architecture
* **Baseline Matcher:** **LightGlue + ALIKED** (`fabio-sim/LightGlue-ONNX`).
* **Candidate Matcher:** **LoMa-B** (ECCV 2026).
* **Decomposed ONNX Pipelines:** Decomposed into `detector.onnx`, `descriptor.onnx`, and `matcher.onnx` to allow $O(N)$ detections and $O(M)$ match invocations.
* **Static Shapes:** Keypoints padded to fixed sizes ($N = 1024$ / $2048$) with binary validity masks for zero-overhead WebGPU pipeline binding.

#### 2. Chunked Streaming & Memory Management
* **Web Worker Pipeline:** Image decoding is managed in a background Web Worker queue. Full-resolution JPEGs are never decoded simultaneously into RAM.
* **ImageBitmap Lifecycle:** Images are decoded as `ImageBitmap` objects on demand and explicitly closed via `bitmap.close()` immediately after tensor creation.
* **ORT Memory Discipline:** A single global `InferenceSession` is maintained. All intermediate WebGPU activation tensors are explicitly released via `tensor.dispose()` to prevent browser tab crashes.

#### 3. Resolution & Camera Intrinsics Parity
* Images are resized to long-edge $640\text{ px}$ with aspect ratio preserved.
* Scale factor $s = \frac{640}{\max(W_{\text{orig}}, H_{\text{orig}})}$ is applied to calibrate the working intrinsic matrix:
  $$K' = \begin{bmatrix} s \cdot f_x & 0 & s \cdot c_x \\ 0 & s \cdot f_y & s \cdot c_y \\ 0 & 0 & 1 \end{bmatrix}$$
* **Intrinsics Parity Note:** The pipeline assumes `cameras.txt` contains calibrated, undistorted `PINHOLE` camera parameters (as exported by the WebXR/ARCore recorder). Keypoint coordinates from ONNX are un-scaled back by $1/s$ to match the original image coordinates, corresponding to undistorted normalized coordinates $(\hat{u}, \hat{v}) = K^{-1} [u, v, 1]^T$ before 5-point RANSAC epipolar verification.

#### 4. Multi-View Feature Track Generation via Union-Find with Strict 1-to-1 Consistency
* **Background:** The raw COLMAP export's `points3D.txt` is an occupancy grid containing zero feature tracks. Furthermore, pairwise 2D-2D inlier matches cannot be triangulated directly across $>2$ views without clustering.
* **Clustering Algorithm:**
  - After 5-point RANSAC epipolar verification, all pairwise inlier correspondences $( (i, p_a) \leftrightarrow (j, p_b) )$ from both sequential and loop pairs are aggregated.
  - A **Disjoint-Set (Union-Find)** data structure with path compression and union-by-rank clusters keypoint sightings across multiple frames into unified multi-view tracks:
    $$\text{Track}_m = \{ (f_1, \mathbf{x}_1), (f_2, \mathbf{x}_2), \dots, (f_L, \mathbf{x}_L) \}$$
  - **Strict Pre-Union Consistency Check:** Before merging two keypoints with `Union(u, v)`, the algorithm checks whether `Find(u)` and `Find(v)` already contain observations from the same image frame ($f_{\text{img}}(u) == f_{\text{img}}(v)$ or overlapping frame sets). If a conflict exists, the candidate edge is **rejected prior to union**. This prevents symmetric textures, repetitive patterns, or false matches from merging disjoint tracks and causing track explosion / over-clustering.

---

### 3.3 Metric Scale Recovery & Geometric Logic Protection (Solving Scale Ambiguity)

> **CRITICAL GEOMETRIC PRINCIPLE:** Pure 2D-2D Essential Matrix decomposition yields a unit-norm translation ($\|t_{\text{essential}}\| = 1$) without metric scale. Feeding unit-length translation edges into an SE(3) pose graph with metric odometry priors destroys trajectory scale.

#### Resolving the Circular Logic Lock in Loop Closures
Attempting to triangulate 3D points using ARCore initial poses across loop-closure frames $(i, j)$ where VIO has globally drifted leads to a **circular logic failure**: drifted camera poses produce ghosted or severely distorted 3D points, which in turn causes 3D-2D EPnP to fail or inject corrupt metric scales into the graph.

To ensure unconditional geometric robustness, the pipeline establishes a strict metric recovery hierarchy tailored to the active iteration phase:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                         METRIC SCALE RECOVERY HIERARCHY FOR LOOP EDGES (i <-> j)                │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Priority 1 (Iteration 2 Mode — Requires actions/*.json): ARCore Depth Map Unprojection          │
│   P_k^(i) = d(p_k^(i)) * K^(-1) * [u, v, 1]^T  (Direct metric depth, zero baseline ambiguity)   │
│   Solves metric T_ij via 3D-2D EPnP directly against unprojected sensor depth.                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Priority 2 (Local Sub-Map Refinement Only): Wide-Baseline Track Triangulation + EPnP             │
│   Triangulate tracks across local windows (i - k, i, i + k) where local VIO drift is bounded.    │
│   Gated by strict Cheirality (Z > 0) and Parallax (> 2.5°) checks.                               │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Priority 3 (Iteration 1 Default & Universal Fallback): Prior Baseline Distance Scale Alignment   │
│   λ = ||t_j^(0) - t_i^(0)|| / ||t_ij^(essential)||                                              │
│   Scales unit essential translation directly by ARCore prior baseline length.                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Iteration 1 Default: Priority 3 — Baseline Distance Scale Alignment:**
   - In **Iteration 1 (Pure COLMAP Mode)**, `signals` is `undefined`, and global loop closures connect frames with unknown cumulative drift.
   - The 2D-2D Essential Matrix provides the relative rotation $R_{ij}$ and unit translation direction $t_{ij}^{\text{essential}}$.
   - Metric scale $\lambda$ is computed directly by scaling the normalized vector by the prior baseline distance between ARCore camera centers:
     $$\lambda = \frac{\|t_j^{(0)} - t_i^{(0)}\|}{\|t_{ij}^{\text{essential}}\|}, \quad T_{ij}^{\text{metric}} = (R_{ij}, \lambda \cdot t_{ij}^{\text{essential}})$$
   - This guarantees that relative loop edge translations match the global metric order of magnitude without risking triangulation blow-up or circular drift feedback.

2. **Local Sub-Map Refinement: Priority 2 — Wide-Baseline Multi-View Track Triangulation + EPnP:**
   - Multi-view track triangulation is applied **only within local sub-maps** where local VIO drift is strictly bounded (e.g., neighbor frames $i-k, i, i+k$ with $k \ge 5$ and baseline $> 0.2\text{ m}$).
   - 3D points $\{P_k^{(i)}\}$ are triangulated using local metric odometry baselines and matched to 2D keypoints in frame $j$ to solve candidate $T_{ij}$ via EPnP + RANSAC.
   - **Degeneracy & Safety Gates:**
     - **Cheirality Check:** All inlier 3D points must have strictly positive depth ($Z > 0$) in both camera frames $i$ and $j$.
     - **Parallax Angle Check:** The maximum triangulation parallax angle across rays must exceed **$2.5^\circ$**.
     - **Automatic Fallback:** If EPnP produces $< 12$ inliers, fails cheirality, or exhibits parallax $< 2.5^\circ$, the pipeline **immediately aborts EPnP and falls back to Priority 3**, preventing degenerate scales from entering the pose graph.

3. **Iteration 2 Enhancement: Priority 1 — ARCore Depth Map Unprojection (Direct 3D-2D PnP):**
   - In **Iteration 2**, when `signals.depthMaps` is available in `actions/*.json`, 2D keypoints in frame $i$ are unprojected into 3D metric coordinates using calibrated hardware depth:
     $$P_k^{(i)} = d(p_k^{(i)}) \cdot K^{-1} \begin{bmatrix} u \\ v \\ 1 \end{bmatrix}$$
   - Solving 3D-2D EPnP against 2D keypoints in loop frame $j$ directly yields true metric transformation $T_{ij}^{\text{metric}}$ with zero scale ambiguity and complete immunity to visual odometry drift.

---

### 3.4 Robust Pose-Graph Optimization via GNC-TLS & WASM Solver

The global state consists of camera poses $T_i = (R_i, t_i) \in \text{SE}(3)$ for all frames $i \in \{1, \dots, N\}$, with $T_0$ pinned to its ARCore prior ($T_0 = T_0^{(0)}$).

#### 1. Optimization Formulation with GNC-TLS
Instead of standard Huber loss, the optimizer implements **Graduated Non-Convexity with Truncated Least Squares (GNC-TLS)**:

$$\min_{\{T_i\}, \{\mu_e\}} \sum_{e=(i,i+1) \in \mathcal{E}_{\text{odom}}} \| r_e(T_i, T_{i+1}) \|_{\Sigma_{\text{odom}}}^2 + \sum_{e=(i,j) \in \mathcal{E}_{\text{loop}}} \left[ \mu_e \| r_e(T_i, T_j) \|_{\Sigma_{\text{loop}}}^2 + \phi(\mu_e) \right]$$

Where:
- $r_e(T_i, T_j) = \text{Log}\left( T_{ij}^{\text{metric}} \cdot (T_j \cdot T_i^{-1})^{-1} \right) \in \mathfrak{se}(3)$.
- $\mu_e \in [0, 1]$ is a dynamic weight associated with loop edge $e$.
- In each GNC iteration, edge weights $\mu_e$ are updated according to the current residual error:
  $$\mu_e = \begin{cases} 1 & \text{if } \|r_e\|^2 \le \frac{\mu}{\mu+1} \bar{c}^2 \\ 0 & \text{if } \|r_e\|^2 \ge \frac{\mu+1}{\mu} \bar{c}^2 \\ \frac{\bar{c}}{\|r_e\|}\sqrt{\mu(\mu+1)} - \mu & \text{otherwise} \end{cases}$$
- As the convexity parameter $\mu \to 0$, GNC transitions to Truncated Least Squares, **completely pruning outlier loop edges ($\mu_e = 0$)** to prevent trajectory distortion.

#### 2. High-Performance Lightweight Sparse Solver in WASM
- To solve the linearized normal equations $(J^T W J + \lambda I)\Delta x = -J^T W r$ for 200+ frames (dimension $1200 \times 1200$), a lightweight custom C++ WebAssembly module is compiled using **`Eigen::SimplicialLDLT`** sparse Cholesky factorization.
- Eliminates heavy, monolithic runtime dependencies like full Ceres or g2o builds, while maintaining deterministic numerical precision and executing a full LM iteration in $< 20\text{ ms}$ on standard browser CPU runtimes.

---

### 3.5 Three-Tier Graceful Degradation Strategy

In **Iteration 1**, `signals` is `undefined`, and the refiner operates in **Pure Appearance Mode** using Sim(3)-style relative scale alignment (Priority 3). Priority 1 (Depth Unprojection) remains dormant until `signals.depthMaps` is provided in **Iteration 2**.

When auxiliary signals are present in Iteration 2, ARCore depth maps (which degrade beyond 8 meters and suffer from missing data in specular/sky regions) are governed by a 3-tier adaptive degradation policy:

| Valid Depth Ratio ($\frac{\text{Valid Pixels}}{\text{Total Pixels}}$) | Operational Mode | Processing Strategy |
| :--- | :--- | :--- |
| **$\ge 40\%$ (High Confidence)** | **Full Geometric Mode** | • Enable Depth-Guided Pre-Warping before feature matching.<br>• Unproject depth to point clouds and execute **3D-3D Depth-ICP** for fine relative pose constraints $\mathcal{E}_{\text{icp}}$. |
| **$15\% \le \text{Ratio} < 40\%$ (Partial Depth)** | **PnP Scale Recovery Mode** | • Disable Depth Pre-Warping to prevent projection distortion.<br>• Use valid depth samples for **direct depth unprojection (Priority 1 in §3.3)** on matched 2D keypoints for 3D-2D PnP scale recovery. |
| **$< 15\%$ or `signals` Undefined (Iter 1)** | **Pure Appearance Mode** | • Bypass depth processing entirely.<br>• Default to **Prior Baseline Distance Scale Alignment (Priority 3 in §3.3)** for loop edge scaling, with optional local sub-map track triangulation (Priority 2). |

---

## 4. TypeScript Interface Contracts & Seam Definitions

```typescript
/**
 * Core COLMAP data structures matching sparse/0/ text and binary definitions.
 */
export interface ColmapCamera {
  cameraId: number;
  model: 'PINHOLE' | 'SIMPLE_PINHOLE' | 'RADIAL' | 'OPENCV';
  width: number;
  height: number;
  params: number[]; // [fx, fy, cx, cy, ...]
}

export interface ColmapImage {
  imageId: number;
  /** Quaternion in COLMAP world-to-camera convention: [qw, qx, qy, qz] */
  qvec: [number, number, number, number];
  /** Translation vector: [tx, ty, tz] */
  tvec: [number, number, number];
  cameraId: number;
  name: string;
  /** 2D point observations (empty for raw occupancy models) */
  xys?: [number, number][];
  point3DIds?: number[];
}

export interface ColmapPoint3D {
  point3DId: number;
  xyz: [number, number, number];
  rgb: [number, number, number];
  error: number;
  trackImageIds?: number[];
  trackPoint2DIndices?: number[];
}

export interface ColmapModel {
  cameras: Map<number, ColmapCamera>;
  images: Map<number, ColmapImage>;
  points3D: Map<number, ColmapPoint3D>;
}

/**
 * Auxiliary recorder stream parsed from actions/*.json (Iteration 2).
 */
export interface RecorderAuxiliarySignals {
  odometryPath?: Array<{
    timestamp: number;
    position: [number, number, number];
    quaternion: [number, number, number, number];
  }>;
  depthMaps?: Map<string, ArrayBuffer | Float32Array>;
  gpsFixes?: Array<{ lat: number; lon: number; alt: number; timestamp: number }>;
}

export interface RefinerOptions {
  matcher: 'lightglue-aliked' | 'loma-b';
  backend: 'webgpu' | 'wasm';
  maxKeypoints: number;
  inlierThresholdPx: number;
  spatialGridOccupancyThreshold: number; // default: 0.25 (16/64 cells)
  /**
   * Iteration 2 Enhancement: Requires signals.depthMaps parsed from actions/*.json.
   * Dormant / false by default in Iteration 1 (COLMAP-only mode).
   */
  enableDepthPrewarping: boolean;
  depthValidThreshold: number; // default: 0.40
  gncIterations: number;
  gncBarcThreshold: number;
}

/**
 * Diagnostic and visualization metadata for an evaluated loop closure edge.
 */
export interface LoopConstraintEdge {
  fromImageId: number;
  toImageId: number;
  /** Relative metric pose: quaternion [qw, qx, qy, qz] */
  qvec: [number, number, number, number];
  /** Relative metric translation: [tx, ty, tz] */
  tvec: [number, number, number];
  /** Dynamic GNC weight in [0, 1] (0 = pruned outlier) */
  gncWeight: number;
  inlierCount: number;
  meanReprojectionErrorPx: number;
  scaleSource: 'depth-unprojection' | 'wide-baseline-triangulation' | 'prior-baseline-fallback';
}

export interface RefinerMetrics {
  pairCount: number;
  loopClosuresEvaluated: number;
  loopClosuresAccepted: number;
  loopClosuresPrunedByGNC: number;
  meanInliersPerAcceptedLoop: number;
  spatialCoverageRatios: number[];
  depthDegradationTier: 'full-geometric' | 'pnp-scale-only' | 'pure-appearance';
  optimizerInitialCost: number;
  optimizerFinalCost: number;
  loopEdges: LoopConstraintEdge[];
  runtimeMs: {
    featureMatching: number;
    pnpScaleRecovery: number;
    gncOptimization: number;
    total: number;
  };
}

export interface RefinerResult {
  refinedModel: ColmapModel;
  metrics: RefinerMetrics;
}

/**
 * Pure transform interface for Task 2 pose refinement.
 */
export type PoseRefiner = (
  model: ColmapModel,
  images: Map<string, Blob | Uint8Array>,
  signals?: RecorderAuxiliarySignals,
  options?: Partial<RefinerOptions>
) => Promise<RefinerResult>;
```

### Invariants & Non-Obvious Rules:
1. **Pass-Through `points3D` Cloud:** The occupancy point cloud in `points3D.txt` must be passed through untouched ($100\%$ byte-faithful). 3DGS utilizes the point cloud solely as an initial seed; refining extrinsics provides the true quality leverage.
2. **Fixed Intrinsics:** Camera parameters in `cameras.txt` remain fixed to avoid degenerate focal length solutions under planar orbital motions.
3. **Immutability:** The input `ColmapModel` must never be mutated in-place; `refine()` returns a newly instantiated `ColmapModel`.

---

## 5. Implementation & Verification Roadmap (Task 2 Goal 2)

### Milestone 1: TS Seam Infrastructure & WASM Solver Validation
- **Objective:** Establish the foundational TypeScript COLMAP I/O pipeline and verify the custom WASM GNC-TLS optimizer on synthetic drift graphs.
- **Key Deliverables:**
  - Streaming COLMAP Reader and Writer adhering to exact format-faithful text/binary serialization.
  - Custom C++ WASM module wrapping `Eigen::SimplicialLDLT` sparse Cholesky factorization.
  - Synthetic graph test verifying analytical Lie algebraic Jacobians against numerical derivatives, recovery from injected Gaussian drift, and hard rejection ($\mu_e = 0$) of $30\%$ false-positive loop edges.
  - Round-trip fidelity test: `parse(model) -> serialize(model)` produces structurally identical COLMAP archives.

### Milestone 2: Browser WebGPU / ONNX Inference & Static Shape Memory Lifecycle
- **Objective:** Implement client-side deep feature extraction and matching with strict browser memory management.
- **Key Deliverables:**
  - ONNX Runtime Web integration executing decomposed `detector.onnx`, `descriptor.onnx`, and `matcher.onnx` (LightGlue baseline with LoMa-B candidate compatibility).
  - Static-shape tensor binding ($N = 1024 / 2048$) with binary validity masks.
  - Background Web Worker decoding pipeline with explicit `ImageBitmap.close()` and `tensor.dispose()` recycling to guarantee zero memory leaks over 200+ image sequences.

### Milestone 3: End-to-End Visual Loop Closure & Scale Recovery Integration
- **Objective:** Integrate pair selection, Union-Find track clustering, metric scale resolution, and pose-graph optimization into the pure `refine()` transform.
- **Key Deliverables:**
  - $8 \times 8$ spatial grid coverage filter rejecting localized perceptual aliasing clusters.
  - Disjoint-Set Union-Find track builder with strict 1-to-1 frame consistency checks.
  - Metric scale recovery engine defaulting to Prior Baseline Distance Scale Alignment (Priority 3) with cheirality/parallax-gated sub-map PnP (Priority 2).
  - Complete `refine(model, images)` transform returning refined extrinsics and diagnostic metrics.

### Milestone 4: End-to-End Proof via Measurement Harness
- **Objective:** Validate photometric and geometric reconstruction improvements against the Referee measurement harness.
- **Key Deliverables:**
  - End-to-end execution pipeline: `Raw Zip -> refine() -> LichtFeld-Studio Headless -> Measurement Harness`.
  - Harness verification report demonstrating improved held-out PSNR/SSIM, reduced reprojection error, and sharper A/B visual renderings on real outdoor ARCore test captures.
