import { describe, expect, it } from 'vitest';
import {
  decodeBinaryAnchorPayload,
  encodeBinaryAnchorPayload,
} from './codec-binary-anchor';

/**
 * P3 of the QR payload-compression benchmark plan: A5 — fixed binary layout
 * for the `?show=`-style anchor envelope. This is the inline variant's
 * "maximum effort" lower bound (decision D8: built unconditionally so the
 * detection plan's §8 pointer-shape premise is actually tested).
 *
 * The codec is deliberately LOSSY: coordinates quantise to 1e-7°, altitude
 * to 0.1 m, scale to 0.01, rotation to 0.1°. Decode therefore returns a
 * canonical re-serialisation, not the original string.
 */
describe('binary anchor codec (A5)', () => {
  const C3 = '{"a":[{"lat":47.3769,"lon":8.5417,"alt":2}]}';

  it('round-trips a minimal single-anchor envelope exactly', async () => {
    // These values survive 1e-7 quantisation exactly, so decode must
    // reproduce the identical canonical JSON.
    const encoded = await encodeBinaryAnchorPayload(C3);
    expect(await decodeBinaryAnchorPayload(encoded)).toBe(C3);
  });

  it('round-trips optional fields (name, ui, s, r)', async () => {
    const payload =
      '{"a":[{"lat":-12.5,"lon":130.25,"alt":-4.5,"n":"Süd ⛲","ui":3,"s":2.5,"r":90}]}';
    const encoded = await encodeBinaryAnchorPayload(payload);
    expect(await decodeBinaryAnchorPayload(encoded)).toBe(payload);
  });

  it('is idempotent under encode→decode→encode', async () => {
    const payload =
      '{"a":[{"lat":47.37691234,"lon":8.54171234,"alt":2.34,"s":1.234}]}';
    const once = await encodeBinaryAnchorPayload(payload);
    const canonical = await decodeBinaryAnchorPayload(once);
    expect(canonical).not.toBeNull();
    const twice = await encodeBinaryAnchorPayload(canonical as string);
    expect(twice).toBe(once);
  });

  // Why this test matters: A5's benchmark claim is byte-level density — a
  // one-anchor envelope is 1 version byte + 1 count + 1 flags + 4+4+2
  // coordinate bytes = 13 bytes before transport encoding.
  it('packs a minimal anchor into 13 bytes', async () => {
    const encoded = await encodeBinaryAnchorPayload(C3);
    // base64url: 13 bytes → ceil(13·4/3) = 18 chars.
    expect(encoded).toHaveLength(18);
  });

  it('throws a TypeError for payloads that are not a valid envelope', async () => {
    await expect(encodeBinaryAnchorPayload('not json')).rejects.toThrow(
      TypeError
    );
    await expect(encodeBinaryAnchorPayload('{"b":[]}')).rejects.toThrow(
      TypeError
    );
    await expect(
      encodeBinaryAnchorPayload('{"a":[{"lat":91,"lon":0,"alt":0}]}')
    ).rejects.toThrow(TypeError);
    await expect(
      // Altitude beyond the int16 decimetre range.
      encodeBinaryAnchorPayload('{"a":[{"lat":0,"lon":0,"alt":40000}]}')
    ).rejects.toThrow(TypeError);
  });

  it('returns null for foreign, truncated or wrong-version input', async () => {
    expect(await decodeBinaryAnchorPayload('!!!')).toBeNull();
    const encoded = await encodeBinaryAnchorPayload(C3);
    expect(await decodeBinaryAnchorPayload(encoded.slice(0, 6))).toBeNull();
    expect(await decodeBinaryAnchorPayload('AA')).toBeNull(); // version 0
  });
});
