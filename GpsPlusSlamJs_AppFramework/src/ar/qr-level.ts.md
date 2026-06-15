# qr-level.ts

**Purpose:** Fetch + defensively validate the QR level file (§8) — Phase 6 of
the [QR-code detection & tracking plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-qr-code-detection-tracking-plan.md).
The printed QR encodes only a URL; the level file carries `physicalSizeM`
(drives the pose solve + size self-check), the absolute `geo` pose (drives the
synthetic vote), and the AR `content`.

## Public API

- `parseQrLevel(data: unknown): QrLevel` — validate an already-parsed value;
  throws `QrLevelValidationError` with a descriptive message. Heading is
  normalized into `[0, 360)`.
- `fetchQrLevel(url, { fetchImpl?, signal? }): Promise<QrLevel>` — fetch + parse
  - validate; rejects on non-OK response, non-JSON body, network failure, or
    schema violation. `fetchImpl` defaults to global `fetch`.
- `QrLevel`, `QrLevelValidationError`, `FetchLike`, `FetchQrLevelOptions`.

## Invariants & assumptions

- **External, user-authored data → validated at the boundary:** `version`
  finite; `qr.physicalSizeM` a positive finite number; `qr.geo.{lat∈[-90,90],
lon∈[-180,180], alt finite, headingDeg finite}`. Anything else throws.
- **`content` is opaque.** The AR content format is an open question (plan §12);
  it is carried through untouched and NOT interpreted here.
- **`qr.geo` is a `QrGeoPose`** — it feeds `buildQrGpsVotes` directly.
- Injected `fetchImpl` keeps the loader unit-testable and lets callers add
  caching/headers; the controller (`qr-tracking-controller.ts`) caches by URL.

## Tests

- `qr-level.test.ts` — valid parse (content preserved, heading normalized) and
  rejection of every malformed field; fetch success, non-OK, non-JSON, network
  failure, and propagated schema violation (all via an injected fetch).

## Related

- `qr.geo` → [qr-gps-vote.ts.md](qr-gps-vote.ts.md) (`QrGeoPose`).
- Consumed by [qr-tracking-controller.ts.md](qr-tracking-controller.ts.md).
