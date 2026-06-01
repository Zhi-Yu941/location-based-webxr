/**
 * Tests for the inline `?show=` URL-state codec.
 *
 * Why this matters: this codec is the single source of truth for the placed
 * anchor under decision F1 (D1.1–D1.5) — it replaces the old `localStorage`
 * persistence. The setup state machine's branch selection (cache-miss vs
 * cache-hit) hinges on `decodeShowParam` being *total*: any malformed,
 * empty, or out-of-range param must resolve to "no anchor" (`null`) instead
 * of throwing. These tests pin that contract plus the compact-encoding and
 * round-trip guarantees that make the link short and shareable.
 */

import { describe, it, expect } from "vitest";
import {
  encodeAnchorsToShowParam,
  decodeShowParam,
  ANCHOR_VISUALIZATIONS,
  DEFAULT_VISUALIZATION,
  DEFAULT_SCALE,
  DEFAULT_ROTATION_DEG,
  type AnchorSpec,
} from "./url-anchor-state.js";

/** A fully-resolved spec with all defaults explicit, for round-trip checks. */
function spec(overrides: Partial<AnchorSpec> = {}): AnchorSpec {
  return {
    lat: 47.3769,
    lon: 8.5417,
    alt: 12,
    ui: 1,
    scale: 1,
    rotationDeg: 0,
    ...overrides,
  };
}

describe("documented defaults & visualization set", () => {
  it("pins the D1.1 default values", () => {
    expect(DEFAULT_VISUALIZATION).toBe(1);
    expect(DEFAULT_SCALE).toBe(1);
    expect(DEFAULT_ROTATION_DEG).toBe(0);
    expect([...ANCHOR_VISUALIZATIONS]).toEqual([1, 2, 3, 4]);
  });
});

describe("decodeShowParam — robustness (never throws)", () => {
  it("returns null for null / undefined / empty input", () => {
    expect(decodeShowParam(null)).toBeNull();
    expect(decodeShowParam(undefined)).toBeNull();
    expect(decodeShowParam("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(decodeShowParam("{not json")).toBeNull();
    expect(decodeShowParam("%7Bnot json")).toBeNull();
  });

  it("returns null when the envelope is not an object or lacks an `a` array", () => {
    expect(decodeShowParam("42")).toBeNull();
    expect(decodeShowParam("[]")).toBeNull();
    expect(decodeShowParam(JSON.stringify({ b: [] }))).toBeNull();
    expect(decodeShowParam(JSON.stringify({ a: 5 }))).toBeNull();
  });

  it("returns null for an empty anchor list", () => {
    expect(decodeShowParam(JSON.stringify({ a: [] }))).toBeNull();
  });
});

describe("decodeShowParam — validation & defaults", () => {
  it("decodes a minimal anchor and applies the D1.1 defaults", () => {
    const raw = JSON.stringify({ a: [{ lat: 47.3769, lon: 8.5417, alt: 12 }] });
    expect(decodeShowParam(raw)).toEqual([
      { lat: 47.3769, lon: 8.5417, alt: 12, ui: 1, scale: 1, rotationDeg: 0 },
    ]);
  });

  it("decodes all optional fields (name, ui, scale, rotation)", () => {
    const raw = JSON.stringify({
      a: [{ lat: 1, lon: 2, alt: 3, n: "Home", ui: 3, s: 2.5, r: 90 }],
    });
    expect(decodeShowParam(raw)).toEqual([
      {
        lat: 1,
        lon: 2,
        alt: 3,
        name: "Home",
        ui: 3,
        scale: 2.5,
        rotationDeg: 90,
      },
    ]);
  });

  it("requires a finite altitude — drops anchors without one", () => {
    expect(
      decodeShowParam(JSON.stringify({ a: [{ lat: 1, lon: 2 }] })),
    ).toBeNull();
    expect(
      decodeShowParam(JSON.stringify({ a: [{ lat: 1, lon: 2, alt: "x" }] })),
    ).toBeNull();
  });

  it("drops out-of-range lat/lon anchors but keeps valid neighbours", () => {
    const raw = JSON.stringify({
      a: [
        { lat: 200, lon: 2, alt: 1 }, // bad lat
        { lat: 1, lon: 2, alt: 5 }, // good
        { lat: 1, lon: 999, alt: 1 }, // bad lon
      ],
    });
    expect(decodeShowParam(raw)).toEqual([
      { lat: 1, lon: 2, alt: 5, ui: 1, scale: 1, rotationDeg: 0 },
    ]);
  });

  it("defaults an unknown/invalid `ui` back to 1", () => {
    const raw = JSON.stringify({ a: [{ lat: 1, lon: 2, alt: 3, ui: 9 }] });
    expect(decodeShowParam(raw)?.[0]?.ui).toBe(1);
  });

  it("defaults a non-positive / non-finite scale back to 1", () => {
    const raw = JSON.stringify({
      a: [
        { lat: 1, lon: 2, alt: 3, s: 0 },
        { lat: 1, lon: 2, alt: 3, s: -2 },
      ],
    });
    const decoded = decodeShowParam(raw);
    expect(decoded?.[0]?.scale).toBe(1);
    expect(decoded?.[1]?.scale).toBe(1);
  });

  it("normalises rotation into [0, 360)", () => {
    const raw = JSON.stringify({
      a: [
        { lat: 1, lon: 2, alt: 3, r: 450 },
        { lat: 1, lon: 2, alt: 3, r: -90 },
      ],
    });
    const decoded = decodeShowParam(raw);
    expect(decoded?.[0]?.rotationDeg).toBe(90);
    expect(decoded?.[1]?.rotationDeg).toBe(270);
  });

  it("ignores an empty-string name", () => {
    const raw = JSON.stringify({ a: [{ lat: 1, lon: 2, alt: 3, n: "" }] });
    expect(decodeShowParam(raw)?.[0]).not.toHaveProperty("name");
  });

  it("tolerates a percent-encoded (escaped) param value", () => {
    const escaped = encodeURIComponent(
      JSON.stringify({ a: [{ lat: 1, lon: 2, alt: 3 }] }),
    );
    expect(decodeShowParam(escaped)).toEqual([
      { lat: 1, lon: 2, alt: 3, ui: 1, scale: 1, rotationDeg: 0 },
    ]);
  });
});

describe("encodeAnchorsToShowParam — compact output", () => {
  it("produces a URI-escaped JSON envelope with short keys", () => {
    const param = encodeAnchorsToShowParam([spec()]);
    // The param is the percent-escaped form of its own JSON: escaping the
    // decoded value reproduces it exactly.
    expect(encodeURIComponent(decodeURIComponent(param))).toBe(param);
    const envelope = JSON.parse(decodeURIComponent(param)) as { a: unknown[] };
    expect(envelope.a).toHaveLength(1);
    expect(envelope.a[0]).toEqual({ lat: 47.3769, lon: 8.5417, alt: 12 });
  });

  it("omits default-valued fields (ui=1, s=1, r=0, empty name)", () => {
    const param = encodeAnchorsToShowParam([spec()]);
    const [a] = (JSON.parse(decodeURIComponent(param)) as { a: object[] }).a;
    expect(a).not.toHaveProperty("ui");
    expect(a).not.toHaveProperty("s");
    expect(a).not.toHaveProperty("r");
    expect(a).not.toHaveProperty("n");
  });

  it("includes non-default fields under their short keys", () => {
    const param = encodeAnchorsToShowParam([
      spec({ name: "Home", ui: 4, scale: 2, rotationDeg: 45 }),
    ]);
    const [a] = (JSON.parse(decodeURIComponent(param)) as { a: object[] }).a;
    expect(a).toMatchObject({ n: "Home", ui: 4, s: 2, r: 45 });
  });
});

describe("round-trip", () => {
  const cases: AnchorSpec[][] = [
    [spec()],
    [spec({ name: "Home", ui: 2, scale: 1.5, rotationDeg: 180 })],
    [spec({ lat: -33.8688, lon: 151.2093, alt: 0, ui: 3 })],
    [
      spec({ name: "A", ui: 4, scale: 0.5, rotationDeg: 270 }),
      spec({ lat: 0, lon: 0, alt: -5, name: "B" }),
    ],
  ];

  it.each(cases)("decode(encode(x)) deep-equals x", (...anchors) => {
    expect(decodeShowParam(encodeAnchorsToShowParam(anchors))).toEqual(anchors);
  });
});
