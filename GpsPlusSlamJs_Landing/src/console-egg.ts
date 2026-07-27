/**
 * Console ASCII easter egg (catalog №5): on boot, print a small pin logo
 * and one wry line for the devtools-openers. Zero visual risk, no ledger
 * (E4 — no tracking). Styled with `%c`. The logger is injected so the
 * unit test needs no real console.
 */

/** The wry line. */
export const CONSOLE_EGG_LINE =
  "You read consoles. We read GPS. github.com/cs-util-com/location-based-webxr";

const PIN_ART = ["   .-.  ", "  ( o )  ", "   \\ /   ", "    V    "].join("\n");

/** Minimal logger seam (real: `console`). */
export interface EggLogger {
  info(...args: unknown[]): void;
}

/**
 * Print the console egg once. Uses `console.info` (only `no-console`
 * warn-level here, but the call site carries a scoped disable + comment
 * to keep lint output clean).
 */
export function printConsoleEgg(logger: EggLogger = console): void {
  logger.info(
    `%c${PIN_ART}%c\n${CONSOLE_EGG_LINE}`,
    "color:#ef4444;font-weight:bold",
    "color:#888",
  );
}
