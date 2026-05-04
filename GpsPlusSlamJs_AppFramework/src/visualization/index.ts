/**
 * Visualization module — Three.js markers, Leaflet map overlay, alignment lerping, camera follower.
 */

// --- alignment-lerper ---
export {
  type AlignmentLerper,
  createAlignmentLerper,
} from './alignment-lerper.js';

// --- camera-follower ---
export {
  type CameraFollower,
  createCameraFollower,
} from './camera-follower.js';

// --- css3d-renderer-manager ---
export {
  type Css3dRendererManager,
  createCss3dRendererManager,
} from './css3d-renderer-manager.js';

// --- gps-compass-cubes ---
export {
  COMPASS_CUBE_SIZE,
  COMPASS_CUBE_DISTANCE,
  type GpsCompassCubes,
  createGpsCompassCubes,
} from './gps-compass-cubes.js';

// --- gps-event-markers ---
export { GpsEventVisualizer, gpsEventVisualizer } from './gps-event-markers.js';

// --- leaflet-map-overlay ---
// NOTE: DEFAULT_ZOOM and DEFAULT_HEIGHT_OFFSET also exist in map-overlay;
// import directly from the specific module if you need the leaflet variants.
export {
  DEFAULT_LEAFLET_MAP_SIZE_PX,
  DEFAULT_WORLD_SIZE,
  DEFAULT_Z_OFFSET,
  type LeafletMapOverlayOptions,
  LeafletMapOverlay,
} from './leaflet-map-overlay.js';

// --- lerp-utils ---
export { DEFAULT_LERP_RATE, clampedAlpha } from './lerp-utils.js';

// --- map-overlay ---
export {
  DEFAULT_ZOOM,
  DEFAULT_MAP_SIZE,
  DEFAULT_HEIGHT_OFFSET,
  type TextureLoaderInterface,
  type MapOverlayOptions,
  latLonToTileXY,
  tileXYToLatLon,
  MapOverlay,
} from './map-overlay.js';

// --- gps-anchored-mesh-manager ---
export {
  GpsAnchoredMeshManager,
  type GpsAnchoredItem,
  type GpsAnchoredMeshManagerOptions,
} from './gps-anchored-mesh-manager.js';

// --- three-dispose ---
export {
  type DisposeOptions,
  disposeObject3D,
  disposeMeshArray,
} from './three-dispose.js';

// --- vis-colors ---
export { VIS_COLORS } from './vis-colors.js';
