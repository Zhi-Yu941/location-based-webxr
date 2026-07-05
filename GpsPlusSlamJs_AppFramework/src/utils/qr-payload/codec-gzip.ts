/**
 * Codec A3 of the QR payload-compression benchmark (plan §4): gzip +
 * base64url. Kept in the benchmark SOLELY to quantify gzip's container
 * overhead versus `deflate-raw` (hypothesis H5) — it is expected to lose
 * and be pruned in P5, so nothing outside the benchmark may depend on it.
 */

import { decodeBase64Url, encodeBase64Url } from './base64url';
import { compressBytes, decompressBytes } from './compression';
import { utf8DecodeTotal, utf8Encode } from './utf8';

export async function encodeGzipPayload(payload: string): Promise<string> {
  return encodeBase64Url(await compressBytes(utf8Encode(payload), 'gzip'));
}

/** Total decode: malformed base64url, gzip stream or UTF-8 → `null`. */
export async function decodeGzipPayload(text: string): Promise<string | null> {
  const bytes = decodeBase64Url(text);
  if (bytes === null) {
    return null;
  }
  const inflated = await decompressBytes(bytes, 'gzip');
  if (inflated === null) {
    return null;
  }
  return utf8DecodeTotal(inflated);
}
