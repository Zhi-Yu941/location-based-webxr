import { BufferAttribute, BufferGeometry, Points, PointsMaterial } from "three";
import type { ScenePalette } from "./palette";

/**
 * Ambient particle field (v3 F2): subtle palette-specific atmosphere in
 * ALL chapters — fireflies (dark/dusk), techno dust (neon), sunlit motes
 * (light/mono). One `Points` cloud, one draw call.
 *
 * Motion is TIME-driven only: `updateParticles(field, nowMs)` is a pure
 * function of the clock (base position + sinusoidal drift), never of
 * scroll progress — the story's scrub-path-independence guarantees stay
 * untouched. The continuous-render loop that animates this is gated by
 * tab visibility and tier in `scene-controller.ts` (the deliberate
 * supersession of strict render-on-demand, recorded in its sidecar).
 */

export const PARTICLE_FIELD_NAME = "ambient-particles";

/** One cloud over the whole walkable world; single draw call. */
const PARTICLE_COUNT = 70;
const AREA_RADIUS = 24;
const MIN_Y = 0.5;
const MAX_Y = 7;
/** Max sinusoidal displacement per axis (keeps the bounds test honest). */
const DRIFT_AMPLITUDE = 1.4;

/** Per-style motion/appearance tuning. */
const STYLE_TUNING = {
  // Sizes are world units (sizeAttenuation) — tuned SMALL on purpose:
  // at the story's pull-back framings anything bigger reads as noise.
  fireflies: { size: 0.16, opacity: 0.7, speed: 0.45, bob: 1.0 },
  dust: { size: 0.1, opacity: 0.5, speed: 0.22, bob: 0.4 },
  motes: { size: 0.13, opacity: 0.45, speed: 0.3, bob: 0.6 },
} as const;

type ParticleStyle = keyof typeof STYLE_TUNING;

/** Deterministic LCG (same recipe as clay-world) — art, not crypto. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

interface ParticleBasis {
  readonly base: Float32Array;
  readonly phase: Float32Array;
  style: ParticleStyle;
}

/**
 * Build the deterministic particle cloud. Base positions stay clear of
 * the drift amplitude from the bounds so animated particles can never
 * leave the world disc or dip under the floor.
 */
export function buildParticleField(): Points {
  const rng = createRng(20260714);
  const base = new Float32Array(PARTICLE_COUNT * 3);
  const phase = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const radius = Math.sqrt(rng()) * (AREA_RADIUS - DRIFT_AMPLITUDE);
    const azimuth = rng() * Math.PI * 2;
    base[i * 3] = Math.cos(azimuth) * radius;
    base[i * 3 + 1] =
      MIN_Y + DRIFT_AMPLITUDE + rng() * (MAX_Y - MIN_Y - 2 * DRIFT_AMPLITUDE);
    base[i * 3 + 2] = Math.sin(azimuth) * radius;
    phase[i] = rng() * Math.PI * 2;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(base.slice(), 3));
  const material = new PointsMaterial({
    size: STYLE_TUNING.motes.size,
    sizeAttenuation: true,
    transparent: true,
    opacity: STYLE_TUNING.motes.opacity,
    depthWrite: false,
  });
  const field = new Points(geometry, material);
  field.name = PARTICLE_FIELD_NAME;
  field.frustumCulled = false;
  const basis: ParticleBasis = { base, phase, style: "motes" };
  field.userData.particleBasis = basis;
  return field;
}

function getBasis(field: Points): ParticleBasis | null {
  const basis: unknown = field.userData.particleBasis;
  if (
    !basis ||
    !((basis as ParticleBasis).base instanceof Float32Array) ||
    !((basis as ParticleBasis).phase instanceof Float32Array)
  ) {
    return null;
  }
  return basis as ParticleBasis;
}

/** Recolor + restyle the field from `palette.particles`. */
export function applyParticlePalette(
  field: Points,
  palette: ScenePalette,
): void {
  const basis = getBasis(field);
  const material = field.material;
  if (!basis || !(material instanceof PointsMaterial)) {
    return;
  }
  basis.style = palette.particles.style;
  const tuning = STYLE_TUNING[basis.style];
  material.color.setHex(palette.particles.color);
  material.size = tuning.size;
  material.opacity = tuning.opacity;
}

/**
 * Advance the drift to the given clock time. Pure in `timeMs`: calling
 * with the same timestamp always yields the same positions.
 */
export function updateParticles(field: Points, timeMs: number): void {
  const basis = getBasis(field);
  if (!basis) {
    return;
  }
  const { speed, bob } = STYLE_TUNING[basis.style];
  const t = (timeMs / 1000) * speed;
  const positions = field.geometry.getAttribute("position");
  for (let i = 0; i < basis.phase.length; i += 1) {
    const p = basis.phase[i] ?? 0;
    const baseX = basis.base[i * 3] ?? 0;
    const baseY = basis.base[i * 3 + 1] ?? 0;
    const baseZ = basis.base[i * 3 + 2] ?? 0;
    positions.setXYZ(
      i,
      baseX + Math.sin(t + p * 1.7) * DRIFT_AMPLITUDE * 0.6,
      baseY + Math.sin(t * 1.3 + p) * DRIFT_AMPLITUDE * 0.5 * bob,
      baseZ + Math.cos(t * 0.8 + p * 2.3) * DRIFT_AMPLITUDE * 0.6,
    );
  }
  positions.needsUpdate = true;
}
