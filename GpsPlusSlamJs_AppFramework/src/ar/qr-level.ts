/**
 * QR level-file loader — Phase 6 / §8 of the QR-code detection & tracking plan.
 *
 * The printed QR encodes only a short URL; everything else lives in the level
 * file fetched from that URL: the physical QR size (drives `solvePnP` + the size
 * self-check), the QR's absolute geo pose (drives the synthetic GPS vote), and
 * the AR content to instantiate. Keeping size/geo out of the QR keeps the
 * printed code low-density and lets authors fix a mis-measured size or relocate
 * without reprinting.
 *
 * This module fetches and DEFENSIVELY validates that external, user-authored
 * document at the boundary (CLAUDE.md "write defensively"). The AR `content`
 * format is an open question (plan §12) — it is carried through opaquely and
 * NOT interpreted here; only the fields the pose + vote need are validated.
 */

import type { QrGeoPose } from './qr-gps-vote.js';

/**
 * A validated QR level file.
 *
 * Both `physicalSizeM` and `geo` are OPTIONAL (Note 3 of the follow-up plan:
 * flat optionals + a capability model, not a discriminated union). Their
 * PRESENCE gates which capabilities activate, and the use-cases are combinable:
 * - `geo` present → the high-weight GPS vote (`buildQrGpsVotes`) runs.
 * - `physicalSizeM` present → size is authored; otherwise it must be MEASURED
 *   first (Note 4 depth path) before size-dependent features (PnP solve, vote)
 *   unlock. See the size lifecycle in `state/qr-detected-slice.ts`.
 * - neither → a debug/observe or trigger-only level (still keyed by payload).
 */
export interface QrLevel {
  /** Schema version for forward-compat. */
  version: number;
  qr: {
    /** Printed physical side length, meters. Optional — may be measured instead. */
    physicalSizeM?: number;
    /** Absolute geo pose of the QR center + heading. Optional — geo-less levels skip the vote. */
    geo?: QrGeoPose;
  };
  /** AR content to instantiate (format deferred — plan §12). Opaque here. */
  content?: unknown;
}

/** Thrown when a fetched level file fails validation. */
export class QrLevelValidationError extends Error {
  constructor(message: string) {
    super(`qr-level: ${message}`);
    this.name = 'QrLevelValidationError';
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Validate the optional `qr.physicalSizeM`. When present it MUST be a positive
 * number (a `0`/negative authored size is a bug, not a "measure it instead"
 * signal). Returns `undefined` when omitted.
 */
function parsePhysicalSize(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!isFiniteNumber(value) || value <= 0) {
    throw new QrLevelValidationError(
      '"qr.physicalSizeM" must be a positive number when present'
    );
  }
  return value;
}

/**
 * Validate the optional `qr.geo`. When present every field is validated (a
 * partial geo is a bug — it would silently place the vote wrong). Returns
 * `undefined` when omitted; heading is normalized into `[0, 360)`.
 */
function parseGeo(value: unknown): QrGeoPose | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new QrLevelValidationError('"qr.geo" must be an object when present');
  }
  const { lat, lon, alt, headingDeg } = value;
  if (!isFiniteNumber(lat) || lat < -90 || lat > 90) {
    throw new QrLevelValidationError(
      '"qr.geo.lat" must be a number in [-90, 90]'
    );
  }
  if (!isFiniteNumber(lon) || lon < -180 || lon > 180) {
    throw new QrLevelValidationError(
      '"qr.geo.lon" must be a number in [-180, 180]'
    );
  }
  if (!isFiniteNumber(alt)) {
    throw new QrLevelValidationError('"qr.geo.alt" must be a finite number');
  }
  if (!isFiniteNumber(headingDeg)) {
    throw new QrLevelValidationError(
      '"qr.geo.headingDeg" must be a finite number'
    );
  }
  return { lat, lon, alt, headingDeg: ((headingDeg % 360) + 360) % 360 };
}

/**
 * Validate an already-parsed value as a {@link QrLevel}. Throws
 * {@link QrLevelValidationError} with a descriptive message on any violation.
 */
export function parseQrLevel(data: unknown): QrLevel {
  if (!isRecord(data)) {
    throw new QrLevelValidationError('level file must be a JSON object');
  }
  if (!isFiniteNumber(data.version)) {
    throw new QrLevelValidationError('missing/invalid "version"');
  }
  if (!isRecord(data.qr)) {
    throw new QrLevelValidationError('missing/invalid "qr"');
  }
  const physicalSizeM = parsePhysicalSize(data.qr.physicalSizeM);
  const geo = parseGeo(data.qr.geo);

  return {
    version: data.version,
    qr: {
      ...(physicalSizeM !== undefined ? { physicalSizeM } : {}),
      ...(geo !== undefined ? { geo } : {}),
    },
    content: 'content' in data ? data.content : undefined,
  };
}

/** Minimal `fetch` slice used by {@link fetchQrLevel}. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface FetchQrLevelOptions {
  /** Injected fetch (defaults to global `fetch`). */
  fetchImpl?: FetchLike;
  /** Optional abort signal for cancellation. */
  signal?: AbortSignal;
}

/**
 * Fetch and validate a level file from `url`. Rejects with
 * {@link QrLevelValidationError} on a non-OK response, non-JSON body, or a
 * schema violation.
 */
export async function fetchQrLevel(
  url: string,
  options: FetchQrLevelOptions = {}
): Promise<QrLevel> {
  const fetchImpl =
    options.fetchImpl ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!fetchImpl) {
    throw new QrLevelValidationError('no fetch implementation available');
  }

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, { signal: options.signal });
  } catch (err) {
    throw new QrLevelValidationError(
      `fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!response.ok) {
    throw new QrLevelValidationError(
      `fetch ${url} returned status ${response.status}`
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new QrLevelValidationError(`response for ${url} was not valid JSON`);
  }
  return parseQrLevel(body);
}
