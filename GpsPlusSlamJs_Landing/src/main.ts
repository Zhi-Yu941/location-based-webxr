/**
 * Landing-page bootstrap. Wires the DOM chapters to the 3D scroll story.
 *
 * Boot order matters: theme first (so the first rendered frame uses the
 * right palette), then capability detection (decides quality tier and
 * whether scroll-driven animation runs at all), then the 3D scene. Every
 * step degrades gracefully — the DOM copy must stand alone when WebGL or
 * motion is unavailable (see the plan doc's "Fallbacks" decision).
 */
import { CHAPTERS, sectionElementId } from "./chapters";

function warnMissingSections(): void {
  for (const chapter of CHAPTERS) {
    if (!document.getElementById(sectionElementId(chapter.id))) {
      // A missing section desynchronizes scroll mapping and story timeline;
      // fail loudly in the console but keep the rest of the page working.
      console.warn(
        `landing: missing chapter section #${sectionElementId(chapter.id)}`,
      );
    }
  }
}

warnMissingSections();
