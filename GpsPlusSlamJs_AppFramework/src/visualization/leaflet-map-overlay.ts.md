# leaflet-map-overlay.ts

## Purpose

Embeds a full interactive Leaflet map into the Three.js 3D scene via `CSS3DObject`. Replaces the old single-tile `MapOverlay` with multi-tile rendering, native pan/zoom, and live GPS trajectory layers. The trajectory (raw GPS path + accuracy circles, fused path, alignment snapshots, optional user-position dot) is drawn from a single resolved `MapData` snapshot via the shared `drawMapData` routine — the SAME routine the 2D session-summary map uses — supplied through `render(data)`. Reference-point markers are an app concept driven separately via the generic named-marker API.

## Public API

### `LeafletMapOverlay(scene, camera, options?)`

Constructor — creates an overlay instance (does not show it yet).

| Param     | Type                       | Default | Description                         |
| --------- | -------------------------- | ------- | ----------------------------------- |
| `scene`   | `THREE.Scene`              | —       | The Three.js scene                  |
| `camera`  | `THREE.Camera`             | —       | The active camera                   |
| `options` | `LeafletMapOverlayOptions` | `{}`    | Configuration overrides (see below) |

### `LeafletMapOverlayOptions`

| Field           | Type                       | Default         | Description                                                             |
| --------------- | -------------------------- | --------------- | ----------------------------------------------------------------------- |
| `mapSizePx`     | `number`                   | `600`           | Pixel dimensions of the Leaflet container                               |
| `worldSize`     | `number`                   | `10`            | World-space size in meters                                              |
| `heightOffset`  | `number`                   | `-4`            | Height below parent in meters                                           |
| `zoomLevel`     | `number`                   | `17`            | Initial Leaflet zoom level                                              |
| `tileServerUrl` | `string`                   | OSM URL         | Tile server URL template                                                |
| `mapParent`     | `THREE.Object3D`           | `camera`        | Parent node for the CSS3DObject                                         |
| `onTileError`   | `(error: unknown) => void` | `undefined`     | Callback when tile loading fails (e.g., offline)                        |
| `offscreenRoot` | `HTMLElement`              | `document.body` | DOM node for off-screen Leaflet container append                        |
| `headingUp`     | `boolean`                  | `false`         | Start in heading-up mode (rotate the map so the user heading points up) |

### Key Methods

| Method                             | Description                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setGpsPosition(lat, lon)`         | Set/update GPS position; centers the map (user dot is drawn from `MapData`)                                                                                                                                                                                                                                                                                                                                                         |
| `show()`                           | Create Leaflet map + CSS3DObject; requires GPS position                                                                                                                                                                                                                                                                                                                                                                             |
| `hide()`                           | Remove CSS3DObject from scene (preserves buffered data)                                                                                                                                                                                                                                                                                                                                                                             |
| `toggle()`                         | Toggle visibility                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `render(data)`                     | Draw a full trajectory snapshot (`MapData`) via the shared `drawMapData` routine (always with `showUserPosition: true`); replaces the previous layers wholesale (buffered before `show()`). Fused path recomputes from the latest matrix (D2), matching the summary map. When `MapData.userHeadingDeg` is set it draws a true-north view-direction line from the user dot (Finding 2, 2026-06-28); live and replay share this path. |
| `addCurrentMarker(lat, lon, name)` | Add a generic "current" named marker (red dot, popup label). App-defined semantics — used by recorder for newly observed ref-points.                                                                                                                                                                                                                                                                                                |
| `addPriorMarker(lat, lon, name)`   | Add a "prior" named marker (green, decorated with 📌). Used by recorder for historical ref-points loaded from prior sessions.                                                                                                                                                                                                                                                                                                       |
| `addPriorMarkers(markers)`         | Bulk-add prior markers.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `clearPriorMarkers()`              | Remove all prior markers; current markers untouched.                                                                                                                                                                                                                                                                                                                                                                                |
| `setZoomLevel(zoom)`               | Set zoom level (clamped 0–19)                                                                                                                                                                                                                                                                                                                                                                                                       |
| `zoomIn()`                         | Increment zoom by 1 (clamped at max)                                                                                                                                                                                                                                                                                                                                                                                                |
| `zoomOut()`                        | Decrement zoom by 1 (clamped at min)                                                                                                                                                                                                                                                                                                                                                                                                |
| `getLeafletMap()`                  | Returns the Leaflet `L.Map` instance or `null`                                                                                                                                                                                                                                                                                                                                                                                      |
| `setHeadingUpEnabled(enabled)`     | Enable/disable heading-up rotation at runtime. Disabling snaps the map back to the north-up baseline immediately.                                                                                                                                                                                                                                                                                                                   |
| `isHeadingUpEnabled()`             | Whether heading-up rotation is currently enabled.                                                                                                                                                                                                                                                                                                                                                                                   |
| `updatePosition(dtSeconds?)`       | Per-frame hook. Position follows the parent via the scene graph; this drives the heading-up rotation only — smooths the map yaw toward the latest ~1 Hz `MapData.userHeadingDeg` and applies it. No-op when heading-up is disabled, not shown, or the heading is undefined (holds the last orientation). `dtSeconds` drives the smoothing rate (default 0 = no progress).                                                           |
| `dispose()`                        | Full cleanup — hides, destroys map, clears buffers                                                                                                                                                                                                                                                                                                                                                                                  |

### Exported Constants

- `DEFAULT_LEAFLET_MAP_SIZE_PX` — 600
- `DEFAULT_WORLD_SIZE` — 10
- `DEFAULT_HEIGHT_OFFSET` — -4
- `DEFAULT_ZOOM` — 17

## Invariants & Assumptions

- `show()` is a no-op if no GPS position has been set via `setGpsPosition()`.
- The trajectory snapshot passed to `render()` is **buffered** — it can be supplied before `show()` and is drawn when the map becomes visible. Each `render()` removes the previous trajectory layers and redraws, so the live fused path "snaps" as the alignment matrix improves.
- The Leaflet container is appended to `offscreenRoot` (default: `document.body`) off-screen (`position: fixed; left: -9999px`) for Leaflet initialization. When `show()` creates the CSS3DObject, these off-screen styles are **cleared** — CSS3DRenderer positions elements via CSS transforms, which are visual-only offsets from the element's layout position. Retaining `position: fixed` with `left/top: -9999px` would push the element off-screen because the transform applies on top of that extreme offset.
- **No hardcoded CSS class names** on Leaflet markers — internal markers use empty `className` to avoid coupling to external stylesheets.
- **Ref-point marker prominence (F5-A, 2026-06-16 user feedback).** `addCurrentMarker` / `addPriorMarker` dots are sized by `REF_POINT_MARKER_SIZE_PX` (**20 px**, enlarged from 12) with a 3 px white halo + drop shadow so they are obvious on the small CSS3D minimap — the field tester reported the minimap "showed the user but not the marker" because the old 12 px dots were too small to notice. A test locks the rendered `divIcon` `iconSize` ≥ 18 px so it cannot silently shrink back.
- Trajectory colors (raw GPS yellow, fused cyan, snapshot red, user-position blue) live in the shared `map-overlay-draw.ts` / `VIS_COLORS` palette — the overlay no longer draws them itself.
- CSS3DObject scale = `worldSize / mapSizePx` so the DOM map appears at the configured world size.
- CSS3DObject is parented to `mapParent` (default: camera), positioned at `(0, heightOffset, -0.5)`, rotated `−π/2` on X to lie in the XZ plane.
- **Heading-up rotation (2026-06-29 plan).** Off by default (north-up). When enabled, `updatePosition(dt)` smooths the map's in-plane yaw toward the latest `MapData.userHeadingDeg` (a ~1 Hz target) every frame via `lerpAngleDeg` + `clampedAlpha`, and applies `headingUpQuat` (yaw about world-up composed with the baseline tilt — see `heading-up-rotation.ts`). The first sample snaps (no spin-up from north); a `null` heading holds the last orientation; disabling restores the baseline tilt. The parent (`CameraFollower`) is rotation-identity so the yaw is about true world up. Live-only by convention (replay stays north-up). The perceived rotation **sign** is an open device spot-check (see the 2026-06-29 plan).

## Examples

```ts
import { LeafletMapOverlay } from './leaflet-map-overlay';
import { buildMapData } from './map-data';

const overlay = new LeafletMapOverlay(scene, camera, {
  mapParent: cameraFollower.object3D,
});

overlay.setGpsPosition(49.99, 8.24);
overlay.show();

// Live data from store subscribers — build a full snapshot and render it:
overlay.render(
  buildMapData({
    rawGpsPath,
    odometryPositions,
    alignmentMatrix,
    zeroRef,
    alignmentSnapshots,
  })
);

// Cleanup:
overlay.dispose();
```

## Tests

- `leaflet-map-overlay.test.ts` — unit tests covering constructor defaults, visibility toggling, GPS position, live overlays, 3D positioning, buffered data, zoom level control (setZoomLevel, zoomIn, zoomOut, clamping), tile error callback (onTileError invocation, graceful degradation, multiple errors), CSS3DObject compatibility (off-screen style clearing), dispose, and DOM hardcoding audit regressions (P5 no hardcoded classNames, P6 VIS_COLORS.USER_POSITION usage, P9 offscreenRoot option). Reference-point markers were stripped in Iter 4D of the boundary cleanup; recorder-side composition lives in `GpsPlusSlamJs_RecorderApp/src/visualization/`.
