import { beforeAll, describe, expect, it } from 'vitest';
import {
  estimateQrSize,
  type QrEcLevel,
  type QrSizeEstimate,
} from './qr-size-estimator';
import { decodeBase64Url } from './base64url';
import { encodeBase45 } from './base45';
import { encodeBase32Up } from './base32up';
import { compressBytes } from './compression';
import { utf8Encode } from './utf8';
import { encodeDeflatePayload } from './codec-deflate';
import { encodeGzipPayload } from './codec-gzip';
import {
  encodeDictionaryDeflatePayload,
  encodeDictionaryPayload,
  packDictionaryBytes,
} from './codec-dictionary';
import { encodeBinaryAnchorPayload } from './codec-binary-anchor';

/**
 * P4 of the QR payload-compression benchmark
 * (gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-05-qr-payload-compression-benchmark-plan.md):
 * the EXECUTABLE DOCUMENTATION of the whole investigation. Every corpus row
 * (C1–C5) runs through every applicable candidate (A0–A7), metrics come
 * from the §3 QR-bit estimator, and hypotheses H1–H5 are asserted below —
 * refutations are recorded in the test comments per plan §2.
 *
 * Per decision D5 the hypotheses are the ONLY assertions — no snapshot of
 * the numbers table (it would churn on every estimator tweak). The full
 * table is logged (visible with `--silent=false`) and preserved in the P5
 * findings doc.
 */

/** The deployed launch-URL prefix every QR payload rides on (plan §1). */
const PREFIX_QUERY = 'https://gps.csutil.com/?qr=';
/** All-uppercase path form (A6) — stays in QR alphanumeric mode entirely. */
const PREFIX_UPPER = 'HTTPS://GPS.CSUTIL.COM/S/';

// ——— Corpus (plan §5) — fixed, deterministic, no network ———

/** C1: typical raw-GitHub pointer. */
const C1 =
  'https://raw.githubusercontent.com/cs-util-com/qr-scenes/main/qr/scene-demo.json';
/** C2: Google Drive share URL — high-entropy id, worst case for compression. */
const C2 =
  'https://drive.google.com/file/d/1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv/view?usp=sharing';
/** C3: minimal inline envelope (one anchor, required fields only). */
const C3 = '{"a":[{"lat":47.3769,"lon":8.5417,"alt":2}]}';
/** C4: five anchors with names and non-default ui/s/r (H1's "does deflate ever win?"). */
const C4 =
  '{"a":[' +
  '{"lat":47.376912,"lon":8.541694,"alt":2,"n":"Fountain","ui":2,"s":1.5,"r":45},' +
  '{"lat":47.376955,"lon":8.541732,"alt":2.5,"n":"North Gate","ui":3,"s":2,"r":90},' +
  '{"lat":47.377001,"lon":8.541801,"alt":3,"n":"Cafe Terrace","ui":4,"s":0.75,"r":180},' +
  '{"lat":47.377048,"lon":8.54186,"alt":1.5,"n":"Old Tree","ui":2,"s":1.25,"r":270},' +
  '{"lat":47.377102,"lon":8.541925,"alt":2,"n":"Info Board","ui":3,"s":0.5,"r":315}' +
  ']}';
/** C5: short indirection id (A7). */
const C5 = 'a1b2c';

type RowKind = 'pointer' | 'inline' | 'id';

interface CorpusRow {
  key: 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
  kind: RowKind;
  payload: string;
}

const CORPUS: readonly CorpusRow[] = [
  { key: 'C1', kind: 'pointer', payload: C1 },
  { key: 'C2', kind: 'pointer', payload: C2 },
  { key: 'C3', kind: 'inline', payload: C3 },
  { key: 'C4', kind: 'inline', payload: C4 },
  { key: 'C5', kind: 'id', payload: C5 },
];

// ——— Candidates (plan §4) ———

async function deflateBytes(payload: string): Promise<Uint8Array> {
  return compressBytes(utf8Encode(payload), 'deflate-raw');
}

interface CandidateSpec {
  key: string;
  /** Which corpus kinds this candidate applies to. */
  kinds: readonly RowKind[];
  toUrl: (payload: string) => Promise<string>;
}

/**
 * A0/A1 append the payload RAW: every corpus payload is query-legal as-is
 * (asserted below) — percent-encoding via `encodeURIComponent` would
 * escape `/`, `:` and quotes unnecessarily and strawman the baseline.
 */
const CANDIDATES: readonly CandidateSpec[] = [
  {
    key: 'A0-raw',
    kinds: ['pointer'],
    toUrl: (p) => Promise.resolve(PREFIX_QUERY + p),
  },
  {
    key: 'A1-json',
    kinds: ['inline'],
    toUrl: (p) => Promise.resolve(PREFIX_QUERY + encodeURIComponent(p)),
  },
  {
    key: 'A2-deflate',
    kinds: ['pointer', 'inline'],
    toUrl: async (p) => PREFIX_QUERY + (await encodeDeflatePayload(p)),
  },
  {
    key: 'A3-gzip',
    kinds: ['pointer', 'inline'],
    toUrl: async (p) => PREFIX_QUERY + (await encodeGzipPayload(p)),
  },
  {
    key: 'A4-dict',
    kinds: ['pointer', 'inline'],
    toUrl: async (p) => PREFIX_QUERY + (await encodeDictionaryPayload(p)),
  },
  {
    key: 'A4+A2',
    kinds: ['pointer', 'inline'],
    toUrl: async (p) =>
      PREFIX_QUERY + (await encodeDictionaryDeflatePayload(p)),
  },
  {
    key: 'A5-binary',
    kinds: ['inline'],
    toUrl: async (p) => PREFIX_QUERY + (await encodeBinaryAnchorPayload(p)),
  },
  {
    // Alphanumeric-mode CEILING: base45 emits ' ', '%', '+' which are NOT
    // URL-safe — shipping this needs custom query parsing AND scanner
    // tolerance for literal spaces. Measured to know what alnum mode buys.
    key: 'A6-45/defl',
    kinds: ['pointer', 'inline'],
    toUrl: async (p) => PREFIX_UPPER + encodeBase45(await deflateBytes(p)),
  },
  {
    // URL-safe alnum transport of the same deflate bytes.
    key: 'A6-32/defl',
    kinds: ['pointer', 'inline'],
    toUrl: async (p) => PREFIX_UPPER + encodeBase32Up(await deflateBytes(p)),
  },
  {
    // Best pointer bytes (dict+deflate) on the uppercase path.
    key: 'A6-32/d+d',
    kinds: ['pointer'],
    toUrl: async (p) =>
      PREFIX_UPPER +
      encodeBase32Up(
        await compressBytes(packDictionaryBytes(p), 'deflate-raw')
      ),
  },
  {
    // Best inline bytes (A5 binary) on the uppercase path.
    key: 'A6-32/bin',
    kinds: ['inline'],
    toUrl: async (p) => {
      const bytes = decodeBase64Url(await encodeBinaryAnchorPayload(p));
      return PREFIX_UPPER + encodeBase32Up(bytes ?? new Uint8Array());
    },
  },
  {
    key: 'A7-id',
    kinds: ['id'],
    toUrl: (p) => Promise.resolve(PREFIX_QUERY + p),
  },
];

// ——— Result matrix, computed once ———

const EC_LEVELS: readonly QrEcLevel[] = ['L', 'M', 'Q'];

interface CellResult {
  url: string;
  byEc: Record<QrEcLevel, QrSizeEstimate | null>;
}

const matrix = new Map<string, Map<string, CellResult>>();

function cell(row: string, candidate: string): CellResult {
  const result = matrix.get(row)?.get(candidate);
  if (result === undefined) {
    throw new Error(`benchmark matrix is missing ${row}/${candidate}`);
  }
  return result;
}

/** Bits at EC Q — the primary decision metric (decision D2). */
function qBits(row: string, candidate: string): number {
  return cell(row, candidate).byEc.Q?.bits ?? Number.POSITIVE_INFINITY;
}

function qVersion(row: string, candidate: string): number {
  return cell(row, candidate).byEc.Q?.version ?? Number.POSITIVE_INFINITY;
}

beforeAll(async () => {
  for (const row of CORPUS) {
    const rowResults = new Map<string, CellResult>();
    for (const candidate of CANDIDATES) {
      if (!candidate.kinds.includes(row.kind)) {
        continue;
      }
      const url = await candidate.toUrl(row.payload);
      const byEc = {
        L: estimateQrSize(url, 'L'),
        M: estimateQrSize(url, 'M'),
        Q: estimateQrSize(url, 'Q'),
        H: null,
      };
      rowResults.set(candidate.key, { url, byEc });
    }
    matrix.set(row.key, rowResults);
  }
  // Readable report — suppressed by vitest's `silent: true`; run the file
  // with `--silent=false` to print it (that output feeds the P5 findings doc).
  console.info(renderReport());
});

function renderReport(): string {
  const lines: string[] = [
    '',
    'QR payload benchmark — versions at EC L/M/Q (bits at Q)',
  ];
  for (const row of CORPUS) {
    lines.push(`- ${row.key} (${row.kind}, ${row.payload.length} chars)`);
    const baselineKey =
      row.kind === 'inline'
        ? 'A1-json'
        : row.kind === 'id'
          ? 'A7-id'
          : 'A0-raw';
    const baselineModules = matrix.get(row.key)?.get(baselineKey)?.byEc
      .Q?.modules;
    for (const [key, result] of matrix.get(row.key) ?? []) {
      lines.push(`  - ${key}: ${renderCell(result, baselineModules)}`);
    }
  }
  return lines.join('\n');
}

function renderCell(
  result: CellResult,
  baselineModules: number | undefined
): string {
  const per = EC_LEVELS.map((ec) => {
    const estimate = result.byEc[ec];
    return `${ec} ${estimate === null ? '—' : `v${estimate.version}`}`;
  }).join(' / ');
  const q = result.byEc.Q;
  const distance =
    q !== null && baselineModules !== undefined
      ? `, ×${(baselineModules / q.modules).toFixed(2)} scan distance vs baseline`
      : '';
  return `${per} (${q === null ? '—' : `${q.bits} bits`}, ${result.url.length} chars${distance})`;
}

// ——— Guard: the corpus really is query-legal raw (anti-strawman for A0/A1) ———

describe('corpus preconditions', () => {
  // Why this test matters: A0 appends the pointer URL RAW. That is only a
  // fair (non-strawman) baseline if nothing in it breaks query parsing:
  // no '&' (parameter split), '#' (fragment), '+' (URLSearchParams space),
  // '%' (escape introducer) or literal spaces.
  it('pointer rows contain only query-value-safe characters', () => {
    for (const payload of [C1, C2]) {
      expect(payload).not.toMatch(/[&#+%\s]/);
    }
  });
});

// ——— Hypotheses (plan §2) ———

describe('H1 — generic compression on short pointers is net-negative', () => {
  // Why this test matters: deflate has fixed overhead and base64url adds
  // +33 % — on a < 150-char URL there is no redundancy to pay for it. If
  // this ever flips, the pointer recommendation changes.
  it('deflate LOSES against the raw pointer on C1 and C2 at EC Q', () => {
    expect(qBits('C1', 'A2-deflate')).toBeGreaterThan(qBits('C1', 'A0-raw'));
    expect(qBits('C2', 'A2-deflate')).toBeGreaterThan(qBits('C2', 'A0-raw'));
  });

  it('deflate WINS against percent-encoded JSON on the multi-anchor C4 at EC Q', () => {
    expect(qBits('C4', 'A2-deflate')).toBeLessThan(qBits('C4', 'A1-json'));
  });
});

describe('H2 — the static dictionary beats generic deflate on pointers', () => {
  // Why this test matters: the dictionary has zero header overhead and
  // knows the domain's long prefixes; deflate cannot amortise on ~80 chars.
  it('dictionary bits < deflate bits on C1 and C2 at EC Q', () => {
    expect(qBits('C1', 'A4-dict')).toBeLessThan(qBits('C1', 'A2-deflate'));
    expect(qBits('C2', 'A4-dict')).toBeLessThan(qBits('C2', 'A2-deflate'));
  });
});

describe('H3 — QR alphanumeric mode can beat base64url despite more chars', () => {
  // Why this test matters: this is the §3 thesis that character count is
  // the wrong metric — the SAME deflate bytes, re-encoded to a longer but
  // alnum-mode string on an uppercase prefix, must cost fewer QR bits.
  it('uppercase-prefix base32(deflate) undercuts query-prefix base64url(deflate) on C4', () => {
    expect(qBits('C4', 'A6-32/defl')).toBeLessThan(qBits('C4', 'A2-deflate'));
  });

  it('base45 undercuts base32 on the same bytes (denser alnum packing) on C4', () => {
    expect(qBits('C4', 'A6-45/defl')).toBeLessThanOrEqual(
      qBits('C4', 'A6-32/defl')
    );
  });
});

describe('H4 — indirection dominates every compression scheme', () => {
  // Why this test matters: A7 is the reference lower bound (never the sole
  // shipped shape per decision D1) — every codec is judged by its distance
  // to this yardstick.
  it('the short-id URL needs the lowest version of the whole benchmark at EC Q', () => {
    const idVersion = qVersion('C5', 'A7-id');
    for (const [rowKey, candidates] of matrix) {
      for (const [candidateKey, result] of candidates) {
        const version = result.byEc.Q?.version ?? Number.POSITIVE_INFINITY;
        expect(
          version,
          `${rowKey}/${candidateKey} should not beat the A7 id`
        ).toBeGreaterThanOrEqual(idVersion);
      }
    }
  });
});

describe('H5 — gzip never beats deflate-raw (container overhead)', () => {
  it('gzip bits > deflate bits for every compressible row at EC Q', () => {
    for (const row of ['C1', 'C2', 'C3', 'C4']) {
      expect(
        qBits(row, 'A3-gzip'),
        `${row}: gzip must pay its container`
      ).toBeGreaterThan(qBits(row, 'A2-deflate'));
    }
  });
});
