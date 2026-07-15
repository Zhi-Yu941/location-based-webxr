# `console-egg.ts` — boot console easter egg (№5)

## Purpose

Prints a small ASCII pin logo + one wry line for visitors who open
devtools (catalog №5). Zero visual risk, no tracking/ledger (E4).

## Public API

- `printConsoleEgg(logger = console)` — prints once via `logger.info`
  with `%c` styling. Logger injected for tests.
- `CONSOLE_EGG_LINE`, `EggLogger`.

## Invariants & assumptions

- The `console.info` call is ENCAPSULATED here (the module's only
  `no-console` surface); callers just invoke `printConsoleEgg`.
- Pure output, no state, never throws (defaults to real console).

## Tests

`console-egg.test.ts` — logs the wry line + repo URL with matched `%c`
style args; default-console path doesn't throw.
