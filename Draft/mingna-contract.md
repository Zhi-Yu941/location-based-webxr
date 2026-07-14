## 1. Core Data Models (TypeScript Interfaces)

### ColmapCamera
Represents the intrinsic parameters and geometry model of a camera.

```typescript
export interface ColmapCamera {
  cameraId: number;       // Unique camera identifier
  model: string;          // Camera model type (e.g., "PINHOLE", "RADIAL")
  width: number;          // Image width in pixels
  height: number;         // Image height in pixels
  params: number[];       // Model-specific intrinsic parameters (e.g., [fx, fy, cx, cy])
}
```

### ColmapImage
Represents the extrinsic parameters (pose) of a registered image and its relationship to the camera.

```typescript
export interface ColmapImage {
  imageId: number;        // Unique image identifier
  quaternion: {           // Rotation represented as a quaternion (W, X, Y, Z)
    qw: number;
    qx: number;
    qy: number;
    qz: number;
  };
  translation: {          // Translation vector (TX, TY, TZ)
    tx: number;
    ty: number;
    tz: number;
  };
  cameraId: number;       // Associated camera ID (references ColmapCamera.cameraId)
  name: string;           // Filename of the image
  points2D: Array<{       // Array of 2D keypoints observed in the image
    x: number;
    y: number;
    point3DId: number;    // Subscribed 3D point ID, or -1 if untriangulated
  }>;
}
```

### ColmapPoint3D
Represents a triangulated point in 3D world space, including its color, error metrics, and visibility track.

```typescript
export interface ColmapPoint3D {
  point3DId: number;      // Unique 3D point identifier
  coordinate: {           // 3D position in world coordinate system
    x: number;
    y: number;
    z: number;
  };
  color: {                // RGB color values [0-255]
    r: number;
    g: number;
    b: number;
  };
  error: number;          // Reprojection error
  track: Array<{          // List of image features that observe this 3D point
    imageId: number;      // References ColmapImage.imageId
    point2DIdx: number;   // The 0-based index of the keypoint within that image
  }>;
}
```

### Top-Level Structure (Entity-Component Map)
To ensure $O(1)$ lookup performance, avoid memory duplication, and natively handle non-continuous sparse IDs, the complete model is managed via lookup maps rather than nested arrays.

```typeScript
export interface ColmapModel {
  cameras: Map<number, ColmapCamera>;     // Key: cameraId
  images: Map<number, ColmapImage>;       // Key: imageId
  points3D: Map<number, ColmapPoint3D>;   // Key: point3DId
}
```

## 2. Reader/Writer Interface Contract (`IColmapReaderWriter`)

To guarantee that unit tests can run completely isolated from the host file system (enabling lossless mock verification via pure strings) while allowing the asset processing layer to gracefully interact with file streams, the interface is specified as follows:

```typescript
export interface IColmapReaderWriter {
  /**
   * Parses the raw decompressed text content into a strongly-typed in-memory model.
   */
  parseModel(files: {
    camerasTxt: string;
    imagesTxt: string;
    points3DTxt: string;
  }): ColmapModel;

  /**
   * Serializes the in-memory strongly-typed model back into standard COLMAP-compliant strings.
   * 
   * 💡 Success Criteria:
   * Performing a parse -> serialize -> parse pipeline on an unmodified model 
   * MUST yield byte-faithful results across all floating-point values and structures.
   */
  serializeModel(model: ColmapModel): {
    camerasTxt: string;
    imagesTxt: string;
    points3DTxt: string;
  };
}
```

## 3. Pose Optimization Pipeline Pure Function Contract (IPoseRefiner)
This interface acts as the "core engine" of the project. Keeping it as a pure function—accepting data and returning new data without triggering any side effects—drastically simplifies replay testing and regression tracking.

```typeScript
export interface IPoseRefiner {
  /**
   * Core algorithm interface for camera pose refinement.
   * 
   * @param inputModel The baseline model parsed by the Reader/Writer interface.
   * @param extraSignals Optional parameter for future iterations to inject high-frequency raw 
   *                     sensor logs (e.g., GPS, IMU) from `actions/*.json`.
   */
  refine(
    inputModel: ColmapModel, 
    extraSignals?: any 
  ): ColmapModel;
}
```

## 4. Measurement Harness Interface Contract (IMeasurementHarness)
Serving as the impartial "referee," this harness is responsible for executing the LichtFeld training run using the provided model and extracting quantitative performance metrics.

```typeScript
export interface QualityMetrics {
  psnr: number;                  // Peak Signal-to-Noise Ratio of held-out views (higher is better)
  ssim: number;                  // Structural Similarity Index Measure (closer to 1.0 is better)
  meanReprojectionError: number; // Mean Reprojection Error (lower is better)
  abRenderLinks: string[];       // Paths or URLs to automatically generated side-by-side comparison renders
}

export interface IMeasurementHarness {
  /**
   * Evaluates the Splat rendering quality of a specific COLMAP model.
   * 
   * @param model The model under test (can be either the baseline or refined variant).
   * @param heldOutImageIds Array of image IDs held back from training, dedicated exclusively to metric calculation.
   */
  evaluate(
    model: ColmapModel, 
    heldOutImageIds: number[]
  ): Promise<QualityMetrics>;
}
```