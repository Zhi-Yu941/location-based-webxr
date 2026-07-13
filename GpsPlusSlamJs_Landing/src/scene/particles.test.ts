/**
 * Why these tests matter: the ambient particles (v3 F2) are the reason
 * the page moved from render-on-demand to visibility-gated continuous
 * rendering — a deliberate battery trade-off. That only stays defensible
 * if the particles are cheap and predictable: deterministic builds (two
 * page loads look identical, tests can pin structure), TIME-driven
 * motion that is a pure function of the clock (never of scroll — the
 * scrub-path-independence suites must stay untouched), and bounded
 * drift (particles never wander into the copy or under the floor).
 */
import { describe, expect, it } from "vitest";
import type { PointsMaterial } from "three";
import { THEME_IDS } from "../theme";
import { getPalette } from "./palette";
import {
  PARTICLE_FIELD_NAME,
  applyParticlePalette,
  buildParticleField,
  updateParticles,
} from "./particles";

describe("palette particle-block completeness", () => {
  it("every palette defines color and style", () => {
    for (const theme of THEME_IDS) {
      const particles = getPalette(theme).particles;
      expect(particles, theme).toBeDefined();
      expect(typeof particles.color, theme).toBe("number");
      expect(["fireflies", "dust", "motes"]).toContain(particles.style);
    }
  });
});

describe("buildParticleField", () => {
  it("is deterministic: two builds produce identical base positions", () => {
    const a = buildParticleField().geometry.getAttribute("position");
    const b = buildParticleField().geometry.getAttribute("position");
    expect(a.array).toEqual(b.array);
  });

  it("is named, transparent, and never writes depth (drawn over the world softly)", () => {
    const field = buildParticleField();
    expect(field.name).toBe(PARTICLE_FIELD_NAME);
    const material = field.material as PointsMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
  });
});

describe("updateParticles — time-driven, scrub-independent motion", () => {
  it("moves particles as time advances", () => {
    const field = buildParticleField();
    applyParticlePalette(field, getPalette("dark"));
    updateParticles(field, 0);
    const early = Float32Array.from(
      field.geometry.getAttribute("position").array,
    );
    updateParticles(field, 5000);
    const later = field.geometry.getAttribute("position").array;
    expect(later).not.toEqual(early);
  });

  it("is a pure function of the clock: same timestamp → same positions", () => {
    const field = buildParticleField();
    applyParticlePalette(field, getPalette("dark"));
    updateParticles(field, 1234);
    const first = Float32Array.from(
      field.geometry.getAttribute("position").array,
    );
    updateParticles(field, 99999);
    updateParticles(field, 1234);
    expect(field.geometry.getAttribute("position").array).toEqual(first);
  });

  it("keeps every particle inside the world bounds at arbitrary times", () => {
    const field = buildParticleField();
    applyParticlePalette(field, getPalette("light"));
    for (const t of [0, 777, 60_000, 3_600_000]) {
      updateParticles(field, t);
      const positions = field.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i += 1) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        expect(Math.hypot(x, z)).toBeLessThan(30);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(10);
      }
    }
  });
});

describe("applyParticlePalette", () => {
  it("recolors the field and adapts size/opacity to the palette style", () => {
    const field = buildParticleField();
    applyParticlePalette(field, getPalette("dark"));
    const material = field.material as PointsMaterial;
    const fireflySize = material.size;
    expect(material.color.getHex()).toBe(getPalette("dark").particles.color);

    applyParticlePalette(field, getPalette("neon"));
    expect(material.color.getHex()).toBe(getPalette("neon").particles.color);
    // dust reads finer than fireflies
    expect(material.size).toBeLessThan(fireflySize);
  });
});
