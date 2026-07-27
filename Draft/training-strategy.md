# Density Control Strategies in LichtFeld Studio (LFS)

This document outlines the differences, technical mechanisms, and ideal use cases for the three main densification (density control) strategies available in LichtFeld Studio: **MRNF**, **IGS+**, and **MCMC**.

---

## Overview Comparison

| Strategy | Core Mechanism | Key Advantages | Best Use Cases |
| :--- | :--- | :--- | :--- |
| **MRNF** | Edge-guided Adaptive Density Control (ADC) | Exceptional edge & high-frequency detail retention; highly balanced | Default choice for general scenes and standard 3D reconstruction tasks |
| **IGS+** | Long-Axis-Split (LAS) + Laplacian/NMS importance sampling | Low memory/Gaussian count, fast training & rendering speed | Budget-constrained setups, dense camera view datasets, or lightweight model deployment |
| **MCMC** | Markov Chain Monte Carlo probabilistic resampling | Extremely clean output, effectively suppresses floating artifacts (*floaters*) | Noisy datasets, inaccurate camera poses, or scenes with complex occlusions |

---

## Detailed Breakdown

### 1. MRNF (Edge-Guided Adaptive Density Control)
* **Technical Mechanism**: An edge-guided variant of traditional Adaptive Density Control (ADC). It directs Gaussian growth and splitting (Grow & Split) specifically toward image-edge and high-frequency texture regions, while pruning points using raw opacity and scale thresholds.
* **Key Features**:
  * **Superior Fine Details**: Preserves crisp boundaries, thin structures (e.g., foliage, grids, sharp outlines), and fine textures far better than baseline 3DGS.
  * **High Versatility**: Serves as the primary recommended default strategy in LichtFeld Studio for most real-world scenes.
* **When to Use**: Default choice when high visual fidelity across sharp borders is required.

---

### 2. IGS+ (ImprovedGS+ Strategy)
* **Technical Mechanism**: Based on the *ImprovedGS+* algorithm, natively re-implemented with hardware-level C++/CUDA optimizations in LFS. It replaces isotropic cloning with a **Long-Axis-Split (LAS)** CUDA kernel, Laplacian & Non-Maximum Suppression (NMS) edge importance sampling, and adaptive exponential scale scheduling.
* **Key Features**:
  * **High Efficiency**: Eliminates redundant Gaussian cloning, significantly reducing compute latency and GPU/Host synchronization overhead.
  * **Low Gaussian Budget**: Achieves high PSNR reconstruction quality with ~13%–38% fewer total Gaussians compared to standard methods, while speeding up training time by ~26%.
* **When to Use**: Ideal for large, densely captured datasets where memory usage, file size, or real-time frame rates are critical constraints.

---

### 3. MCMC (Markov Chain Monte Carlo Strategy)
* **Technical Mechanism**: Based on *3D Gaussian Splatting as Markov Chain Monte Carlo* (arXiv:2404.09591). It models the spatial distribution of Gaussians as a probability density function, replacing heuristic clone/split rules with stochastic MCMC resampling to relocate, add, and eliminate points dynamically in 3D space.
* **Key Features**:
  * **Artifact Suppression**: Excellent at eliminating floating artifacts (*floaters*) and non-geometric noise.
  * **Robustness**: Highly resilient against imperfect camera poses, lighting variations, or dynamic/blurry occlusions in input images.
* **When to Use**: Ideal for noisy, imperfect, or challenging input data where traditional gradient-based splitting produces floating clutter.

---

## References & Papers

1. **LichtFeld Studio Repository**: [MrNeRF/LichtFeld-Studio](https://github.com/MrNeRF/LichtFeld-Studio)
2. **IGS+ Paper**: *Improved Techniques for 3D Gaussian Splatting* ([arXiv:2603.08661](https://arxiv.org/abs/2603.08661))
3. **MCMC Paper**: *3D Gaussian Splatting as Markov Chain Monte Carlo* ([arXiv:2404.09591](https://arxiv.org/abs/2404.09591))

# LichtFeld Studio (LFS): Unchecked Options Analysis & Quality Tuning Guide

This document explains the technical functions of the unchecked options in the LFS Training Parameters panel. Note that **Undistort** is kept unchecked because the dataset camera model is already **`PINHOLE`**.

---

## Options Recommended to Enable (Significantly Boosts Quality)

### 1. Mip Filter
* **Technical Function**: Integrates Mip-Splatting anti-aliasing techniques directly into the rendering pipeline.
* **Impact on Quality**: **Very High**. Effectively eliminates high-frequency flickering (aliasing), noisy floaters, and jagged edges when zooming out, viewing from oblique angles, or moving the camera.

### 2. PPISP (Physical Photometric Image Signal Processor)
* **Technical Function**: Utilizes a physically grounded photometric model to disentangle lens vignetting, white balance drift, and exposure variations across captured frames.
* **Impact on Quality**: **High**. Prevents photometric inconsistencies from corrupting 3D geometry, eliminating blotchy or uneven surface textures caused by auto-exposure differences.

### 3. Bilateral Grid
* **Technical Function**: Builds a 3D bilateral grid to model and compensate for localized light changes and subtle color shifts.
* **Impact on Quality**: **Moderate to High** (Recommended if PPISP is not used). Ensures smooth color and brightness transitions across neighboring camera viewpoints.

---

## Options Recommended to Leave Unchecked (Not Needed for Standard Setups)

### 1. Undistort
* **Reason**: The camera model of the dataset is already **`PINHOLE`** (distortion-free). Re-running distortion correction is unnecessary and avoids redundant pixel interpolation artifacts.

### 2. GUT (Gaussian Unscented Transform) "sometimes not supported"
* **Reason**: Specifically designed for fisheye lenses, ultra-wide distortion, or rolling-shutter artifacts. Enabling it under standard perspective setups increases CUDA memory and compute overhead without noticeable visual improvements.

### 3. Sparsity
* **Reason**: Applies a sparsity penalty in the loss function to forcibly prune Gaussians for model compression/lightweight deployment. It should remain disabled when pursuing maximum visual fidelity to avoid erasing fine geometric or semi-transparent details.