import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decodeDeflatePayload, encodeDeflatePayload } from './codec-deflate';
import { decodeGzipPayload, encodeGzipPayload } from './codec-gzip';
import {
  decodeDictionaryDeflatePayload,
  decodeDictionaryPayload,
  encodeDictionaryDeflatePayload,
  encodeDictionaryPayload,
} from './codec-dictionary';
import {
  decodeBinaryAnchorPayload,
  encodeBinaryAnchorPayload,
} from './codec-binary-anchor';

/**
 * P3 property tests (benchmark plan §6 P3): every codec must round-trip its
 * domain and decode totally — a printed QR code delivers whatever it
 * delivers, forever, so `decode` may never throw.
 */

const TEXT_CODECS = [
  {
    name: 'deflate-raw (A2)',
    encode: encodeDeflatePayload,
    decode: decodeDeflatePayload,
  },
  { name: 'gzip (A3)', encode: encodeGzipPayload, decode: decodeGzipPayload },
  {
    name: 'dictionary (A4)',
    encode: encodeDictionaryPayload,
    decode: decodeDictionaryPayload,
  },
  {
    name: 'dictionary+deflate (A4+A2)',
    encode: encodeDictionaryDeflatePayload,
    decode: decodeDictionaryDeflatePayload,
  },
] as const;

describe.each(TEXT_CODECS)('$name — properties', ({ encode, decode }) => {
  it('round-trips arbitrary unicode strings', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 300 }), async (payload) => {
        expect(await decode(await encode(payload))).toBe(payload);
      }),
      { numRuns: 50 }
    );
  });

  it('decodes arbitrary strings totally (string or null, never a throw)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: 'binary', maxLength: 96 }),
        async (text) => {
          const decoded = await decode(text);
          expect(decoded === null || typeof decoded === 'string').toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});

/** Wire-envelope arbitrary matching the `?show=` schema (url-anchor-state). */
const WIRE_ANCHOR_ARB = fc.record(
  {
    lat: fc.double({ min: -90, max: 90, noNaN: true }),
    lon: fc.double({ min: -180, max: 180, noNaN: true }),
    alt: fc.double({ min: -3000, max: 3000, noNaN: true }),
    n: fc.string({ minLength: 1, maxLength: 40 }),
    ui: fc.constantFrom(2, 3, 4),
    s: fc.double({ min: 0.01, max: 100, noNaN: true }),
    r: fc.double({ min: 0, max: 359.9, noNaN: true }),
  },
  { requiredKeys: ['lat', 'lon', 'alt'] }
);

const ENVELOPE_ARB = fc
  .array(WIRE_ANCHOR_ARB, { minLength: 1, maxLength: 8 })
  .map((anchors) => JSON.stringify({ a: anchors }));

/** Circular distance for rotation degrees (359.99 ≈ 0.01). */
function rotationDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

describe('binary anchor codec (A5) — properties', () => {
  interface WireAnchorShape {
    lat: number;
    lon: number;
    alt: number;
    n?: string;
    ui?: number;
    s?: number;
    r?: number;
  }

  it('round-trips arbitrary envelopes within quantisation tolerance', async () => {
    await fc.assert(
      fc.asyncProperty(ENVELOPE_ARB, async (payload) => {
        const decoded = await decodeBinaryAnchorPayload(
          await encodeBinaryAnchorPayload(payload)
        );
        expect(decoded).not.toBeNull();
        const original = (JSON.parse(payload) as { a: WireAnchorShape[] }).a;
        const restored = (
          JSON.parse(decoded as string) as { a: WireAnchorShape[] }
        ).a;
        expect(restored).toHaveLength(original.length);
        for (let i = 0; i < original.length; i++) {
          const before = original[i] as WireAnchorShape;
          const after = restored[i] as WireAnchorShape;
          expect(after.lat).toBeCloseTo(before.lat, 6);
          expect(after.lon).toBeCloseTo(before.lon, 6);
          // Tolerances are half a quantisation step plus float headroom.
          expect(Math.abs(after.alt - before.alt)).toBeLessThanOrEqual(0.051);
          expect(after.n).toBe(before.n);
          expect(after.ui).toBe(before.ui);
          const scaleError =
            before.s === undefined ? 0 : Math.abs((after.s ?? NaN) - before.s);
          expect(scaleError).toBeLessThanOrEqual(0.0051);
          const rotationError =
            before.r === undefined
              ? 0
              : rotationDistance(after.r ?? NaN, before.r);
          expect(rotationError).toBeLessThanOrEqual(0.051);
        }
      }),
      { numRuns: 75 }
    );
  });

  it('is idempotent: encode(decode(encode(x))) === encode(x)', async () => {
    await fc.assert(
      fc.asyncProperty(ENVELOPE_ARB, async (payload) => {
        const once = await encodeBinaryAnchorPayload(payload);
        const canonical = await decodeBinaryAnchorPayload(once);
        expect(canonical).not.toBeNull();
        expect(await encodeBinaryAnchorPayload(canonical as string)).toBe(once);
      }),
      { numRuns: 50 }
    );
  });

  it('decodes arbitrary strings totally', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: 'binary', maxLength: 64 }),
        async (text) => {
          const decoded = await decodeBinaryAnchorPayload(text);
          expect(decoded === null || typeof decoded === 'string').toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });
});
