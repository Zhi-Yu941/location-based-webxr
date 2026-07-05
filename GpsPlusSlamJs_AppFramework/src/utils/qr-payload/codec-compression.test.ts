import { describe, expect, it } from 'vitest';
import { decodeDeflatePayload, encodeDeflatePayload } from './codec-deflate';
import { decodeGzipPayload, encodeGzipPayload } from './codec-gzip';

/**
 * P3 of the QR payload-compression benchmark plan: A2 (deflate-raw) and A3
 * (gzip) codecs. A3 exists purely to quantify gzip's container overhead
 * (hypothesis H5) — it is expected to lose and be pruned in P5.
 */
describe.each([
  {
    name: 'deflate-raw (A2)',
    encode: encodeDeflatePayload,
    decode: decodeDeflatePayload,
  },
  { name: 'gzip (A3)', encode: encodeGzipPayload, decode: decodeGzipPayload },
])('$name codec', ({ encode, decode }) => {
  it('round-trips a representative pointer URL', async () => {
    const payload =
      'https://raw.githubusercontent.com/cs-util-com/qr-scenes/main/qr/scene-demo.json';
    expect(await decode(await encode(payload))).toBe(payload);
  });

  it('round-trips a multi-anchor inline JSON envelope', async () => {
    const payload =
      '{"a":[{"lat":47.3769,"lon":8.5417,"alt":2,"n":"Fountain"},{"lat":47.3770,"lon":8.5418,"alt":3,"ui":3}]}';
    expect(await decode(await encode(payload))).toBe(payload);
  });

  it('round-trips non-ASCII payloads (UTF-8 boundary)', async () => {
    const payload = '{"a":[{"lat":1,"lon":2,"alt":0,"n":"Zürich 😀"}]}';
    expect(await decode(await encode(payload))).toBe(payload);
  });

  it('emits URL-safe output (no percent-escaping needed)', async () => {
    const encoded = await encode('https://example.com/some/path.json');
    expect(encodeURIComponent(encoded)).toBe(encoded);
  });

  // Why this test matters: printed QR codes deliver damaged input forever —
  // the decoder must be total (null, never a throw) on garbage.
  it('returns null for corrupted or foreign input', async () => {
    expect(await decode('not/base64url!')).toBeNull();
    expect(await decode('AAAA')).toBeNull(); // valid base64url, invalid stream
    const valid = await encode('hello world hello world');
    expect(await decode(valid.slice(0, valid.length - 3))).toBeNull();
  });
});

describe('deflate-raw vs gzip framing', () => {
  // Why this test matters: hypothesis H5 — gzip is deflate plus a >= 18-byte
  // container, so its encoded form must always be longer. The benchmark's
  // full assertion lives in P4; this pins the mechanism at codec level.
  it('gzip output is strictly longer than deflate-raw for the same payload', async () => {
    const payload =
      'https://raw.githubusercontent.com/cs-util-com/qr-scenes/main/qr/scene-demo.json';
    const deflate = await encodeDeflatePayload(payload);
    const gzip = await encodeGzipPayload(payload);
    expect(gzip.length).toBeGreaterThan(deflate.length);
  });
});
