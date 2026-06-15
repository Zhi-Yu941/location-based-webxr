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

/** A validated QR level file. */
export interface QrLevel {
  /** Schema version for forward-compat. */
  version: number;
  qr: {
    /** Printed physical side length, meters. */
    physicalSizeM: number;
    /** Absolute geo pose of the QR center + heading. */
    geo: QrGeoPose;
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
  const { qr } = data;
  if (!isFiniteNumber(qr.physicalSizeM) || qr.physicalSizeM <= 0) {
    throw new QrLevelValidationError(
      '"qr.physicalSizeM" must be a positive number'
    );
  }
  if (!isRecord(qr.geo)) {
    throw new QrLevelValidationError('missing/invalid "qr.geo"');
  }
  const { geo } = qr;
  if (!isFiniteNumber(geo.lat) || geo.lat < -90 || geo.lat > 90) {
    throw new QrLevelValidationError(
      '"qr.geo.lat" must be a number in [-90, 90]'
    );
  }
  if (!isFiniteNumber(geo.lon) || geo.lon < -180 || geo.lon > 180) {
    throw new QrLevelValidationError(
      '"qr.geo.lon" must be a number in [-180, 180]'
    );
  }
  if (!isFiniteNumber(geo.alt)) {
    throw new QrLevelValidationError('"qr.geo.alt" must be a finite number');
  }
  if (!isFiniteNumber(geo.headingDeg)) {
    throw new QrLevelValidationError(
      '"qr.geo.headingDeg" must be a finite number'
    );
  }

  return {
    version: data.version,
    qr: {
      physicalSizeM: qr.physicalSizeM,
      geo: {
        lat: geo.lat,
        lon: geo.lon,
        alt: geo.alt,
        // Normalize heading into [0, 360).
        headingDeg: ((geo.headingDeg % 360) + 360) % 360,
      },
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
