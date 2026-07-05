/**
 * Codec A2 of the QR payload-compression benchmark (plan §4):
 * `deflate-raw` over the UTF-8 payload, transported as unpadded base64url.
 * `deflate-raw` (no zlib/gzip container) is the only generic codec worth
 * shipping per hypothesis H5 — `codec-gzip.ts` exists solely to quantify
 * the container overhead.
 *
 * Async because `CompressionStream` is stream-based; the sync codecs share
 * the same signature so the benchmark treats all candidates uniformly.
 */

import { decodeBase64Url, encodeBase64Url } from './base64url';
import { compressBytes, decompressBytes } from './compression';
import { utf8DecodeTotal, utf8Encode } from './utf8';

export async function encodeDeflatePayload(payload: string): Promise<string> {
  return encodeBase64Url(
    await compressBytes(utf8Encode(payload), 'deflate-raw')
  );
}

/** Total decode: malformed base64url, deflate stream or UTF-8 → `null`. */
export async function decodeDeflatePayload(
  text: string
): Promise<string | null> {
  const bytes = decodeBase64Url(text);
  if (bytes === null) {
    return null;
  }
  const inflated = await decompressBytes(bytes, 'deflate-raw');
  if (inflated === null) {
    return null;
  }
  return utf8DecodeTotal(inflated);
}
