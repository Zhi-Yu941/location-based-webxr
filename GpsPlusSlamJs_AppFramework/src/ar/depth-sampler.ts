/**
 * Depth Sampler
 *
 * Samples sparse depth points from WebXR depth sensing API.
 * Depth data provides 3D point samples for reconstruction and validation.
 *
 * @see depth-sampler.md for detailed documentation
 */

import type { ARPose, DepthPoint, DepthSample } from '../types/ar-types';
import { extractOdomPosition } from '../state/gps-event-coordinator';

export type { DepthSample } from '../types/ar-types';

/**
 * Configuration for depth sampling behavior.
 */
export interface DepthSamplerConfig {
  /** Interval between samples in milliseconds. Default: 1000ms */
  intervalMs: number;
  /** Number of points per dimension (gridSize x gridSize). Default: 3 */
  gridSize: number;
  /** Time in ms to wait before declaring depth unavailable. Default: 5000ms */
  unavailabilityThresholdMs: number;
}

/**
 * Callbacks for depth sampler events.
 */
export interface DepthSamplerCallbacks {
  /** Called when a depth sample is captured */
  onSampleCaptured: (sample: DepthSample) => void;
  /** Returns the current AR pose, or null if not available */
  getCurrentPose: () => ARPose | null;
  /**
   * Called once when depth is determined to be unavailable.
   * Triggered after unavailabilityThresholdMs with no depth data.
   * Field Test Readiness Issue #8.
   */
  onDepthUnavailable?: () => void;
}

/**
 * WebXR depth info interface (subset of XRDepthInformation).
 */
export interface DepthInfo {
  width: number;
  height: number;
  getDepthInMeters: (x: number, y: number) => number;
}

const DEFAULT_CONFIG: DepthSamplerConfig = {
  intervalMs: 1000,
  gridSize: 3,
  unavailabilityThresholdMs: 5000,
};

/**
 * Samples sparse depth points from WebXR depth sensing.
 *
 * Usage:
 * ```ts
 * const sampler = new DepthSampler({
 *   onSampleCaptured: (sample) => saveSample(sample),
 *   getCurrentPose: () => arSession.getCurrentPose(),
 * });
 * sampler.start();
 * // In frame loop:
 * sampler.onFrame(timestamp, depthInfo);
 * ```
 */
export class DepthSampler {
  private readonly callbacks: DepthSamplerCallbacks;
  private readonly config: DepthSamplerConfig;
  private running = false;
  private sampleCount = 0;
  private lastSampleTime = -Infinity;
  /** Timestamp when sampling started (for unavailability detection) */
  private startTime = -Infinity;
  /** Whether we've ever received valid depth data */
  private depthReceived = false;
  /** Whether we've already fired the unavailable callback */
  private unavailableCallbackFired = false;

  constructor(
    callbacks: DepthSamplerCallbacks,
    config?: Partial<DepthSamplerConfig>
  ) {
    this.callbacks = callbacks;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start depth sampling.
   */
  start(): void {
    this.running = true;
    this.sampleCount = 0;
    this.lastSampleTime = -Infinity;
    this.startTime = performance.now();
    this.depthReceived = false;
    this.unavailableCallbackFired = false;
  }

  /**
   * Stop depth sampling.
   */
  stop(): void {
    this.running = false;
  }

  /**
   * Check if sampler is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the number of samples captured since start.
   */
  getSampleCount(): number {
    return this.sampleCount;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): DepthSamplerConfig {
    return { ...this.config };
  }

  /**
   * Called each frame with depth information.
   *
   * @param timestamp - Current frame timestamp in milliseconds
   * @param depthInfo - WebXR depth information, or null if unavailable
   */
  onFrame(timestamp: number, depthInfo: DepthInfo | null): void {
    if (!this.running) {
      return;
    }

    // Check if depth data is unavailable
    if (!depthInfo) {
      // Check if we should fire the unavailable callback
      // (Field Test Readiness Issue #8: Depth sensing not confirmed)
      this.checkDepthUnavailability();
      return;
    }

    // Mark that we've received depth data
    this.depthReceived = true;

    // Check interval
    if (timestamp - this.lastSampleTime < this.config.intervalMs) {
      return;
    }

    // Get current pose
    const pose = this.callbacks.getCurrentPose();
    if (!pose) {
      return;
    }

    // Sample the grid
    const points = this.sampleGrid(depthInfo);

    // Create sample — convert DOMHighResTimeStamp to epoch ms for consistency
    // with all other action timestamps (GPS events, images, reference points)
    const sample: DepthSample = {
      timestamp: performance.timeOrigin + timestamp,
      cameraPos: extractOdomPosition(pose),
      cameraRot: [
        pose.orientation.x,
        pose.orientation.y,
        pose.orientation.z,
        pose.orientation.w,
      ],
      points,
    };

    this.lastSampleTime = timestamp;
    this.sampleCount++;
    this.callbacks.onSampleCaptured(sample);
  }

  /**
   * Sample a grid of depth points from the depth buffer.
   */
  private sampleGrid(depthInfo: DepthInfo): DepthPoint[] {
    const points: DepthPoint[] = [];
    const gridSize = this.config.gridSize;

    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        // Calculate normalized screen coordinates (avoiding edges)
        // For a 3x3 grid: positions at 0.25, 0.5, 0.75
        const screenX = (col + 1) / (gridSize + 1);
        const screenY = (row + 1) / (gridSize + 1);

        // Sample depth at this position
        const depthM = depthInfo.getDepthInMeters(screenX, screenY);

        points.push({
          screenX,
          screenY,
          depthM,
        });
      }
    }

    return points;
  }

  /**
   * Check if depth has been unavailable for longer than the threshold.
   * If so, fire the onDepthUnavailable callback (once).
   */
  private checkDepthUnavailability(): void {
    // Don't check if we've already received depth or fired callback
    if (this.depthReceived || this.unavailableCallbackFired) {
      return;
    }

    // Don't fire if no callback is registered
    if (!this.callbacks.onDepthUnavailable) {
      return;
    }

    // Check elapsed time since start
    const elapsed = performance.now() - this.startTime;
    if (elapsed >= this.config.unavailabilityThresholdMs) {
      this.unavailableCallbackFired = true;
      this.callbacks.onDepthUnavailable();
    }
  }

  /**
   * Check if depth data has ever been received.
   * Useful for testing and status display.
   */
  hasReceivedDepth(): boolean {
    return this.depthReceived;
  }
}
