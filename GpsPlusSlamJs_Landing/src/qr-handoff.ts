/**
 * Desktop→phone QR handoff for the CTA (v2 B2).
 *
 * Desktop cannot show AR — the established WebAR pattern is an explicit
 * "you are on desktop → scan this QR to open it on your phone" handoff.
 * When the device cannot run `immersive-ar` (round-8 Z6 detection) AND
 * the viewport is desktop-class, the CTA's `#qr-handoff` container gains
 * a client-generated QR code of the LIVE URL. Runtime generation is
 * deliberate (v2 doc §3.3): the QR encodes `location.href`, so preview
 * and staging origins stay correct without a rebuild.
 */
import { renderSVG } from "uqr";

/** The environment signals the show/hide decision is based on. */
export interface QrHandoffEnvironment {
  /** `immersive-ar` WebXR support (see `ar-support.ts`). */
  readonly arSupported: boolean;
  /** `window.innerWidth` in CSS px. */
  readonly viewportWidth: number;
  /** `matchMedia('(hover: hover) and (pointer: fine)').matches` */
  readonly hasFinePointer: boolean;
}

/** Id of the (statically hidden) handoff container in index.html. */
export const QR_HANDOFF_CONTAINER_ID = "qr-handoff";

/**
 * Minimum viewport width considered "desktop-class". Combined with the
 * fine-pointer signal so neither a narrow desktop window alone nor a
 * wide coarse-pointer phone (landscape) triggers the handoff.
 */
export const QR_HANDOFF_MIN_VIEWPORT_WIDTH = 768;

/** Caption rendered under the QR code. */
export const QR_HANDOFF_CAPTION = "Scan to try on your phone";

/**
 * True iff the QR handoff should be shown: the device cannot run
 * immersive-ar AND it looks like a desktop (fine pointer + wide
 * viewport). AR-capable devices get the upgraded CTA claim instead.
 */
export function shouldShowQrHandoff(env: QrHandoffEnvironment): boolean {
  return (
    !env.arSupported &&
    env.hasFinePointer &&
    env.viewportWidth >= QR_HANDOFF_MIN_VIEWPORT_WIDTH
  );
}

/**
 * Inject the QR (SVG, client-generated) + caption into `#qr-handoff`
 * and unhide it. No-ops when `show` is false, the container is missing,
 * the URL is empty, or encoding fails — the static page must never
 * break over an optional enhancement.
 */
export function applyQrHandoff(
  doc: Pick<Document, "getElementById">,
  show: boolean,
  url: string,
): void {
  if (!show) {
    return;
  }
  const container = doc.getElementById(QR_HANDOFF_CONTAINER_ID);
  if (!container || typeof url !== "string" || url.length === 0) {
    return;
  }
  let svg: string;
  try {
    // ecc M + border: keep the code scannable at the rendered ~130px
    // even on lower-quality screens; the version scales with URL length.
    svg = renderSVG(url, { ecc: "M", border: 2 });
  } catch {
    return;
  }
  // Safe innerHTML: renderSVG emits only QR module geometry (rects/paths)
  // — the URL text itself is never embedded as markup.
  container.innerHTML = `${svg}<p class="qr-caption">${QR_HANDOFF_CAPTION}</p>`;
  container.hidden = false;
}
