# gps-plus-slam-physics-demo

Physics balls bounce off the **reconstructed occupancy mesh** of a real space.
Two modes, one placement/spawn story:

- **AR (on device):** a live WebXR session reconstructs the room and balls bounce
  off it. _(Lands in a later iteration.)_
- **Desktop replay (the developer harness):** load a recorded walk (`.zip`) and
  replay it — the same occupancy mesh reconstructs from the replayed depth stream
  while you spawn balls against it. No phone, no WebXR, deterministic world.

This is the next rung after `GpsPlusSlamJs_AnchorStarter`: it demonstrates
"developer content reacts to the real reconstructed world" and doubles as a
TDD-friendly harness (record once, iterate on the desktop).

## Status

- **C1 (this iteration):** desktop-replay skeleton — load a recording and replay
  it with live occupancy-mesh reconstruction, play/pause + speed. Built on the
  framework's `startReplaySession` (Part A) and `pointer-picking` (Part B).
- **Next:** a demo-local mesh-view controller (Cubes/Detailed live toggle), then
  Rapier physics (collider from the mesh, spawn/step/bounce), and live AR.

See the design + implementation docs in the private repo:
`GpsPlusSlamJs_Docs/docs/2026-07-15-0533-replay-as-dev-harness-and-physics-demo-design.md`
and its `…-0751-…-summary-and-followups.md` companion.

## Develop

```bash
cd GpsPlusSlamJs_PhysicsDemo
pnpm run dev     # builds the framework, serves on http://localhost:5182
pnpm test        # format + lint + typecheck + unit + e2e
pnpm run test:unit
pnpm run test:e2e
```

The framework is a workspace dependency consumed from its built `dist/`; the
scripts run `build:framework` first, so rebuild after changing framework source.
