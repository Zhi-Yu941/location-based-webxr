/**
 * Codec A4 of the QR payload-compression benchmark (plan §4): a VERSIONED
 * static substitution dictionary — known long substrings (URL prefixes,
 * JSON envelope keys) collapse to single reserved bytes (0x01–0x1F) before
 * transport encoding. Hypothesis H2: on short URL pointers this beats
 * generic deflate, which cannot amortise its header on < 150 chars.
 *
 * Wire layout: `[versionByte][body…]`, base64url-transported. Printed QR
 * codes are immutable, so the table may only EVOLVE by adding a new version
 * byte with a new table — decode must support every version ever printed
 * (currently: 0x01). Literal control bytes in the payload are escaped with
 * 0x00 so they can never be misread as tokens.
 *
 * Also exports the A4+A2 chain (dictionary, then `deflate-raw`): the
 * substituted bytes are what generic compression sees, so the two compose.
 */

import { decodeBase64Url, encodeBase64Url } from './base64url';
import { compressBytes, decompressBytes } from './compression';
import { utf8DecodeTotal, utf8Encode } from './utf8';

const DICTIONARY_VERSION = 0x01;
const ESCAPE = 0x00;

/**
 * Token table, version 0x01. Bytes 0x01–0x1F are reserved for tokens (31
 * slots; 22 used). Sorted longest-first at module load for greedy matching —
 * entry order here is only cosmetic, BUT the byte assignments are frozen
 * forever once a QR code is printed.
 */
const TOKEN_TABLE_V1: readonly (readonly [number, string])[] = [
  [0x01, 'https://raw.githubusercontent.com/'],
  [0x02, 'https://gps.csutil.com/'],
  [0x03, 'https://drive.google.com/file/d/'],
  [0x04, 'https://drive.google.com/'],
  [0x05, 'https://github.com/'],
  [0x06, 'https://'],
  [0x07, '/refs/heads/main/'],
  [0x08, '/main/'],
  [0x09, '.json'],
  [0x0a, '.github.io/'],
  [0x0b, '?usp=sharing'],
  [0x0c, '/view'],
  [0x0d, '{"a":[{"lat":'],
  [0x0e, ',"lon":'],
  [0x0f, ',"alt":'],
  [0x10, ',"n":"'],
  [0x11, ',"ui":'],
  [0x12, ',"s":'],
  [0x13, ',"r":'],
  [0x14, '},{"lat":'],
  [0x15, '}]}'],
  [0x16, '"}'],
];

const TOKENS_BY_LENGTH = [...TOKEN_TABLE_V1].sort(
  (a, b) => b[1].length - a[1].length
);
const TOKEN_BYTES_BY_VALUE = new Map<number, Uint8Array>(
  TOKEN_TABLE_V1.map(([byte, text]) => [byte, utf8Encode(text)])
);

/** Substitute known substrings and prepend the dictionary version byte. */
export function packDictionaryBytes(payload: string): Uint8Array {
  const out: number[] = [DICTIONARY_VERSION];
  let index = 0;
  while (index < payload.length) {
    const token = matchTokenAt(payload, index);
    if (token !== null) {
      out.push(token[0]);
      index += token[1].length;
      continue;
    }
    index += pushLiteralChar(payload, index, out);
  }
  return Uint8Array.from(out);
}

function matchTokenAt(
  payload: string,
  index: number
): readonly [number, string] | null {
  for (const token of TOKENS_BY_LENGTH) {
    if (payload.startsWith(token[1], index)) {
      return token;
    }
  }
  return null;
}

/** Append one code point's UTF-8 bytes (escaped if < 0x20); returns its
 * length in UTF-16 units so the caller can advance. */
function pushLiteralChar(
  payload: string,
  index: number,
  out: number[]
): number {
  const char = String.fromCodePoint(payload.codePointAt(index) ?? 0);
  for (const byte of utf8Encode(char)) {
    if (byte < 0x20) {
      out.push(ESCAPE);
    }
    out.push(byte);
  }
  return char.length;
}

/** Expand a packed dictionary body. Total: unknown version/token → `null`. */
export function unpackDictionaryBytes(bytes: Uint8Array): string | null {
  if (bytes.length === 0 || bytes[0] !== DICTIONARY_VERSION) {
    return null;
  }
  const out: number[] = [];
  for (let i = 1; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    if (byte === ESCAPE) {
      i += 1;
      if (i >= bytes.length) {
        return null; // dangling escape
      }
      out.push(bytes[i] ?? 0);
    } else if (byte < 0x20) {
      const expansion = TOKEN_BYTES_BY_VALUE.get(byte);
      if (expansion === undefined) {
        return null; // reserved byte this version never assigns
      }
      out.push(...expansion);
    } else {
      out.push(byte);
    }
  }
  return utf8DecodeTotal(Uint8Array.from(out));
}

/**
 * A4: dictionary substitution + base64url. Promise-returning (not `async` —
 * the work is synchronous) so all benchmark codecs share one signature.
 */
export function encodeDictionaryPayload(payload: string): Promise<string> {
  return Promise.resolve(encodeBase64Url(packDictionaryBytes(payload)));
}

export function decodeDictionaryPayload(text: string): Promise<string | null> {
  const bytes = decodeBase64Url(text);
  return Promise.resolve(bytes === null ? null : unpackDictionaryBytes(bytes));
}

/** A4+A2 chain: dictionary substitution, then deflate-raw, then base64url. */
export async function encodeDictionaryDeflatePayload(
  payload: string
): Promise<string> {
  return encodeBase64Url(
    await compressBytes(packDictionaryBytes(payload), 'deflate-raw')
  );
}

export async function decodeDictionaryDeflatePayload(
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
  return unpackDictionaryBytes(inflated);
}
