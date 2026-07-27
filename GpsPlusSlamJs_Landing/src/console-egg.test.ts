/**
 * Why this test matters: the console egg (catalog №5) is fire-and-forget
 * boot output — a regression that threw would break boot, and one that
 * dropped the repo URL would lose the only payload the egg carries.
 */
import { describe, expect, it, vi } from "vitest";
import { CONSOLE_EGG_LINE, printConsoleEgg } from "./console-egg";

describe("printConsoleEgg", () => {
  it("prints the wry line + repo URL via the injected logger with %c styling", () => {
    const info = vi.fn();
    printConsoleEgg({ info });
    expect(info).toHaveBeenCalledOnce();
    const [format, ...styles] = info.mock.calls[0]!;
    expect(String(format)).toContain(CONSOLE_EGG_LINE);
    expect(String(format)).toContain(
      "github.com/cs-util-com/location-based-webxr",
    );
    // %c placeholders come with matching style argument strings.
    expect((String(format).match(/%c/g) ?? []).length).toBe(styles.length);
    expect(styles.length).toBeGreaterThan(0);
  });

  it("defaults to the real console without throwing", () => {
    expect(() => printConsoleEgg()).not.toThrow();
  });
});
