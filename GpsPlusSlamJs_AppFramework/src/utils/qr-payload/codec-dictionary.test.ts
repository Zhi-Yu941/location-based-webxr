import { describe, expect, it } from 'vitest';
import { decodeBase64Url } from './base64url';
import {
  decodeDictionaryDeflatePayload,
  decodeDictionaryPayload,
  encodeDictionaryDeflatePayload,
  encodeDictionaryPayload,
} from './codec-dictionary';

/**
 * P3 of the QR payload-compression benchmark plan: A4 — static substitution
 * dictionary (hypothesis H2: beats generic deflate on short URL pointers
 * because it has no header overhead and knows the domain's long prefixes).
 */
describe('dictionary codec (A4)', () => {
  const POINTER =
    'https://raw.githubusercontent.com/cs-util-com/qr-scenes/main/qr/scene-demo.json';

  it('round-trips a raw-GitHub pointer URL', async () => {
    const encoded = await encodeDictionaryPayload(POINTER);
    expect(await decodeDictionaryPayload(encoded)).toBe(POINTER);
  });

  it('round-trips an inline JSON envelope', async () => {
    const payload =
      '{"a":[{"lat":47.3769,"lon":8.5417,"alt":2,"n":"Fountain","ui":3},{"lat":47.377,"lon":8.5418,"alt":3}]}';
    const encoded = await encodeDictionaryPayload(payload);
    expect(await decodeDictionaryPayload(encoded)).toBe(payload);
  });

  // Why this test matters: H2's mechanism — known prefixes collapse to one
  // byte each, so the packed byte count must undercut the raw UTF-8 length
  // substantially for a typical pointer.
  it('substitutes known prefixes down to a fraction of the raw bytes', async () => {
    const encoded = await encodeDictionaryPayload(POINTER);
    const packed = decodeBase64Url(encoded);
    expect(packed).not.toBeNull();
    // 80-char pointer: ~34 chars of it are dictionary tokens.
    expect((packed as Uint8Array).length).toBeLessThan(POINTER.length - 30);
  });

  // Why this test matters: printed QR codes are immutable — the version
  // byte is the only thing letting the table evolve without breaking them.
  it('prepends dictionary version 0x01 and rejects unknown versions', async () => {
    const encoded = await encodeDictionaryPayload(POINTER);
    const packed = decodeBase64Url(encoded);
    expect(packed?.[0]).toBe(0x01);
    const tampered = Uint8Array.from(packed ?? []);
    tampered[0] = 0x02; // a future version this decoder does not know
    const { encodeBase64Url } = await import('./base64url');
    expect(await decodeDictionaryPayload(encodeBase64Url(tampered))).toBeNull();
  });

  it('escapes literal control characters instead of misreading them as tokens', async () => {
    const payload = 'line1\nline2\ttabraw';
    const encoded = await encodeDictionaryPayload(payload);
    expect(await decodeDictionaryPayload(encoded)).toBe(payload);
  });

  it('returns null for foreign or truncated input', async () => {
    expect(await decodeDictionaryPayload('!!!')).toBeNull();
    const encoded = await encodeDictionaryPayload(POINTER);
    expect(await decodeDictionaryPayload(encoded.slice(0, 5))).toBeNull();
  });
});

describe('dictionary + deflate chained codec (A4+A2)', () => {
  it('round-trips pointer URLs and inline JSON', async () => {
    const payloads = [
      'https://raw.githubusercontent.com/u/r/main/qr/x.json',
      '{"a":[{"lat":1.5,"lon":2.5,"alt":0}]}',
    ];
    for (const payload of payloads) {
      const encoded = await encodeDictionaryDeflatePayload(payload);
      expect(await decodeDictionaryDeflatePayload(encoded)).toBe(payload);
    }
  });

  it('returns null for corrupted input', async () => {
    expect(await decodeDictionaryDeflatePayload('AAAA')).toBeNull();
  });
});
