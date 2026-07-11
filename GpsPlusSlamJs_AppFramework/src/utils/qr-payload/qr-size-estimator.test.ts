import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import {
  QR_ALPHANUMERIC_CHARSET,
  estimateQrSize,
  type QrEcLevel,
} from './qr-size-estimator';

/**
 * P1 of the QR payload-compression benchmark plan
 * (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-05-qr-payload-compression-benchmark-plan.md).
 *
 * The estimator is the benchmark's *metric* — every later phase (P2–P5)
 * ranks candidates by its output, so these tests pin it against hand-derived
 * spec values AND against the `qrcode` npm package as an independent oracle
 * (decision D6: strict version equality, no tolerance band).
 */

const EC_LEVELS: readonly QrEcLevel[] = ['L', 'M', 'Q', 'H'];

describe('estimateQrSize — hand-derived spec values', () => {
  // Why this test matters: "HELLO WORLD" is the ISO 18004 worked example —
  // 11 alphanumeric chars = 5 pairs (55 bits) + 1 remainder (6 bits) + mode
  // indicator (4) + char-count indicator (9 in v1–9) = 74 bits, fitting v1
  // at every EC level except H is also v1 (H capacity 72 bits < 74 → v2? no:
  // 9 codewords = 72 bits < 74 bits → v2 at H).
  it('encodes the classic alphanumeric example at the spec bit cost', () => {
    const result = estimateQrSize('HELLO WORLD', 'Q');
    expect(result).toEqual({ bits: 74, version: 1, modules: 21 });
    // 74 bits exceed v1-H's 9 data codewords (72 bits) → v2 at EC H.
    expect(estimateQrSize('HELLO WORLD', 'H')).toEqual({
      bits: 74,
      version: 2,
      modules: 25,
    });
  });

  // Why this test matters: numeric mode is the cheapest (10 bits / 3 digits)
  // and its remainder handling (2 digits → 7 bits) is easy to get wrong.
  it('encodes pure digits in numeric mode', () => {
    // 4 (mode) + 10 (CCI v1-9) + 2×10 + 7 = 41 bits.
    expect(estimateQrSize('01234567', 'L')).toEqual({
      bits: 41,
      version: 1,
      modules: 21,
    });
  });

  // Why this test matters: lowercase letters are NOT in the QR alphanumeric
  // charset, so they must cost 8 bits/char in byte mode.
  it('encodes lowercase text in byte mode', () => {
    // 4 + 8 (CCI v1-9) + 5×8 = 52 bits.
    expect(estimateQrSize('hello', 'L')).toEqual({
      bits: 52,
      version: 1,
      modules: 21,
    });
  });

  // Why this test matters: the whole benchmark hinges on correct mode
  // *segmentation*, and the optimum is subtle — ':' and '/' ARE in the QR
  // alphanumeric charset, so the cheapest split of "https://ABC" is NOT at
  // the "://" boundary: byte("https") = 4+8+5×8 = 52 bits, then
  // alnum("://ABC") = 4+9+3×11 = 46 bits → 98 total, beating both the pure
  // byte segment (4+8+11×8 = 100) and a split at "https://" (≥ 106).
  it('finds the optimal split inside the URL scheme separator', () => {
    expect(estimateQrSize('https://ABC', 'L')?.bits).toBe(98);
  });

  it('splits into byte + alphanumeric segments when the run is long enough', () => {
    // byte("https") = 52 bits, alnum("://" + 40×'A' = 43 chars) =
    // 4 + 9 + 21×11 + 6 = 250 bits → 302 total (vs 396 pure byte).
    expect(estimateQrSize(`https://${'A'.repeat(40)}`, 'L')?.bits).toBe(302);
  });

  // Why this test matters: multi-byte UTF-8 chars must be costed at their
  // byte length, not 8 bits per JS char (ö = 2 bytes, 😀 = 4 bytes).
  it('costs non-ASCII characters at their UTF-8 byte length', () => {
    // 4 + 8 + 2×8 = 28 bits.
    expect(estimateQrSize('ö', 'L')?.bits).toBe(28);
    // 4 + 8 + 4×8 = 44 bits (astral char = one code point, 4 UTF-8 bytes).
    expect(estimateQrSize('😀', 'L')?.bits).toBe(44);
  });

  it('returns version 1 with zero bits for the empty payload', () => {
    expect(estimateQrSize('', 'H')).toEqual({
      bits: 0,
      version: 1,
      modules: 21,
    });
  });

  // Why this test matters: the plan (§3) requires `null`, never a throw, for
  // payloads beyond the v25 capacity table.
  it('returns null for payloads exceeding the v25 capacity table', () => {
    expect(estimateQrSize('a'.repeat(1300), 'L')).toBeNull();
    expect(estimateQrSize('a'.repeat(600), 'H')).toBeNull();
  });

  // Why this test matters: defensive-boundary rule — invalid EC levels are a
  // caller bug but must degrade to null, matching the totality convention.
  it('returns null for an invalid EC level', () => {
    expect(estimateQrSize('abc', 'X' as QrEcLevel)).toBeNull();
  });

  it('exposes the 45-char QR alphanumeric charset', () => {
    expect(QR_ALPHANUMERIC_CHARSET).toHaveLength(45);
    expect(QR_ALPHANUMERIC_CHARSET).toBe(
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'
    );
  });
});

/**
 * Oracle cross-validation (decision D6): our chosen version must EQUAL the
 * `qrcode` package's for every probe. Instead of sweeping every length
 * (too slow), we probe each (version, EC, mode) capacity BOUNDARY: the
 * longest single-mode string our estimator says still fits version v must
 * make the oracle pick exactly v, and one more char must push the oracle
 * past v. A wrong entry anywhere in the v1–25 capacity table fails here.
 */
describe('estimateQrSize — qrcode oracle boundary agreement', () => {
  const MODE_PROBES = [
    { label: 'numeric', char: '8' },
    { label: 'alphanumeric', char: 'A' },
    { label: 'byte', char: 'a' },
  ] as const;

  /** Largest repeat count of `char` that still fits `version` per OUR estimator. */
  function maxCharsFitting(
    char: string,
    ec: QrEcLevel,
    version: number
  ): number {
    let lo = 0;
    let hi = 8000;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi + 1) / 2);
      const estimate = estimateQrSize(char.repeat(mid), ec);
      if (estimate !== null && estimate.version <= version) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  function oracleVersion(payload: string, ec: QrEcLevel): number {
    return QRCode.create(payload, { errorCorrectionLevel: ec }).version;
  }

  for (const ec of EC_LEVELS) {
    for (const probe of MODE_PROBES) {
      it(
        `agrees on every v1–25 ${probe.label} boundary at EC ${ec}`,
        // Wall-clock heavy (25 binary-searched oracle QR encodes per probe;
        // ~2–5 s each in isolation) but the assertions are structural, so a
        // generous budget weakens nothing. At the 5 s default these tests sit
        // at 90–100 % of budget and flake whenever the suite grows and files
        // run in parallel (observed 2026-07-11 at 5,028 ms).
        { timeout: 60_000 },
        () => {
          for (let version = 1; version <= 25; version++) {
            const maxChars = maxCharsFitting(probe.char, ec, version);
            const atBoundary = probe.char.repeat(maxChars);
            expect(
              oracleVersion(atBoundary, ec),
              `${probe.label}×${maxChars} @ EC ${ec} should need v${version}`
            ).toBe(version);
            // One more char must overflow this version for the oracle too.
            const overflowed = probe.char.repeat(maxChars + 1);
            expect(
              oracleVersion(overflowed, ec),
              `${probe.label}×${maxChars + 1} @ EC ${ec} should exceed v${version}`
            ).toBeGreaterThan(version);
          }
        }
      );
    }
  }

  // Why this test matters: the benchmark's real payloads are MIXED-mode
  // (lowercase URL prefix + uppercase/numeric encoded tail), so segmentation
  // itself — not just the capacity table — must match the oracle.
  const MIXED_PROBES = [
    'https://gps.csutil.com/?qr=a1b2c',
    'HTTPS://GPS.CSUTIL.COM/S/A1B2C',
    'https://raw.githubusercontent.com/user/repo/main/qr/scene-demo.json',
    'https://gps.csutil.com/?qr=UOX5AT2MNRAVIT3EGVQVCSKBJZKESRKSGQ3UMMSF',
    '{"a":[{"lat":47.3769,"lon":8.5417,"alt":2}]}',
    `https://gps.csutil.com/?qr=${'JBSWY3DPEB3W64TMMQQQ'.repeat(10)}`,
    '8'.repeat(120) + 'A'.repeat(50) + 'a'.repeat(30),
  ];

  for (const payload of MIXED_PROBES) {
    it(`agrees with the oracle on mixed payload "${payload.slice(0, 24)}…"`, () => {
      for (const ec of EC_LEVELS) {
        const estimate = estimateQrSize(payload, ec);
        expect(estimate).not.toBeNull();
        expect(estimate?.version, `EC ${ec}: ${payload.slice(0, 40)}`).toBe(
          oracleVersion(payload, ec)
        );
      }
    });
  }
});
