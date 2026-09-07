# Measurement Harness Specification & Technical Contract (Task 2 Goal 1 Component 3)

> **Status:** Draft / Specification
> **Component:** Task 2 Goal 1 — Component 3 (The Referee)
> **Seam Contract:** COLMAP Sparse Model (`sparse/0/`) + Images (`images/`) $\rightarrow$ Metrics Report & Visual Artifacts

---

## 1. Executive Summary & Purpose

The **Measurement Harness** acts as the objective, reproducible referee for all camera pose refinement experiments in Team 6's Gaussian Splatting pipeline. Its core directive is **"Model in $\rightarrow$ Metrics out"**—ensuring that every claim of pose refinement quality ("this splat is better than that one") is backed by rigorous, quantitative numbers and verifiable visual side-by-side evidence, rather than subjective opinions.

To maintain strict scientific fairness and avoid confounding factors, the harness operates against a **frozen baseline protocol** where training hyperparameters, image resolutions, and evaluation view splits remain strictly identical between baseline (raw recorder poses) and candidate (refined poses) runs.

---

## 2. System Architecture & Seam Integration

The Measurement Harness is implemented as a standalone CLI tool in **Node.js / TypeScript** within the `location-based-webxr` repository. It interfaces with external toolchains and model formats via well-defined seams:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   MEASUREMENT HARNESS                                  │
│                                  (Node.js / TypeScript)                                │
│                                                                                        │
│  ┌────────────────────┐   Physical Split   ┌───────────────────┐   Headless Exec       │
│  │ Raw / Refined Zip  │ ─────────────────> │  Training Model   │ ────────────────┐ │
│  │ (COLMAP sparse/0)  │  (Drop held-out)   │ (sparse/0 + imgs) │                 │ │
│  └────────────────────┘                    └───────────────────┘                 │ │
│            │                                                                     │ │
│            │ Reserve                                                             ▼ │
│            ▼                                                           ┌─────────────────┐ │
│  ┌────────────────────┐                                                │ LichtFeld Studio│ │
│  │ Held-Out GT Images │                                                │  (--headless)   │ │
│  │   & Test Poses     │                                                └─────────────────┘ │
│  └────────────────────┘                                                          │ │
│            │                                                                     │ │
│            │                                    Held-Out Views                   │ │
│            │                                      Renders                        │ │
│            │                                         │                           │ │
│            └───────────────────┬─────────────────────┘                           │ │
│                                ▼                                                 │ │
│                    ┌───────────────────────┐                                     │ │
│                    │  Metric Calculator    │ <───────────────────────────────────┘ │
│                    │     (PSNR / SSIM)     │                                       │
│                    └───────────────────────┘                                       │
│                                │                                                   │
│                                ▼                                                   │
│                    ┌───────────────────────┐                                       │
│                    │ Interactive HTML & MD │                                       │
│                    │   Evaluation Report   │                                       │
│                    └───────────────────────┘                                       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Key Technical Decisions:
1. **Physical Dataset Splitting (Option A - Dual COLMAP Model Passing):** The harness performs physical filtering on `sparse/0/images.txt` to generate two distinct model sets:
   - `sparse_train/`: Passed to LichtFeld-Studio to train the 3DGS model on training frames only (guaranteeing zero test data leakage).
   - `sparse_eval/`: Contains held-out test frames and camera poses, passed to LichtFeld-Studio's rendering module to drive held-out evaluation view rendering.
2. **Headless Execution:** LichtFeld-Studio is executed via Node.js sub-processes using its native headless CLI mode (`--headless`), enabling unattended batch evaluation without GUI overhead.
3. **Automated Reprojection Metric Detection:** The harness parses `points3D.txt` to check for 2D–3D feature tracks. If points are synthetic occupancy grid voxels (placeholder error `1.0` with empty track lists), reprojection error is automatically evaluated as `N/A` (`null`). If valid feature tracks exist, it computes geometric reprojection residuals.
4. **Performant Node.js Metric Libraries:** Image decoding and channel extractions are accelerated using `sharp`, and SSIM calculation utilizes optimized buffer libraries (e.g. `ssim.js` / TypedArray operations) to ensure fast TypeScript execution.
5. **Interactive HTML Reporting:** Outputs an interactive `index.html` report featuring Side-by-Side triple views (Baseline | Refined | GT) and an image comparison slider for granular visual inspection of ghosting and blurriness.

---

## 3. Evaluation Methodology & Metrics

### 3.1 Physical Held-Out Split Protocol (Option A Strategy)
- **Stratified Sampling:** By default, every $N$-th frame (default: `heldOutInterval = 8`) is selected as a held-out evaluation frame.
- **Dual-Model Partitioning (Option A):**
  - **Training Subset (`sparse_train/`):** `sparse/0/images.txt` excluding held-out image entries, paired with training JPEG frames in `images/`. Used exclusively during LichtFeld 3DGS training.
  - **Evaluation Subset (`sparse_eval/`):** Held-out ground-truth JPEG frames paired with their target test camera extrinsics and intrinsics. Used to drive LichtFeld headless rendering for held-out evaluation views.

### 3.2 Quantitative & Qualitative Metrics (Meaning & Calculation Specifications)

#### 1. Peak Signal-to-Noise Ratio (PSNR)
* **Meaning & Physical Intuition:** Measures absolute pixel-level reconstruction accuracy between a rendered view and the ground-truth photograph in decibels (dB). Higher values indicate lower pixel-level reconstruction error.
* **Mathematical Definition:**
  Given an $H \times W$ RGB ground-truth image $I_{\text{GT}}$ and a rendered image $I_{\text{rendered}}$:
  $$\text{MSE} = \frac{1}{3 \cdot H \cdot W} \sum_{i=1}^{H} \sum_{j=1}^{W} \sum_{c \in \{R,G,B\}} \left( I_{\text{rendered}}(i,j,c) - I_{\text{GT}}(i,j,c) \right)^2$$
  $$\text{PSNR} = 10 \cdot \log_{10} \left( \frac{\text{MAX}_I^2}{\text{MSE}} \right)$$
  where $\text{MAX}_I = 255$ for 8-bit image formats (or $1.0$ for floating-point normalized buffers).
* **Calculation Protocol & Libraries:**
  1. Load ground-truth JPEG frame and rendered held-out frame into memory using `sharp` for fast buffer decoding into raw RGB byte arrays.
  2. Compute per-pixel channel difference squared, sum over all pixels and channels, and divide by $3 \cdot H \cdot W$.
  3. Compute $\text{PSNR} = 10 \cdot \log_{10}(65025 / \text{MSE})$. If $\text{MSE} = 0$, clamp PSNR to $100.0\text{ dB}$.

#### 2. Structural Similarity Index Measure (SSIM)
* **Meaning & Physical Intuition:** Evaluates perceptual visual similarity by comparing local luminance, contrast, and structural correlation. Unlike PSNR (which is purely pixel-wise), SSIM closely matches human visual perception of sharpness and structural fidelity. Values range from $[-1, 1]$, where $1.0$ represents identical perceptual structure.
* **Mathematical Definition:**
  For local image patches $x$ (Rendered) and $y$ (Ground Truth) using an $11 \times 11$ circular Gaussian window ($\sigma = 1.5$):
  $$\text{SSIM}(x,y) = \frac{(2\mu_x \mu_y + C_1)(2\sigma_{xy} + C_2)}{(\mu_x^2 + \mu_y^2 + C_1)(\sigma_x^2 + \sigma_y^2 + C_2)}$$
  where:
  - $\mu_x, \mu_y$ are local window weighted means.
  - $\sigma_x^2, \sigma_y^2$ are local variances and $\sigma_{xy}$ is local covariance.
  - $C_1 = (K_1 L)^2, C_2 = (K_2 L)^2$ with stability constants $K_1 = 0.01, K_2 = 0.03, L = 255$.
* **Calculation Protocol & Libraries:**
  1. Convert RGB images to grayscale luminance $Y = 0.299R + 0.587G + 0.114B$ via `sharp`.
  2. Execute SSIM window calculations using optimized Node.js buffer operations or tested packages (e.g., `ssim.js`) to avoid manual pixel loop bottlenecks.
  3. Compute local SSIM map and average over all window locations to yield Mean SSIM (MSSIM).

#### 3. Geometric Reprojection Error & Bundle Adjustment Residuals
* **Meaning & Physical Intuition:** Measures explicit 3D-to-2D geometric self-consistency of camera extrinsics and 3D structure. Represents the mean pixel distance (L2 norm) between observed 2D keypoint locations and projected 3D points.
* **Mathematical Definition:**
  Let $\mathbf{P}_k \in \mathbb{R}^3$ be a 3D point, $R_i \in SO(3)$ and $t_i \in \mathbb{R}^3$ be the world-to-camera pose of image $i$, $K$ be the camera intrinsics matrix, and $\mathbf{p}_{i,k} \in \mathbb{R}^2$ be the observed 2D keypoint location:
  $$\pi(\mathbf{P}_c) = \begin{bmatrix} f_x \frac{X_c}{Z_c} + c_x \\ f_y \frac{Y_c}{Z_c} + c_y \end{bmatrix} \quad \text{where } \mathbf{P}_c = R_i \mathbf{P}_k + t_i = [X_c, Y_c, Z_c]^T$$
  $$\text{Mean Reprojection Error} = \frac{1}{N_{\text{obs}}} \sum_{i} \sum_{k \in \text{Obs}(i)} \left\| \mathbf{p}_{i,k} - \pi(R_i \mathbf{P}_k + t_i) \right\|_2$$
* **Special Handling & Automated Detection Rule:**
  - **Prerequisite:** Requires real 2D–3D feature correspondences (tracks) in `points3D.txt`.
  - **Recorder Reality:** The raw WebXR recorder exports synthetic 3D points derived from an occupancy grid with a constant placeholder error `1.0` and **no feature tracks** (`POINT3D_ID X Y Z R G B ERROR` with empty track lists).
  - **Automated Detection Protocol:** Upon parsing `points3D.txt`, the harness inspects point track lengths and error values. If all point tracks are empty and error equals `1.0`, the harness automatically returns `meanReprojectionError = null` (`N/A`) and records an explicit explanatory note in the report. If non-empty feature tracks exist (e.g., generated by upstream COLMAP BA), it computes true geometric reprojection residuals.

#### 4. Qualitative Visual Inspection (A/B Artifact Verification)
* **Meaning & Physical Intuition:** Human sanity-checking mechanism to detect geometric and rendering artifacts that numerical averages might obscure.
* **Target Artifacts Monitored:**
  - **Ghosting & Doubled Edges:** Caused by global camera pose drift or incorrect loop closure alignments.
  - **Floating Artifacts (Floaters):** Caused by inconsistent multi-view rays or uncalibrated extrinsics.
  - **Texture Blurring & Smearing:** Caused by per-frame pose errors resulting in misaligned Gaussian splat optimization.

---

## 4. TypeScript Interface Contracts

Below are the normative TypeScript type declarations defining the harness interface and data structures.

```typescript
/**
 * Configuration options for driving a measurement harness run.
 */
export interface HarnessConfig {
  /** Path to the baseline COLMAP ZIP (raw recorder export) */
  baselineZipPath: string;

  /** Optional path to a candidate/refined COLMAP ZIP. If omitted, evaluates baseline only. */
  candidateZipPath?: string;

  /** Target directory where evaluation artifacts and HTML reports will be emitted */
  outputDir: string;

  /** Sampling interval for held-out evaluation frames (e.g. 8 means 1 in 8 frames held out) */
  heldOutInterval: number;

  /** Frozen LichtFeld training parameters */
  trainingParams: {
    iterations: number;
    resolution: number;
    densificationStrategy: 'MRNF' | 'IGS+' | 'MCMC';
    enableMipFilter: boolean;
    enablePPISP: boolean;
    seed: number;
  };

  /** Executable path or command for LichtFeld-Studio binary */
  lichtfeldBinaryPath: string;
}

/**
 * Per-frame evaluation metrics.
 */
export interface FrameMetric {
  imageId: number;
  imageName: string;
  psnr: number;
  ssim: number;
  baselineRenderPath: string;
  candidateRenderPath?: string;
  groundTruthPath: string;
}

/**
 * Summary metrics comparing baseline and candidate runs.
 */
export interface AggregateMetrics {
  meanPsnr: number;
  meanSsim: number;

  /** Mean reprojection error in pixels. null if feature tracks do not exist. */
  meanReprojectionError: number | null;
}

/**
 * Final structured report emitted by the measurement harness.
 */
export interface HarnessReport {
  timestamp: string;
  sceneName: string;
  config: HarnessConfig;

  baselineMetrics: AggregateMetrics;
  candidateMetrics?: AggregateMetrics;

  /** Percentage or absolute improvements (positive means candidate is better) */
  delta?: {
    psnrDelta: number;
    ssimDelta: number;
    reprojectionDelta: number | null;
  };

  perFrameResults: FrameMetric[];
  htmlReportPath: string;
  markdownReportPath: string;
}

/**
 * Core interface for the Measurement Harness referee component.
 */
export interface IMeasurementHarness {
  /**
   * Evaluates a single model or compares a refined candidate against a baseline model.
   * @param config Operational configuration and training parameters.
   * @returns Complete quantitative and visual evaluation report.
   */
  evaluate(config: HarnessConfig): Promise<HarnessReport>;
}
```

---

## 5. Harness Execution Workflow

The CLI script (`npx ts-node src/harness/cli.ts`) executes through the following deterministic phases:

```
Phase 1: Validation & Model Parsing
  ├── Load baseline (and optional candidate) COLMAP ZIPs.
  └── Verify parseability of cameras.txt, images.txt, and points3D.txt.

Phase 2: Option A Dataset Partitioning
  ├── Partition dataset into sparse_train/ (training split) and sparse_eval/ (held-out test split).
  ├── Bundle sparse_train/ with training images for 3DGS optimization.
  └── Extract held-out Ground Truth JPEG frames & evaluation camera extrinsics into sparse_eval/.

Phase 3: Headless LichtFeld Training & Evaluation Rendering
  ├── Launch LichtFeld CLI with --headless to train splat on sparse_train/.
  ├── Invoke LichtFeld render mode passing sparse_eval/ camera poses to render held-out PNGs.
  └── (If candidate present) Repeat training on candidate sparse_train/ and rendering on candidate sparse_eval/.

Phase 4: Metric Calculation & Analysis
  ├── Compute PSNR and SSIM between rendered views and Ground Truth frames.
  └── Calculate mean metrics and performance deltas (Baseline vs Candidate).

Phase 5: Interactive Artifact Generation
  ├── Render HTML Report (index.html) with Side-by-Side comparison & Image Slider.
  └── Generate Markdown Report (report.md) for CI / PR logs.
```

---

## 6. HTML & Markdown Report Specifications

### 6.1 Interactive HTML Report (`index.html`)
The generated `index.html` report is self-contained and visually rich:

1. **Executive Summary Header:**
   - Baseline vs. Refined key comparison indicators (Mean PSNR, Mean SSIM, Reprojection Error).
   - Color-coded badges: Green for improvement ($\Delta \text{PSNR} > 0$), Red for regression.
2. **Configuration Metadata Block:**
   - Display frozen training parameters (iterations, resolution, random seed, densification strategy).
3. **Interactive Side-by-Side / Slider Viewers:**
   - **Triple-View Layout:** Displays `[ Baseline Render | Candidate Render | Ground Truth (GT) ]` in parallel for each held-out view.
   - **Interactive Overlay Slider:** Allows mouse-hover / drag toggling between Baseline and Candidate renders to instantly spot ghosting, doubled edges, or high-frequency blur.

### 6.2 Markdown Summary (`report.md`)
A lightweight, GitHub-flavored Markdown file emitted alongside `index.html` for easy embedding in Pull Requests and review call artifacts:

```markdown
# Measurement Harness Evaluation Report

- **Scene:** `statue_outdoor_01`
- **Timestamp:** 2026-07-27 14:30:00

## Summary Metrics

| Metric | Baseline (Raw Poses) | Candidate (Refined Poses) | Delta ($\Delta$) |
| :--- | :--- | :--- | :--- |
| **Mean PSNR** | 22.45 dB | **25.12 dB** | +2.67 dB |
| **Mean SSIM** | 0.782 | **0.845** | +0.063 |
| **Reprojection Error** | `N/A` (Occupancy Grid) | `N/A` (Occupancy Grid) | `N/A` |

*Full interactive visual comparison report available at [index.html](./index.html).*
```

---

## 7. Verification & Testing Strategy

To adhere to Team 6's testing guidelines, the Measurement Harness is verified at two levels:

1. **Unit Tests (Pure Metric & Split Logic):**
   - **Metric Math Tests:** Test `calculatePSNR` and `calculateSSIM` on synthetic image pairs with known ground-truth noise levels.
   - **Split Logic Tests:** Assert that input COLMAP models with $M$ images split deterministically into $M_{train} = M - \lfloor M/N \rfloor$ training images and $M_{val} = \lfloor M/N \rfloor$ evaluation images, preserving exact image IDs and pose parameters.
2. **End-to-End Replay Tests:**
   - Run the harness against a standard Task 1 recorder ZIP fixture.
   - Assert that the harness completes execution, invokes LichtFeld in headless mode, produces valid numeric PSNR/SSIM outputs, and generates accessible `index.html` and `report.md` files.

---

## 8. Open Questions & Future Considerations

The following design aspects are explicitly marked for team discussion and future iteration:

1. **Order of Refinement vs. Dataset Splitting:**
   - *Question:* Should the `refine(model)` algorithm run on the entire camera trajectory before splitting into `sparse_train/` and `sparse_eval/` (allowing global loop closure to optimize test camera poses as well), or should `refine()` be strictly restricted to the training subset?
   - *Status:* Open topic for alignment with Product Owner and team.

2. **Baseline Freeze Result Caching:**
   - *Question:* Should the harness implement a baseline evaluation cache (storing baseline PSNR/SSIM metrics and rendered views for a given dataset and `heldOutInterval`) to avoid repeating identical baseline LichtFeld training runs across multiple candidate refinement tests?
   - *Status:* Open topic for future iteration.
