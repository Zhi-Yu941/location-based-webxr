/**
 * Tests for the anchor marker extension seam.
 *
 * Why this matters: `createAnchorMarker` is the single "your content here"
 * boundary a student edits. The only contract the framework wiring relies
 * on is "returns one Three.js Object3D"; this test pins that contract so a
 * refactor that accidentally returns undefined/null is caught.
 */

import { describe, it, expect } from 'vitest';
import { Object3D } from 'three';
import { createAnchorMarker } from './marker.js';

describe('createAnchorMarker', () => {
  it('returns a single Three.js Object3D', () => {
    const marker = createAnchorMarker();
    expect(marker).toBeInstanceOf(Object3D);
  });

  it('returns a fresh instance each call (no shared mutable singleton)', () => {
    expect(createAnchorMarker()).not.toBe(createAnchorMarker());
  });
});
