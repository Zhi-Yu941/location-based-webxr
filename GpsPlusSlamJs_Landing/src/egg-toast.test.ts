/**
 * Why these tests matter: the egg toast is the only feedback channel the
 * hidden eggs have (no counters, no ledger — E4). If it failed to
 * appear the geocache would open silently; if it never hid, a stale
 * pill would sit over the story forever. The lifecycle (create once,
 * re-show resets the timer, auto-hide) is pinned against fake DOM/timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EGG_TOAST_ID,
  EGG_TOAST_VISIBLE_MS,
  showEggToast,
  type ToastDocument,
} from "./egg-toast";

interface FakeElement {
  id: string;
  textContent: string;
  classes: Set<string>;
  classList: { add(c: string): void; remove(c: string): void };
  setAttribute(name: string, value: string): void;
  attributes: Record<string, string>;
}

function makeFakeDoc(): { doc: ToastDocument; created: FakeElement[] } {
  const created: FakeElement[] = [];
  const makeElement = (): FakeElement => {
    const el: FakeElement = {
      id: "",
      textContent: "",
      classes: new Set(),
      classList: {
        add: (c) => el.classes.add(c),
        remove: (c) => el.classes.delete(c),
      },
      attributes: {},
      setAttribute: (name, value) => {
        el.attributes[name] = value;
      },
    };
    return el;
  };
  const doc: ToastDocument = {
    getElementById: (id) =>
      (created.find((el) => el.id === id) as unknown as HTMLElement) ?? null,
    createElement: () => {
      const el = makeElement();
      created.push(el);
      return el as unknown as HTMLElement;
    },
    body: { appendChild: () => {} },
  };
  return { doc, created };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("showEggToast", () => {
  it("creates the element once, marks it a status region, and shows the message", () => {
    const { doc, created } = makeFakeDoc();
    showEggToast("🎉 Cache found", doc);
    showEggToast("🎉 Cache found again", doc);
    expect(created).toHaveLength(1);
    const el = created[0]!;
    expect(el.id).toBe(EGG_TOAST_ID);
    expect(el.attributes.role).toBe("status");
    expect(el.textContent).toBe("🎉 Cache found again");
    expect(el.classes.has("visible")).toBe(true);
  });

  it("auto-hides after the visible window", () => {
    const { doc, created } = makeFakeDoc();
    showEggToast("hi", doc);
    vi.advanceTimersByTime(EGG_TOAST_VISIBLE_MS + 50);
    expect(created[0]!.classes.has("visible")).toBe(false);
  });

  it("re-showing resets the hide timer instead of hiding mid-display", () => {
    const { doc, created } = makeFakeDoc();
    showEggToast("first", doc);
    vi.advanceTimersByTime(EGG_TOAST_VISIBLE_MS - 200);
    showEggToast("second", doc);
    vi.advanceTimersByTime(300); // past the FIRST timer's deadline
    expect(created[0]!.classes.has("visible")).toBe(true);
    vi.advanceTimersByTime(EGG_TOAST_VISIBLE_MS);
    expect(created[0]!.classes.has("visible")).toBe(false);
  });
});
