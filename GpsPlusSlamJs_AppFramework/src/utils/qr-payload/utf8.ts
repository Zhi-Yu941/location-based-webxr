/**
 * UTF-8 helpers shared by the QR payload codecs (benchmark plan §6 P3).
 * Decoding is TOTAL: invalid byte sequences yield `null` (fatal
 * `TextDecoder`, exception swallowed) — never a lossy U+FFFD substitution,
 * because a silently mangled payload is worse than a rejected one.
 */

const ENCODER = new TextEncoder();
const FATAL_DECODER = new TextDecoder('utf-8', { fatal: true });

export function utf8Encode(text: string): Uint8Array {
  return ENCODER.encode(text);
}

/** Decode UTF-8 bytes, or `null` when the sequence is invalid. */
export function utf8DecodeTotal(bytes: Uint8Array): string | null {
  try {
    return FATAL_DECODER.decode(bytes);
  } catch {
    return null;
  }
}
