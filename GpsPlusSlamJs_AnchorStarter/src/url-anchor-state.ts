/**
 * Inline `?show=` URL-state codec for the starter example.
 *
 * Decision F1 (D1.1–D1.5, doc `2026-06-01-url-anchor-state-and-offscreen-hud`)
 * moves the single persisted anchor out of `localStorage` and into the page
 * **URL** so the link becomes *shareable* across devices and people. This
 * module is the single source of truth for that state.
 *
 * The wire envelope is deliberately minimal and **multi-anchor-ready** — even
 * though the starter only ever places one anchor today, the schema already
 * carries a list so a future multi-anchor authoring flow is a purely additive
 * change (D1.5: never repurpose or remove a key, only add optional ones; hence
 * no version field is needed):
 *
 * ```jsonc
 * { "a": [ { "lat": 47.37, "lon": 8.54, "alt": 12,   // required
 *            "n": "Home",   // optional display name
 *            "ui": 3,       // optional visualization style (1..4, default 1)
 *            "s": 2,        // optional scale multiplier (>0, default 1)
 *            "r": 90 } ] }  // optional rotation° vs true north (0..360, default 0)
 * ```
 *
 * `decodeShowParam` mirrors the validate-and-clamp discipline of the framework's
 * `recording-options.ts`: it is **total** — any malformed, empty or
 * out-of-range param resolves to `null` ("no anchor"), individual bad anchors
 * are dropped rather than poisoning their valid neighbours, and it never throws.
 */

/** The visualization styles an anchor can request (D1.1 §6). */
export const ANCHOR_VISUALIZATIONS = [1, 2, 3, 4] as const;
/**
 * - `1` giant 3D map pin (default)
 * - `2` billboard
 * - `3` light-beam / vertical pillar
 * - `4` floating ring / circle
 */
export type AnchorVisualization = (typeof ANCHOR_VISUALIZATIONS)[number];

export const DEFAULT_VISUALIZATION: AnchorVisualization = 1;
export const DEFAULT_SCALE = 1;
export const DEFAULT_ROTATION_DEG = 0;

/**
 * A fully-resolved anchor: the shape `decodeShowParam` returns and
 * `encodeAnchorsToShowParam` accepts. Defaults are always explicit here; the
 * compact wire form only appears inside this module.
 */
export interface AnchorSpec {
  /** Latitude in degrees, −90..90. */
  lat: number;
  /** Longitude in degrees, −180..180. */
  lon: number;
  /** Height in metres above the GPS/ground reference (not absolute MSL). */
  alt: number;
  /** Optional display label. Omitted (not empty) when absent. */
  name?: string;
  /** Visualization style; defaults to {@link DEFAULT_VISUALIZATION}. */
  ui: AnchorVisualization;
  /** Size multiplier (>0); defaults to {@link DEFAULT_SCALE}. */
  scale: number;
  /** Rotation about the vertical axis vs true north, 0..360°; default 0. */
  rotationDeg: number;
}

/** Short-keyed wire form of a single anchor (defaults omitted). */
interface WireAnchor {
  lat: number;
  lon: number;
  alt: number;
  n?: string;
  ui?: number;
  s?: number;
  r?: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Encode anchors into the value for the `?show=` query param: a percent-escaped
 * JSON envelope. Default-valued optional fields are omitted to keep the link
 * short.
 */
export function encodeAnchorsToShowParam(
  anchors: readonly AnchorSpec[],
): string {
  const a = anchors.map(toWire);
  return encodeURIComponent(JSON.stringify({ a }));
}

function toWire(anchor: AnchorSpec): WireAnchor {
  const wire: WireAnchor = {
    lat: anchor.lat,
    lon: anchor.lon,
    alt: anchor.alt,
  };
  if (anchor.name !== undefined && anchor.name !== "") wire.n = anchor.name;
  if (anchor.ui !== DEFAULT_VISUALIZATION) wire.ui = anchor.ui;
  if (anchor.scale !== DEFAULT_SCALE) wire.s = anchor.scale;
  if (anchor.rotationDeg !== DEFAULT_ROTATION_DEG) wire.r = anchor.rotationDeg;
  return wire;
}

/**
 * Decode the `?show=` param value into resolved anchors, or `null` when there
 * is no usable anchor. Total and tolerant — see the module doc.
 */
export function decodeShowParam(
  raw: string | null | undefined,
): AnchorSpec[] | null {
  if (raw === null || raw === undefined || raw === "") return null;

  const parsed = tryParse(raw);
  if (typeof parsed !== "object" || parsed === null) return null;

  const list = (parsed as { a?: unknown }).a;
  if (!Array.isArray(list)) return null;

  const anchors: AnchorSpec[] = [];
  for (const entry of list) {
    const anchor = toAnchorSpec(entry);
    if (anchor !== null) anchors.push(anchor);
  }
  return anchors.length > 0 ? anchors : null;
}

/**
 * Parse the param. `URLSearchParams.get` already percent-decodes, so the
 * literal value is usually plain JSON — but a hand-built or doubly-encoded
 * link may still be escaped, so fall back to a percent-decoded parse.
 */
function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Not plain JSON — try the percent-decoded form below.
  }
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

function toAnchorSpec(entry: unknown): AnchorSpec | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { lat, lon, alt, n, ui, s, r } = entry as Record<string, unknown>;

  const coords = toCoordinates(lat, lon, alt);
  if (coords === null) return null;

  const spec: AnchorSpec = {
    ...coords,
    ui: normaliseVisualization(ui),
    scale: normaliseScale(s),
    rotationDeg: normaliseRotation(r),
  };
  if (typeof n === "string" && n !== "") spec.name = n;
  return spec;
}

/**
 * Validate the required coordinate triple. Returns the finite, in-range
 * numbers, or `null` so the caller can drop the anchor. Altitude is required
 * (D1.1) but unbounded.
 */
function toCoordinates(
  lat: unknown,
  lon: unknown,
  alt: unknown,
): { lat: number; lon: number; alt: number } | null {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon) || !isFiniteNumber(alt)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon, alt };
}

function normaliseVisualization(value: unknown): AnchorVisualization {
  if (
    isFiniteNumber(value) &&
    (ANCHOR_VISUALIZATIONS as readonly number[]).includes(value)
  ) {
    return value as AnchorVisualization;
  }
  return DEFAULT_VISUALIZATION;
}

function normaliseScale(value: unknown): number {
  return isFiniteNumber(value) && value > 0 ? value : DEFAULT_SCALE;
}

function normaliseRotation(value: unknown): number {
  if (!isFiniteNumber(value)) return DEFAULT_ROTATION_DEG;
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}
