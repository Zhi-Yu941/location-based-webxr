/**
 * Minimal getting-started example for gps-plus-slam-app-framework.
 *
 * Wires `createSlamAppStore()` (with the no-op `NullStorageBackend`) to
 * a tiny Three.js scene + status panel. No WebXR, no AR session, no map
 * UI — the goal is to show the smallest end-to-end integration that
 * proves the framework + closed-source core resolve and run in a real
 * browser without depending on any recorder-only slices (routing,
 * scenarios, ref-points).
 *
 * See ./status.ts for the (testable) status formatter; everything else
 * here is glue and is verified manually via `pnpm dev` + the bundle's
 * load behavior.
 */
import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import {
  createSlamAppStore,
  selectGpsPositions,
} from 'gps-plus-slam-app-framework/state';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';

import { formatStatus } from './status.js';

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id} element in index.html`);
  }
  return element as T;
}

function setupScene(canvas: HTMLCanvasElement): {
  render: () => void;
  cube: Mesh;
} {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x111111);

  const scene = new Scene();
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 1.2, 3);
  camera.lookAt(0, 0, 0);

  scene.add(new AmbientLight(0xffffff, 0.5));
  const sun = new DirectionalLight(0xffffff, 0.8);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  const cube = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ color: 0x4f8cff })
  );
  scene.add(cube);

  function resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  function render(): void {
    cube.rotation.y += 0.01;
    cube.rotation.x += 0.005;
    renderer.render(scene, camera);
  }
  return { render, cube };
}

function main(): void {
  const canvas = getElement<HTMLCanvasElement>('scene');
  const statusEl = getElement<HTMLPreElement>('status');

  const store = createSlamAppStore({ storageBackend: new NullStorageBackend() });
  const { render } = setupScene(canvas);

  function refreshStatus(): void {
    // selectGpsPositions is currently typed against the framework's internal
    // CombinedRootState (which includes a refPoints slice that this minimal
    // app does not mount). Only `gpsData` is read at runtime, so a structural
    // cast through `unknown` is safe. The selector typing is scheduled to be
    // relaxed in Iter 3 of the AppFramework / RecorderApp boundary cleanup
    // (see GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md).
    const state = store.getState() as unknown as Parameters<typeof selectGpsPositions>[0];
    statusEl.textContent = formatStatus({
      isRecording: store.getState().recorder.isRecording,
      actionCount: store.getState().recorder.actionCount,
      gpsPositionCount: selectGpsPositions(state).length,
      failedWriteCount: store.getState().recorder.failedWriteCount,
    });
  }

  store.subscribe(refreshStatus);
  refreshStatus();

  function tick(): void {
    render();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

main();
