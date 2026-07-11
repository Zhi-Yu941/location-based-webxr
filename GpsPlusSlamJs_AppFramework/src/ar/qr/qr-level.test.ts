/**
 * QR level-file loader — unit tests.
 *
 * Why this test matters: the level file is external, user-authored data that
 * feeds the pose solve (`physicalSizeM`) and the synthetic GPS vote (`geo`). A
 * malformed field must be rejected at the boundary with a clear error rather
 * than silently producing a wrong-scale or wrong-place vote on a device.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  parseQrLevel,
  fetchQrLevel,
  QrLevelValidationError,
  type FetchLike,
} from './qr-level';

const valid = {
  version: 1,
  qr: {
    physicalSizeM: 0.2,
    geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 },
  },
  content: [{ kind: 'box' }],
};

describe('parseQrLevel', () => {
  it('accepts a well-formed level file and preserves content', () => {
    const level = parseQrLevel(valid);
    expect(level.version).toBe(1);
    expect(level.qr.physicalSizeM).toBe(0.2);
    expect(level.qr.geo).toEqual({
      lat: 47.5,
      lon: 8.7,
      alt: 400,
      headingDeg: 30,
    });
    expect(level.content).toEqual([{ kind: 'box' }]);
  });

  it('normalizes heading into [0, 360)', () => {
    expect(
      parseQrLevel({
        ...valid,
        qr: { ...valid.qr, geo: { ...valid.qr.geo, headingDeg: -90 } },
      }).qr.geo?.headingDeg
    ).toBe(270);
    expect(
      parseQrLevel({
        ...valid,
        qr: { ...valid.qr, geo: { ...valid.qr.geo, headingDeg: 450 } },
      }).qr.geo?.headingDeg
    ).toBe(90);
  });

  it('rejects non-objects', () => {
    expect(() => parseQrLevel(null)).toThrow(QrLevelValidationError);
    expect(() => parseQrLevel('nope')).toThrow(QrLevelValidationError);
  });

  it('rejects a missing or invalid version', () => {
    expect(() => parseQrLevel({ ...valid, version: 'x' })).toThrow(/version/);
  });

  it('rejects a non-positive physical size', () => {
    expect(() =>
      parseQrLevel({ ...valid, qr: { ...valid.qr, physicalSizeM: 0 } })
    ).toThrow(/physicalSizeM/);
    expect(() =>
      parseQrLevel({ ...valid, qr: { ...valid.qr, physicalSizeM: -1 } })
    ).toThrow(/physicalSizeM/);
  });

  it('accepts a geo-less level (no vote) — geo omitted', () => {
    const level = parseQrLevel({ version: 1, qr: { physicalSizeM: 0.2 } });
    expect(level.qr.geo).toBeUndefined();
    expect(level.qr.physicalSizeM).toBe(0.2);
  });

  it('accepts a size-less level (size measured later) — physicalSizeM omitted', () => {
    const level = parseQrLevel({
      version: 1,
      qr: { geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 } },
    });
    expect(level.qr.physicalSizeM).toBeUndefined();
    expect(level.qr.geo?.headingDeg).toBe(30);
  });

  it('accepts a bare level with neither size nor geo (trigger/observe-only)', () => {
    const level = parseQrLevel({ version: 1, qr: {} });
    expect(level.qr.physicalSizeM).toBeUndefined();
    expect(level.qr.geo).toBeUndefined();
  });

  it('still rejects a present-but-invalid size or partial geo', () => {
    expect(() =>
      parseQrLevel({ version: 1, qr: { physicalSizeM: 0 } })
    ).toThrow(/physicalSizeM/);
    expect(() =>
      parseQrLevel({
        version: 1,
        qr: { geo: { lat: 47.5, lon: 8.7, alt: 400 } },
      })
    ).toThrow(/headingDeg/);
  });

  it('rejects out-of-range geo coordinates', () => {
    const bad = (geo: Record<string, number>) => () =>
      parseQrLevel({ ...valid, qr: { ...valid.qr, geo } });
    expect(bad({ lat: 91, lon: 0, alt: 0, headingDeg: 0 })).toThrow(/lat/);
    expect(bad({ lat: 0, lon: 200, alt: 0, headingDeg: 0 })).toThrow(/lon/);
    expect(bad({ lat: 0, lon: 0, alt: NaN, headingDeg: 0 })).toThrow(/alt/);
    expect(bad({ lat: 0, lon: 0, alt: 0, headingDeg: Infinity })).toThrow(
      /headingDeg/
    );
  });
});

describe('fetchQrLevel', () => {
  const okFetch = (body: unknown): FetchLike =>
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(body),
      })
    );

  it('fetches, parses, and validates', async () => {
    const level = await fetchQrLevel('https://lvl/1', {
      fetchImpl: okFetch(valid),
    });
    expect(level.qr.physicalSizeM).toBe(0.2);
  });

  it('rejects a non-OK response', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      });
    await expect(fetchQrLevel('https://lvl/x', { fetchImpl })).rejects.toThrow(
      /status 404/
    );
  });

  it('rejects a non-JSON body', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('bad json')),
      });
    await expect(fetchQrLevel('https://lvl/x', { fetchImpl })).rejects.toThrow(
      /not valid JSON/
    );
  });

  it('wraps a network failure', async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error('offline'));
    await expect(fetchQrLevel('https://lvl/x', { fetchImpl })).rejects.toThrow(
      /fetch failed/
    );
  });

  it('propagates a schema violation from the fetched body', async () => {
    await expect(
      fetchQrLevel('https://lvl/x', { fetchImpl: okFetch({ version: 1 }) })
    ).rejects.toThrow(QrLevelValidationError);
  });
});
