# leaflet-map-overlay.ts

## Purpose

Embeds a full interactive Leaflet map into the Three.js 3D scene via `CSS3DObject`. Replaces the old single-tile `MapOverlay` with multi-tile rendering, native pan/zoom, and live GPS overlay layers (raw path, fused path, alignment snapshots, reference points).

## Public API

### `LeafletMapOverlay(scene, camera, options?)`

Constructor — creates an overlay instance (does not show it yet).

| Param     | Type                       | Default | Description                         |
| --------- | -------------------------- | ------- | ----------------------------------- |
| `scene`   | `THREE.Scene`              | —       | The Three.js scene                  |
| `camera`  | `THREE.Camera`             | —       | The active camera                   |
| `options` | `LeafletMapOverlayOptions` | `{}`    | Configuration overrides (see below) |

### `LeafletMapOverlayOptions`

| Field           | Type                       | Default         | Description                                      |
| --------------- | -------------------------- | --------------- | ------------------------------------------------ |
| `mapSizePx`     | `number`                   | `600`           | Pixel dimensions of the Leaflet container        |
| `worldSize`     | `number`                   | `10`            | World-space size in meters                       |
| `heightOffset`  | `number`                   | `-4`            | Height below parent in meters                    |
| `zoomLevel`     | `number`                   | `17`            | Initial Leaflet zoom level                       |
| `tileServerUrl` | `string`                   | OSM URL         | Tile server URL template                         |
| `mapParent`     | `THREE.Object3D`           | `camera`        | Parent node for the CSS3DObject                  |
| `onTileError`   | `(error: unknown) => void` | `undefined`     | Callback when tile loading fails (e.g., offline) |
| `offscreenRoot` | `HTMLElement`              | `document.body` | DOM node for off-screen Leaflet container append |

### Key Methods

| Method                             | Description                                                        |
| ---------------------------------- | ------------------------------------------------------------------ |
| `setGpsPosition(lat, lon)`         | Set/update GPS position; centers map and moves user dot            |
| `show()`                           | Create Leaflet map + CSS3DObject; requires GPS position            |
| `hide()`                           | Remove CSS3DObject from scene (preserves buffered data)            |
| `toggle()`                         | Toggle visibility                                                  |
| `addRawGpsPoint(lat, lon)`         | Append point to raw GPS polyline (yellow)                          |
| `addFusedPoint(lat, lon)`          | Append point to fused polyline (cyan)                              |
| `addAlignmentSnapshot(lat, lon)`   | Add point to red alignment snapshot polyline                       |
| `setZoomLevel(zoom)`               | Set zoom level (clamped 0–19)                                      |
| `zoomIn()`                         | Increment zoom by 1 (clamped at max)                               |
| `zoomOut()`                        | Decrement zoom by 1 (clamped at min)                               |
| `getLeafletMap()`                  | Returns the Leaflet `L.Map` instance or `null`                     |
| `updatePosition()`                 | No-op (backward compat with frame-loop call)                       |
| `dispose()`                        | Full cleanup — hides, destroys map, clears buffers                 |

### Exported Constants

- `DEFAULT_LEAFLET_MAP_SIZE_PX` — 600
- `DEFAULT_WORLD_SIZE` — 10
- `DEFAULT_HEIGHT_OFFSET` — -4
- `DEFAULT_ZOOM` — 17

## Invariants & Assumptions

- `show()` is a no-op if no GPS position has been set via `setGpsPosition()`.
- Overlay data (`addRawGpsPoint`, etc.) is **buffered** — can be called before `show()` and will be rendered when the map becomes visible.
- The Leaflet container is appended to `offscreenRoot` (default: `document.body`) off-screen (`position: fixed; left: -9999px`) for Leaflet initialization. When `show()` creates the CSS3DObject, these off-screen styles are **cleared** — CSS3DRenderer positions elements via CSS transforms, which are visual-only offsets from the element's layout position. Retaining `position: fixed` with `left/top: -9999px` would push the element off-screen because the transform applies on top of that extreme offset.
- **No hardcoded CSS class names** on Leaflet markers — internal markers use empty `className` to avoid coupling to external stylesheets.
- User position dot color uses `VIS_COLORS.USER_POSITION.css` from the centralized palette.
- CSS3DObject scale = `worldSize / mapSizePx` so the DOM map appears at the configured world size.
- CSS3DObject is parented to `mapParent` (default: camera), positioned at `(0, heightOffset, -0.5)`, rotated `−π/2` on X to lie in the XZ plane.
- Colors match `VIS_COLORS` constants: raw GPS = yellow, fused = cyan, snapshot = red.

## Examples

```ts
import { LeafletMapOverlay } from './leaflet-map-overlay';

const overlay = new LeafletMapOverlay(scene, camera, {
  mapParent: cameraFollower.object3D,
});

overlay.setGpsPosition(49.99, 8.24);
overlay.show();

// Live data from store subscribers:
overlay.addRawGpsPoint(49.991, 8.241);
overlay.addFusedPoint(49.991, 8.241);

// Cleanup:
overlay.dispose();
```

## Tests

- `leaflet-map-overlay.test.ts` — unit tests covering constructor defaults, visibility toggling, GPS position, live overlays, 3D positioning, buffered data, zoom level control (setZoomLevel, zoomIn, zoomOut, clamping), tile error callback (onTileError invocation, graceful degradation, multiple errors), CSS3DObject compatibility (off-screen style clearing), dispose, and DOM hardcoding audit regressions (P5 no hardcoded classNames, P6 VIS_COLORS.USER_POSITION usage, P9 offscreenRoot option). Reference-point markers were stripped in Iter 4D of the boundary cleanup; recorder-side composition lives in `GpsPlusSlamJs_RecorderApp/src/visualization/`.
